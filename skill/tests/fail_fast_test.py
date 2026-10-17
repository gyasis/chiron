"""fail_fast_test — the exam paths (mock oral, Sessione, tutor) fail fast against a stub governor over real HTTP:
one total deadline per action, a stale lease is skipped, the Modal lane is the last rung, num_ctx and
X-Governor-Max-Seconds reach the wire. Never touches the real governor: local_models.GOVERNOR points at the stub.
Run: ~/miniconda3/bin/python tests/fail_fast_test.py"""
import asyncio, json, os, sys, threading, time, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

SKILL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.environ["CHIRON_SKILL"] = SKILL_DIR      # mock_oral prepends $CHIRON_SKILL/server: test THIS tree, not the main checkout
sys.path.insert(0, os.path.join(SKILL_DIR, "server"))
import fail_fast as ff  # noqa: E402
import local_models as lm  # noqa: E402
import mock_oral as mo  # noqa: E402
import sessione as S  # noqa: E402
import tutor_chain as tc  # noqa: E402
from fastapi import HTTPException  # noqa: E402

REPLY = '{"reply": "Bene, grazie.", "followup": false}'
SEEN = []            # (path, body, headers) for every POST
DELAY = {}           # model -> seconds before answering
FAIL = set()         # models that answer HTTP 500
LANE = {"status": 200}
BUDGET = {"active_leases": []}


class Gov(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        try:
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass                                   # the client gave up (deadline)

    def do_GET(self):
        self._send(200, BUDGET) if self.path == "/budget" else self._send(404, {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])) or b"{}")
        SEEN.append((self.path, body, dict(self.headers)))
        if self.path == "/llm/lane/v1/chat/completions":
            if LANE["status"] != 200:
                return self._send(LANE["status"], {"error": "no session"})
            return self._send(200, {"choices": [{"message": {"content": REPLY}, "finish_reason": "stop"}],
                                    "usage": {"completion_tokens": 9}})
        model = body.get("model")
        time.sleep(DELAY.get(model, 0))
        if model in FAIL:
            return self._send(500, {"error": "boom"})
        self._send(200, {"model": model, "message": {"content": REPLY, "thinking": ""}})

    def log_message(self, *a):
        pass


SRV = ThreadingHTTPServer(("127.0.0.1", 0), Gov)
SRV.daemon_threads = True
threading.Thread(target=SRV.serve_forever, daemon=True).start()
ROOT = f"http://127.0.0.1:{SRV.server_address[1]}"
EX = {"local:a:1": {"model": "a:1", "local": True}, "local:b:2": {"model": "b:2", "local": True},
      "local:c:3": {"model": "c:3", "local": True}}


def chats(model=None):
    return [b for p, b, _ in SEEN if p.endswith("/api/chat") and (model is None or b["model"] == model)]


def lane_calls():
    return [b for p, b, _ in SEEN if p == "/llm/lane/v1/chat/completions"]


class Base(unittest.TestCase):
    def setUp(self):
        SEEN.clear(); DELAY.clear(); FAIL.clear()
        LANE["status"] = 200
        BUDGET["active_leases"] = []
        ff._budget["at"] = float("-inf")
        self.p = [mock.patch.object(lm, "GOVERNOR", ROOT + "/llm/ollama"),
                  mock.patch.object(tc, "GOVERNOR", ROOT + "/llm/ollama"),
                  mock.patch.object(lm, "thinking_off", lambda tag: False),
                  mock.patch.object(ff, "MIN_ATTEMPT_S", 0.5),
                  mock.patch.object(ff, "MODAL_RESERVE_S", 1.0),
                  mock.patch.dict(mo.EXAMINERS, EX, clear=True),
                  mock.patch.object(mo, "refresh_examiners", lambda: mo.EXAMINERS),
                  mock.patch.object(mo, "_CLOUD_EXAMINERS", {}),
                  mock.patch.dict(os.environ, {"TUTOR_FALLBACKS": "governor:b:2,governor:c:3", "OLLAMA_API_KEY": ""})]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in reversed(self.p):
            p.stop()


class DeadlineUnit(unittest.TestCase):
    def test_timeout_caps_and_expires(self):
        now = [100.0]
        d = ff.Deadline(10, "t", clock=lambda: now[0])
        self.assertEqual(d.timeout(90), 10)
        self.assertEqual(d.timeout(4), 4)
        self.assertEqual(d.timeout(90, reserve=3), 7)
        now[0] += 8
        with self.assertRaises(ff.DeadlineExceeded):
            d.timeout(90)                               # 2 s left < MIN_ATTEMPT_S

    def test_scope_outer_wins_and_no_scope_keeps_cap(self):
        self.assertEqual(ff.attempt_timeout(90), 90)
        with ff.scope(5, "outer") as outer:
            with ff.scope(500, "inner") as inner:
                self.assertIs(inner, outer)
                self.assertLessEqual(ff.attempt_timeout(90), 5)
        self.assertIsNone(ff.current())

    def test_scope_reaches_asyncio_run(self):
        async def peek():
            return ff.current()
        with ff.scope(5, "tutor turn") as d:            # tutor_server._run_answer -> asyncio.run(answer_turn)
            self.assertIs(asyncio.run(peek()), d)

    def test_num_ctx_for(self):
        self.assertEqual(ff.num_ctx_for(500), 8192)
        self.assertEqual(ff.num_ctx_for(30_000), 16384)
        self.assertEqual(ff.num_ctx_for(10_000_000), 32768)


class OralDeadline(Base):
    def test_one_total_deadline_across_the_chain(self):
        """Three slow governor rungs (10 s each = 30 s before) end at the 4 s deadline, then Modal answers."""
        DELAY.update({"a:1": 10, "b:2": 10, "c:3": 10})
        with mock.patch.object(mo, "ORAL_DEADLINE_S", 4):
            t = time.monotonic()
            out = mo.examine({"examiner": "local:a:1", "answer": "Sono un medico."})
            took = time.monotonic() - t
        self.assertLess(took, 5.5)
        self.assertEqual(out["examiner"], ff.MODAL_MODEL)
        self.assertTrue(any("deadline" in f for f in out["fallback_from"]), out["fallback_from"])
        self.assertEqual(len(lane_calls()), 1)

    def test_num_ctx_and_max_seconds_on_the_wire(self):
        with mock.patch.object(mo, "ORAL_DEADLINE_S", 20):
            mo.examine({"examiner": "local:a:1"})
        body = chats("a:1")[0]
        self.assertEqual(body["options"]["num_ctx"], 8192)
        hdr = next(h for p, b, h in SEEN if p.endswith("/api/chat"))
        secs = int(hdr["X-Governor-Max-Seconds"])
        self.assertTrue(1 <= secs <= 20, secs)


class BusyLease(Base):
    def test_stale_lease_is_skipped(self):
        BUDGET["active_leases"] = [{"lease_id": "L1", "model": "a:1", "age_s": 600.0}]
        out = mo.examine({"examiner": "local:a:1"})
        self.assertEqual(chats("a:1"), [])                 # never queued behind the hung call
        self.assertEqual(out["examiner"], "local:b:2")
        self.assertIn("busy", out["fallback_from"][0])

    def test_young_lease_and_latest_suffix(self):
        BUDGET["active_leases"] = [{"model": "a:1", "age_s": 30.0}]
        self.assertIsNone(ff.stale_lease("a:1"))
        ff._budget["at"] = float("-inf")
        BUDGET["active_leases"] = [{"model": "ornith:latest", "age_s": 300.0}]
        self.assertIsNotNone(ff.stale_lease("ornith"))

    def test_budget_unreachable_does_not_block(self):
        with mock.patch.object(ff, "_fetch_budget", side_effect=OSError("down")):
            self.assertIsNone(ff.stale_lease("a:1"))

    def test_tutor_skips_busy_model(self):
        BUDGET["active_leases"] = [{"model": "a:1", "age_s": 600.0}]
        with mock.patch.object(tc, "FALLBACKS", ["governor:b:2"]):
            self.assertIn("Bene", tc._answer("governor:a:1", "s", [], "u"))
        self.assertEqual(chats("a:1"), [])


class ModalFallback(Base):
    def test_not_used_when_governor_answers(self):
        mo.examine({"examiner": "local:a:1"})
        self.assertEqual(lane_calls(), [])

    def test_used_when_every_governor_rung_fails(self):
        FAIL.update({"a:1", "b:2", "c:3"})
        out = mo.examine({"examiner": "local:a:1"})
        self.assertEqual(out["examiner"], ff.MODAL_MODEL)
        lane = lane_calls()[0]
        self.assertEqual(lane["model"], ff.MODAL_MODEL)
        self.assertEqual(lane["reasoning_effort"], "none")

    def test_no_lane_session_is_an_actionable_error(self):
        FAIL.update({"a:1", "b:2", "c:3"})
        LANE["status"] = 409
        with self.assertRaises(HTTPException) as cm:
            mo.examine({"examiner": "local:a:1"})
        self.assertIn("lane open", cm.exception.detail)

    def test_sessione_chain_ends_on_modal(self):
        FAIL.update({"g:1", "a:1", "b:2", "c:3"})
        with mock.patch.object(S, "GATEWAY_URL", ROOT + "/llm/ollama/v1"), mock.patch.object(S, "GATEWAY_MODEL", "g:1"), \
             mock.patch.object(mo, "default_examiner", return_value="local:a:1"):
            out = S.llm_json("s", "u", "t")
        self.assertEqual(out["reply"], "Bene, grazie.")
        self.assertEqual(len(lane_calls()), 1)


class SessioneGateway(Base):
    def test_governor_gateway_goes_native_with_num_ctx(self):
        with mock.patch.object(S, "GATEWAY_URL", ROOT + "/llm/ollama/v1"), mock.patch.object(S, "GATEWAY_MODEL", "g:1"):
            out = S.llm_json("s", "u", "t")
        self.assertEqual(out["reply"], "Bene, grazie.")
        p, body, hdr = SEEN[0]
        self.assertEqual(p, "/llm/ollama/api/chat")     # not /v1, which cannot carry num_ctx
        self.assertEqual(body["options"]["num_ctx"], 8192)
        self.assertIn("X-Governor-Max-Seconds", hdr)

    def test_deadline_bounds_sessione(self):
        DELAY.update({"g:1": 10, "a:1": 10, "b:2": 10, "c:3": 10})
        with mock.patch.object(S, "GATEWAY_URL", ROOT + "/llm/ollama/v1"), mock.patch.object(S, "GATEWAY_MODEL", "g:1"), \
             mock.patch.object(S, "SESSIONE_DEADLINE_S", 4), mock.patch.object(mo, "default_examiner", return_value="local:a:1"):
            t = time.monotonic()
            S.llm_json("s", "u", "t")
        self.assertLess(time.monotonic() - t, 5.5)
        self.assertEqual(len(lane_calls()), 1)


class TutorDeadline(Base):
    def test_fallbacks_share_one_deadline(self):
        DELAY.update({"a:1": 10, "b:2": 10, "c:3": 10})
        with mock.patch.object(tc, "FALLBACKS", ["governor:b:2", "governor:c:3"]):
            t = time.monotonic()
            with ff.scope(3, "tutor turn"):
                out = tc._answer("governor:a:1", "s", [], "u")
            took = time.monotonic() - t
        self.assertLess(took, 4.5)                          # was 3 x 140 s
        self.assertIn("unavailable", out)
        self.assertIn("DeadlineExceeded", tc.LAST_ERRORS[-1][1])

    def test_num_ctx_on_tutor_calls(self):
        self.assertIn("Bene", tc._call("governor:a:1", "sys", [], "hi"))
        self.assertEqual(chats("a:1")[0]["options"]["num_ctx"], 8192)


if __name__ == "__main__":
    unittest.main()
