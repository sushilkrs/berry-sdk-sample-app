"""Build a student's merged profile from all of their documents.

Berry extracts one record per PDF and never combines them, so the app does. The profile is rebuilt
from scratch every time (after an upload, a re-send or a delete) and upserted whole, because a Berry
upsert replaces the record rather than merging into it.

Rules:
  - fullName and email typed in at registration always win (email falls back to the newest document);
  - other single-value fields: the newest document that has a value wins;
  - lists (skills, work experience, education) are combined and de-duplicated case-insensitively, and
    each entry keeps the id of the document it came from.
"""
from . import app_db

SINGLE_FIELDS = ["jobTitle", "location", "professionalSummary", "linkedInUrl", "githubUrl", "portfolioUrl"]


def _key(*parts) -> tuple:
    return tuple(" ".join(str(p or "").lower().split()) for p in parts)


def build_profile(student: dict, documents: list[dict], records: dict[str, dict]) -> dict:
    """student: app DB row; documents: the student's app DB rows; records: Berry document records by id."""
    profile = {
        "id": student["id"],
        "studentId": student["id"],
        "fullName": student["full_name"],
        "email": student.get("email") or "",
        **{f: "" for f in SINGLE_FIELDS},
        "skillsList": [],
        "skillSources": {},          # skill -> ids of the documents that list it (not in the schema; Berry keeps it)
        "workExperience": [],
        "education": [],
        "documentIds": [],
        "updatedAt": app_db.now(),
    }
    skills_seen: dict[tuple, str] = {}
    work_seen, edu_seen = set(), set()

    # oldest first, so a newer document overwrites single-value fields
    for doc in sorted(documents, key=lambda d: d["uploaded_at"]):
        rec = records.get(doc.get("berry_record_id") or "")
        if doc["status"] != "ingested" or not rec:
            continue
        doc_id = doc["id"]
        profile["documentIds"].append(doc_id)

        for f in SINGLE_FIELDS:
            if rec.get(f):
                profile[f] = rec[f]
        if not student.get("email") and rec.get("email"):
            profile["email"] = rec["email"]

        for skill in rec.get("skillsList") or []:
            if not isinstance(skill, str) or not skill.strip():
                continue
            k = _key(skill)
            name = skills_seen.setdefault(k, skill.strip())
            if name not in profile["skillsList"]:
                profile["skillsList"].append(name)
            sources = profile["skillSources"].setdefault(name, [])
            if doc_id not in sources:
                sources.append(doc_id)

        for w in rec.get("workExperience") or []:
            if not isinstance(w, dict) or not (w.get("company") or w.get("details")):
                continue
            # one entry per company; a newer document's description replaces the older one
            k = _key(w.get("company")) if w.get("company") else _key("", w.get("details"))
            entry = {"company": w.get("company") or "", "details": w.get("details") or "", "documentId": doc_id}
            if k in work_seen:
                profile["workExperience"] = [entry if _key(e["company"]) == k else e for e in profile["workExperience"]]
            else:
                work_seen.add(k)
                profile["workExperience"].append(entry)

        if rec.get("degreeName") or rec.get("institutionName"):
            k = _key(rec.get("degreeName"), rec.get("institutionName"))
            if k not in edu_seen:
                edu_seen.add(k)
                profile["education"].append({"degreeName": rec.get("degreeName") or "",
                                             "institutionName": rec.get("institutionName") or "",
                                             "graduationYear": rec.get("graduationYear") or 0,
                                             "documentId": doc_id})
    return profile
