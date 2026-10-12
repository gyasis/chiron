"""mock_oral_test — the mock oral's pure parts (no network: no TTS, ASR or model calls).
Run: python3 skill/tests/mock_oral_test.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import mock_oral as mo  # noqa: E402


class ParseJson(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(mo.parse_json('{"reply": "Bene."}')["reply"], "Bene.")

    def test_fenced_with_prose(self):   # gemma4 wraps its JSON in ```json fences
        self.assertTrue(mo.parse_json('Ecco:\n```json\n{"followup": true}\n```\n')["followup"])

    def test_no_object_raises(self):
        with self.assertRaises(ValueError):
            mo.parse_json("Mi dispiace, non posso.")


class Questions(unittest.TestCase):
    def test_only_exam_items_in_track_order(self):
        with tempfile.TemporaryDirectory() as d:
            for slug, items in (("chiron-pimsleur-x--02-b", [{"id": "b1", "kind": "exam", "q": "Q2?", "it": "A2.", "en": "g"}]),
                                ("chiron-pimsleur-x--01-a", [{"id": "a0", "kind": "phrase", "it": "ciao"},
                                                             {"id": "a1", "kind": "exam", "q": "Q1?", "it": "A1.", "en": "g"}])):
                os.makedirs(f"{d}/{slug}")
                json.dump({"title": "Pimsleur · " + slug[-1], "items": items}, open(f"{d}/{slug}/pimsleur.json", "w"))
            qs = mo.questions(Path(d))
        self.assertEqual([q["id"] for q in qs], ["a1", "b1"])
        self.assertEqual(qs[0]["lesson"], "a")
        self.assertEqual(qs[0]["it"], "A1.")


class Prompt(unittest.TestCase):
    def test_second_followup_is_forbidden(self):
        self.assertIn("NON farne un'altra", mo._examiner_prompt({"followup_asked": True}))
        self.assertNotIn("NON farne un'altra", mo._examiner_prompt({"followup_asked": False}))


class Report(unittest.TestCase):
    def test_averages_and_errors(self):
        s = {"started": "oggi", "examiner": "gemma4", "turns": [
            {"question": "Q1?", "answer": "il paziente devono", "model_answer": "M1",
             "feedback": {"understood": 5, "accuracy": 3, "reply": "Bene.",
                          "errors": [{"said": "devono", "better": "deve", "why": "agreement"}]}},
            {"question": "Q2?", "answer": "", "feedback": {"understood": 4, "accuracy": 4, "reply": "Grazie."}}]}
        md = mo.report_md(s)
        self.assertIn("understood 4.5/5", md)
        self.assertIn("accuracy 3.5/5", md)
        self.assertIn("~~devono~~ → **deve**", md)
        self.assertIn("_(nothing heard)_", md)


if __name__ == "__main__":
    unittest.main()
