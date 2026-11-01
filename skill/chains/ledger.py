"""ledger — the prompt ledger: one full record (prompt + response) per model call, appended to
daily JSONL files and loaded idempotently into the corpus Postgres table `prompt_ledger`.

  record(source, model, messages_or_prompt, response, **meta)   never raises into the caller
  set_context(**kv) / context(**kv)                              run_id / lesson_id / session_id for nested calls
  chain_call(source, model_dict, instruction, user_input, fn)    awaits a chain call and records it
  load_to_pg() / status()                                        loader and machine-readable state

CLI: python3 ledger.py load | status
"""
from __future__ import annotations
import contextlib, contextvars, hashlib, json, os, sys, threading, time, uuid
from datetime import datetime, timezone
from pathlib import Path

MAX_FILE_BYTES = 64 * 1024 * 1024        # a day file past this rolls to YYYY-MM-DD.N.jsonl
LEARNER = "gyasi"
TABLE = "prompt_ledger"
FIELDS = ("call_id", "ts", "source", "run_id", "step", "model", "endpoint", "params", "prompt", "response",
          "tokens_in", "tokens_out", "reasoning_chars", "latency_ms", "finish_reason", "status", "error",
          "lesson_id", "session_id", "learner")

_lock = threading.Lock()
_ctx: contextvars.ContextVar[dict] = contextvars.ContextVar("ledger_ctx", default={})
_stats = {"failures": 0, "last_error": None, "last_load": None}


def ledger_dir() -> Path:
    env = os.environ.get("CHIRON_LEDGER_DIR")
    return Path(env) if env else Path(__file__).resolve().parent.parent / "server" / "state" / "ledger"


def _fail(what: str, e: BaseException) -> None:
    msg = f"{type(e).__name__}: {e}"
    _stats["failures"] += 1
    _stats["last_error"] = f"{what}: {msg}"[:300]
    try:
        sys.stderr.write(f"[ledger] {what} failed: {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass


# ── context ──────────────────────────────────────────────────────────────────

def set_context(**kv) -> None:
    """Merge kv into the current context (None values are dropped)."""
    _ctx.set({**_ctx.get(), **{k: v for k, v in kv.items() if v is not None}})


@contextlib.contextmanager
def context(**kv):
    token = _ctx.set({**_ctx.get(), **{k: v for k, v in kv.items() if v is not None}})
    try:
        yield
    finally:
        _ctx.reset(token)


def new_run_id() -> str:
    return uuid.uuid4().hex


# ── writer ───────────────────────────────────────────────────────────────────

def _target(day: str) -> Path:
    d = ledger_dir()
    d.mkdir(parents=True, exist_ok=True)
    n = 0
    while True:
        p = d / (f"{day}.jsonl" if n == 0 else f"{day}.{n}.jsonl")
        if not p.exists() or p.stat().st_size < MAX_FILE_BYTES:
            return p
        n += 1


def record(source: str, model: str | None, messages_or_prompt, response: str | None, **meta) -> str | None:
    """Append one record; returns its call_id, or None if the write failed."""
    try:
        now = datetime.now(timezone.utc)
        prompt = messages_or_prompt if isinstance(messages_or_prompt, str) else json.dumps(
            messages_or_prompt, ensure_ascii=False, default=str)
        ctx = _ctx.get()
        rec = {"call_id": None, "ts": now.isoformat(), "source": source,
               "run_id": meta.get("run_id", ctx.get("run_id")), "step": meta.get("step"),
               "model": model, "endpoint": meta.get("endpoint"), "params": meta.get("params"),
               "prompt": prompt, "response": response, "tokens_in": meta.get("tokens_in"),
               "tokens_out": meta.get("tokens_out"), "reasoning_chars": meta.get("reasoning_chars"),
               "latency_ms": meta.get("latency_ms"), "finish_reason": meta.get("finish_reason"),
               "status": meta.get("status", "ok"), "error": meta.get("error"),
               "lesson_id": meta.get("lesson_id", ctx.get("lesson_id")),
               "session_id": meta.get("session_id", ctx.get("session_id")), "learner": LEARNER}
        rec["call_id"] = hashlib.sha256(
            f"{rec['ts']}{source}{model}{prompt}{response}".encode("utf-8", "replace")).hexdigest()[:32]
        line = json.dumps(rec, ensure_ascii=False, default=str) + "\n"
        with _lock:
            with open(_target(now.strftime("%Y-%m-%d")), "a", encoding="utf-8") as f:
                f.write(line)
        return rec["call_id"]
    except BaseException as e:      # the ledger must never break the call it observes
        if isinstance(e, (KeyboardInterrupt, SystemExit)):
            raise
        _fail("write", e)
        return None


def _usage_meta(usage: dict | None) -> dict:
    u = usage or {}
    return {"tokens_in": u.get("prompt_tokens"), "tokens_out": u.get("output_tokens", u.get("completion_tokens")),
            "reasoning_chars": u.get("thinking_chars", u.get("reasoning_chars"))}


async def chain_call(source: str, model_dict: dict, instruction: str, user_input: str, fn):
    """Await fn(user_input) (a chain's process_prompt_async), record the call, re-raise any error."""
    prompt = instruction.replace("{input}", str(user_input)) if "{input}" in instruction else instruction
    model = (model_dict or {}).get("name")
    t0 = time.time()
    try:
        out = await fn(user_input)
    except BaseException as e:
        record(source, model, prompt, None, status="cancelled" if not isinstance(e, Exception) else "error",
               error=f"{type(e).__name__}: {e}"[:500], latency_ms=int((time.time() - t0) * 1000))
        raise
    record(source, model, prompt, out if isinstance(out, str) else str(out),
           latency_ms=int((time.time() - t0) * 1000))
    return out


# ── status ───────────────────────────────────────────────────────────────────

def status() -> dict:
    d = ledger_dir()
    try:
        files = sorted(p.name for p in d.glob("*.jsonl"))
    except Exception as e:
        files = []
        _fail("status", e)
    return {"dir": str(d), "files": len(files), "latest": files[-1] if files else None,
            "failures": _stats["failures"], "last_error": _stats["last_error"], "last_load": _stats["last_load"]}


# ── loader ───────────────────────────────────────────────────────────────────

_DDL = """
create table if not exists {t} (
  call_id text primary key, ts timestamptz not null, source text not null, run_id text, step text,
  model text, endpoint text, params jsonb, prompt text, response text, tokens_in integer,
  tokens_out integer, reasoning_chars integer, latency_ms integer, finish_reason text, status text,
  error text, lesson_id text, session_id text, learner text
);
create index if not exists {t}_ts on {t} (ts);
create index if not exists {t}_source on {t} (source);
create index if not exists {t}_session on {t} (session_id);
create index if not exists {t}_lesson on {t} (lesson_id);
"""


def pg_connect():
    """Connect with CHIRON_PG_DSN, else the DSN line in ~/.chiron/corpus.env. The DSN is never printed."""
    import psycopg
    dsn = os.environ.get("CHIRON_PG_DSN")
    if not dsn:
        envf = Path.home() / ".chiron" / "corpus.env"
        if envf.exists():
            for line in envf.read_text().splitlines():
                if line.startswith("CHIRON_PG_DSN="):
                    dsn = line.split("=", 1)[1].strip()
    if not dsn:
        raise RuntimeError("CHIRON_PG_DSN not set (see ~/.chiron/corpus.env)")
    return psycopg.connect(dsn, autocommit=True)


def _row(rec: dict) -> tuple:
    vals = []
    for k in FIELDS:
        v = rec.get(k)
        if k == "params" and v is not None:
            v = json.dumps(v, ensure_ascii=False, default=str)
        vals.append(v)
    return tuple(vals)


def load_to_pg(conn=None) -> dict:
    """Insert records added since the last load. Idempotent: ON CONFLICT (call_id) DO NOTHING plus a
    per-file byte watermark in <dir>/.loaded.json; a partial trailing line waits for the next load."""
    res = {"files": 0, "read": 0, "inserted": 0, "skipped": 0, "errors": 0}
    own = conn is None
    d = ledger_dir()
    try:
        if own:
            conn = pg_connect()
        conn.execute(_DDL.format(t=TABLE))
        d.mkdir(parents=True, exist_ok=True)
        mark_p = d / ".loaded.json"
        try:
            marks = json.loads(mark_p.read_text())
        except Exception:
            marks = {}
        cols = ", ".join(FIELDS)
        ph = ", ".join(["%s"] * len(FIELDS))
        sql = f"insert into {TABLE} ({cols}) values ({ph}) on conflict (call_id) do nothing"
        for p in sorted(d.glob("*.jsonl")):
            off = int(marks.get(p.name, 0))
            if p.stat().st_size <= off:
                continue
            with open(p, "rb") as f:
                f.seek(off)
                data = f.read()
            end = data.rfind(b"\n") + 1
            if not end:
                continue
            res["files"] += 1
            errs_before = res["errors"]
            for raw in data[:end].splitlines():
                if not raw.strip():
                    continue
                res["read"] += 1
                try:
                    cur = conn.execute(sql, _row(json.loads(raw)))
                    if cur.rowcount:
                        res["inserted"] += 1
                    else:
                        res["skipped"] += 1
                except Exception as e:
                    res["errors"] += 1
                    _fail("load row", e)
            if res["errors"] == errs_before:       # a file with a failed row is re-read next load (inserts are idempotent)
                marks[p.name] = off + end
        tmp = mark_p.with_suffix(".tmp")
        tmp.write_text(json.dumps(marks))
        tmp.replace(mark_p)
    finally:
        if own and conn is not None:
            conn.close()
    _stats["last_load"] = {**res, "at": datetime.now(timezone.utc).isoformat()}
    return res


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "load":
        print(json.dumps(load_to_pg()))
    elif cmd == "status":
        print(json.dumps(status()))
    else:
        sys.exit("usage: ledger.py load | status")
