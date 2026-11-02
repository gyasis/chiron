"""pimsleur_jobs — turn phrases the Ask phrase coach built into a Pimsleur SEASON, through the generate job system.

    POST /api/pimsleur/from-phrases
        {phrases:[{it, en?, register?}] | collection:"pimsleur-basket", topic?, lessons?, confirm:true, dry?}

The phrases are written to a JSON source file (state/pimsleur-from-phrases/<hash>.json) headed by an instruction to use
them as the drill TARGETS; the Pimsleur chain's planner is told (CH_TARGETS=given, see chains/dispatch.py) to use exactly
those phrases. The run is a normal job: app.generate() queues it (JOBS, state/<id>.log, Jobs/Activity, the library).
Audio bakes on the Mac path: CHIRON_PIMSLEUR_ENGINE is forced to "mac" (Modal costs money and is never chosen here).

  - confirm:true is required: a season costs a generation run plus an audio bake (as raccolte' lesson action).
  - the same phrase set (content hash of the sorted, folded `it`) returns the existing job: {duplicate:true, url}.
  - the browser-origin guard of /api/anki/* applies: only Chiron's own page origins and the app can start a run.
  - dry:true returns the source file and the env the run would get, and starts nothing.
  - from a collection: after a NEW run starts, the items move to a collection named after the topic and the basket
    empties; a duplicate leaves the basket alone.
"""
from __future__ import annotations
import hashlib, json, os, re, subprocess, sys
from pathlib import Path

from fastapi import APIRouter
from starlette.requests import Request
from starlette.responses import JSONResponse

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / "chains"))
import dispatch  # noqa: E402
import raccolte  # noqa: E402

STATE = Path(os.environ.get("CHIRON_PIMSLEUR_STATE", SKILL / "server" / "state")) / "pimsleur-from-phrases"
GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
MIN_FROM_COLLECTION, MAX_LESSONS, MAX_PHRASES = 3, 8, 40
LIVE = ("queued", "running", "baking", "ready", "published")      # a job in one of these makes the same set a duplicate
HEADER = ("TARGET PHRASES chosen by the learner. Use these exact phrases, with this wording and register, as the drill "
          "targets of the season. Do not invent your own targets or replace these.")

router = APIRouter()
SUBMIT = None          # app.py: fn(GenReq-shaped dict) -> generate()'s reply; a test sets a mock
JOBS: dict = {}        # app.py's job table
ORIGIN_OK = None       # app.py: fn(request) -> True | None | False (the /api/anki/* origin check)


def _log(msg: str) -> None:
    sys.stderr.write(f"[pimsleur-jobs] {msg}\n")
    sys.stderr.flush()


def _reply(status: int, error: str, **kw) -> JSONResponse:
    return JSONResponse({"ok": False, "error": error, **kw}, status_code=status)


def phrase_hash(phrases: list[dict]) -> str:
    return hashlib.sha256("\n".join(sorted(raccolte.fold(p["it"]) for p in phrases)).encode()).hexdigest()[:12]


def derive_topic(phrases: list[dict]) -> str:
    """A short theme from the first phrases: their English intents when present, else the Italian."""
    def short(p):
        t = (p.get("en") or p["it"]).strip().rstrip("?.!")
        return " ".join(t.split()[:5])
    return "Coach phrases: " + "; ".join(short(p) for p in phrases[:3])


def topic_slug(topic: str) -> str:
    return dispatch._slug("language-it", "pimsleur", topic)


def _free_topic(topic: str) -> str:
    """A derived topic whose season file already exists is numbered, so a new set never resumes a stale plan."""
    t, n = topic, 2
    while (GEN / f"{topic_slug(t)}.season.json").exists():
        t, n = f"{topic} ({n})", n + 1
    return t


def mac_warning() -> str | None:
    """None when the Mac Studio answers the fleet check, else why the audio bake will not run."""
    try:
        r = subprocess.run(["fleet-locate", "--json", "--node", "macstudio"], capture_output=True, text=True, timeout=25)
        d = json.loads(r.stdout)
    except Exception as e:
        return f"Could not check the Mac Studio ({type(e).__name__}); the audio bake runs there and may wait or fail."
    if "macstudio" not in (d.get("found") or {}):
        return "Mac Studio is away — the audio bake will wait/fail until it is back (fleet-locate does not see it)."
    down = [k for k, v in ((d.get("services") or {}).get("macstudio") or {}).items() if not v and k in ("governor", "omnivoice-tts", "whisper")]
    if down:
        return f"Mac Studio is up but {', '.join(down)} is down — the audio bake will wait/fail."
    return None


def source_doc(phrases: list[dict]) -> dict:
    return {"_instructions": HEADER,
            "targets": [{"it": p["it"], "en": p.get("en", ""), "register": p.get("register", "")} for p in phrases]}


def read_collection(cid: str) -> list[dict]:
    with raccolte._lock:
        col = raccolte._get(raccolte._load(), cid)
        rows = raccolte._active(col)
    out = []
    for r in rows:
        m = re.search(r"register:(lei|tu|neutral)", r.get("note") or "")
        out.append({"it": r["it"], "en": r.get("en", ""), "register": m.group(1) if m else ""})
    return out


def clean_phrases(raw) -> list[dict] | str:
    """The usable phrases, or the reason there are none."""
    if not isinstance(raw, list) or not raw:
        return "phrases must be a non-empty list of {it, en?, register?}"
    if len(raw) > MAX_PHRASES:
        return f"too many phrases ({len(raw)} > {MAX_PHRASES})"
    out, seen = [], set()
    for p in raw:
        if not isinstance(p, dict) or not isinstance(p.get("it"), str) or not p["it"].strip():
            return "every phrase needs an `it` string"
        it = re.sub(r"\s+", " ", p["it"]).strip()[:300]
        if raccolte.fold(it) in seen:
            continue
        seen.add(raccolte.fold(it))
        reg = p.get("register") if p.get("register") in ("lei", "tu", "neutral") else ""
        out.append({"it": it, "en": str(p.get("en") or "").strip()[:300], "register": reg})
    return out


def run_env(topic: str, path: Path, lessons: int | None) -> dict:
    """The environment the job would run the chain with (what dispatch.resolve adds, plus the stage, slug and bake engine)."""
    res = dispatch.resolve("language-it", "pimsleur", topic, None, {"source_file": str(path), "lessons": lessons})
    return {**res["env"], "CH_STAGE": "all", "CH_SLUG": res["slug"], "CHIRON_PIMSLEUR_ENGINE": "mac"}


def existing_job(h: str) -> dict | None:
    return next((j for j in JOBS.values() if (j.get("extra") or {}).get("phrase_hash") == h and j.get("status") in LIVE), None)


def move_basket(cid: str, topic: str, phrases: list[dict]) -> dict:
    """Keep the history: the basket's items go to a collection named after the season, then the basket is emptied."""
    col = raccolte.api_create({"name": topic})
    raccolte.add_items(col["id"], [{"it": p["it"], "en": p["en"], "source": "ask-phrase",
                                    "note": f"register:{p['register']}" if p["register"] else ""} for p in phrases])
    for p in phrases:
        raccolte.api_remove(cid, p["it"])
    return {"id": col["id"], "name": col["name"]}


@router.post("/api/pimsleur/from-phrases")
async def from_phrases(request: Request):
    ok = ORIGIN_OK(request) if ORIGIN_OK else None
    if ok is False:
        _log(f"refused origin {request.headers.get('origin')!r}")
        return _reply(403, "origin not allowed")
    try:
        b = await request.json()
    except ValueError:
        b = None
    if not isinstance(b, dict):
        return _reply(400, "body must be a JSON object")
    if b.get("confirm") is not True:
        return _reply(400, "a Pimsleur season costs a generation run plus an audio bake: send confirm:true")

    cid = b.get("collection")
    if cid is not None:
        if not isinstance(cid, str):
            return _reply(400, "collection must be a collection id")
        try:
            phrases = read_collection(cid)
        except Exception as e:
            return _reply(404, f"collection {cid!r}: {getattr(e, 'detail', e)}")
        if len(phrases) < MIN_FROM_COLLECTION:
            return _reply(400, f"a season needs at least {MIN_FROM_COLLECTION} phrases; {cid!r} holds {len(phrases)}")
    else:
        phrases = clean_phrases(b.get("phrases"))
        if isinstance(phrases, str):
            return _reply(400, phrases)
    lessons = b.get("lessons")
    if lessons is not None and (isinstance(lessons, bool) or not isinstance(lessons, int) or not 1 <= lessons <= MAX_LESSONS):
        return _reply(400, f"lessons must be an integer from 1 to {MAX_LESSONS}")
    topic_in = b.get("topic")
    if topic_in is not None and not isinstance(topic_in, str):
        return _reply(400, "topic must be a string")
    h = phrase_hash(phrases)

    dup = existing_job(h)
    if dup:
        return {"ok": True, "duplicate": True, "job_id": dup["id"], "status": dup.get("status"), "topic": dup.get("subject"),
                "url": dup.get("lesson_url") or "/library/", "note": "already exists — this phrase set already has a Pimsleur season"}

    topic = re.sub(r"\s+", " ", topic_in or "").strip()[:120]
    if not topic:
        topic = _free_topic(derive_topic(phrases))
    elif (GEN / f"{topic_slug(topic)}.season.json").exists():
        return _reply(409, f"a Pimsleur season on {topic!r} already exists with different phrases: change the topic")
    path = STATE / f"{h}.json"
    doc = source_doc(phrases)
    warn = mac_warning()
    if b.get("dry"):
        return {"ok": True, "dry": True, "topic": topic, "slug": topic_slug(topic), "phrase_hash": h, "lessons": lessons,
                "source_file": {"path": str(path), "content": doc}, "env": run_env(topic, path, lessons),
                **({"warning": warn} if warn else {})}
    if SUBMIT is None:
        return _reply(503, "the generate job system is not wired")
    STATE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    res = SUBMIT({"domain": "language-it", "depth": "pimsleur", "subject": topic, "stage": "all",
                  "source": "Chiron · Ask phrase coach", "source_ref": h,
                  "extra": {"source_file": str(path), "lessons": lessons, "phrase_hash": h, "phrases": len(phrases)}})
    if res.get("duplicate"):     # generate() joined an in-flight or failed job of the same slug
        return {"ok": True, "duplicate": True, "job_id": res.get("job_id"), "status": res.get("status"), "topic": topic,
                "url": "/library/", "note": res.get("note") or "already exists"}
    out = {"ok": True, "duplicate": False, "job_id": res.get("job_id"), "slug": res.get("slug"), "status": res.get("status"),
           "topic": topic, "phrases": len(phrases), "url": "/library/"}
    if warn:
        out["warning"] = warn
    if cid is not None:
        try:
            out["moved_to"] = move_basket(cid, topic, phrases)
        except Exception as e:
            _log(f"basket move failed after the run started: {type(e).__name__}: {e}")
            out["basket_error"] = f"the run started but the basket was not emptied: {getattr(e, 'detail', e)}"
    _log(f"{res.get('job_id')}: {len(phrases)} phrases, topic {topic!r}, hash {h}")
    return out
