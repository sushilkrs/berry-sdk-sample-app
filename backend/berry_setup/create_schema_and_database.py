"""One-time Berry setup: register the two schemas (the JSON files next to this script) and create the
two databases the app writes to. Safe to re-run: skips what exists.

    ResumeSchema         -> ResumePlaygroundKG  one record per uploaded PDF, written by structured ingest
    StudentProfileSchema -> StudentProfiles     one merged record per student, written by the app

    .venv/Scripts/python -m backend.berry_setup.create_schema_and_database
"""
import json

import requests
from berrydb import BerryDB

from backend import config  # loads .env

config.check()
host, key = config.BERRYDB_HOST, config.BERRYDB_API_KEY
PAIRS = [(config.BERRY_SCHEMA, config.BERRY_DATABASE),
         (config.BERRY_PROFILE_SCHEMA, config.BERRY_PROFILE_DATABASE)]


def schema_exists(schema_name: str) -> bool:
    r = requests.get(f"{host}/profile/schema", params={"schemaName": schema_name, "apiKey": key}, timeout=30)
    return r.status_code == 200 and "schema" in (r.json() or {})


def create_schema(schema_name: str, schema: dict) -> None:
    """The SDK's create_schema first; if the server rejects its body, the flat body it accepts."""
    if BerryDB.create_schema(key, schema_name, schema["description"], schema):
        print(f"[+] schema {schema_name}: created with the SDK")
        return
    body = {
        "name": schema_name,
        "description": schema["description"],
        "rawSchema": schema["rawSchema"],
        "dataTypes": schema["schemaDataTypes"],
        "filterFields": schema["filterFields"],
        "indexFields": schema["indexFields"],
        "displayTextField": schema["displayTextField"],
        "displayImageField": schema["displayImageField"],
        "embeddedType": False,
    }
    r = requests.post(f"{host}/profile/schema", params={"apiKey": key}, json=body, timeout=60)
    if r.status_code not in (200, 201):
        raise SystemExit(f"[!] schema {schema_name} failed: HTTP {r.status_code} {r.text[:300]}")
    print(f"[+] schema {schema_name}: created with the API fallback (the SDK call was rejected)")


BerryDB.init(host)
for schema_name, db_name in PAIRS:
    if schema_exists(schema_name):
        print(f"[=] schema {schema_name} exists")
    else:
        create_schema(schema_name, json.loads((config.BERRY_SETUP / f"{schema_name}.json").read_text()))

    existing = BerryDB.databases(key) or {}
    if db_name in existing:
        print(f"[=] database {db_name} exists (schema {existing[db_name]['schemaName']})")
    else:
        BerryDB.create_database(key, db_name, schema_name)
        print(f"[+] database {db_name}: created")
