"""pimsleur_chain_rules_test — the Pimsleur chain's guards: reasoning refused, learner phrases corrected, intro and
item checks. No model calls. Run: ~/miniconda3/bin/python tests/pimsleur_chain_rules_test.py"""
import asyncio, importlib.util, json, os, sys, tempfile, unittest
from pathlib import Path

os.environ.setdefault("CH_TOPIC", "test topic")
os.environ.setdefault("CHIRON_LEDGER_DIR", tempfile.mkdtemp(prefix="chiron-pims-rules-"))
CHAIN = Path(__file__).resolve().parent.parent / "chains" / "2026-10-11_chiron-pimsleur-lesson-chain" / "run.py"
spec = importlib.util.spec_from_file_location("pims_chain", CHAIN)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ITEM = lambda i, it: {"id": f"i{i}", "it": it, "en": f"english sentence {i}", "kind": "phrase", "build": it.split()[-2:] and [" ".join(it.split()[-2:])]}
TALK = {"id": "talk", "it": "Va bene.", "en": "Say something now. Go.", "kind": "talk"}


def bank(n=8, intro=["A scene."], first="La lavanderia è aperta oggi"):
    items = [ITEM(0, first)] + [ITEM(k, f"Frase numero {k} per oggi") for k in range(1, n - 1)] + [TALK]
    return {"intro": intro, "items": items}


class Leak(unittest.TestCase):
    def test_reasoning_before_the_json_is_refused(self):
        self.assertTrue(m.leaked_reasoning("Let me carefully analyze the task.\n" + "x" * 400 + '\n{"items": []}'))

    def test_json_alone_or_fenced_is_accepted(self):
        self.assertFalse(m.leaked_reasoning('{"items": []}'))
        self.assertFalse(m.leaked_reasoning('```json\n{"items": []}\n```'))
        self.assertFalse(m.leaked_reasoning('Here it is:\n{"items": []}'))


class SourceFixes(unittest.TestCase):
    T = [{"it": "Metti i camici nel sacco.", "en": "Put the coats in the bag."},
         {"it": "Stirare i lenzuoli.", "en": "Iron the bedsheets."}]

    def test_fixes_are_applied_and_logged_first_checker_wins(self):
        issues = [{"n": 2, "problem": "irregular plural", "fix_it": "Stirare le lenzuola.", "fix_en": "Iron the bedsheets.", "by": "deepseek"},
                  {"n": 2, "problem": "plural", "fix_it": "Stira le lenzuola.", "fix_en": "Iron the sheets.", "by": "gemma"},
                  {"n": 1, "problem": "same", "fix_it": "Metti i camici nel sacco.", "fix_en": "Put the coats in the bag.", "by": "gemma"},
                  {"n": 9, "problem": "out of range", "fix_it": "x", "by": "gemma"}]
        out, notes = m.apply_source_fixes(self.T, issues)
        self.assertEqual(out[1]["it"], "Stirare le lenzuola.")
        self.assertEqual(out[0], self.T[0])                        # a "fix" that changes nothing is not a change
        self.assertEqual(len(notes), 2)
        self.assertIn("deepseek", notes[0])
        self.assertIn("also suggested by gemma", notes[1])
        self.assertEqual(self.T[1]["it"], "Stirare i lenzuoli.")   # the caller's list is not modified


class Bank(unittest.TestCase):
    def test_a_bare_string_intro_becomes_a_list(self):
        b = bank(intro="You are on the ward.")
        self.assertEqual(m.bank_valid_for([])(b), [])
        self.assertEqual(b["intro"], ["You are on the ward."])

    def test_needs_eight_or_nine_items(self):
        self.assertTrue(any("8-9 items" in i for i in m.bank_valid_for([])(bank(n=7))))
        self.assertEqual(m.bank_valid_for([])(bank(n=9)), [])

    def test_an_item_from_an_earlier_lesson_is_refused(self):
        prev = [{"it": "La lavanderia è aperta oggi.", "kind": "phrase"}]
        iss = m.bank_valid_for(prev)(bank())
        self.assertTrue(any("repeats an item" in i for i in iss), iss)


class AskJson(unittest.TestCase):
    def test_a_leaking_model_falls_through_to_the_next(self):
        seen = []

        async def fake_llm(md, prompt):
            seen.append(md["name"])
            return ("Let me think. " * 60 + '{"ok": 1}') if "gemma" in md["name"] else '{"ok": 2}'
        real_llm, real_off = m.pi.llm, m.pi.chiron_models.thinking_off
        m.pi.llm, m.pi.chiron_models.thinking_off = fake_llm, (lambda md, force=False: md)
        try:
            o = asyncio.run(m.ask_json("p", "t", ["gemma4:31b", "deepseek-flash@latest"]))
        finally:
            m.pi.llm, m.pi.chiron_models.thinking_off = real_llm, real_off
        self.assertEqual(o, {"ok": 2})
        self.assertEqual(len(seen), 4)                              # gemma 3 tries, then the next model once
        self.assertTrue(all("max_tokens" in m.quiet_model("gemma4:31b")["params"] for _ in [0]))


class Wiring(unittest.TestCase):
    def test_only_the_plan_uses_the_shared_thinking_ladder(self):
        src = CHAIN.read_text()
        self.assertEqual(src.count("pi.json_with_repair("), 1)
        self.assertIn('pi.json_with_repair(prompt, "pimsleur-plan"', src)


if __name__ == "__main__":
    unittest.main()
