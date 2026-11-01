"""phrase_coach_test — the phrase-coach chain (kind routing, check/fix loop, attempt coaching, bad completions) and the
NDJSON route /ask/phrase/api/*. Model calls are mocked at the chain's transport (_chat) and at httpx; no network.
Run: ~/miniconda3/bin/python tests/phrase_coach_test.py"""
import asyncio, json, os, sys, tempfile, unittest
from pathlib import Path

import httpx

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-phrasecoach-"))
os.environ["CHIRON_LEDGER_DIR"] = str(TMP / "ledger")
sys.path.insert(0, str(SKILL / "server"))
sys.path.insert(0, str(SKILL / "chains"))

import phrase_coach  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

phrase_coach.get_coach()
chain = phrase_coach._chain
REAL_CHAT = chain._chat


def meta(tag, reason="stop"):
    return {"model": tag, "done_reason": reason, "latency_ms": 5, "thinking_chars": 0, "tokens_in": 1, "tokens_out": 1}


BUILD = {"it": "Sono qui per la specializzazione.", "register": "neutral", "register_note": "no address form",
         "variants": [{"it": "Sono qui per fare la specializzazione.", "register": "neutral", "why": "common"}],
         "literal_trap": {"it": "Io sono qui per la mia specializzazione.", "why": "io and mia are redundant"}}
TEACH = ("**Sono qui per la specializzazione.**\nRegister: neutral. No Lei or tu form.\n\n**The pattern**\n`Sono qui per + [noun]`\n\n"
         "**Your turn**\nI'm here for my interview.\n\n```meta\n"
         '{"pattern": "Sono qui per + [noun]", "slots": ["noun"], "practice": "I\'m here for my interview.", '
         '"breakdown": [{"chunk": "Sono qui", "gloss": "I am here"}]}\n```\n[[SPEAK]]stray model speak[[/SPEAK]]')
COACH = ("**Good: you used the frame.**\n**Corrections**\n- per il colloquio, not per colloquio.\n\n**Your turn**\nI'm here for my exam.\n\n```meta\n"
         '{"corrected": "Sono qui per il colloquio.", "register": "neutral", "pattern": "Sono qui per + [noun]", "slots": ["noun"], '
         '"practice": "I\'m here for my exam.", "breakdown": [{"chunk": "per il colloquio", "gloss": "for the interview"}]}\n```')


class Script:
    """Replaces chain._chat: answers by step (read from the system prompt) and records the calls."""
    def __init__(self, understand, check=None, fail_step=None, answers=None):
        self.calls, self.understand, self.check = [], understand, check or {"ok": True, "fixes": []}
        self.fail_step, self.answers = fail_step, answers or {}

    async def __call__(self, tag, system, user):
        step = ("understand" if system.startswith("You route") else "build" if system.startswith("You write Italian")
                else "check" if system.startswith("You are a strict") else "teach" if "teach the learner to build" in system
                else "coach" if "marking a learner" in system else "answer")
        self.calls.append((step, tag, user))
        if step == self.fail_step:
            raise chain.ModelReplyError(f"{tag}: done_reason='length', 0 chars of content")
        if step in self.answers:
            return self.answers[step], meta(tag)
        out = {"understand": json.dumps(self.understand), "build": json.dumps(BUILD), "check": json.dumps(self.check),
               "teach": TEACH, "coach": COACH, "answer": "Because Italian drops the subject pronoun."}[step]
        return out, meta(tag)


NEW = {"kind": "new_request", "meaning": "I'm here for my specialization", "situation": "clinic", "listener": "staff",
       "register_default": "neutral", "register_reason": "no address form", "nuance": ""}


def run_coach(script, messages):
    chain._chat = script
    return asyncio.run(chain.coach(messages, session_id="t"))


def prior_turns():
    first = "How do I say I'm here for my specialization?"
    reply = ("**Sono qui per la specializzazione.**\n\n[[SPEAK]]Sono qui per la specializzazione.[[/SPEAK]]\n\n```phrase\n"
             + json.dumps({"it": BUILD["it"], "practice": "I'm here for my interview.", "pattern": "Sono qui per + [noun]",
                           "slots": ["noun"]}) + "\n```")
    return [{"role": "user", "content": first}, {"role": "assistant", "content": reply}]


class Chain(unittest.TestCase):
    def test_new_request_runs_all_four_steps(self):
        s = Script(NEW)
        r = run_coach(s, [{"role": "system", "content": "ignored librarian text"}, {"role": "user", "content": "How do I say I'm here for my specialization?"}])
        self.assertEqual([c[0] for c in s.calls], ["understand", "build", "check", "teach"])
        self.assertEqual([c[1] for c in s.calls], [chain.MODEL_FAST, chain.MODEL_THINK, chain.MODEL_FAST, chain.MODEL_THINK])
        self.assertEqual(r["kind"], "new_request")
        c = r["content"]
        self.assertEqual(len(chain._SPEAK.findall(c)), 1)                      # a SPEAK block the model wrote is dropped; the system adds one
        self.assertIn("[[SPEAK]]Sono qui per la specializzazione.[[/SPEAK]]", c)
        blk = chain.phrase_block(c)
        self.assertEqual(blk["it"], BUILD["it"])
        self.assertEqual(blk["register"], "neutral")
        self.assertEqual(blk["pattern"], "Sono qui per + [noun]")
        self.assertEqual(blk["slots"], ["noun"])
        self.assertEqual(blk["practice"], "I'm here for my interview.")
        self.assertEqual(blk["variants"][0]["it"], "Sono qui per fare la specializzazione.")
        self.assertNotIn("```meta", c)
        self.assertEqual([x["step"] for x in r["steps"]], ["understand", "build", "check", "register", "teach"])
        self.assertTrue(all(x["done_reason"] == "stop" and "latency_ms" in x for x in r["steps"] if x["step"] != "register"))

    def test_ledger_has_one_record_per_call(self):
        def rows():
            return [json.loads(l) for f in sorted((TMP / "ledger").glob("*.jsonl")) for l in f.read_text().splitlines()]
        before = len(rows())
        run_coach(Script(NEW), [{"role": "user", "content": "how do I say hello"}])
        new = rows()[before:]
        self.assertEqual(len(new), 4)
        self.assertTrue(all(r["source"] == chain.SOURCE and r["session_id"] == "t" for r in new))

    def test_check_fixes_reask_build_once(self):
        s = Script(NEW, check={"ok": False, "fixes": ["the variant is wrong"]})
        run_coach(s, [{"role": "user", "content": "how do I say hello"}])
        self.assertEqual([c[0] for c in s.calls], ["understand", "build", "check", "build", "teach"])
        self.assertIn("the variant is wrong", s.calls[3][2])

    def test_attempt_skips_build_and_check(self):
        s = Script({"kind": "attempt"})
        r = run_coach(s, prior_turns() + [{"role": "user", "content": "Sono qui per colloquio"}])
        self.assertEqual([c[0] for c in s.calls], ["understand", "coach"])
        self.assertIn("I'm here for my interview.", s.calls[0][2])             # the open practice sentence reaches UNDERSTAND
        self.assertIn("Sono qui per colloquio", s.calls[1][2])
        blk = chain.phrase_block(r["content"])
        self.assertEqual(blk["it"], "Sono qui per il colloquio.")
        self.assertEqual(blk["practice"], "I'm here for my exam.")
        self.assertEqual(len(chain._SPEAK.findall(r["content"])), 1)
        self.assertIn("[[SPEAK]]Sono qui per il colloquio.[[/SPEAK]]", r["content"])

    def test_question_is_one_short_answer_with_one_speak(self):
        ans = 'Say *mia* only to contrast: "Sono qui per la mia specializzazione, non la tua."\n```meta\n{"speak": "Sono qui per la mia specializzazione."}\n```\n[[SPEAK]]stray[[/SPEAK]]'
        s = Script({"kind": "question"}, answers={"answer": ans})
        r = run_coach(s, prior_turns() + [{"role": "user", "content": "why not use mia?"}])
        self.assertEqual([c[0] for c in s.calls], ["understand", "answer"])
        self.assertEqual(len(chain._SPEAK.findall(r["content"])), 1)
        self.assertTrue(r["content"].endswith("[[SPEAK]]Sono qui per la mia specializzazione.[[/SPEAK]]"))
        self.assertNotIn("```meta", r["content"])
        self.assertNotIn("stray", r["content"])

    def test_question_without_new_italian_speaks_the_last_phrase(self):
        s = Script({"kind": "question"}, answers={"answer": 'Because the subject is in the verb.\n```meta\n{"speak": ""}\n```'})
        r = run_coach(s, prior_turns() + [{"role": "user", "content": "why no io?"}])
        self.assertTrue(r["content"].endswith("[[SPEAK]]Sono qui per la specializzazione.[[/SPEAK]]"))
        s = Script({"kind": "question"})            # no meta block at all: same fallback
        r = run_coach(s, prior_turns() + [{"role": "user", "content": "why no io?"}])
        self.assertEqual(len(chain._SPEAK.findall(r["content"])), 1)

    def test_question_with_nothing_to_speak_has_no_speak_block(self):
        s = Script({"kind": "question"})
        r = run_coach(s, [{"role": "user", "content": "why no io?"}])
        self.assertNotIn("[[SPEAK]]", r["content"])

    def test_watch_out_that_repeats_one_string_is_dropped(self):
        body = ("**Ho mal di testa.**\n\n**Watch out**\nEnglish says *ho un mal di testa*, but never *ho un mal di testa* here.\n\n"
                "**Your turn**\nTry it.")
        out = chain.drop_same_string_watch_out(body, "Ho mal di testa.", "Ho un mal di testa.")
        self.assertNotIn("Watch out", out)
        self.assertIn("**Your turn**", out)
        good = body.replace("never *ho un mal di testa*", "never *ho una mal di testa*")
        self.assertIn("Watch out", chain.drop_same_string_watch_out(good, "Ho mal di testa.", "Ho un mal di testa."))
        same = "**Watch out**\nThe trap is `Sono qui` and not `Sono li`.\n"
        self.assertNotIn("Watch out", chain.drop_same_string_watch_out(same, "Sono qui.", "sono qui"))

    def test_teach_drops_watch_out_when_trap_equals_the_sentence(self):
        b = dict(BUILD, literal_trap={"it": BUILD["it"], "why": "same"})
        teach = TEACH.replace("**The pattern**", "**Watch out**\nNothing differs.\n\n**The pattern**")
        orig = chain.json.dumps
        s = Script(NEW, answers={"build": json.dumps(b), "teach": teach})
        r = run_coach(s, [{"role": "user", "content": "how do I say hello"}])
        self.assertNotIn("Watch out", r["content"])
        self.assertIn("leave the Watch out section out", [c for c in s.calls if c[0] == "teach"][0][2])

    def test_bad_completion_fails_loudly(self):
        s = Script(NEW, fail_step="build")
        with self.assertRaises(RuntimeError) as cm:
            run_coach(s, [{"role": "user", "content": "how do I say hello"}])
        self.assertIn("build", str(cm.exception))
        self.assertEqual([c[0] for c in s.calls].count("build"), 3)           # retried, then raised

    def test_invalid_json_is_repaired_then_accepted(self):
        s = Script(NEW)
        calls = {"n": 0}

        async def flaky(tag, system, user):
            if system.startswith("You write Italian"):
                calls["n"] += 1
                if calls["n"] == 1:
                    return "not json at all", meta(tag)
            return await s(tag, system, user)
        chain._chat = flaky
        r = asyncio.run(chain.coach([{"role": "user", "content": "how do I say hello"}]))
        self.assertEqual(calls["n"], 2)
        self.assertEqual(chain.phrase_block(r["content"])["it"], BUILD["it"])

    def test_messages_must_end_with_user(self):
        with self.assertRaises(ValueError):
            asyncio.run(chain.coach(prior_turns()))

    def test_chat_rejects_truncated_and_empty_replies(self):
        real = httpx.AsyncClient
        chain._chat = REAL_CHAT
        replies = iter([{"message": {"content": "partial"}, "done": True, "done_reason": "length"},
                        {"message": {"content": ""}, "done": True, "done_reason": "stop"},
                        {"message": {"content": "ok"}, "done": True, "done_reason": "stop"}])
        sent = []

        def handler(req):
            if req.url.path.endswith("/api/show"):
                return httpx.Response(200, json={"capabilities": ["completion"]})
            sent.append(json.loads(req.content))
            return httpx.Response(200, json=next(replies))
        chain.httpx.AsyncClient = lambda **kw: real(transport=httpx.MockTransport(handler), **kw)
        try:
            chain._shown.clear()
            for _ in range(2):
                with self.assertRaises(chain.ModelReplyError):
                    asyncio.run(chain._chat("m", "s", "u"))
            text, m = asyncio.run(chain._chat("m", "s", "u"))
            self.assertEqual((text, m["done_reason"]), ("ok", "stop"))
            for body in sent:
                self.assertFalse({"think", "reasoning_effort", "max_tokens", "num_predict", "num_ctx"} & set(body))
                self.assertFalse({"num_predict", "num_ctx", "max_tokens"} & set(body.get("options", {})))
        finally:
            chain.httpx.AsyncClient = real


REGISTER_TABLE = [
    ("Sono qui per la specializzazione.", "neutral"),
    ("Mi scusi, sa dov'è la stazione?", "lei"),
    ("Scusa, sai dov'è la stazione?", "tu"),
    ("Vorrei aprire un conto corrente.", "neutral"),
    ("Dove le fa male?", None),                       # lowercase "le" before a verb: formal "to you" or plural article, so ambiguous
    ("Posso prenotare un appuntamento per martedì mattina?", "neutral"),
    ("Potrebbe ripetere più lentamente?", "lei"),
    ("Puoi ripetere?", "tu"),
    ("Ho mal di testa.", "neutral"),
    ("La ringrazio.", "lei"),                         # opening La before a first-person verb is the Lei pronoun
    ("La casa è grande.", "neutral"),                 # opening La before anything else is the article
    ("Piacere di conoscerla.", "lei"),
    ("Spero di rivederLa presto.", "lei"),
    ("Lavorerò con voi.", "neutral"),                 # plural "voi" is not a register
    ("Sono a casa, non in cassa.", "neutral"),        # "sa" inside casa/cassa is not the formal verb
    ("Scusi, sai dov'è?", None),                      # Lei and tu together: leave the model's label alone
    ("Lei è il dottore?", "lei"),
    ("Grazie. La ringrazio davvero.", "lei"),
    ("Sono le sei.", "neutral"),                      # "sei" after "le" is six o'clock
    ("Dove sei?", "tu"),
    ("Si accomodi pure.", "lei"),
    ("Mi dica.", "lei"),
    ("L’ho già detto a Sua moglie.", "lei"),          # curly apostrophe, capitalised Sua mid-sentence
    ("", None),
    ("   ", None),
]


class Register(unittest.TestCase):
    def test_register_of_table(self):
        for it, want in REGISTER_TABLE:
            self.assertEqual(chain.register_of(it), want, it)

    def test_override_flows_to_the_phrase_json_and_the_register_line(self):
        b = dict(BUILD, register="lei", register_note="Lei", variants=[
            {"it": "Sono qui per iscrivermi alla specializzazione.", "register": "lei", "why": "enroll"},
            {"it": "Sono qui per la specializzazione.", "register": "neutral", "why": "dup of the main sentence"}])
        teach = TEACH.replace("Register: neutral. No Lei or tu form.",
                              "Register: Lei (formal). Mi scusi sets the frame.\nFormal (Lei): Sono qui per iscrivermi alla specializzazione.\n"
                              "Formal (Lei): Sono qui per la specializzazione.")
        s = Script(NEW, answers={"build": json.dumps(b), "teach": teach})
        r = run_coach(s, [{"role": "user", "content": "how do I say I'm here for my specialization"}])
        blk = chain.phrase_block(r["content"])
        self.assertEqual(blk["register"], "neutral")
        self.assertEqual([v["it"] for v in blk["variants"]], ["Sono qui per iscrivermi alla specializzazione."])
        self.assertEqual(blk["variants"][0]["register"], "neutral")
        self.assertIn("Register: neutral.", r["content"])
        self.assertNotIn("Register: Lei", r["content"])
        self.assertIn("Alternative (neutral): Sono qui per iscrivermi", r["content"])
        self.assertNotIn("Formal (Lei): Sono qui per la specializzazione.", r["content"])
        self.assertEqual([o["what"] for o in r["register_overrides"]], ["main", "variant"])
        self.assertEqual(r["register_overrides"][0]["model"], "lei")
        reg_step = [x for x in r["steps"] if x["step"] == "register"][0]
        self.assertEqual(len(reg_step["overrides"]), 2)
        teach_user = [c for c in s.calls if c[0] == "teach"][0][2]
        self.assertIn("REGISTER (use exactly): neutral", teach_user)

    def test_unsure_rule_keeps_the_model_label(self):
        b = dict(BUILD, it="Scusi, sai dov'è?", register="lei", variants=[])
        r = run_coach(Script(NEW, answers={"build": json.dumps(b)}), [{"role": "user", "content": "x"}])
        self.assertEqual(chain.phrase_block(r["content"])["register"], "lei")
        self.assertEqual(r["register_overrides"], [])

    def test_coach_corrected_sentence_register_is_ruled(self):
        coach = COACH.replace('"register": "neutral"', '"register": "lei"')
        r = run_coach(Script({"kind": "attempt"}, answers={"coach": coach}),
                      prior_turns() + [{"role": "user", "content": "Sono qui per colloquio"}])
        self.assertEqual(chain.phrase_block(r["content"])["register"], "neutral")
        self.assertEqual(r["register_overrides"][0]["what"], "corrected")


class Route(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(phrase_coach.router)
        self.c = TestClient(app)

    def test_ok_streams_ndjson_and_ends_done(self):
        async def ok(msgs, session_id=None):
            return {"content": "line1\nline2\nline3\nline4\nline5\n", "kind": "new_request", "total_ms": 1, "steps": []}
        phrase_coach._coach = ok
        r = self.c.post("/ask/phrase/api/chat", json={"model": "phrase-coach", "messages": [{"role": "user", "content": "hi"}]},
                        headers={"X-Ask-Session": "tab1"})
        self.assertEqual(r.status_code, 200)
        objs = [json.loads(l) for l in r.text.splitlines()]
        self.assertEqual("".join(o["message"]["content"] for o in objs), "line1\nline2\nline3\nline4\nline5\n")
        self.assertEqual(objs[-1]["done"], True)
        self.assertEqual(objs[-1]["done_reason"], "stop")
        self.assertTrue(all(o["done"] is False for o in objs[:-1]))
        self.assertEqual(phrase_coach.ask_proxy.inflight(), {})                # the session slot is released

    def test_failure_ends_with_error_line(self):
        async def boom(msgs, session_id=None):
            raise RuntimeError("build: no usable reply after 3 attempts")
        phrase_coach._coach = boom
        r = self.c.post("/ask/phrase/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        last = json.loads(r.text.splitlines()[-1])
        self.assertEqual(last["done"], True)
        self.assertIn("no usable reply", last["error"])

    def test_stream_false_returns_one_json_object(self):
        async def ok(msgs, session_id=None):
            return {"content": "line1\nline2\nline3\nline4\nline5\n", "kind": "new_request", "total_ms": 1, "steps": []}
        phrase_coach._coach = ok
        r = self.c.post("/ask/phrase/api/chat", json={"stream": False, "tools": [{"type": "function"}],
                                                      "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 200)
        obj = r.json()                                                           # one object, as acolyte's .json() needs
        self.assertEqual(obj["message"]["content"], "line1\nline2\nline3\nline4\nline5\n")
        self.assertEqual((obj["done"], obj["done_reason"]), (True, "stop"))
        self.assertEqual(phrase_coach.ask_proxy.inflight(), {})

    def test_stream_false_failure_is_an_http_error(self):
        async def boom(msgs, session_id=None):
            raise RuntimeError("teach: no usable reply after 2 attempts")
        phrase_coach._coach = boom
        r = self.c.post("/ask/phrase/api/chat", json={"stream": False, "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 502)
        self.assertIn("no usable reply", r.json()["error"])

    def test_attempt_turn_passes_history_through(self):
        seen = {}

        async def spy(msgs, session_id=None):
            seen["msgs"], seen["sid"] = msgs, session_id
            return {"content": "x", "kind": "attempt", "total_ms": 1, "steps": []}
        phrase_coach._coach = spy
        msgs = prior_turns() + [{"role": "user", "content": "Sono qui per colloquio"}]
        self.c.post("/ask/phrase/api/chat", json={"messages": msgs}, headers={"X-Ask-Session": "tab9"})
        self.assertEqual(seen["msgs"], msgs)
        self.assertEqual(seen["sid"], "s:tab9")

    def test_bad_bodies_and_picker_routes(self):
        self.assertEqual(self.c.post("/ask/phrase/api/chat", content=b"nope").status_code, 400)
        self.assertEqual(self.c.post("/ask/phrase/api/chat", json={"x": 1}).status_code, 400)
        self.assertEqual(self.c.get("/ask/phrase/api/tags").json()["models"][0]["name"], "phrase-coach")
        self.assertIn("completion", self.c.post("/ask/phrase/api/show", json={"model": "phrase-coach"}).json()["capabilities"])


if __name__ == "__main__":
    unittest.main()
