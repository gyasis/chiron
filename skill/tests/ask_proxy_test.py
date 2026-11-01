"""ask_proxy_test — /ask/llm streams through, cancels the upstream call when the browser goes (before the first
byte and mid-stream), and runs one model call per session (a newer one supersedes the old). Drives the REAL
app.app over raw ASGI (so a disconnect can be sent) with an httpx.MockTransport upstream; no network.
Run: ~/miniconda3/bin/python tests/ask_proxy_test.py"""
import asyncio, json, os, sys, tempfile, time, unittest
from pathlib import Path

import httpx

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-askproxy-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name not in ("state", "__pycache__"):
        os.symlink(f, TMP / "skill" / "server" / f.name)
(TMP / "gen").mkdir()
os.environ.update(CHIRON_SKILL=str(TMP / "skill"), CHIRON_GEN=str(TMP / "gen"), CHIRON_LEDGER_DIR=str(TMP / "ledger"),
                  CHIRON_ASK_LLM_URL="http://upstream.test", CHIRON_ASK_PROVIDER="ollama", CHIRON_ASK_MODEL="m")
sys.path.insert(0, str(SKILL / "server"))

try:
    import app as A  # noqa: E402
    import ask_proxy  # noqa: E402
    OK = True
except Exception as e:  # pragma: no cover - environment without the server deps
    OK, WHY = False, repr(e)

UP = []          # what the upstream saw / how it ended: dicts with mode, body, headers, events


async def upstream(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    rec = {"mode": body["model"], "body": body, "headers": dict(request.headers), "events": []}
    UP.append(rec)
    if body["model"] == "silent":                      # a cold load / prefill: no byte for a long time
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            rec["events"].append("cancelled")
            raise
        return httpx.Response(200, json={})
    if body["model"] == "stream":
        async def gen():
            try:
                yield b'{"message":{"content":"Ci"}}\n'
                rec["events"].append("first-chunk-sent")
                await asyncio.sleep(30)
                yield b'{"done":true}\n'
            finally:
                rec["events"].append("closed")
        return httpx.Response(200, headers={"content-type": "application/x-ndjson"}, content=gen())
    async def two():
        yield b'{"message":{"content":"Ciao"}}\n'
        yield b'{"done":true}\n'
    return httpx.Response(200, headers={"content-type": "application/x-ndjson"}, content=two())


async def call(model: str, session: str | None = None, disconnect_after: float | None = None,
               path: str = "/ask/llm/api/chat", extra: dict | None = None):
    """One request through the ASGI app; returns (status, body bytes, first-body-chunk time)."""
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": "hi"}], "stream": True,
                       **(extra or {})}).encode()
    sent, gone = [{"type": "http.request", "body": body, "more_body": False}], asyncio.Event()
    t0 = time.monotonic()

    async def receive():
        if sent:
            return sent.pop(0)
        if disconnect_after is None:
            await gone.wait()
        else:
            await asyncio.sleep(max(0.0, disconnect_after - (time.monotonic() - t0)))
        return {"type": "http.disconnect"}

    out = {"status": None, "body": b"", "first": None}

    async def send(m):
        if m["type"] == "http.response.start":
            out["status"] = m["status"]
        elif m["type"] == "http.response.body" and m.get("body"):
            out["first"] = out["first"] or time.monotonic() - t0
            out["body"] += m["body"]

    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    if session:
        headers.append((b"x-ask-session", session.encode()))
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
             "method": "POST", "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"",
             "root_path": "", "headers": headers, "client": ("127.0.0.1", 50000), "server": ("test", 80)}
    try:
        await A.app(scope, receive, send)
    finally:
        gone.set()
    return out


async def settle():
    for _ in range(40):
        await asyncio.sleep(0.05)


@unittest.skipUnless(OK, "server deps unavailable")
class AskProxy(unittest.TestCase):
    def setUp(self):
        UP.clear()
        ask_proxy._inflight.clear()
        ask_proxy._transport = httpx.MockTransport(upstream)

    def tearDown(self):
        ask_proxy._transport = None

    def run_(self, coro):
        return asyncio.run(coro)

    def test_streams_through_with_num_ctx_and_max_seconds(self):
        out = self.run_(call("fast", "tab1"))
        self.assertEqual(out["status"], 200)
        self.assertEqual(out["body"], b'{"message":{"content":"Ciao"}}\n{"done":true}\n')
        self.assertEqual(UP[0]["body"]["options"]["num_ctx"], 8192)     # never the server's 131K default
        self.assertEqual(UP[0]["headers"]["x-governor-max-seconds"], "180")
        self.assertEqual(ask_proxy._inflight, {})                     # slot released

    def _ledger_rows(self):
        return [json.loads(l) for f in sorted((TMP / "ledger").glob("*.jsonl")) for l in f.read_text().splitlines()]

    def test_ledger_records_streamed_reply_and_request(self):
        before = len(self._ledger_rows())
        out = self.run_(call("fast", "tabL"))
        self.assertEqual(out["body"], b'{"message":{"content":"Ciao"}}\n{"done":true}\n')   # stream untouched
        rec = self._ledger_rows()[before]
        self.assertEqual((rec["source"], rec["session_id"], rec["status"], rec["response"], rec["model"]),
                         ("ask", "s:tabL", "ok", "Ciao", "fast"))
        self.assertIn('"hi"', rec["prompt"])
        self.assertEqual(rec["params"]["stream"], True)

    def test_ledger_records_cancelled_mid_stream(self):
        before = len(self._ledger_rows())
        self.run_(call("stream", "tabC", disconnect_after=0.3))
        self.run_(settle())
        rec = self._ledger_rows()[before]
        self.assertEqual((rec["status"], rec["response"]), ("cancelled", "Ci"))

    def _get(self, path: str, client_host: str) -> int:
        async def go():
            st = []

            async def receive():
                return {"type": "http.request", "body": b"", "more_body": False}

            async def send(m):
                if m["type"] == "http.response.start":
                    st.append(m["status"])
            scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
                     "method": "GET", "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"",
                     "root_path": "", "headers": [], "client": (client_host, 50000), "server": ("test", 80)}
            await A.app(scope, receive, send)
            return st[0]
        return self.run_(go())

    def test_ledger_endpoints_are_loopback_only(self):
        for path in ("/api/ledger", "/api/ledger/status"):
            self.assertEqual(self._get(path, "192.168.0.50"), 403, path)
            self.assertEqual(self._get(path, "::ffff:10.0.0.1"), 403, path)
        self.assertEqual(self._get("/api/ledger/status", "127.0.0.1"), 200)
        self.assertEqual(self._get("/api/ledger/status", "::1"), 200)

    def test_page_num_ctx_is_kept(self):
        self.run_(call("fast", "tab1", extra={"options": {"num_ctx": 4096}}))
        self.assertEqual(UP[0]["body"]["options"]["num_ctx"], 4096)

    def test_disconnect_before_first_byte_cancels_upstream(self):
        async def go():
            t = time.monotonic()
            out = await call("silent", "tab1", disconnect_after=0.5)
            return out, time.monotonic() - t
        out, took = self.run_(go())
        self.assertLess(took, 3)                                      # not the 180 s read timeout
        self.assertEqual(UP[0]["events"], ["cancelled"])
        self.assertEqual(out["status"], 499)
        self.assertEqual(ask_proxy._inflight, {})

    def test_disconnect_mid_stream_closes_upstream(self):
        async def go():
            out = await call("stream", "tab1", disconnect_after=0.5)
            await settle()
            return out
        out = self.run_(go())
        self.assertEqual(out["status"], 200)
        self.assertIn(b"Ci", out["body"])                              # the first chunk got through before the end
        self.assertIn("closed", UP[0]["events"])
        self.assertEqual(ask_proxy._inflight, {})

    def test_newer_request_supersedes_older_in_same_session(self):
        async def go():
            first = asyncio.ensure_future(call("silent", "tab1"))
            await asyncio.sleep(0.4)
            second = await call("fast", "tab1")
            return await asyncio.wait_for(first, 3), second
        first, second = self.run_(go())
        self.assertEqual(first["status"], 409)
        self.assertEqual(UP[0]["events"], ["cancelled"])               # the Mac stops working on it
        self.assertEqual(second["status"], 200)

    def test_other_sessions_are_independent(self):
        async def go():
            first = asyncio.ensure_future(call("silent", "tabA", disconnect_after=1.0))
            await asyncio.sleep(0.3)
            second = await call("fast", "tabB")
            return await first, second
        first, second = self.run_(go())
        self.assertEqual(second["status"], 200)
        self.assertEqual(first["status"], 499)                          # ended by its own disconnect, not by tabB

    def test_session_falls_back_to_client_address(self):
        async def go():
            first = asyncio.ensure_future(call("silent"))
            await asyncio.sleep(0.4)
            await call("fast")
            return await asyncio.wait_for(first, 3)
        self.assertEqual(self.run_(go())["status"], 409)


if __name__ == "__main__":
    unittest.main()
