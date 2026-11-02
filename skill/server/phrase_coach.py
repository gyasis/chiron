"""phrase_coach — the phrase-coach chain behind an Ollama-compatible endpoint the Ask page already speaks.

    POST /ask/phrase/api/chat   acolyte's /api/chat body -> NDJSON (`message.content` chunks, then done:true)
    GET  /ask/phrase/api/tags   one pseudo-model, so acolyte's model picker has something to list
    POST /ask/phrase/api/show   its capabilities

The reply comes from chains/2026-11-01_chiron-phrase-coach-chain `coach(messages)`; the prompts live in the chain,
never in the page. A run is a server-side task (phrase_runs) that outlives the connection: a browser disconnect cancels
nothing, the same request sent again attaches to the run (replaying what it has emitted, then continuing live; a finished run
is returned at once with no model calls), and only a newer, different request from the same X-Ask-Session supersedes it.
A run that fails ends the stream with the error line ask_proxy.error_line uses, so acolyte shows "Answer interrupted".

    GET  /ask/phrase/run/<run_id>   {status, content_so_far, done, error, user, elapsed_s} for a page that lost its stream
    GET  /ask/phrase/run/latest     the same for this session's newest run (the page does not need to know the id)
    The chat response carries X-Phrase-Run: <run_id> (X-Phrase-Run-Attached: 1 when it joined an existing run).
"""
from __future__ import annotations
import asyncio, contextlib, importlib.util, json, sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / "chains"))
import ask_proxy  # noqa: E402
import local_models  # noqa: E402
import phrase_related  # noqa: E402
import phrase_runs  # noqa: E402

CHAIN_FILE = SKILL / "chains" / "2026-11-01_chiron-phrase-coach-chain" / "run.py"
MODEL_ID = "phrase-coach"

router = APIRouter()
STORE = phrase_runs.RunStore()
_coach = None            # the chain's coach(); tests replace it
_chain = None


def _log(msg: str) -> None:
    sys.stderr.write(f"[phrase_coach] {msg}\n")
    sys.stderr.flush()


def get_coach():
    """Load the chain module once. Its directory name is not importable, hence the file loader."""
    global _coach, _chain
    if _coach is None:
        spec = importlib.util.spec_from_file_location("chiron_phrase_coach_chain", CHAIN_FILE)
        _chain = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_chain)
        _chain.GOVERNOR = local_models.GOVERNOR     # the chain's own default is the neutral localhost
        _chain.RELATED = phrase_related.find_related    # "Study more": lessons in the library for the phrase's topics
        _coach = _chain.coach
    return _coach


def ndjson_line(text: str) -> bytes:
    return json.dumps({"model": MODEL_ID, "message": {"role": "assistant", "content": text}, "done": False},
                      ensure_ascii=False).encode() + b"\n"


def ndjson_done() -> bytes:
    return json.dumps({"model": MODEL_ID, "message": {"role": "assistant", "content": ""}, "done": True,
                       "done_reason": "stop"}).encode() + b"\n"


async def events(msgs: list, session_id: str):
    """("text", chunk) per section as the chain finishes it, then ("done", result). A coach() replaced by a test (or any
    callable that returns the whole reply) is sent as one chunk."""
    coach = get_coach()
    if coach is _chain.coach:
        async for ev in _chain.coach_stream(msgs, session_id=session_id):
            yield ev
    else:
        res = await coach(msgs, session_id=session_id)
        yield ("text", res["content"])
        yield ("done", res)


@router.get("/ask/phrase/api/tags")
def tags():
    return {"models": [{"name": MODEL_ID, "model": MODEL_ID}]}


@router.post("/ask/phrase/api/show")
def show():
    return {"capabilities": ["completion"], "model_info": {}}


async def drive(emit, msgs: list, key: str) -> dict:
    result: dict = {}
    async for kind, val in events(msgs, key):
        if kind == "text":
            emit(val)
        else:
            result = val
    return result


@router.get("/ask/phrase/run/latest")
async def run_latest(request: Request):
    run = STORE.latest_for(ask_proxy.session_key(request))
    if run is None:
        raise HTTPException(404, "no run for this session")
    return run.view(STORE.clock())


@router.get("/ask/phrase/run/{rid}")
async def run_status(rid: str):
    run = STORE.get(rid)
    if run is None:
        raise HTTPException(404, f"no run {rid!r} (finished runs are kept {int(STORE.ttl_s)} s)")
    return run.view(STORE.clock())


@router.post("/ask/phrase/api/chat")
async def chat(request: Request):
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "body is not JSON")
    msgs = body.get("messages") if isinstance(body, dict) else None
    if not isinstance(msgs, list) or not all(isinstance(m, dict) for m in msgs):
        raise HTTPException(400, "body needs a messages list")

    url = "/ask/phrase/api/chat"
    key = ask_proxy.session_key(request)
    run, attached = STORE.start(key, msgs, drive)
    _log(f"{key}: run {run.id} {'attached to the existing run (' + run.status + ')' if attached else 'started'}")
    headers = {"X-Phrase-Run": run.id, "X-Phrase-Run-Attached": "1" if attached else "0"}

    async def stream():
        i = 0
        while True:
            await run.wait_change(i)
            while i < len(run.chunks):
                yield ndjson_line(run.chunks[i])          # one whole section per line: a fenced block never arrives half-sent
                i += 1
            if run.status != "running":
                break
        if run.status != "done":
            yield ask_proxy.error_line(url, run.error or run.status)
            return
        r = run.result
        _log(f"{key}: run {run.id} kind={r.get('kind')} first_text_ms={r.get('first_text_ms')} total_ms={r.get('total_ms')} steps="
             + ",".join(f"{s['step']}:{s['model']}:{s['latency_ms']}ms:{s['done_reason']}" for s in r.get("steps", [])))
        yield ndjson_done()

    if body.get("stream") is False:
        # acolyte asks for a single JSON reply whenever the request carries tools, and reads it with .json(),
        # so the sections are folded into one Ollama /api/chat object. A failure becomes an HTTP error,
        # which acolyte's non-stream path reports instead of rendering an empty answer.
        while run.status == "running":
            await run.wait_change(len(run.chunks))
        if run.status != "done":
            return JSONResponse({"error": run.error or run.status}, status_code=502, headers=headers)
        return JSONResponse({"model": MODEL_ID, "message": {"role": "assistant", "content": "".join(run.chunks)},
                             "done": True, "done_reason": "stop"}, headers=headers)
    return StreamingResponse(stream(), media_type="application/x-ndjson", headers=headers)
