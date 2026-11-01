"""phrase_coach — the phrase-coach chain behind an Ollama-compatible endpoint the Ask page already speaks.

    POST /ask/phrase/api/chat   acolyte's /api/chat body -> NDJSON (`message.content` chunks, then done:true)
    GET  /ask/phrase/api/tags   one pseudo-model, so acolyte's model picker has something to list
    POST /ask/phrase/api/show   its capabilities

The reply comes from chains/2026-11-01_chiron-phrase-coach-chain `coach(messages)`; the prompts live in the chain,
never in the page. Same single-flight as /ask/llm (ask_proxy): one coach run per X-Ask-Session, a newer request
or a browser disconnect cancels the run in flight. A run that fails ends the stream with the error line
ask_proxy.error_line uses, so acolyte shows "Answer interrupted" instead of a reply that merely stops.
"""
from __future__ import annotations
import asyncio, contextlib, importlib.util, json, sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from starlette.requests import Request
from starlette.responses import StreamingResponse

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / "chains"))
import ask_proxy  # noqa: E402
import local_models  # noqa: E402

CHAIN_FILE = SKILL / "chains" / "2026-11-01_chiron-phrase-coach-chain" / "run.py"
MODEL_ID = "phrase-coach"
CHUNK_LINES = 4          # lines per streamed delta: the reply is complete before it is sent, this only paces the render

router = APIRouter()
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
        _coach = _chain.coach
    return _coach


def ndjson_chunks(text: str) -> list[bytes]:
    lines = text.splitlines(keepends=True)
    parts = ["".join(lines[i:i + CHUNK_LINES]) for i in range(0, len(lines), CHUNK_LINES)] or [text]
    out = [json.dumps({"model": MODEL_ID, "message": {"role": "assistant", "content": p}, "done": False},
                      ensure_ascii=False).encode() + b"\n" for p in parts]
    out.append(json.dumps({"model": MODEL_ID, "message": {"role": "assistant", "content": ""}, "done": True,
                           "done_reason": "stop"}).encode() + b"\n")
    return out


@router.get("/ask/phrase/api/tags")
def tags():
    return {"models": [{"name": MODEL_ID, "model": MODEL_ID}]}


@router.post("/ask/phrase/api/show")
def show():
    return {"capabilities": ["completion"], "model_info": {}}


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
    cancel, gone = asyncio.Event(), asyncio.Event()
    old = ask_proxy._inflight.get(key)
    if old is not None and not old.is_set():
        _log(f"{key}: new coach run supersedes the one in flight — cancelling it")
        old.set()
    ask_proxy._inflight[key] = cancel
    watcher = asyncio.ensure_future(ask_proxy._watch_disconnect(request, gone, cancel))

    def why() -> str:
        return "browser disconnected" if gone.is_set() else "superseded by a newer request from this session"

    async def stream():
        task = stop = None
        try:
            task = asyncio.ensure_future(get_coach()(msgs, session_id=key))
            stop = asyncio.ensure_future(cancel.wait())
            await asyncio.wait({task, stop}, return_when=asyncio.FIRST_COMPLETED)
            if not task.done():
                task.cancel()
                with contextlib.suppress(BaseException):
                    await task
                _log(f"{key}: coach run cancelled — {why()}")
                if not gone.is_set():
                    yield ask_proxy.error_line(url, why())
                return
            try:
                res = task.result()
            except BaseException as e:
                cause = f"{type(e).__name__}: {e}"[:500]
                _log(f"{key}: coach run failed — {cause}")
                yield ask_proxy.error_line(url, cause)
                return
            _log(f"{key}: kind={res.get('kind')} total_ms={res.get('total_ms')} steps="
                 + ",".join(f"{s['step']}:{s['model']}:{s['latency_ms']}ms:{s['done_reason']}" for s in res.get("steps", [])))
            for line in ndjson_chunks(res["content"]):
                yield line
        finally:
            for t in (task, stop):
                if t is not None and not t.done():
                    t.cancel()
            watcher.cancel()
            if ask_proxy._inflight.get(key) is cancel:
                del ask_proxy._inflight[key]

    return StreamingResponse(stream(), media_type="application/x-ndjson")
