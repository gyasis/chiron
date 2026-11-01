"""ledger_test — the prompt ledger writer, context, rollover, Postgres loader and the ask_proxy stream tap.
The loader tests use a throwaway table in the corpus Postgres (skipped when it is unreachable) and drop only that table.
Run: ~/miniconda3/bin/python tests/ledger_test.py"""
import asyncio, json, os, sys, tempfile, unittest, uuid
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-ledger-"))
os.environ["CHIRON_LEDGER_DIR"] = str(TMP / "ledger")
sys.path.insert(0, str(SKILL / "chains"))
sys.path.insert(0, str(SKILL / "server"))
import ledger  # noqa: E402

try:
    import ask_proxy  # noqa: E402
    TAP_OK = True
except Exception as e:  # pragma: no cover - environment without the server deps
    TAP_OK, TAP_WHY = False, repr(e)


def rows(d: Path) -> list[dict]:
    return [json.loads(l) for f in sorted(d.glob("*.jsonl")) for l in f.read_text().splitlines()]


def pg_or_none():
    try:
        return ledger.pg_connect()
    except Exception:
        return None


class Writer(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(dir=TMP))
        os.environ["CHIRON_LEDGER_DIR"] = str(self.dir)
        ledger._stats.update(failures=0, last_error=None)

    def test_record_writes_every_field(self):
        cid = ledger.record("unit", "m:1", [{"role": "user", "content": "ciao"}], "salve", endpoint="http://x",
                            params={"temperature": 0.4}, tokens_in=3, tokens_out=2, reasoning_chars=0,
                            latency_ms=12, finish_reason="stop", step="s1", lesson_id="L", session_id="S")
        (r,) = rows(self.dir)
        self.assertEqual(r["call_id"], cid)
        self.assertEqual(len(cid), 32)
        for k in ledger.FIELDS:
            self.assertIn(k, r)
        self.assertEqual((r["source"], r["model"], r["response"], r["status"], r["learner"]),
                         ("unit", "m:1", "salve", "ok", "gyasi"))
        self.assertEqual(json.loads(r["prompt"])[0]["content"], "ciao")      # messages stored as JSON text
        self.assertEqual(r["params"], {"temperature": 0.4})
        self.assertTrue(r["ts"].endswith("+00:00"))

    def test_string_prompt_kept_verbatim(self):
        ledger.record("unit", None, "plain prompt", None, status="error", error="boom")
        (r,) = rows(self.dir)
        self.assertEqual((r["prompt"], r["response"], r["status"], r["error"]), ("plain prompt", None, "error", "boom"))

    def test_never_raises_when_dir_unwritable(self):
        blocker = TMP / "afile"
        blocker.write_text("x")
        os.environ["CHIRON_LEDGER_DIR"] = str(blocker / "sub")     # parent is a file: mkdir fails
        self.assertIsNone(ledger.record("unit", "m", "p", "r"))
        st = ledger.status()
        self.assertEqual(st["failures"], 1)
        self.assertIn("write", st["last_error"])

    def test_context_flows_into_record(self):
        with ledger.context(run_id="R1", lesson_id="L1", session_id="S1"):
            ledger.record("unit", "m", "p", "r")
            with ledger.context(lesson_id="L2"):
                ledger.record("unit", "m", "p2", "r2")
        ledger.record("unit", "m", "p3", "r3")
        a, b, c = rows(self.dir)
        self.assertEqual((a["run_id"], a["lesson_id"], a["session_id"]), ("R1", "L1", "S1"))
        self.assertEqual((b["run_id"], b["lesson_id"]), ("R1", "L2"))
        self.assertEqual((c["run_id"], c["lesson_id"]), (None, None))

    def test_obs_set_out_sets_context(self):
        import obs
        out = self.dir / "my-lesson"
        obs.set_out(out)
        try:
            ledger.record("unit", "m", "p", "r")
            (r,) = rows(self.dir)
            self.assertEqual(r["lesson_id"], "my-lesson")
            self.assertEqual(len(r["run_id"]), 32)
        finally:
            ledger._ctx.set({})

    def test_rollover_at_size_cap(self):
        old = ledger.MAX_FILE_BYTES
        ledger.MAX_FILE_BYTES = 200
        try:
            for i in range(4):
                ledger.record("unit", "m", "x" * 150, str(i))
        finally:
            ledger.MAX_FILE_BYTES = old
        names = sorted(p.name for p in self.dir.glob("*.jsonl"))
        self.assertGreater(len(names), 1)
        self.assertTrue(any(n.count(".") == 2 for n in names), names)     # YYYY-MM-DD.N.jsonl
        self.assertEqual(len(rows(self.dir)), 4)

    def test_chain_call_records_and_reraises(self):
        async def ok(u):
            return "out:" + u

        async def bad(u):
            raise ValueError("nope")
        self.assertEqual(asyncio.run(ledger.chain_call("chain:t", {"name": "mm"}, "do {input} now", "X", ok)), "out:X")
        with self.assertRaises(ValueError):
            asyncio.run(ledger.chain_call("chain:t", {"name": "mm"}, "do {input} now", "Y", bad))
        a, b = rows(self.dir)
        self.assertEqual((a["prompt"], a["response"], a["model"], a["status"]), ("do X now", "out:X", "mm", "ok"))
        self.assertEqual((b["status"], b["response"]), ("error", None))
        self.assertIn("ValueError: nope", b["error"])


@unittest.skipUnless(pg_or_none(), "corpus Postgres (127.0.0.1:5442) unreachable")
class Loader(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(dir=TMP))
        os.environ["CHIRON_LEDGER_DIR"] = str(self.dir)
        self.table = "prompt_ledger_test_" + uuid.uuid4().hex[:8]
        self.real = ledger.TABLE
        ledger.TABLE = self.table
        self.conn = ledger.pg_connect()

    def tearDown(self):
        ledger.TABLE = self.real
        self.conn.execute(f"drop table if exists {self.table}")      # only this test's own table
        self.conn.close()

    def test_load_is_incremental_and_idempotent(self):
        ledger.record("unit", "m", [{"role": "user", "content": "a"}], "ra", params={"k": 1}, session_id="S")
        ledger.record("unit", "m", "b", "rb")
        r1 = ledger.load_to_pg(self.conn)
        self.assertEqual((r1["read"], r1["inserted"], r1["errors"]), (2, 2, 0))
        r2 = ledger.load_to_pg(self.conn)
        self.assertEqual((r2["read"], r2["inserted"]), (0, 0))              # watermark: nothing new to read
        ledger.record("unit", "m", "c", "rc")
        r3 = ledger.load_to_pg(self.conn)
        self.assertEqual((r3["read"], r3["inserted"]), (1, 1))
        (self.dir / ".loaded.json").unlink()                                # reset the watermark
        r4 = ledger.load_to_pg(self.conn)
        self.assertEqual((r4["read"], r4["inserted"], r4["skipped"]), (3, 0, 3))   # ON CONFLICT DO NOTHING
        n, p = self.conn.execute(f"select count(*), max(params->>'k') from {self.table}").fetchone()
        self.assertEqual((n, p), (3, "1"))

    def test_partial_trailing_line_waits(self):
        ledger.record("unit", "m", "a", "ra")
        f = next(self.dir.glob("*.jsonl"))
        with open(f, "a") as fh:
            fh.write('{"call_id": "half')                                      # writer mid-line
        r = ledger.load_to_pg(self.conn)
        self.assertEqual((r["read"], r["inserted"], r["errors"]), (1, 1, 0))
        r = ledger.load_to_pg(self.conn)
        self.assertEqual(r["read"], 0)                                          # no newline yet: still waiting


@unittest.skipUnless(TAP_OK, "server deps unavailable")
class Tap(unittest.TestCase):
    def feed_all(self, data: bytes, size: int):
        t = ask_proxy.StreamTap()
        for i in range(0, len(data), size):
            t.feed(data[i:i + size])
        t.close()
        return t

    def test_ollama_ndjson_split_mid_line(self):
        data = (b'{"message":{"content":"Ci"}}\n{"message":{"content":"ao"}}\n'
                b'{"done":true,"done_reason":"stop","prompt_eval_count":7,"eval_count":2}\n')
        for size in (1, 5, 17, len(data)):
            t = self.feed_all(data, size)
            self.assertEqual((t.text, t.finish_reason, t.tokens_in, t.tokens_out), ("Ciao", "stop", 7, 2), size)

    def test_openai_sse_split_mid_line(self):
        data = (b'data: {"choices":[{"delta":{"content":"Sa"}}]}\n\ndata: {"choices":[{"delta":{"content":"lve"}}]}\n\n'
                b'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":3}}\n\n'
                b'data: [DONE]\n\n')
        for size in (1, 9, 40, len(data)):
            t = self.feed_all(data, size)
            self.assertEqual((t.text, t.finish_reason, t.tokens_in, t.tokens_out), ("Salve", "stop", 4, 3), size)
            self.assertEqual(t.parse_errors, 0)

    def test_unparseable_lines_do_not_break(self):
        t = self.feed_all(b'garbage\n{"message":{"content":"ok"}}\n', 4)
        self.assertEqual(t.text, "ok")
        self.assertEqual(t.parse_errors, 1)

    def test_pretty_printed_non_stream_reply(self):
        body = json.dumps({"choices": [{"message": {"content": "tutto"}, "finish_reason": "stop"}]}, indent=2).encode()
        t = self.feed_all(body, 11)
        self.assertEqual((t.text, t.finish_reason), ("tutto", "stop"))

    def test_request_view(self):
        p, m, params = ask_proxy._request_view(json.dumps(
            {"model": "m", "messages": [{"role": "user", "content": "x"}], "stream": True, "options": {"a": 1}}).encode())
        self.assertEqual((p, m, params), ([{"role": "user", "content": "x"}], "m", {"model": "m", "stream": True, "options": {"a": 1}}))


if __name__ == "__main__":
    unittest.main()
