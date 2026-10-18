"""ask_proxy — the streaming body of /ask/llm: cancel upstream when the browser goes, one request per session.

Origin: the 2026-10-17 governor wedge. The old proxy buffered the whole reply, never noticed the browser
leave, and every reload of the Ask page sent a FRESH request, so the governor ran four calls in 7 minutes
for nobody (241 s, 172 s, 125 s after Chiron had already given up).

  * streams the upstream reply through as it arrives (no buffering);
  * a browser disconnect closes the upstream connection, before the first byte (a cold load emits none)
    as well as mid-stream. Ollama aborts a completion when its client closes;
  * at most one in-flight model call per session: a new one supersedes (cancels) the old one. The session
    is the page's X-Ask-Session header (one id per tab, kept across reloads), else the client address.

Only model calls (POST …/api/chat, …/chat/completions, …) are single-flight; GET /api/tags etc. pass through.
"""
from __future__ import annotations
import asyncio
import json
import re, contextlib, sys

import httpx
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse

INFER_SUFFIXES = ("api/chat", "api/generate", "chat/completions", "completions", "responses")
POLL_S = 0.25
_inflight: dict[str, asyncio.Event] = {}    # session -> the cancel signal of its current model call
_transport: httpx.AsyncBaseTransport | None = None   # tests inject an httpx.MockTransport


def _log(msg: str) -> None:
    sys.stderr.write(f"[ask_proxy] {msg}\n")
    sys.stderr.flush()


def session_key(request: Request) -> str:
    sid = (request.headers.get("x-ask-session") or "").strip()[:80]
    return "s:" + sid if sid else "ip:" + (request.client.host if request.client else "?")


def is_model_call(method: str, path: str) -> bool:
    return method.upper() == "POST" and path.rstrip("/").endswith(INFER_SUFFIXES)


def inflight() -> dict:
    """Machine-readable: which sessions hold a model call right now."""
    return {k: not ev.is_set() for k, ev in _inflight.items()}


async def _watch_disconnect(request: Request, gone: asyncio.Event, cancel: asyncio.Event) -> None:
    """The body is already read, so the next ASGI message can only be http.disconnect."""
    while True:
        msg = await request.receive()
        if msg.get("type") == "http.disconnect":
            gone.set()
            cancel.set()
            return


_SPEAK_OPEN = re.compile(r"\[\[\s*SPEAK\s*\]\]", re.I)
_SPEAK_CLOSE = re.compile(r"\[\[\s*/\s*SPEAK\s*\]\]", re.I)


class SpeakCloser:
    """Ask voices the text between [[SPEAK]] and [[/SPEAK]]. Some models (gemma4:12b, 2026-10-18) open the block and
    never close it, so acolyte shows the raw tag and has nothing to speak. Watching Ollama's /api/chat NDJSON, this
    adds the missing [[/SPEAK]] just before the final done:true line (or to the content of a non-streamed reply)."""

    def __init__(self) -> None:
        self.buf, self.text = b"", ""

    def _fix(self, line: bytes) -> list[bytes]:
        try:
            obj = json.loads(line)
        except ValueError:
            return [line]
        if not isinstance(obj, dict):
            return [line]
        msg = obj.get("message") if isinstance(obj.get("message"), dict) else None
        if msg and isinstance(msg.get("content"), str):
            self.text += msg["content"]
        if obj.get("done") and len(_SPEAK_OPEN.findall(self.text)) > len(_SPEAK_CLOSE.findall(self.text)):
            _log("closing an unterminated [[SPEAK]] block so Ask can voice it")
            if msg and msg.get("content"):                 # non-streamed: the whole reply is in this one object
                msg["content"] += "\n[[/SPEAK]]"
                return [json.dumps(obj).encode()]
            extra = {"model": obj.get("model"), "created_at": obj.get("created_at"),
                     "message": {"role": "assistant", "content": "\n[[/SPEAK]]"}, "done": False}
            return [json.dumps(extra).encode(), line]
        return [line]

    def feed(self, chunk: bytes) -> bytes:
        self.buf += chunk
        *lines, self.buf = self.buf.split(b"\n")
        return b"".join(l + b"\n" for line in lines for l in self._fix(line))

    def flush(self) -> bytes:
        rest, self.buf = self.buf, b""
        return b"".join(self._fix(rest)) if rest.strip() else rest


async def forward(request: Request, url: str, body: bytes | None, headers: dict, timeout: httpx.Timeout) -> Response:
    key = session_key(request) if is_model_call(request.method, url) else None
    cancel, gone = asyncio.Event(), asyncio.Event()
    if key:
        old = _inflight.get(key)
        if old is not None and not old.is_set():
            _log(f"{key}: new model call supersedes the one in flight — cancelling it")
            old.set()
        _inflight[key] = cancel
    watcher = asyncio.ensure_future(_watch_disconnect(request, gone, cancel))
    cx = httpx.AsyncClient(timeout=timeout, transport=_transport)

    async def cleanup(r: httpx.Response | None = None) -> None:
        watcher.cancel()
        if r is not None:
            await r.aclose()
        await cx.aclose()
        if key and _inflight.get(key) is cancel:
            del _inflight[key]

    def why() -> str:
        return "browser disconnected" if gone.is_set() else "superseded by a newer request from this session"

    # 1. wait for the upstream headers, racing the browser and any newer request
    try:
        send = asyncio.ensure_future(cx.send(cx.build_request(request.method, url, content=body or None,
                                                               headers=headers), stream=True))
        stop = asyncio.ensure_future(cancel.wait())
        await asyncio.wait({send, stop}, return_when=asyncio.FIRST_COMPLETED)
        stop.cancel()
        if not send.done():
            send.cancel()
            with contextlib.suppress(BaseException):
                await send
            _log(f"{key or url}: upstream cancelled before the first byte — {why()}")
            await cleanup()
            if gone.is_set():
                return Response(status_code=499)           # nobody is listening
            raise HTTPException(409, "superseded by a newer question from this page")
        r = send.result()
    except HTTPException:
        raise
    except BaseException:
        await cleanup()
        raise

    # 2. stream it through; a disconnect or a newer request closes the upstream mid-stream
    closer = SpeakCloser() if url.rstrip("/").endswith("api/chat") and r.status_code == 200 else None

    async def chunks():
        it = r.aiter_raw().__aiter__()
        stop = asyncio.ensure_future(cancel.wait())
        try:
            while True:
                nxt = asyncio.ensure_future(it.__anext__())
                await asyncio.wait({nxt, stop}, return_when=asyncio.FIRST_COMPLETED)
                if not nxt.done():
                    nxt.cancel()
                    with contextlib.suppress(BaseException):
                        await nxt
                    _log(f"{key or url}: upstream closed mid-stream — {why()}")
                    return
                try:
                    data = nxt.result()
                except StopAsyncIteration:
                    if closer:
                        tail = closer.flush()
                        if tail:
                            yield tail
                    return
                yield closer.feed(data) if closer else data
        except httpx.HTTPError as e:                       # e.g. a >read-timeout gap between chunks
            _log(f"{key or url}: upstream stream failed: {type(e).__name__}: {e}")
        finally:
            stop.cancel()
            await cleanup(r)

    return StreamingResponse(chunks(), status_code=r.status_code,
                             media_type=r.headers.get("content-type", "application/json"))
