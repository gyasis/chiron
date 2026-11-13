"""plain_lesson_test — a lesson with <meta name="chiron-chrome" content="none"> (Il Centro) is served byte-for-byte as
written: no tutor, language switch, web player, hand-off or lanes. Other lessons still get the injections, and the
Il Centro builder (il-centro/lesson_nav.inject) writes the meta exactly once.
Run: ~/miniconda3/bin/python tests/plain_lesson_test.py"""
import os, sys, tempfile, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-plain-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name != "state" and f.name != "__pycache__":
        os.symlink(f, TMP / "skill" / "server" / f.name)
os.environ["CHIRON_SKILL"] = str(TMP / "skill")
os.environ["CHIRON_GEN"] = str(TMP / "gen")
sys.path.insert(0, str(SKILL / "server"))
sys.path.insert(0, str(SKILL / "il-centro"))

PLAIN = ('<html><head>\n<meta name="chiron-chrome" content="none">\n</head><body><div class="wrap">\n'
         '<p>Ciao</p>\n</footer>\n</div></body></html>')
for slug, html in (("il-centro-day-9", PLAIN), ("normal", "<html><head></head><body><p>Aorta</p></body></html>")):
    (TMP / "gen" / slug).mkdir(parents=True)
    (TMP / "gen" / slug / "audio").mkdir()
    (TMP / "gen" / slug / "lesson.html").write_text(html, encoding="utf-8")

try:
    from fastapi.testclient import TestClient
    import app as A  # noqa: E402
    OK = True
except Exception as e:  # pragma: no cover
    OK, WHY = False, repr(e)

INJECTED = ("tutor.js", "lang-switch.js", "web-player.js", "handoff.js", "chrome-lanes.js", "lesson-nav.js")


@unittest.skipUnless(OK, "server deps unavailable")
class PlainServe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(A.app)

    def test_plain_lesson_served_as_written(self):
        self.assertEqual(self.c.get("/lessons/il-centro-day-9/lesson.html").text, PLAIN)

    def test_other_lessons_still_injected(self):
        h = self.c.get("/lessons/normal/lesson.html").text
        for js in INJECTED:
            self.assertIn(js, h)


class BuilderWritesMeta(unittest.TestCase):
    def test_inject_adds_meta_once(self):
        import lesson_nav
        d = TMP / "series" / "il-centro-day-2"
        d.mkdir(parents=True)
        p = d / "lesson.html"
        p.write_text('<html><head>\n<title>x</title></head><body><div class="wrap">\n<p>x</p>\n</footer>\n</div></body></html>')
        lesson_nav.inject(str(p), 2)
        lesson_nav.inject(str(p), 2)
        self.assertEqual(p.read_text().count(lesson_nav.PLAIN_META), 1)
        self.assertRegex(p.read_text(), A.PLAIN_LESSON_RE if OK else lesson_nav.PLAIN_META)


if __name__ == "__main__":
    unittest.main(verbosity=2)
