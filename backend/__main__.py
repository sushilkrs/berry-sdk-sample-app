import uvicorn

from . import app_db, config

config.check()
app_db.init()
print(f"[*] Berry {config.BERRYDB_HOST}, database {config.BERRY_DATABASE}; app DB {config.SQLITE_PATH}")
uvicorn.run("backend.main:app", host="127.0.0.1", port=config.PORT, log_level="info")
