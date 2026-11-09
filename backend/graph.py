"""One student's knowledge graph for the profile page.

GET /api/students/{id}/graph -> {nodes, edges, sources}

Built server-side (the BerryDB key never reaches the browser) from:
  * the student's merged profile in BerryDB (the profiles database): skills, companies, education,
    location, job title;
  * the app's own document rows (which uploads belong to the student, and their BerryDB record ids);
  * BerryDB's graph projection of each document's NER annotations, read from universal-graph-service
    (GET /universal-api/graph/enrich on the documents database). UGS keys each annotated field by
    asset::uuid5(NS, "<record id>|content.text|ner") and links it to object::<type>::<hash> entity
    nodes with "mentioned_in" edges; we keep the edges of THIS student's documents only. UGS types
    every NER entity as "misc", so the label (PERSON / ORGANIZATION / ...) is taken from the record's
    own NER annotation;
  * fallback when UGS is unreachable or has not projected a document yet: the NER annotation on the
    BerryDB record itself.
Entities that name the same thing as a profile value (e.g. ORGANIZATION "Infosys" and the company
"Infosys") collapse into one node.
"""
import re
import time
import uuid

import requests
from fastapi import HTTPException

from . import app_db, berry_client, config

ASSET_NS = uuid.UUID("6a4c1e83-6d5f-5e83-9c2f-be2242000a55")  # universal-graph-service _WS4_ASSET_NAMESPACE
UGS_URL = config.BERRY_GRAPH_API
UGS_ORG = config.BERRY_ORG_NAME
_cache: dict[str, tuple[float, dict]] = {}
CACHE_S = 20

NER_TYPE = {"PERSON": "person", "PER": "person", "ORGANIZATION": "organization", "ORG": "organization",
            "LOCATION": "location", "LOC": "location", "GPE": "location", "DATE": "date"}


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def asset_id(record_id: str) -> str:
    return f"asset::{uuid.uuid5(ASSET_NS, f'{record_id}|{berry_client.TEXT_FIELD}|ner')}"


def _ugs_graph() -> dict:
    """The documents database's projected graph, cached briefly (it covers every student)."""
    hit = _cache.get(config.BERRY_DATABASE)
    if hit and hit[0] > time.time():
        return hit[1]
    headers = {"x-api-key": config.BERRYDB_API_KEY}
    if UGS_ORG:
        headers["x-org-name"] = UGS_ORG
    r = requests.get(f"{UGS_URL}/graph/enrich", params={"database": config.BERRY_DATABASE, "depth": 2},
                     headers=headers, timeout=30)
    r.raise_for_status()
    data = r.json()
    _cache[config.BERRY_DATABASE] = (time.time() + CACHE_S, data)
    return data


class _G:
    def __init__(self):
        self.nodes: dict[str, dict] = {}
        self.edges: dict[str, dict] = {}

    def node(self, nid, label, ntype, source, **data):
        n = self.nodes.get(nid)
        if n is None:
            n = self.nodes[nid] = {"id": nid, "label": str(label), "type": ntype, "sources": [], "data": {}}
        if source not in n["sources"]:
            n["sources"].append(source)
        n["data"].update({k: v for k, v in data.items() if v not in (None, "", [], {})})
        return nid

    def edge(self, src, dst, label, source, **data):
        eid = f"{src}|{label}|{dst}"
        if eid not in self.edges:
            self.edges[eid] = {"id": eid, "source": src, "target": dst, "label": label, "sources": [source],
                               "data": {k: v for k, v in data.items() if v not in (None, "", [], {})}}
        elif source not in self.edges[eid]["sources"]:
            self.edges[eid]["sources"].append(source)


def student_graph(student_id: str) -> dict:
    student = app_db.get_student(student_id)
    if not student:
        raise HTTPException(404, "Student not found")
    docs = [d for d in app_db.documents_of(student_id) if d["status"] == "ingested" and d["berry_record_id"]]
    notes = []
    try:
        profile = berry_client.get_profile(student_id) or {}
    except Exception as e:
        profile, _ = {}, notes.append(f"Profile not readable from BerryDB: {str(e)[:200]}")
    try:
        records = berry_client.get_records([d["berry_record_id"] for d in docs])
    except Exception as e:
        records, _ = {}, notes.append(f"Document records not readable from BerryDB: {str(e)[:200]}")

    P, D, U, N = "BerryDB profile", "App DB", "BerryDB graph (universal-graph-service)", "BerryDB NER annotation"
    g = _G()
    sid = g.node(f"student::{student_id}", profile.get("fullName") or student["full_name"], "student", D,
                 email=profile.get("email") or student.get("email"), studentId=student_id,
                 jobTitle=profile.get("jobTitle"), professionalSummary=profile.get("professionalSummary"),
                 linkedInUrl=profile.get("linkedInUrl"), githubUrl=profile.get("githubUrl"),
                 portfolioUrl=profile.get("portfolioUrl"), profileUpdatedAt=profile.get("updatedAt"))
    if profile:
        g.nodes[sid]["sources"].append(P)

    # ---- profile values ----
    if profile.get("jobTitle"):
        g.edge(sid, g.node(f"role::{_norm(profile['jobTitle'])}", profile["jobTitle"], "role", P), "HAS_ROLE", P)
    if profile.get("location"):
        g.edge(sid, g.node(f"location::{_norm(profile['location'])}", profile["location"], "location", P),
               "LOCATED_IN", P)
    for skill in profile.get("skillsList") or []:
        if isinstance(skill, str) and skill.strip():
            g.edge(sid, g.node(f"skill::{_norm(skill)}", skill.strip(), "skill", P,
                               documents=(profile.get("skillSources") or {}).get(skill)), "HAS_SKILL", P)
    for w in profile.get("workExperience") or []:
        if isinstance(w, dict) and w.get("company"):
            g.edge(sid, g.node(f"organization::{_norm(w['company'])}", w["company"], "company", P),
                   "WORKED_AT", P, details=w.get("details"), documentId=w.get("documentId"))
    for e in profile.get("education") or []:
        if not isinstance(e, dict):
            continue
        inst = e.get("institutionName")
        inst_id = g.node(f"organization::{_norm(inst)}", inst, "institution", P) if inst else None
        if e.get("degreeName"):
            deg = g.node(f"degree::{_norm(e['degreeName'])}|{_norm(inst)}", e["degreeName"], "degree", P,
                         graduationYear=e.get("graduationYear") or None, institution=inst)
            g.edge(sid, deg, "HAS_DEGREE", P, graduationYear=e.get("graduationYear") or None)
            if inst_id:
                g.edge(deg, inst_id, "AWARDED_BY", P)
        elif inst_id:
            g.edge(sid, inst_id, "STUDIED_AT", P)

    # ---- documents + their entities ----
    ugs, ugs_ok = None, False
    try:
        ugs = _ugs_graph()
        ugs_ok = True
    except Exception as e:
        notes.append(f"universal-graph-service not reachable, entities from the NER annotation instead: {str(e)[:160]}")
    ugs_nodes = {n["id"]: n for n in (ugs or {}).get("nodes", [])}
    counts = {"ugs_entities": 0, "ner_entities": 0}

    for d in docs:
        rec = records.get(d["berry_record_id"]) or {}
        did = g.node(f"document::{d['id']}", d["file_name"], "document", D, documentId=d["id"],
                     berryRecordId=d["berry_record_id"], pages=d.get("pages"), uploadedAt=d.get("uploaded_at"),
                     fieldsFilled=d.get("fields_filled"), nerStatus=d.get("ner_status"))
        if rec:
            g.nodes[did]["sources"].append("BerryDB documents")
        g.edge(sid, did, "HAS_DOCUMENT", D)
        ents = berry_client.entities(rec) if rec else []
        label_of = {}
        for e in ents:
            label_of.setdefault(_norm(e["text"]), e["label"])

        def add_entity(text, ner_label, source, **extra):
            t = NER_TYPE.get(str(ner_label or "").upper(), "entity")
            key = _norm(text)
            # collapse into a profile node naming the same thing
            for cand in (f"{t}::{key}", f"organization::{key}" if t == "organization" else None,
                         f"location::{key}" if t == "location" else None):
                if cand and cand in g.nodes:
                    nid = cand
                    g.node(nid, g.nodes[nid]["label"], g.nodes[nid]["type"], source, nerLabel=ner_label, **extra)
                    break
            else:
                nid = g.node(f"{t}::{key}", text, t, source, nerLabel=ner_label, **extra)
            g.edge(did, nid, "MENTIONS", source)

        aid = asset_id(d["berry_record_id"])
        projected = [e for e in (ugs or {}).get("edges", []) if e.get("source") == aid and e.get("target") in ugs_nodes]
        if projected:
            for e in projected:
                n = ugs_nodes[e["target"]]
                add_entity(n.get("label") or n["id"], label_of.get(_norm(n.get("label"))), U,
                           graphNodeId=n["id"], graphAssetId=aid, graphEdge=e.get("label"))
                counts["ugs_entities"] += 1
        else:
            for e in ents:
                add_entity(e["text"], e["label"], N)
                counts["ner_entities"] += 1
            if ents and ugs_ok:
                notes.append(f"{d['file_name']}: not projected by universal-graph-service yet; showing its NER annotation")

    return {"student_id": student_id, "nodes": list(g.nodes.values()), "edges": list(g.edges.values()),
            "counts": {**counts, "nodes": len(g.nodes), "edges": len(g.edges), "documents": len(docs)},
            "sources": {"profile_database": config.BERRY_PROFILE_DATABASE, "documents_database": config.BERRY_DATABASE,
                        "graph": "universal-graph-service /graph/enrich" if ugs_ok else None},
            "notes": notes}
