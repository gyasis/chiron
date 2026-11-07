"""cancel_test — /cancel stops only the job it names. A stand-in chain (a script that records each launch and
sleeps; no model is called) runs through the real _run_job; /cancel must kill it, leave this process (the server)
alive, keep the job 'cancelled' and start no auto-retry. Temp CHIRON_SKILL/CHIRON_GEN, generation workers paused.
Run: ~/miniconda3/bin/python tests/cancel_test.py"""
import json, os, sys, tempfile, threading, time, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-cancel-"))
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

LAUNCHES = TMP / "launches.txt"
CHAIN = TMP / "fake_chain.py"
CHAIN.write_text(f"import os, time\nopen({str(LAUNCHES)!r}, 'a').write(str(os.getpid()) + '\\n')\ntime.sleep(60)\n")


class T(unittest.TestCase):
    c = TestClient(A.app)

    def setUp(self):
        A._GEN_PAUSED = True
        A.JOBS.clear()
        LAUNCHES.write_text("")
        A.dispatch.resolve = lambda *a, **k: {"slug": "chiron-cancel-probe-systematic", "runpy": str(CHAIN),
                                              "chain_name": "fake", "env": {}, "depth": "systematic"}
        A._next_primary = lambda: "none"

    def _start(self):
        job = {"id": "jc", "slug": "chiron-cancel-probe-systematic", "status": "queued", "subject": "cancel probe",
               "domain": "medicine", "depth": "systematic", "stage": "all", "extra": {}}
        A.JOBS["jc"] = job
        th = threading.Thread(target=A._run_job, args=(job,), daemon=True)
        th.start()
        for _ in range(100):
            if job.get("pid") and LAUNCHES.read_text().strip():
                break
            time.sleep(0.1)
        return job, th

    def test_cancel_kills_chain_not_server_and_does_not_retry(self):
        job, th = self._start()
        pid = int(LAUNCHES.read_text().split()[0])
        self.assertNotEqual(os.getpgid(pid), os.getpgid(0), "chain shares the server's process group")
        r = self.c.post("/cancel/jc").json()
        self.assertTrue(r["killed"])
        th.join(timeout=20)
        self.assertFalse(th.is_alive(), "_run_job kept running after cancel")
        time.sleep(1)
        self.assertEqual(len(LAUNCHES.read_text().split()), 1, "the cancelled chain was auto-retried")
        self.assertEqual(A.JOBS["jc"]["status"], "cancelled")
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_regenerate_after_cancel_clears_flag(self):
        job, th = self._start()
        self.c.post("/cancel/jc")
        th.join(timeout=20)
        (GEN / "chiron-cancel-probe-systematic").mkdir(exist_ok=True)
        A._GEN_Q = type("Q", (), {"put": lambda self, j: None})()
        r = self.c.post("/regenerate/chiron-cancel-probe-systematic", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("cancelled", A.JOBS["jc"])


if __name__ == "__main__":
    unittest.main()
