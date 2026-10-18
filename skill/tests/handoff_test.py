"""handoff_test — the lesson route injects shell/handoff.js exactly once, and the /api/progress relay validates keys and
reports a 502 (not a hang) when the hub is down. CHIRON_SKILL/CHIRON_GEN point at temp dirs; no live library is touched.
Run: ~/miniconda3/bin/python tests/handoff_test.py"""
import os, sys, tempfile, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-handoff-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name not in ("state", "__pycache__"):
        os.symlink(f, TMP / "skill" / "server" / f.name)
os.environ.update(CHIRON_SKILL=str(TMP / "skill"), CHIRON_GEN=str(TMP / "gen"), CHIRON_HUB_PLAIN="http://127.0.0.1:9")
sys.path.insert(0, str(SKILL / "server"))
(TMP / "gen" / "demo").mkdir(parents=True)
(TMP / "gen" / "demo" / "lesson.html").write_text("<html><body><p>x</p></body></html>", encoding="utf-8")
(TMP / "gen" / "dup").mkdir(parents=True)
(TMP / "gen" / "dup" / "lesson.html").write_text('<body><script src="/shell/handoff.js"></script></body>', encoding="utf-8")
from fastapi.testclient import TestClient  # noqa: E402
import app as A  # noqa: E402


class T(unittest.TestCase):
    c = TestClient(A.app)

    def test_injected_once(self):
        self.assertEqual(self.c.get("/lessons/demo/lesson.html").text.count("handoff.js"), 1)
        self.assertEqual(self.c.get("/lessons/dup/lesson.html").text.count("handoff.js"), 1)

    def test_relay_bad_key(self):
        self.assertEqual(self.c.get("/api/progress/bad key!").status_code, 400)

    def test_relay_hub_down_is_502(self):
        r = self.c.get("/api/progress/now-studying")
        self.assertEqual(r.status_code, 502)
        self.assertIn("hub unreachable", r.json()["detail"])


if __name__ == "__main__":
    unittest.main()
