"""pimsleur_to_anki_test — note building / tagging / dedupe logic (no network). Run: python3 -I skill/tests/pimsleur_to_anki_test.py"""
import importlib.util, os, unittest

_spec = importlib.util.spec_from_file_location(
    "p2a", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "pimsleur_to_anki.py"))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

BANK = {"album": "Alb", "items": [
    {"id": "a", "it": "Ciao.", "en": "Hi"}, {"id": "q", "it": "Ha capito?", "en": "Understood?", "kind": "question"},
    {"id": "t", "it": "Risposta", "en": "Explain", "kind": "talk"}],
    "review": [{"id": "r", "it": "Firmi qui.", "en": "Sign here"}]}


class T(unittest.TestCase):
    def setUp(self):
        self.plans = m.build_notes(BANK, "/x/lesson-1")

    def test_talk_skipped_review_kept(self):
        self.assertEqual([p["id"] for p in self.plans], ["a", "q", "r"])
        self.assertTrue(self.plans[2]["review"])

    def test_deck_and_tags(self):
        p = self.plans[0]
        self.assertEqual(p["deck"], "Chiron::Pimsleur::Alb")
        self.assertEqual(p["tags"], ["chiron", "pimsleur", "chiron_item::lesson-1::a"])
        self.assertEqual(m.build_notes(BANK, "/x/l", "D")[0]["deck"], "D")

    def test_key_matches_drill(self):
        self.assertEqual(m.clip_key("lucrezia_italian", "Ciao."), m.clip_key("lucrezia_italian", "Ciao."))
        self.assertEqual(len(m.clip_key("v", "t")), 16)
        self.assertTrue(self.plans[0]["wav"].endswith(f"{m.clip_key('lucrezia_italian', 'Ciao.')}.lev-20.wav"))

    def test_back_field_sound_only_with_clip(self):
        p = dict(self.plans[0], has_clip=False)
        self.assertEqual(m.back_field(p), "Ciao.")
        self.assertIn("[sound:chiron_pimsleur_", m.back_field(dict(p, has_clip=True)))

    def test_review_dedupe(self):
        self.assertTrue(m.review_already_exported("r", ["chiron", "chiron_item::other::r"]))
        self.assertFalse(m.review_already_exported("r", ["chiron_item::other::rr"]))

    def test_verify(self):
        p = dict(self.plans[0], has_clip=True)
        ok = {"fields": {"Front": {"value": "Hi"}, "Back": {"value": m.back_field(p)}}, "tags": p["tags"]}
        self.assertEqual(m.verify_note(p, ok), [])
        bad = {"fields": {"Front": {"value": "Hi"}, "Back": {"value": "Ciao."}}, "tags": []}
        self.assertEqual(len(m.verify_note(p, bad)), 2)

class ExamNotes(unittest.TestCase):
    def test_exam_front_is_italian_question_plus_guidance(self):
        bank = {"album": "A", "items": [{"id": "f", "kind": "exam", "q": "Mi parli di sé.", "en": "Say who you are",
                                         "it": "Mi chiamo Marco Rossi."}, {"id": "t", "kind": "talk", "en": "x y", "it": "z"}]}
        plans = m.build_notes(bank, "/tmp/nolesson")
        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0]["front"], "Mi parli di sé.<br><i>Say who you are</i>")
        self.assertEqual(plans[0]["it"], "Mi chiamo Marco Rossi.")


unittest.main()
