"""Everything this app asks of BerryDB.

The SDK is used for all of it except sending the file: SDK 1.7.7's Database.ingest_structured
takes only URLs, while the same endpoint also accepts the file itself as a multipart upload.
"""
import json
import time
from pathlib import Path

import requests
from berrydb import BerryDB

from . import config

INGEST_URL = "/berrydb/ingest/structured"
TEXT_FIELD = "content.text"  # where structured ingest stores the full text (declared in ResumeSchema)

_db = None


class BerryError(RuntimeError):
    pass


def database():
    global _db
    if _db is None:
        BerryDB.init(config.BERRYDB_HOST)
        _db = BerryDB.connect(config.BERRYDB_API_KEY, config.BERRY_DATABASE)
        if _db is None:
            raise BerryError(f"Database {config.BERRY_DATABASE} not found: run scripts/setup_berry.py")
    return _db


def ingest_file(path: Path, file_name: str, app_file_id: str) -> dict:
    """POST the PDF itself; Berry writes one ResumeSchema record and returns its id."""
    with path.open("rb") as fh:
        resp = requests.post(
            config.BERRYDB_HOST + INGEST_URL,
            headers={"x-api-key": config.BERRYDB_API_KEY},
            data={"database_name": config.BERRY_DATABASE,
                  # written onto the record, so it can be traced back to this app's row
                  "metadata": json.dumps({"appFileId": app_file_id})},
            files={"file": (file_name, fh, "application/pdf")},
            timeout=300,
        )
    try:
        body = resp.json()
    except ValueError:
        raise BerryError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    per_file = (body.get("per_file") or [{}])[0]
    if resp.status_code != 200 or not body.get("success") or per_file.get("error"):
        raise BerryError(per_file.get("error") or body.get("message") or f"HTTP {resp.status_code}: {body}")
    return per_file


def get_record(record_id: str) -> dict | None:
    docs = database().get_all_documents(document_ids=[record_id]) or []
    return docs[0] if docs else None


def get_record_retrying(record_id: str, attempts: int = 4) -> dict | None:
    """Berry reads are eventually consistent: a record just written may not be readable yet."""
    for i in range(attempts):
        rec = get_record(record_id)
        if rec:
            return rec
        time.sleep(2 * (i + 1))
    return None


def entities(record: dict) -> list[dict]:
    """NER spans Berry wrote onto the record, as [{text, label, start, end}], de-duplicated."""
    seen, out = set(), []
    for ann in record.get("annotations") or []:
        if ann.get("task") != "ner":
            continue
        for res in ann.get("results") or []:
            for e in res.get("output") or []:
                key = (e.get("start"), e.get("end"), e.get("label"))
                if key not in seen:
                    seen.add(key)
                    out.append({k: e.get(k) for k in ("text", "label", "start", "end")})
    return sorted(out, key=lambda e: (e["start"] or 0))


def ner_run_info(record: dict) -> dict | None:
    """Model, provider, time and token use of the latest NER run, as Berry recorded it."""
    runs = [a for a in record.get("annotations") or [] if a.get("task") == "ner"]
    if not runs:
        return None
    a = runs[-1]
    return {"provider": a.get("provider"), "model": a.get("model"), "elapsed_ms": a.get("elapsed_ms"),
            "usage": a.get("aggregate_usage")}


def run_ner(record_id: str):
    """Berry runs NER on the full text and writes the entities onto the record (asynchronous)."""
    return database().ner(TEXT_FIELD, document_ids=[record_id], annotate=True)


def delete_record(record_id: str):
    return database().delete_document(record_id)


def reachable() -> bool:
    try:
        requests.get(config.BERRYDB_HOST, timeout=5)
        return True
    except requests.RequestException:
        return False
