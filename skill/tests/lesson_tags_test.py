"""lesson_tags_test — Library tags on lessons (chiron.json "labels"). No rebuild, temp lessons only.
Run: python3 skill/tests/lesson_tags_test.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import lesson_tags as lt  # noqa: E402


class Tags(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name) / "chiron-x"
        self.d.mkdir()
        (self.d / "lesson.html").write_text("<html></html>")
        (self.d / "chiron.json").write_text(json.dumps({"title": "X", "domain": "medical-italian"}))

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *a):
        return lt.main([*a, "--no-rebuild"])

    def test_add_is_idempotent_and_keeps_other_fields(self):
        self.run_cli("add", "Ordine exam", str(self.d))
        self.run_cli("add", "Ordine exam", str(self.d))
        cj = json.loads((self.d / "chiron.json").read_text())
        self.assertEqual(cj["labels"], ["Ordine exam"])
        self.assertEqual(cj["domain"], "medical-italian")

    def test_several_tags_then_remove_one(self):
        self.run_cli("add", "Ordine exam", str(self.d))
        self.run_cli("add", "Codice", str(self.d))
        self.run_cli("rm", "Ordine exam", str(self.d))
        self.assertEqual(lt.labels_of(self.d), ["Codice"])
        self.run_cli("rm", "Codice", str(self.d))
        self.assertNotIn("labels", json.loads((self.d / "chiron.json").read_text()))

    def test_not_a_lesson_is_refused(self):
        with self.assertRaises(SystemExit):
            self.run_cli("add", "T", self.tmp.name)


if __name__ == "__main__":
    unittest.main()
