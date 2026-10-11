"""pimsleur_drill_test — validator + scheduler rules (no audio). Run: python3 -m unittest skill/tests/pimsleur_drill_test.py"""
import importlib.util, os, unittest

_spec = importlib.util.spec_from_file_location(
    "pimsleur_drill", os.path.join(os.path.dirname(__file__), "..", "scripts", "pimsleur_drill.py"))
pd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pd)

A = {"id": "consenso", "it": "consenso informato", "en": "informed consent", "build": ["informato", "consenso informato"]}
B = {"id": "rischi", "it": "Devo informarla sui rischi.", "en": "I must inform you about the risks", "build": ["sui rischi"]}
C = {"id": "capito", "it": "Ha capito?", "en": "Did you understand?", "kind": "question"}
D = {"id": "firmi", "it": "Firmi qui, per favore.", "en": "Sign here, please"}
T = {"id": "spiega", "it": "Il consenso informato è l'accordo del paziente.", "en": "Explain what informed consent is.",
     "kind": "talk", "secs": 25}


class Validate(unittest.TestCase):
    def test_good_bank(self):
        self.assertEqual(pd.validate({"items": [A, B, C, D, T]}), [])

    def test_build_piece_must_be_word_suffix(self):
        bad = {**A, "build": ["consenso"]}
        self.assertTrue(any("not a word-suffix" in e for e in pd.validate({"items": [bad]})))

    def test_build_pieces_must_grow(self):
        bad = {**A, "build": ["consenso informato", "informato"]}
        self.assertTrue(any("must grow" in e for e in pd.validate({"items": [bad]})))

    def test_missing_fields_duplicates_and_kind(self):
        errs = pd.validate({"items": [{"id": "x", "it": "ciao"}, {"id": "x", "it": "a", "en": "b", "kind": "song"}]})
        self.assertTrue(any("missing 'en'" in e for e in errs))
        self.assertTrue(any("duplicate id" in e for e in errs))
        self.assertTrue(any("kind must be" in e for e in errs))

    def test_empty_bank(self):
        self.assertEqual(pd.validate({"items": []}), ["items: must be a non-empty list"])


class Schedule(unittest.TestCase):
    def setUp(self):
        self.steps = pd.schedule({"items": [A, B, C, D, T], "review": [{"id": "old", "it": "Buongiorno", "en": "Good morning"}]})

    def test_every_answer_pause_is_followed_by_its_answer(self):
        for i, st in enumerate(self.steps):
            if st[0] == "answer_pause":
                self.assertEqual(self.steps[i + 1], ("target", st[1]))

    def test_item_is_heard_before_it_is_asked(self):
        """Anticipation only works on something already taught (the 2026-10-10 'Firmi qui' bug)."""
        heard = set()
        for st in self.steps:
            if st[0] == "answer_pause" and st[1] not in heard and st[1] != "Buongiorno":
                self.fail(f"asked before taught: {st[1]}")
            if st[0] == "target":
                heard.add(st[1])

    def test_graduated_recall(self):
        asks = [st[1] for st in self.steps if st[0] == "answer_pause"]
        self.assertGreaterEqual(asks.count(A["it"]), 4)       # first ask + 3 recall slots + final review
        self.assertIn("Buongiorno", asks)                     # review item interleaved

    def test_back_chain_short_to_long(self):
        i = self.steps.index(("target", "informato"))
        self.assertEqual(self.steps[i + 2], ("target", "consenso informato"))

    def test_talk_prompt(self):
        i = next(k for k, st in enumerate(self.steps) if st == ("talk_pause", 25))
        self.assertEqual(self.steps[i - 1], ("cue", T["en"]))
        self.assertEqual(self.steps[i + 2], ("target", T["it"]))

    def test_no_bare_one_word_cue(self):
        for st in self.steps:
            if st[0] == "cue":
                self.assertGreater(len(st[1].split()), 1, st[1])

    def test_questions_use_question_cues(self):
        cues = [self.steps[i - 1][1] for i, st in enumerate(self.steps) if st == ("answer_pause", C["it"])]
        self.assertTrue(all("ask" in c.lower() for c in cues), cues)


class Qc(unittest.TestCase):
    def test_whisper_digits_are_spelled_back(self):
        """Whisper writes 'Alle 9.' for 'alle nove' -- that is not a bad clip."""
        self.assertEqual(pd._norm(pd._spell_numbers("Alle 9.", "it")), pd._norm("alle nove"))
        self.assertEqual(pd._spell_numbers("10 minuti fa", "it"), "dieci minuti fa")
        self.assertEqual(pd._spell_numbers("at 45", "en"), "at 45")


class Pause(unittest.TestCase):
    def test_answer_pause_rule(self):
        self.assertEqual(pd.answer_pause(0.5), 3.5)
        self.assertAlmostEqual(pd.answer_pause(3.0), 7.0)


if __name__ == "__main__":
    unittest.main()
