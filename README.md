# BerryDB SDK sample app

A small resume-intake app that shows how to integrate with **hosted BerryDB** from your own backend
using the [BerryDB Python SDK](https://pypi.org/project/BerryDbNew/) (`BerryDbNew`).

Upload a resume PDF and the app:

1. saves the file to `storage/<id>/<file name>`;
2. records it in the app's **own** database (SQLite, `data/app.db`): file name, type, size, SHA-256,
   path, upload time and processing status;
3. sends the PDF to BerryDB, which extracts **one structured resume record** (name, contact details,
   summary, skills, work experience, education) and returns its id, which the app stores on its row;
4. on request, asks BerryDB to run **named-entity recognition** on the resume text. BerryDB saves the
   entities (people, organizations, locations, dates) on the same record.

The UI labels every piece of information with where it comes from: the app's database or BerryDB.

Only a BerryDB API key is needed. BerryDB runs the AI for extraction and entity recognition.

## How it talks to BerryDB

| Step | Call |
|---|---|
| Send a PDF for extraction | `POST /berrydb/ingest/structured`, multipart form with `database_name`, `file` and optional `metadata` (JSON). SDK 1.7.7's `Database.ingest_structured` accepts URLs only, so the app calls the endpoint directly to send the file itself. |
| Read a record | SDK: `db.get_all_documents(document_ids=[id])` |
| Entity recognition | SDK: `db.ner("content.text", document_ids=[id], annotate=True)` |
| Delete a record | SDK: `db.delete_document(id)` |

All BerryDB calls live in [`backend/berry_client.py`](backend/berry_client.py).

## Project layout

```
berry-sdk-sample-app/
├── backend/                         Python API (FastAPI); also serves frontend/
│   ├── main.py                      HTTP endpoints: upload, list, detail, resend, NER, delete
│   ├── berry_client.py              every BerryDB call
│   ├── app_db.py                    the app's own SQLite database
│   ├── config.py                    settings from .env
│   ├── requirements.txt
│   └── berry_setup/                 one-time BerryDB setup, not used while the app runs
│       ├── ResumeSchema.json        the schema definition registered in BerryDB
│       └── create_schema_and_database.py
├── frontend/                        static UI: index.html, css/, js/
├── storage/                         uploaded files (created at runtime, not committed)
├── data/app.db                      app database (created at runtime, not committed)
└── .env.example
```

## Getting started

Requirements: Python 3.11 or later and a BerryDB API key (from your account settings at
[app.berrydb.io](https://app.berrydb.io)).

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.txt     # macOS/Linux: .venv/bin/python
cp .env.example .env                                                # then put your API key in .env
.venv/Scripts/python -m backend.berry_setup.create_schema_and_database   # once per BerryDB organization
.venv/Scripts/python -m backend                                     # open http://127.0.0.1:8800
```

The setup step registers `ResumeSchema` and creates the database `ResumePlaygroundKG` in your organization.
It skips anything that already exists, so it is safe to run again. The SDK host is `https://api.berrydb.io`;
`app.berrydb.io` is the web app, not the API.

## Where data lives

| What | Where |
|---|---|
| Uploaded files | `storage/<id>/<file name>` |
| File records and processing status | SQLite `data/app.db`, table `files` |
| Extracted profile, full text, entities | BerryDB database `ResumePlaygroundKG` (schema `ResumeSchema`) |

`ResumeSchema` declares a `content.text` field. Structured ingest stores the full resume text there, and
BerryDB's entity recognition only runs on fields the schema declares.

To browse the app database, open `data/app.db` with any SQLite viewer, for example the
SQLite Viewer extension for VS Code or DB Browser for SQLite.

## Limitations

- PDF only, up to 50 MB per file. Scanned PDFs without a text layer are rejected by BerryDB.
- BerryDB derives a record's id from the database and the file's content, so the same PDF always maps to the
  same record. The app therefore refuses a second upload of an identical file.
- Re-sending a file replaces its BerryDB record, including any entity annotations; run entity recognition again
  afterwards.

## License

[MIT](LICENSE)
