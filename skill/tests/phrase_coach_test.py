"""phrase_coach_test — the phrase-coach chain (kind routing, check/fix loop, attempt coaching, bad completions) and the
NDJSON route /ask/phrase/api/*. Model calls are mocked at the chain's transport (_chat) and at httpx; no network.
Run: ~/miniconda3/bin/python tests/phrase_coach_test.py"""
import asyncio, json, os, re, sys, tempfile, unittest
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
chain.RELATED = None        # the library lookup is off unless a test sets it
REAL_CHAT = chain._chat


def meta(tag, reason="stop"):
    return {"model": tag, "done_reason": reason, "latency_ms": 5, "thinking_chars": 0, "tokens_in": 1, "tokens_out": 1}


BUILD = {"it": "Sono qui per la specializzazione.", "register": "neutral", "register_note": "no address form",
         "variants": [{"it": "Sono qui per fare la specializzazione.", "register": "neutral", "why": "common"}],
         "literal_trap": {"it": "Io sono qui per la mia specializzazione.", "why": "io and mia are redundant"}}
TEACH = ("**The pattern**\n`Sono qui per + [noun]`\n\n**Your turn**\nI'm here for my interview.\n\n```meta\n"
         '{"pattern": "Sono qui per + [noun]", "slots": ["noun"], "practice": "I\'m here for my interview.", '
         '"breakdown": [{"chunk": "Sono qui", "gloss": "I am here"}]}\n```\n[[SPEAK]]stray model speak[[/SPEAK]]')
COACH = ("**Good: you used the frame.**\n**Corrections**\n- per il colloquio, not per colloquio.\n**Corrected sentence** **Sono qui per il colloquio.**\n**How it's built**\n1. **sono qui**\n2. **sono qui per**\n3. **Sono qui per il colloquio.**\n\n**Your turn**\nI'm here for my exam.\n\n```meta\n"
         '{"corrected": "Sono qui per il colloquio.", "register": "neutral", "pattern": "Sono qui per + [noun]", "slots": ["noun"], '
         '"practice": "I\'m here for my exam.", "breakdown": [{"chunk": "per il colloquio", "gloss": "for the interview"}]}\n```')


def diagram_for(texts, tag_note="note"):
    """A valid DIAGRAM reply: one token per word of each sentence."""
    sents = []
    for t in texts:
        toks = [{"surface": w, "lemma": w.lower(), "pos": "NOUN", "layer": "nouns", "note": f"{tag_note} {w}"}
                for w in t.replace(".", "").replace("?", "").replace(",", "").split()]
        sents.append({"translation": "English", "literal": "lit", "tokens": toks, "phrases": [], "tips": []})
    return json.dumps({"sentences": sents})


ITEM_BLOCK = "**How it's built**\n1. **a**\n2. **a b**\n3. **c**"
SHARED_MULTI = ("**The pattern**\n`[question word] è [noun]?`\n\n**Your turn**\nWhere is the room?\n\n```meta\n"
                '{"pattern": "[question word] è [noun]?", "slots": ["q", "noun"], "practice": "Where is the room?", "breakdown": [{"chunk": "Dov\'è", "gloss": "where is"}]}\n```')


class Script:
    """Replaces chain._chat: answers by step (read from the system prompt) and records the calls."""
    def __init__(self, understand, check=None, fail_step=None, answers=None):
        self.calls, self.understand, self.check = [], understand, check or {"ok": True, "fixes": []}
        self.diagram_texts = [BUILD["it"]]
        self.fail_step, self.answers = fail_step, answers or {}

    async def __call__(self, tag, system, user):
        step = ("understand" if system.startswith("You route") else "build" if system.startswith("You write Italian")
                else "check" if system.startswith("You are a strict") else "teach_item" if "You are given ONE phrase" in system
                else "teach_shared" if "Write only the shared teaching" in system
                else "coach" if "marking a learner" in system else "diagram" if system.startswith("You are a grammar annotator") else "answer")
        self.calls.append((step, tag, user))
        if step == self.fail_step:
            raise chain.ModelReplyError(f"{tag}: done_reason='length', 0 chars of content")
        if step in self.answers:
            v = self.answers[step]
            return (v(user) if callable(v) else v), meta(tag)
        out = {"understand": json.dumps(self.understand), "build": json.dumps(BUILD), "diagram": diagram_for(re.findall(r"(?m)^\d+\. (.+)$", user)),
               "teach_item": ITEM_BLOCK, "teach_shared": TEACH if user.startswith("N = 1\n") else SHARED_MULTI,
               "check": json.dumps(self.check(user) if callable(self.check) else self.check), "coach": COACH, "answer": "Because Italian drops the subject pronoun."}[step]
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
        self.assertEqual([c[0] for c in s.calls[:3]], ["understand", "build", "check"])
        self.assertEqual(sorted(c[0] for c in s.calls[3:]), ["diagram", "teach_item", "teach_shared"])   # all three run concurrently
        self.assertEqual([c[1] for c in s.calls[:3]], [chain.MODEL_FAST, chain.MODEL_THINK, chain.MODEL_FAST])
        self.assertEqual({c[1] for c in s.calls[3:]}, {chain.MODEL_THINK})
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
        self.assertEqual([x["step"] for x in r["steps"]][:3], ["understand", "build", "check"])
        self.assertEqual(sorted(x["step"] for x in r["steps"][3:]), ["diagram", "how-built", "register", "teach"])
        self.assertTrue(all(x["done_reason"] == "stop" and "latency_ms" in x for x in r["steps"] if x["step"] != "register"))

    def test_ledger_has_one_record_per_call(self):
        def rows():
            return [json.loads(l) for f in sorted((TMP / "ledger").glob("*.jsonl")) for l in f.read_text().splitlines()]
        before = len(rows())
        run_coach(Script(NEW), [{"role": "user", "content": "how do I say hello"}])
        new = rows()[before:]
        self.assertEqual(len(new), 6)
        self.assertTrue(all(r["source"] == chain.SOURCE and r["session_id"] == "t" for r in new))

    def test_check_fixes_reask_build_once(self):
        s = Script(NEW, check={"ok": False, "fixes": ["the variant is wrong"]})
        run_coach(s, [{"role": "user", "content": "how do I say hello"}])
        self.assertEqual([c[0] for c in s.calls[:4]], ["understand", "build", "check", "build"])
        self.assertEqual(sorted(c[0] for c in s.calls[4:]), ["diagram", "teach_item", "teach_shared"])
        self.assertIn("the variant is wrong", s.calls[3][2])

    def test_attempt_skips_build_and_check(self):
        s = Script({"kind": "attempt"})
        s.diagram_texts = ["Sono qui per il colloquio."]
        r = run_coach(s, prior_turns() + [{"role": "user", "content": "Sono qui per colloquio"}])
        self.assertEqual([c[0] for c in s.calls], ["understand", "coach", "diagram"])   # the corrected sentence is diagrammed after COACH
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
        s = Script(NEW, answers={"build": json.dumps(b), "teach_shared": teach})
        r = run_coach(s, [{"role": "user", "content": "how do I say hello"}])
        self.assertNotIn("Watch out", r["content"])
        self.assertIn("leave the Watch out section out", [c for c in s.calls if c[0] == "teach_shared"][0][2])

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
    ("Si può parcheggiare qui?", "neutral"),          # impersonal si governs the verb
    ("Non si può fumare.", "neutral"),
    ("Lei sa dove si può parcheggiare?", "lei"),
    ("Sa se si può entrare?", "lei"),                  # the opening Sa is not governed by the later si
    ("Si sa mai.", "neutral"),
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
        s = Script(NEW, answers={"build": json.dumps(b)})
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
        teach_user = [c for c in s.calls if c[0] == "teach_shared"][0][2]
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


M_EN = ["Where is the clinic?", "Who is my tutor?", "What time is the safety course?"]
M_ITEMS = [{"it": "Dov'è l'ambulatorio?", "register": "neutral", "register_note": "no address form", "variants": [],
            "literal_trap": {"it": "Dove è l'ambulatorio?", "why": "elision"}},
           {"it": "Chi è il mio tutor?", "register": "neutral", "register_note": "no address form", "variants": [],
            "literal_trap": {"it": "Chi è il mio tutor?", "why": "same"}},
           {"it": "A che ora è il corso di sicurezza?", "register": "neutral", "register_note": "no address form", "variants": [],
            "literal_trap": {"it": "Che tempo è il corso?", "why": "time is ora"}}]
M_NEW = {**NEW, "meaning": "three questions", "phrases": [{"en": e, "situation": ""} for e in M_EN]}

def _item_for(user):
    listed = user.split("PHRASES TO BUILD:")[1]
    return next(i for i, e in zip(M_ITEMS, M_EN) if e in listed)


def multi_script(**kw):
    answers = {"build": lambda user: json.dumps({"items": [_item_for(user)]}), **kw.pop("answers", {})}
    s = Script(M_NEW, answers=answers, **kw)
    return s


class MultiPhrase(unittest.TestCase):
    MSG = [{"role": "user", "content": "how do i say these phrases: 1. Where is the clinic? 2. Who is my tutor? 3. What time is the safety course?"}]

    def test_one_build_and_one_check_per_item_each_with_its_own_phrase(self):
        s = multi_script()
        r = run_coach(s, self.MSG)
        steps = [c[0] for c in s.calls]
        self.assertEqual((steps.count("build"), steps.count("check")), (3, 3))
        for c in [c for c in s.calls if c[0] == "build"]:
            self.assertIn("N = 1", c[2])
            listed = c[2].split("PHRASES TO BUILD:")[1]
            self.assertEqual(sum(e in listed for e in M_EN), 1)                  # only its own phrase is built
            self.assertIn("OTHER PHRASES IN THE SAME MESSAGE", c[2])             # the rest ride along as context
        self.assertEqual(len(chain.phrase_block(r["content"])["items"]), 3)

    def test_phrase_block_has_items_and_keeps_top_level_it(self):
        r = run_coach(multi_script(), self.MSG)
        blk = chain.phrase_block(r["content"])
        self.assertEqual([i["it"] for i in blk["items"]], [i["it"] for i in M_ITEMS])
        self.assertEqual([i["en"] for i in blk["items"]], M_EN)
        self.assertEqual(blk["it"], M_ITEMS[0]["it"])                         # backward compatible
        self.assertEqual(blk["pattern"], "[question word] è [noun]?")

    def test_speak_holds_all_n_sentences_in_order(self):
        r = run_coach(multi_script(), self.MSG)
        speaks = chain._SPEAK.findall(r["content"])
        self.assertEqual(len(speaks), 1)
        txt = speaks[0]
        pos = [txt.index(i["it"]) for i in M_ITEMS]
        self.assertEqual(pos, sorted(pos))

    def test_every_item_has_a_how_its_built_section(self):
        r = run_coach(multi_script(), self.MSG)
        self.assertEqual(len(chain._HOW.findall(r["content"])), 3)

    def test_teach_item_missing_a_how_its_built_section_is_asked_again_then_fails(self):
        s = multi_script(answers={"teach_item": "No steps here."})
        with self.assertRaises(RuntimeError) as cm:
            run_coach(s, self.MSG)
        self.assertIn("How it", str(cm.exception))
        self.assertIn("exactly 1", [c for c in s.calls if c[0] == "teach_item"][-1][2])

    def test_multi_teach_is_one_call_per_phrase_plus_a_shared_call(self):
        s = multi_script()
        r = run_coach(s, self.MSG)
        steps = [c[0] for c in s.calls]
        self.assertEqual((steps.count("teach_item"), steps.count("teach_shared")), (3, 1))
        self.assertEqual(len(chain._HOW.findall(r["content"])), 3)
        heads = [l for l in r["content"].splitlines() if l.startswith("**") and l[2:3].isdigit()]
        self.assertEqual(heads, [f"**{k}) {i['it']}**" for k, i in enumerate(M_ITEMS, 1)])
        self.assertLess(r["content"].index("**3) "), r["content"].index("**How it's built"))      # every Italian line first
        self.assertLess(r["content"].rindex("**How it's built"), r["content"].index("**The pattern**"))

    def test_single_phrase_teach_also_requires_how_its_built(self):
        s = Script(NEW, answers={"teach_item": "1. a\n2. b\n3. c"})
        with self.assertRaises(RuntimeError):
            run_coach(s, [{"role": "user", "content": "how do I say hello"}])

    def test_a_flagged_item_is_rebuilt_alone(self):
        fixed = {**M_ITEMS[1], "it": "Chi è il mio tutor di percorso?"}
        calls = {"build": 0}

        def build(user):
            calls["build"] += 1
            return json.dumps({"items": [fixed if "REVIEWER FIXES" in user else _item_for(user)]})
        s = multi_script(check=lambda user: {"ok": False, "fixes": [{"item": 1, "fix": "use tutor di percorso"}]} if "Chi è il mio tutor?" in user else {"ok": True, "fixes": []},
                         answers={"build": build})
        r = run_coach(s, self.MSG)
        self.assertEqual(calls["build"], 4)                                       # 3 builds + one re-ask, not 3 more
        fix_user = [c for c in s.calls if c[0] == "build" and "REVIEWER FIXES" in c[2]][0][2]
        listed = fix_user.split("PHRASES TO BUILD:")[1].split("## REVIEWER FIXES")[0]
        self.assertIn(M_EN[1], listed)
        self.assertNotIn(M_EN[0], listed)
        self.assertEqual([i["it"] for i in chain.phrase_block(r["content"])["items"]],
                         [M_ITEMS[0]["it"], fixed["it"], M_ITEMS[2]["it"]])

    def test_register_rule_runs_per_item(self):
        items = [dict(i) for i in M_ITEMS]
        items[1] = {**items[1], "it": "Scusi, chi è il mio tutor?", "register": "neutral"}      # has a Lei opener
        s = multi_script(answers={"build": lambda user: json.dumps({"items": [next(i for i, e in zip(items, M_EN) if e in user.split("PHRASES TO BUILD:")[1])]})})
        r = run_coach(s, self.MSG)
        regs = [i["register"] for i in chain.phrase_block(r["content"])["items"]]
        self.assertEqual(regs, ["neutral", "lei", "neutral"])

    def test_build_with_wrong_item_count_is_repaired_then_fails(self):
        s = multi_script(answers={"build": json.dumps({"items": M_ITEMS[:2]})})
        with self.assertRaises(RuntimeError):
            run_coach(s, self.MSG)
        repair = [c for c in s.calls if c[0] == "build" and "PROBLEMS" in c[2]]
        self.assertTrue(repair)
        self.assertIn("exactly 1", repair[0][2])

    def test_understand_without_phrases_still_builds_one(self):
        r = run_coach(Script(NEW), [{"role": "user", "content": "how do I say hello"}])
        self.assertEqual(len(chain.phrase_block(r["content"])["items"]), 1)


class Diagram(unittest.TestCase):
    MSG = [{"role": "user", "content": "how do I say I'm here for my specialization?"}]

    def test_diagram_fence_is_a_valid_annotated_passage(self):
        r = run_coach(Script(NEW), self.MSG)
        doc = json.loads(chain._DFENCE.search(r["content"]).group(1))
        self.assertEqual(chain.validate_annotated_passage(doc), [])
        self.assertEqual(doc["type"], "annotated-passage")
        self.assertEqual(len(doc["sentences"]), 1)
        self.assertEqual(doc["sentences"][0]["text"], BUILD["it"])
        self.assertTrue(r["content"].index("```phrase") < r["content"].index("```diagram"))

    def test_n_items_give_n_sentences(self):
        r = run_coach(multi_script(), MultiPhrase.MSG)
        doc = json.loads(chain._DFENCE.search(r["content"]).group(1))
        self.assertEqual([s["idx"] for s in doc["sentences"]], [1, 2, 3])

    def test_invalid_diagram_is_repaired(self):
        s = Script(NEW)
        n = {"d": 0}
        orig = s.__call__

        async def flaky(tag, system, user):
            if system.startswith("You are a grammar annotator"):
                n["d"] += 1
                if n["d"] == 1:
                    return json.dumps({"sentences": [{"translation": "x", "tokens": [{"surface": "Sono", "pos": "VERB", "layer": "bogus", "note": "n"}]}]}), meta(tag)
            return await orig(tag, system, user)
        chain._chat = flaky
        r = asyncio.run(chain.coach(self.MSG))
        self.assertEqual(n["d"], 2)
        self.assertIn("```diagram", r["content"])

    def test_diagram_failure_keeps_the_reply(self):
        s = Script(NEW, fail_step="diagram")
        r = run_coach(s, self.MSG)
        self.assertNotIn("```diagram", r["content"])
        self.assertIn("**How it's built**", r["content"])
        self.assertIn("[[SPEAK]]", r["content"])
        self.assertTrue(r["diagram_error"])
        self.assertEqual([x for x in r["steps"] if x["step"] == "diagram"][0]["done_reason"], "failed")

    def test_surface_not_in_sentence_is_rejected(self):
        bad = {"sentences": [{"translation": "x", "tokens": [{"surface": "Zebra", "pos": "NOUN", "layer": "nouns", "note": "n"}]}]}
        self.assertIn("does not occur", chain.validate_sentences(bad, ["Sono qui."]))

    def test_validator_mirrors_the_zod_required_fields(self):
        doc = chain.assemble_passage(json.loads(diagram_for(["Sono qui."]))["sentences"], ["Sono qui."])
        self.assertEqual(chain.validate_annotated_passage(doc), [])
        for mutate in (lambda d: d.update(language="fr"), lambda d: d.update(genre="poem"), lambda d: d.update(layers=[]),
                       lambda d: d.update(sentences=[]), lambda d: d["sentences"][0].update(tokens=[]),
                       lambda d: d["sentences"][0]["tokens"][0].update(layer="x"), lambda d: d.update(type="widget")):
            bad = json.loads(json.dumps(doc))
            mutate(bad)
            self.assertTrue(chain.validate_annotated_passage(bad))

    def test_teach_and_diagram_run_concurrently(self):
        s = Script(NEW)
        orig = s.__call__
        ev = {}

        async def barrier(tag, system, user):
            name = "teach" if "Write only the shared teaching" in system else "diagram" if system.startswith("You are a grammar annotator") else None
            if name:
                ev.setdefault("teach", asyncio.Event())
                ev.setdefault("diagram", asyncio.Event())
                ev[name].set()
                other = "diagram" if name == "teach" else "teach"
                await asyncio.wait_for(ev[other].wait(), 3)      # sequential calls would time out here
            return await orig(tag, system, user)
        chain._chat = barrier
        r = asyncio.run(chain.coach(self.MSG))
        self.assertIn("```diagram", r["content"])

    def test_coach_path_diagrams_the_corrected_sentence(self):
        s = Script({"kind": "attempt"})
        s.diagram_texts = ["Sono qui per il colloquio."]
        r = run_coach(s, prior_turns() + [{"role": "user", "content": "Sono qui per colloquio"}])
        doc = json.loads(chain._DFENCE.search(r["content"]).group(1))
        self.assertEqual(doc["sentences"][0]["text"], "Sono qui per il colloquio.")
        self.assertEqual(len(chain._HOW.findall(r["content"])), 1)

    def test_multi_sentence_item_is_annotated_per_sentence_and_merged(self):
        item = {**BUILD, "it": "Scusi, dove è? E chi è il tutor?", "register": "lei"}
        s = Script(NEW, answers={"build": json.dumps({"items": [item]})})
        r = run_coach(s, self.MSG)
        self.assertEqual([c[0] for c in s.calls].count("diagram"), 2)          # one call per Italian sentence
        doc = json.loads(chain._DFENCE.search(r["content"]).group(1))
        self.assertEqual(len(doc["sentences"]), 1)                              # still one ApSentence per phrase
        surfaces = [t["surface"] for t in doc["sentences"][0]["tokens"]]
        self.assertIn("dove", surfaces)
        self.assertIn("chi", surfaces)
        self.assertEqual(doc["sentences"][0]["text"], item["it"])

    def test_backticks_in_notes_cannot_close_the_fence(self):
        d = json.loads(diagram_for([BUILD["it"]]))
        d["sentences"][0]["tokens"][0]["note"] = "use ``` carefully"
        s = Script(NEW, answers={"diagram": json.dumps(d)})
        r = run_coach(s, self.MSG)
        doc = json.loads(chain._DFENCE.search(r["content"]).group(1))
        self.assertIn("```", doc["sentences"][0]["tokens"][0]["note"])


def verb_diagram():
    d = json.loads(diagram_for([BUILD["it"]]))
    d["sentences"][0]["tokens"][0].update(lemma="stare", pos="VERB", layer="verbs")
    return json.dumps(d)


SAMPLE_DOC = {"sentences": [{"idx": 1, "text": "Scusi, dove e quando devo fare la presa di servizio?", "translation": "t",
    "registerNote": "Lei (formal)", "tokens": [
        {"surface": "Scusi", "lemma": "scusare", "pos": "VERB", "layer": "verbs", "note": "imperative"},
        {"surface": "dove", "lemma": "dove", "pos": "ADV", "layer": "adverbs", "note": "where"},
        {"surface": "quando", "lemma": "quando", "pos": "ADV", "layer": "adverbs", "note": "when"},
        {"surface": "devo", "lemma": "dovere", "pos": "VERB", "layer": "verbs", "note": "must"},
        {"surface": "fare", "lemma": "fare", "pos": "VERB", "layer": "verbs", "features": {"form": "infinitive"}, "note": "to do"},
        {"surface": "di", "lemma": "di", "pos": "ADP", "layer": "preps", "note": "of"},
        {"surface": "si", "lemma": "si", "pos": "PRON", "layer": "pronouns", "note": "impersonal si"}],
    "phrases": [{"surface": "presa di servizio", "type": "fixed-expression", "meaning": "taking up post"}], "tips": []}]}


class Related(unittest.TestCase):
    def test_topics_from_a_diagram(self):
        topics = {t["topic"]: t["kind"] for t in chain.study_topics(SAMPLE_DOC)}
        self.assertEqual(topics["dovere + infinito"], "construction")
        self.assertEqual(topics["interrogativi (dove, quando)"], "construction")
        self.assertEqual(topics["forma di cortesia (Lei)"], "construction")
        self.assertEqual(topics["si impersonale"], "construction")
        self.assertEqual(topics["dovere"], "verb")
        self.assertEqual(topics["fare"], "verb")
        self.assertEqual(topics["presa di servizio"], "vocabulary")
        kinds = [t["kind"] for t in chain.study_topics(SAMPLE_DOC)]
        self.assertEqual(kinds, sorted(kinds, key={"construction": 0, "verb": 1, "vocabulary": 2}.get))   # constructions first

    def test_related_block_follows_the_diagram(self):
        chain.RELATED = lambda topics: {"lessons": [{"title": "Dovere", "url": "/lessons/x/lesson.html", "topic": topics[0]["topic"]}], "missing": ["si impersonale"]}
        try:
            r = run_coach(Script(NEW, answers={"diagram": verb_diagram()}), [{"role": "user", "content": "how do I say hello"}])
        finally:
            chain.RELATED = None
        rel = json.loads(re.search(r"```related\n([\s\S]*?)```", r["content"]).group(1))
        self.assertEqual(rel["missing"], ["si impersonale"])
        self.assertTrue(r["content"].index("```diagram") < r["content"].index("```related"))

    def test_related_failure_is_logged_and_omitted(self):
        def boom(topics):
            raise OSError("shard unreadable")
        chain.RELATED = boom
        try:
            r = run_coach(Script(NEW, answers={"diagram": verb_diagram()}), [{"role": "user", "content": "how do I say hello"}])
        finally:
            chain.RELATED = None
        self.assertNotIn("```related", r["content"])
        self.assertIn("```diagram", r["content"])
        self.assertEqual([x for x in r["steps"] if x["step"] == "related"][0]["done_reason"], "failed")


class Streaming(unittest.TestCase):
    MSG = MultiPhrase.MSG

    def collect(self, script, msgs=None):
        chain._chat = script

        async def go():
            chunks, done = [], None
            async for kind, val in chain.coach_stream(msgs or self.MSG, session_id="t"):
                if kind == "text":
                    chunks.append(val)
                else:
                    done = val
            return chunks, done
        return asyncio.run(go())

    def test_sections_arrive_in_order_and_the_hidden_blocks_come_last(self):
        chunks, done = self.collect(multi_script())
        self.assertEqual(len(chunks), 3 + 3 + 1 + 1)                              # 3 Italian lines, 3 build-ups, shared, tail
        self.assertTrue(chunks[0].startswith("**1) "))
        self.assertTrue(chunks[2].startswith("**3) "))
        self.assertTrue(chunks[3].startswith("**How it's built · 1)"))
        self.assertTrue(chunks[6].startswith("**The pattern**"))
        self.assertTrue(chunks[-1].lstrip().startswith("[[SPEAK]]"))              # SPEAK right before the fences, at the very end
        self.assertIn("```phrase", chunks[-1])
        self.assertTrue(all("```" not in c for c in chunks[:-1]))                 # no fence before the last section
        self.assertEqual("".join(chunks), done["content"])
        self.assertLessEqual(done["first_text_ms"], done["total_ms"])

    def test_a_fenced_block_is_never_split_across_chunks(self):
        chunks, _ = self.collect(multi_script())
        self.assertTrue(all(c.count("```") % 2 == 0 for c in chunks))

    def test_item_order_is_stable_when_a_later_item_finishes_first(self):
        s = multi_script()
        orig = s.__call__

        async def slow_first(tag, system, user):
            if system.startswith("You write Italian") and M_EN[0] in user.split("PHRASES TO BUILD:")[1]:
                await asyncio.sleep(0.3)                                          # item 1 is the slowest to build
            return await orig(tag, system, user)
        chunks, _ = self.collect(slow_first)
        self.assertEqual([c.split(")")[0] for c in chunks[:3]], ["**1", "**2", "**3"])

    def test_the_first_text_does_not_wait_for_the_slow_parts(self):
        s = multi_script()
        orig = s.__call__
        t = {}

        async def slow_rest(tag, system, user):
            if system.startswith("You are a grammar annotator") or "Write only the shared teaching" in system:
                await asyncio.sleep(0.4)
            return await orig(tag, system, user)
        chain._chat = slow_rest

        async def go():
            t0 = asyncio.get_event_loop().time()
            async for kind, val in chain.coach_stream(self.MSG, session_id="t"):
                if kind == "text" and "first" not in t:
                    t["first"] = asyncio.get_event_loop().time() - t0
            t["total"] = asyncio.get_event_loop().time() - t0
        asyncio.run(go())
        self.assertLess(t["first"], 0.25)
        self.assertGreater(t["total"], 0.4)

    def test_a_failed_item_fails_the_stream_after_the_chunks_already_sent(self):
        s = multi_script(fail_step="check")
        chain._chat = s
        seen = []

        async def go():
            async for kind, val in chain.coach_stream(self.MSG, session_id="t"):
                seen.append(kind)
        with self.assertRaises(RuntimeError):
            asyncio.run(go())
        self.assertNotIn("done", seen)


class StreamRoute(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(phrase_coach.router)
        self.c = TestClient(app)
        phrase_coach._coach = chain.coach                                         # the real chain (other tests install mocks)
        chain._chat = multi_script()

    def post(self, **extra):
        return self.c.post("/ask/phrase/api/chat", json={"messages": MultiPhrase.MSG, **extra}, headers={"X-Ask-Session": "sr1"})

    def test_ndjson_has_one_line_per_section_and_the_fences_travel_whole(self):
        objs = [json.loads(l) for l in self.post().text.splitlines()]
        text = [o["message"]["content"] for o in objs if not o["done"]]
        self.assertEqual(len(text), 8)
        self.assertTrue(objs[-1]["done"])
        self.assertEqual([i for i, c in enumerate(text) if "```" in c], [7])         # all three fences in the last line, whole
        self.assertEqual(text[-1].count("```") % 2, 0)

    def test_stream_false_folds_every_section(self):
        streamed = "".join(json.loads(l)["message"]["content"] for l in self.post().text.splitlines())
        chain._chat = multi_script()
        r = self.post(stream=False, tools=[{"type": "function"}])
        self.assertEqual(r.json()["message"]["content"], streamed)

    def test_a_failure_after_some_text_ends_with_the_error_line(self):
        chain._chat = multi_script(fail_step="teach_shared")
        lines = [json.loads(l) for l in self.post().text.splitlines()]
        self.assertTrue(any(not o["done"] and o["message"]["content"].startswith("**1)") for o in lines))
        self.assertIn("no usable reply", lines[-1]["error"])


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
