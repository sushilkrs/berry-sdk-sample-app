"""The app's own database (SQLite, data/app.db). Berry holds the extracted resume; this holds the
files, how far each one got, and a few display fields copied from Berry so the list needs no Berry
call. The app knows its own state even when Berry is slow or down."""
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    id               TEXT PRIMARY KEY,          -- uuid, also the storage folder name
    file_name        TEXT NOT NULL,
    file_type        TEXT NOT NULL,             -- MIME type as uploaded
    file_size        INTEGER NOT NULL,          -- bytes
    sha256           TEXT NOT NULL UNIQUE,      -- Berry ids records by content, so one row per content
    file_path        TEXT NOT NULL,             -- relative to the project root: storage/<id>/<name>
    uploaded_at      TEXT NOT NULL,
    status           TEXT NOT NULL,             -- stored | sending | ingested | failed
    berry_database   TEXT,
    berry_record_id  TEXT,
    fields_filled    INTEGER,
    pages            INTEGER,
    text_field       TEXT,
    ingested_at      TEXT,
    error            TEXT,
    ner_status       TEXT,                      -- requested | done | failed
    ner_requested_at TEXT,
    ner_error        TEXT,
    candidate_name   TEXT,                      -- copied from the Berry record for the list
    job_title        TEXT,
    location         TEXT,
    entity_count     INTEGER
);
"""

# columns added after the first version; added to an existing data/app.db on start
_ADDED = {"candidate_name": "TEXT", "job_title": "TEXT", "location": "TEXT", "entity_count": "INTEGER"}

_lock = threading.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _conn():
    con = sqlite3.connect(config.SQLITE_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init() -> None:
    with _lock, _conn() as con:
        con.executescript(SCHEMA)
        have = {r["name"] for r in con.execute("PRAGMA table_info(files)")}
        for col, typ in _ADDED.items():
            if col not in have:
                con.execute(f"ALTER TABLE files ADD COLUMN {col} {typ}")


def insert(row: dict) -> None:
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    with _lock, _conn() as con:
        con.execute(f"INSERT INTO files ({cols}) VALUES ({marks})", list(row.values()))


def update(file_id: str, **fields) -> None:
    sets = ", ".join(f"{k} = ?" for k in fields)
    with _lock, _conn() as con:
        con.execute(f"UPDATE files SET {sets} WHERE id = ?", [*fields.values(), file_id])


def get(file_id: str) -> dict | None:
    with _conn() as con:
        r = con.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    return dict(r) if r else None


def by_hash(sha256: str) -> dict | None:
    with _conn() as con:
        r = con.execute("SELECT * FROM files WHERE sha256 = ?", (sha256,)).fetchone()
    return dict(r) if r else None


def all_files() -> list[dict]:
    with _conn() as con:
        return [dict(r) for r in con.execute("SELECT * FROM files ORDER BY uploaded_at DESC")]


def delete(file_id: str) -> None:
    with _lock, _conn() as con:
        con.execute("DELETE FROM files WHERE id = ?", (file_id,))
