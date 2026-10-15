"""Resume KG playground API: upload resumes, keep them locally, let BerryDB extract them.
Also serves the frontend/ folder.

    .venv/Scripts/python -m backend
"""
import hashlib
import re
import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import app_db, berry_client, config

app = FastAPI(title="Resume KG playground")
_pool = ThreadPoolExecutor(max_workers=3)

MAX_BYTES = 50 * 1024 * 1024  # the ingest endpoint's own limit
PROFILE_FIELDS = ["fullName", "jobTitle", "location", "email", "linkedInUrl", "githubUrl", "portfolioUrl",
                  "professionalSummary", "skillsList", "workExperience", "degreeName", "institutionName",
                  "graduationYear", "academicUnits", "documentUrl"]


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.\- ]", "_", name or "file.pdf")[:150] or "file.pdf"


def _file_or_404(file_id: str) -> dict:
    row = app_db.get(file_id)
    if not row:
        raise HTTPException(404, "File not found")
    return row


def _copy_display_fields(file_id: str, record: dict) -> None:
    """Keep the name, title and location on the app's row so the list needs no Berry call."""
    app_db.update(file_id, candidate_name=record.get("fullName") or None, job_title=record.get("jobTitle") or None,
                  location=record.get("location") or None)


def _send(file_id: str) -> None:
    """Send one stored file to Berry and record the outcome on its row."""
    row = app_db.get(file_id)
    if not row:
        return
    app_db.update(file_id, status="sending", error=None)
    try:
        res = berry_client.ingest_file(config.ROOT / row["file_path"], row["file_name"], file_id)
    except Exception as e:  # the file stays stored; it can be sent again
        app_db.update(file_id, status="failed", error=str(e)[:1000])
        return
    app_db.update(file_id, status="ingested", berry_database=config.BERRY_DATABASE, berry_record_id=res["id"],
                  fields_filled=res.get("fields_filled"), pages=res.get("pages"), text_field=res.get("text_field"),
                  ingested_at=app_db.now(), error=None)
    try:
        record = berry_client.get_record_retrying(res["id"])
        if record:
            _copy_display_fields(file_id, record)
    except Exception:  # display fields are filled on the next detail view instead
        pass


@app.post("/api/files")
async def upload(files: list[UploadFile] = File(...)):
    results = []
    for f in files:
        name = _safe_name(f.filename)
        data = await f.read()
        if not name.lower().endswith(".pdf") or not data.startswith(b"%PDF"):
            results.append({"file_name": name, "error": "Only PDF files can be sent to Berry"})
            continue
        if len(data) > MAX_BYTES:
            results.append({"file_name": name, "error": "File is over 50 MB"})
            continue
        digest = hashlib.sha256(data).hexdigest()
        dup = app_db.by_hash(digest)
        if dup:
            results.append({"file_name": name, "error": f"Already uploaded as {dup['file_name']}", "id": dup["id"]})
            continue
        file_id = str(uuid.uuid4())
        target = config.STORAGE / file_id / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        app_db.insert({"id": file_id, "file_name": name, "file_type": f.content_type or "application/pdf",
                       "file_size": len(data), "sha256": digest, "file_path": f"storage/{file_id}/{name}",
                       "uploaded_at": app_db.now(), "status": "stored"})
        _pool.submit(_send, file_id)
        results.append({"file_name": name, "id": file_id})
    return results


@app.get("/api/files")
def list_files():
    return app_db.all_files()


@app.get("/api/files/{file_id}")
def file_detail(file_id: str):
    """The app's row, plus the live Berry record read through the SDK on every call."""
    row = _file_or_404(file_id)
    out = {"file": row, "profile": None, "entities": [], "entity_groups": [], "text": "", "ner_run": None,
           "berry_meta": None, "record": None, "berry_error": None}
    if not row["berry_record_id"]:
        return out
    try:
        record = berry_client.get_record(row["berry_record_id"])
    except Exception as e:
        out["berry_error"] = f"Could not read the record from Berry: {str(e)[:300]}"
        return out
    if not record:
        out["berry_error"] = "Berry has not made this record readable yet; try again in a few seconds."
        return out

    ents = berry_client.entities(record)
    updates = {}
    if not row["candidate_name"] and record.get("fullName"):
        _copy_display_fields(file_id, record)
    if ents and (row["ner_status"] != "done" or row["entity_count"] != len(ents)):
        updates.update(ner_status="done", entity_count=len(ents), ner_error=None)
    elif not ents and row["ner_status"] == "done":  # re-ingesting replaces the record, annotations included
        updates.update(ner_status=None, entity_count=None)
    if updates:
        app_db.update(file_id, **updates)
        row = app_db.get(file_id)

    groups = {}
    for e in ents:
        g = groups.setdefault(e["label"], [])
        if e["text"] not in g:
            g.append(e["text"])
    meta = record.get("_meta") or {}
    out.update(
        file=row,
        profile={k: record.get(k) for k in PROFILE_FIELDS},
        entities=ents,
        entity_groups=[{"label": k, "values": v} for k, v in groups.items()],
        text=(record.get("content") or {}).get("text", ""),
        ner_run=berry_client.ner_run_info(record),
        berry_meta={"id": record.get("id"), "database": meta.get("databaseName"),
                    "databaseId": meta.get("databaseId"), "organization": meta.get("organizationName"),
                    "uploadedTime": meta.get("uploadedTime"), "appFileId": record.get("appFileId")},
        record=record,
    )
    return out


@app.get("/api/files/{file_id}/download")
def download(file_id: str):
    row = _file_or_404(file_id)
    path = config.ROOT / row["file_path"]
    if not path.is_file():
        raise HTTPException(410, "The stored file is missing")
    return FileResponse(path, filename=row["file_name"], media_type="application/pdf",
                        content_disposition_type="inline")


@app.post("/api/files/{file_id}/send")
def resend(file_id: str):
    row = _file_or_404(file_id)
    if row["status"] == "sending":
        raise HTTPException(409, "Already being sent")
    _pool.submit(_send, file_id)
    return {"ok": True}


@app.post("/api/files/{file_id}/ner")
def ner(file_id: str):
    row = _file_or_404(file_id)
    if not row["berry_record_id"]:
        raise HTTPException(409, "Send the file to Berry first")
    try:
        job = berry_client.run_ner(row["berry_record_id"])
    except Exception as e:
        app_db.update(file_id, ner_status="failed", ner_error=str(e)[:1000], ner_requested_at=app_db.now())
        raise HTTPException(502, f"NER failed: {e}")
    app_db.update(file_id, ner_status="requested", ner_error=None, ner_requested_at=app_db.now())
    return {"ok": True, "job": job}


@app.delete("/api/files/{file_id}")
def delete(file_id: str):
    row = _file_or_404(file_id)
    if row["berry_record_id"]:
        try:
            berry_client.delete_record(row["berry_record_id"])
        except Exception as e:
            raise HTTPException(502, f"Could not delete the Berry record, nothing was removed: {e}")
    shutil.rmtree(config.STORAGE / file_id, ignore_errors=True)
    app_db.delete(file_id)
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"berry_host": config.BERRYDB_HOST, "berry_database": config.BERRY_DATABASE,
            "berry_schema": config.BERRY_SCHEMA, "berry_reachable": berry_client.reachable()}


app.mount("/", StaticFiles(directory=config.FRONTEND, html=True), name="frontend")
