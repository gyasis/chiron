"""slug_rule_test — one slug rule for every lesson. Accents keep their letter, long names are cut at a word, the
'italian' prefix is not doubled, an existing lesson named under the older rule keeps its folder, a bare domain
word is refused as a subject, and every dispatched chain writes to the server's CH_SLUG. Temp CHIRON_SKILL and
CHIRON_GEN, generation workers paused, queue replaced by a recorder: nothing runs, no model is called.
Run: ~/miniconda3/bin/python tests/slug_rule_test.py"""
import os, sys, tempfile, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-slug-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name not in ("state", "__pycache__"):
        os.symlink(f, TMP / "skill" / "server" / f.name)
os.environ.update(CHIRON_SKILL=str(TMP / "skill"), CHIRON_GEN=str(TMP / "gen"), CHIRON_HUB_PLAIN="http://127.0.0.1:9")
sys.path.insert(0, str(SKILL / "server"))
GEN = TMP / "gen"
(GEN / "chiron-library").mkdir(parents=True)
from fastapi.testclient import TestClient  # noqa: E402
import app as A  # noqa: E402
D = A.dispatch


class Recorder:
    def __init__(self):
        self.items = []

    def put(self, job):
        self.items.append(job["id"])

    def qsize(self):
        return len(self.items)


class T(unittest.TestCase):
    c = TestClient(A.app)

    def setUp(self):
        A._GEN_PAUSED = True
        A.JOBS.clear()
        self.q = A._GEN_Q = Recorder()
        A._run_job = lambda j: self.q.items.append(j["id"])

    def test_accents_keep_their_letter(self):
        self.assertEqual(D.slug_base("Perché è così?"), "perche-e-cosi")
        self.assertEqual(D.resolve("medicine", "systematic", "Sindrome di Guillain-Barré")["slug"],
                         "chiron-sindrome-di-guillain-barre-systematic")

    def test_italian_name_cut_at_a_word_and_prefix_not_doubled(self):
        s = D.resolve("language-it", "lesson", "Italian from the hallway: residents organising an evening out")["slug"]
        self.assertTrue(s.startswith("chiron-italian-from-the-hallway-"), s)
        self.assertLessEqual(len(s) - len("chiron-italian-"), 48)
        self.assertFalse(s.endswith("-"))
        self.assertTrue("residents-organising-an-evening-out".startswith(s.split("hallway-")[1]), s)

    def test_existing_lesson_under_old_rule_keeps_its_folder(self):
        subj = "Perché il congiuntivo"
        old = D._legacy_slug("language-it", "lesson", subj)
        self.assertNotEqual(old, D._slug("language-it", "lesson", subj))
        self.assertEqual(D.resolve("language-it", "lesson", subj)["slug"], D._slug("language-it", "lesson", subj))
        (GEN / old).mkdir()
        self.assertEqual(D.resolve("language-it", "lesson", subj)["slug"], old)

    def test_generic_subject_refused_before_any_run(self):
        for subj in ("Italian", "italiano", " Lesson ", "medicina"):
            r = self.c.post("/generate", json={"domain": "language-it", "subject": subj})
            self.assertEqual(r.status_code, 400, subj)
            self.assertIn("too general", r.text)
        self.assertEqual(self.q.items, [])

    def test_specific_subject_still_queues(self):
        r = self.c.post("/generate", json={"domain": "language-it", "subject": "Leggere la chat di classe"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["slug"], "chiron-italian-leggere-la-chat-di-classe")

    def test_every_dispatched_chain_honours_ch_slug(self):
        passage = D.CHAIN[("medical-italian", "passage")]           # its slug comes from the SSM question it picks
        for key, name in D.CHAIN.items():
            if name == passage:
                continue
            src = (D.CHAINS / name / "run.py").read_text()
            self.assertIn('os.environ.get("CH_SLUG"', src, f"{key} ignores CH_SLUG")


if __name__ == "__main__":
    unittest.main()
