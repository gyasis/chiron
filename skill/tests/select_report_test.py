"""select_report_test — the lesson route injects shell/select-report.js (phone tutor highlights) next to
scene-report.js, exactly once, and never touches the live library: CHIRON_SKILL/CHIRON_GEN point at temp dirs.
Run: ~/miniconda3/bin/python tests/select_report_test.py"""
import os, sys, tempfile, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-selreport-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():              # mirror everything but server/ (code is read from there; STATE goes to TMP)
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name != "state" and f.name != "__pycache__":
        os.symlink(f, TMP / "skill" / "server" / f.name)
os.environ["CHIRON_SKILL"] = str(TMP / "skill")
os.environ["CHIRON_GEN"] = str(TMP / "gen")
sys.path.insert(0, str(SKILL / "server"))

(TMP / "gen" / "demo").mkdir(parents=True)
(TMP / "gen" / "demo" / "lesson.html").write_text("<html><body><p>Aorta</p></body></html>", encoding="utf-8")
(TMP / "gen" / "bare").mkdir(parents=True)
(TMP / "gen" / "bare" / "lesson.html").write_text("<p>no body tag</p>", encoding="utf-8")
(TMP / "gen" / "dup").mkdir(parents=True)
(TMP / "gen" / "dup" / "lesson.html").write_text(
    '<body><script src="/shell/select-report.js"></script></body>', encoding="utf-8")

try:
    from fastapi.testclient import TestClient
    import app as A  # noqa: E402
    OK = True
except Exception as e:  # pragma: no cover - environment without the server deps
    OK, WHY = False, repr(e)


@unittest.skipUnless(OK, "server deps unavailable")
class Inject(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(A.app)

    def test_injected_before_body_close(self):
        h = self.c.get("/lessons/demo/lesson.html").text
        self.assertIn('<script src="/shell/select-report.js?v=', h)
        self.assertLess(h.index("select-report.js"), h.index("</body>"))
        self.assertIn("scene-report.js", h)            # sibling still there

    def test_no_body_tag_appends(self):
        self.assertIn("select-report.js", self.c.get("/lessons/bare/lesson.html").text)

    def test_not_duplicated(self):
        self.assertEqual(self.c.get("/lessons/dup/lesson.html").text.count("select-report.js"), 1)

    def test_script_is_served(self):
        r = self.c.get("/shell/select-report.js")
        self.assertEqual(r.status_code, 200)
        self.assertIn("chiron-select", r.text)


class Script(unittest.TestCase):
    def test_posts_the_documented_message(self):
        js = (SKILL / "shell" / "select-report.js").read_text()
        for needle in ("type: 'chiron-select'", "selectionchange", "parent.postMessage"):
            self.assertIn(needle, js)


if __name__ == "__main__":
    unittest.main()
