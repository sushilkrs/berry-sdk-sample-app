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

# Natural-language search: our own LLM key, sent through Berry GPT (SDK LLMAgent) to write the query
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "openai").lower()   # openai | anthropic | openrouter
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
# Berry GPT's own Anthropic default is not a valid model name, so always send one
LLM_MODEL = os.environ.get("LLM_MODEL") or {"anthropic": "claude-sonnet-5-5", "openrouter": "openrouter/free"}.get(LLM_PROVIDER, "gpt-4o-mini")

STORAGE = Path(os.environ.get("APP_STORAGE", ROOT / "storage"))
SQLITE_PATH = Path(os.environ.get("APP_SQLITE", ROOT / "data" / "app.db"))
PORT = int(os.environ.get("APP_PORT", "8800"))


def check() -> None:
    if not BERRYDB_API_KEY:
        raise SystemExit("Missing BERRYDB_API_KEY: set it in .env (copy .env.example)")
    STORAGE.mkdir(parents=True, exist_ok=True)
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
