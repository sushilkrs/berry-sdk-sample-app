import uvicorn

from . import app_db, config

config.check()
app_db.init()
print(f"[*] Berry {config.BERRYDB_HOST}: documents in {config.BERRY_DATABASE}, profiles in "
      f"{config.BERRY_PROFILE_DATABASE}; app DB {config.SQLITE_PATH}")
uvicorn.run("backend.main:app", host="127.0.0.1", port=config.PORT, log_level="info")
