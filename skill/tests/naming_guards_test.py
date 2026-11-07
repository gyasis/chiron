"""naming_guards_test — no entry point may start paid work twice on one lesson, or rebuild a lesson into a different
folder. Covers /retry, /regenerate, /bake, /bake-batch and the accept subject. CHIRON_SKILL/CHIRON_GEN point at temp
dirs, the generation workers are paused and the queues are replaced by recorders, so nothing runs and no model is called.
Run: ~/miniconda3/bin/python tests/naming_guards_test.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-guards-"))
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


class Recorder:
    """Stands in for the generation queue: records what would run, never runs it."""
    def __init__(self):
        self.items = []

    def put(self, job):
        self.items.append(job["id"])

    def get(self, timeout=None):
        import queue
        raise queue.Empty


def lesson(slug, cj=None):
    d = GEN / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "lesson.html").write_text("<html><head><title>x</title></head><body></body></html>")
    if cj is not None:
        (d / "chiron.json").write_text(json.dumps(cj))
    return slug


def job(slug, status, subject="atrial fibrillation", domain="medicine", depth="systematic", lane=None):
    jid = f"j{len(A.JOBS)}"
    A.JOBS[jid] = {"id": jid, "slug": slug, "status": status, "subject": subject, "domain": domain,
                   "depth": depth, "lane": lane, "stage": "all", "extra": {}}
    return jid


class T(unittest.TestCase):
    c = TestClient(A.app)

    def setUp(self):
        A._GEN_PAUSED = True
        A.JOBS.clear()
        self.q = A._GEN_Q = Recorder()
        A._run_job = lambda j: self.q.items.append(j["id"])      # safety net: a direct thread start records, never runs a chain
        self.baked = []
        A._enqueue_bake = lambda j, engine="mac": self.baked.append(j["slug"])

    def slug(self, subject="atrial fibrillation"):
        return A.dispatch.resolve("medicine", "systematic", subject)["slug"]

    # /retry
    def test_retry_double_tap_runs_once(self):
        jid = job(self.slug(), "error")
        self.assertEqual(self.c.post(f"/retry/{jid}").status_code, 200)
        self.assertEqual(self.c.post(f"/retry/{jid}").status_code, 409)
        self.assertEqual(len(self.q.items), 1)

    def test_retry_refused_while_lesson_running(self):
        s = self.slug()
        job(s, "running")
        jid = job(s, "error")
        self.assertEqual(self.c.post(f"/retry/{jid}").status_code, 409)
        self.assertEqual(self.q.items, [])

    # /regenerate
    def test_regenerate_jobless_lesson_without_subject_refused(self):
        s = lesson("chiron-aortic-aneurysm-systematic", {"domain": "medicine"})
        r = self.c.post(f"/regenerate/{s}", json={})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.q.items, [])
        self.assertFalse((GEN / "chiron-chiron-aortic-aneurysm-systematic-systematic").exists())

    def test_regenerate_subject_equal_to_slug_refused(self):
        s = lesson("chiron-aortic-aneurysm-systematic", {"domain": "medicine", "subject": "chiron-aortic-aneurysm-systematic"})
        self.assertEqual(self.c.post(f"/regenerate/{s}", json={}).status_code, 409)
        self.assertEqual(self.q.items, [])

    def test_regenerate_routing_to_other_slug_refused(self):
        s = lesson(self.slug())
        job(s, "ready", domain="language-it", depth=None)     # wrong domain → different slug
        self.assertEqual(self.c.post(f"/regenerate/{s}", json={}).status_code, 409)
        self.assertEqual(self.q.items, [])

    def test_regenerate_valid_runs_once_and_keeps_chapters(self):
        s = lesson(self.slug())
        job(s, "ready")
        r = self.c.post(f"/regenerate/{s}", json={"note": "more on anticoagulation"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["rewrite"])
        self.assertIn("KEPT", r.json()["note"])
        self.assertEqual(self.c.post(f"/regenerate/{s}", json={}).status_code, 409)
        self.assertEqual(len(self.q.items), 1)

    def test_regenerate_rewrite_flag_reaches_job(self):
        s = lesson(self.slug())
        jid = job(s, "ready")
        self.assertEqual(self.c.post(f"/regenerate/{s}", json={"rewrite": True}).status_code, 200)
        self.assertTrue(A.JOBS[jid]["rewrite"])

    # bakes
    def test_bake_refused_while_text_job_bakes_inline(self):
        s = lesson(self.slug())
        job(s, "running")
        r = self.c.post(f"/bake/{s}")
        self.assertTrue(r.json().get("duplicate"))
        self.assertEqual(self.baked, [])

    def test_bake_batch_skips_running_lesson(self):
        s = lesson(self.slug())
        job(s, "running")
        self.c.post("/bake-batch", json={"slugs": [s]})
        self.assertEqual(self.baked, [])

    def test_bake_ready_lesson_enqueues_once(self):
        s = lesson(self.slug())
        job(s, "ready")
        self.c.post(f"/bake/{s}")
        self.assertEqual(self.baked, [s])

    # accept
    def test_accept_restores_real_subject_never_slug(self):
        A._bundle_lesson = lambda slug: None
        A._rebuild_catalog = lambda: None
        s = lesson(self.slug(), {"domain": "medicine"})
        job(s, "ready")
        self.c.post(f"/accept/{s}")
        self.assertEqual(json.loads((GEN / s / "chiron.json").read_text()).get("subject"), "atrial fibrillation")
        s2 = lesson("chiron-orphan-systematic", {"domain": "medicine"})
        self.c.post(f"/accept/{s2}")
        self.assertNotIn("subject", json.loads((GEN / s2 / "chiron.json").read_text()))


if __name__ == "__main__":
    unittest.main()
