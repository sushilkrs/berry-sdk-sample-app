"""Natural-language search over the merged student profiles, with the SDK only.

  1. LLMAgent.chat() sends the question to Berry GPT with our own LLM key; the system prompt holds the
     StudentProfiles schema, and the model answers with one SQL++ SELECT.
  2. The app checks that statement (a single SELECT scoped to the profiles database) and runs it with
     Database.query(), which returns every matching document, not just the top few.

Berry GPT is a plain LLM pass-through here: it never sees the database, so the schema and the rules for
writing the query live in this prompt.
"""
import contextlib
import io
import json
import re
import time

from berrydb import LLMAgent

from . import berry_client, config

BUCKET = "BerryDb"  # every Berry database lives in this one bucket; databaseName tells them apart

PROMPT = """You turn a question about students into ONE Couchbase SQL++ (N1QL) SELECT statement.

Each student is one JSON document in the bucket `{bucket}`. Documents of other databases share that
bucket, so the WHERE clause MUST be exactly: WHERE p.databaseName = "{database}" AND (<conditions>)
with every condition inside those parentheses.

Document shape (example values show the type):
{shape}

Field types:
{types}

Rules:
- Write FROM `{bucket}` AS p, and select META(p).id AS id and p.fullName, plus the fields the
  question is about.
- Skills are ONLY in p.skillsList (an array of strings). Match a skill case-insensitively and exactly:
  ANY s IN p.skillsList SATISFIES LOWER(s) = "java" END
  Do not use LIKE for skills ("java" must not match "javascript").
- Combine conditions with AND / OR as the question says.
- Arrays of objects: ANY w IN p.workExperience SATISFIES ... END
- An IN list is an array, so it takes square brackets, never parentheses:
  right: LOWER(s) IN ["python", "go"]      wrong: LOWER(s) IN ("python", "go")
- "How many" questions: select only the count, with no other fields and no GROUP BY:
  SELECT COUNT(*) AS total FROM `{bucket}` AS p WHERE ...
  (an exception to the id and fullName rule above)
- Backtick the reserved words `value`, `start` and `end`.
- No LIMIT unless the question asks for a number of students.
- Read only: one SELECT, no subqueries, no UNION.
- If the question cannot be answered from these fields, reply with: CANNOT: <short reason>

Reply with the statement only: no explanation, no code fences.

Question: {{{{question}}}}"""


class SearchError(RuntimeError):
    def __init__(self, message: str, partial: dict | None = None):
        super().__init__(message)
        self.partial = partial or {}  # what was done before the failure (the model's reply, the query)


def _system_prompt() -> str:
    schema = json.loads(config.SCHEMA_FILES[config.BERRY_PROFILE_SCHEMA].read_text())
    return PROMPT.format(bucket=BUCKET, database=config.BERRY_PROFILE_DATABASE,
                         shape=json.dumps(schema["rawSchema"], indent=1),
                         types=json.dumps(schema["schemaDataTypes"], indent=1))


def _agent() -> LLMAgent:
    return (LLMAgent.Builder()
            .provider(config.LLM_PROVIDER)
            .model(config.LLM_MODEL or None)
            # Berry GPT treats 0 as "not set" and uses 0.7, so ask for almost-deterministic instead
            .temperature(0.01)
            .system_prompt(_system_prompt())
            .build())


def extract_sql(reply: str) -> str:
    """The SELECT from the model's reply; models often wrap it in code fences despite being told not to."""
    text = re.sub(r"```[a-zA-Z]*", "", reply or "").strip()
    if text.upper().startswith("CANNOT:"):
        raise SearchError(f"The model could not write a query: {text[7:].strip()}")
    m = re.search(r"\bSELECT\b", text, re.IGNORECASE)
    if not m:
        raise SearchError(f"The model did not return a SELECT statement: {text[:300]}")
    return text[m.start():].strip().rstrip(";").strip()


def _close_paren(text: str, start: int) -> int:
    """Index just past the parenthesis that closes text[start] == "(", skipping quoted strings; -1 if none."""
    depth, quote = 0, None
    for i in range(start, len(text)):
        c = text[i]
        if quote:
            quote = None if c == quote else quote
        elif c in "\"'`":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i + 1
    return -1


def check_sql(sql: str) -> None:
    """One SELECT that can only return StudentProfiles documents. db.query() refuses writes on its own;
    the scope check is ours, because a query names its database in WHERE, not in FROM. The WHERE must be
    the scope followed by AND (conditions), so no OR can reach past it."""
    if ";" in sql:
        raise SearchError("The query has more than one statement")
    if not re.match(r"SELECT\b", sql, re.IGNORECASE):
        raise SearchError("Only SELECT statements are run")
    if len(re.findall(r"\bSELECT\b", sql, re.IGNORECASE)) > 1 or re.search(r"\bUNION\b", sql, re.IGNORECASE):
        raise SearchError("Subqueries and UNION are not run")
    db = re.escape(config.BERRY_PROFILE_DATABASE)
    m = re.search(rf'\bWHERE\s+(?:\w+\.)?databaseName\s*=\s*["\']{db}["\']\s*', sql, re.IGNORECASE)
    if not m:
        raise SearchError(f'The query must start its WHERE with databaseName = "{config.BERRY_PROFILE_DATABASE}"')
    rest = sql[m.end():]
    cond = re.match(r"AND\s*\(", rest, re.IGNORECASE)
    if cond:
        end = _close_paren(rest, cond.end() - 1)
        if end < 0:
            raise SearchError("Unbalanced parentheses in the query")
        rest = rest[end:]
    if not re.match(r"\s*(ORDER\s+BY|GROUP\s+BY|LIMIT|OFFSET|$)", rest, re.IGNORECASE):
        raise SearchError("All conditions must sit inside AND ( ... ) after the database scope")


def run_query(sql: str) -> list[dict]:
    """db.query() prints the reason and returns "" when a query fails; keep the printed reason."""
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed):
        result = berry_client.profiles().query(sql)
    if not result:
        raise SearchError(printed.getvalue().strip() or "The query failed")
    return result.get("documents") or []


def search(question: str) -> dict:
    if not config.LLM_API_KEY:
        raise SearchError("Missing LLM_API_KEY: set it in .env to search in plain English")
    berry_client.profiles()  # BerryDB.init(): LLMAgent posts to the same host

    t0 = time.monotonic()
    try:
        reply = _agent().chat(config.LLM_API_KEY, {"question": question})
    except Exception as e:
        raise SearchError(f"Berry GPT call failed: {e}")
    t1 = time.monotonic()
    answer = reply.get("answer") if isinstance(reply, dict) else reply
    out = {"question": question, "llm_reply": answer, "llm_ms": round((t1 - t0) * 1000),
           "provider": config.LLM_PROVIDER, "model": config.LLM_MODEL}
    try:
        out["sql"] = extract_sql(str(answer or ""))
        check_sql(out["sql"])
        out["rows"] = run_query(out["sql"])
    except SearchError as e:
        raise SearchError(str(e), out)
    out["query_ms"] = round((time.monotonic() - t1) * 1000)
    return out
