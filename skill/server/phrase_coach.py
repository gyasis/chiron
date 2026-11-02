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
from starlette.responses import JSONResponse, Response, StreamingResponse

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / "chains"))
import ask_proxy  # noqa: E402
import local_models  # noqa: E402
import phrase_related  # noqa: E402

CHAIN_FILE = SKILL / "chains" / "2026-11-01_chiron-phrase-coach-chain" / "run.py"
MODEL_ID = "phrase-coach"

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
        out: asyncio.Queue = asyncio.Queue()
        result: dict = {}

        async def pump():
            try:
                async for kind, val in events(msgs, key):
                    if kind == "text":
                        out.put_nowait(val)
                    else:
                        result.update(val)
            finally:
                out.put_nowait(None)

        task = asyncio.ensure_future(pump())
        stop = asyncio.ensure_future(cancel.wait())
        get = None
        try:
            while True:
                get = asyncio.ensure_future(out.get())
                await asyncio.wait({get, stop}, return_when=asyncio.FIRST_COMPLETED)
                if not get.done():
                    task.cancel()
                    with contextlib.suppress(BaseException):
                        await task
                    _log(f"{key}: coach run cancelled — {why()}")
                    if not gone.is_set():
                        yield ask_proxy.error_line(url, why())
                    return
                chunk = get.result()
                if chunk is None:
                    break
                yield ndjson_line(chunk)          # one whole section per line: a fenced block never arrives half-sent
            try:
                await task
            except BaseException as e:
                cause = f"{type(e).__name__}: {e}"[:500]
                _log(f"{key}: coach run failed — {cause}")
                yield ask_proxy.error_line(url, cause)
                return
            _log(f"{key}: kind={result.get('kind')} first_text_ms={result.get('first_text_ms')} total_ms={result.get('total_ms')} steps="
                 + ",".join(f"{s['step']}:{s['model']}:{s['latency_ms']}ms:{s['done_reason']}" for s in result.get("steps", [])))
            yield ndjson_done()
        finally:
            for t in (task, stop, get):
                if t is not None and not t.done():
                    t.cancel()
            watcher.cancel()
            if ask_proxy._inflight.get(key) is cancel:
                del ask_proxy._inflight[key]

    if body.get("stream") is False:
        # acolyte asks for a single JSON reply whenever the request carries tools, and reads it with .json(),
        # so the NDJSON lines are folded into one Ollama /api/chat object. A failure becomes an HTTP error,
        # which acolyte's non-stream path reports instead of rendering an empty answer.
        content, error = "", None
        async for line in stream():
            obj = json.loads(line)
            if obj.get("error"):
                error = obj["error"]
                break
            content += (obj.get("message") or {}).get("content", "")
        if error is not None:
            return JSONResponse({"error": error}, status_code=502)
        if gone.is_set():
            return Response(status_code=499)
        return JSONResponse({"model": MODEL_ID, "message": {"role": "assistant", "content": content},
                             "done": True, "done_reason": "stop"})
    return StreamingResponse(stream(), media_type="application/x-ndjson")
