"""Settings from the environment or a .env file in the project root (see .env.example)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # project root
FRONTEND = ROOT / "frontend"
BERRY_SETUP = ROOT / "backend" / "berry_setup"


def _load_dotenv(path: Path) -> None:
    """KEY=value lines; variables already set in the environment win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


_load_dotenv(ROOT / ".env")

BERRYDB_HOST = os.environ.get("BERRYDB_HOST", "https://api.berrydb.io").rstrip("/")
BERRYDB_API_KEY = os.environ.get("BERRYDB_API_KEY", "")
BERRY_DATABASE = os.environ.get("BERRY_DATABASE", "ResumePlaygroundKG")
BERRY_SCHEMA = os.environ.get("BERRY_SCHEMA", "ResumeSchema")
# one merged record per student, id = the student's UUID
BERRY_PROFILE_DATABASE = os.environ.get("BERRY_PROFILE_DATABASE", "StudentProfiles")
BERRY_PROFILE_SCHEMA = os.environ.get("BERRY_PROFILE_SCHEMA", "StudentProfileSchema")

STORAGE = Path(os.environ.get("APP_STORAGE", ROOT / "storage"))
SQLITE_PATH = Path(os.environ.get("APP_SQLITE", ROOT / "data" / "app.db"))
PORT = int(os.environ.get("APP_PORT", "8800"))


def check() -> None:
    if not BERRYDB_API_KEY:
        raise SystemExit("Missing BERRYDB_API_KEY: set it in .env (copy .env.example)")
    STORAGE.mkdir(parents=True, exist_ok=True)
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
