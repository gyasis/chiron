"""running_test — the unified "what is running" list (server/running.py). Run: ~/miniconda3/bin/python tests/running_test.py"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import running  # noqa: E402

NOW = 1_800_000_000.0


class Collect(unittest.TestCase):
    def test_every_source_is_listed_oldest_first(self):
        jobs = [{"id": "p1", "slug": "chiron-pimsleur-coach-phrases-x", "subject": "Coach phrases", "status": "running",
                 "started": "2026-11-08T12:26:48+00:00", "phase": "planning"},
                {"id": "l1", "slug": "chiron-ward-x", "subject": "Ward", "status": "queued", "created": NOW - 10},
                {"id": "old", "slug": "chiron-old", "subject": "Old", "status": "ready", "finished": NOW - 3600}]
        runs = [{"id": "r1", "user": "how do I say hello", "status": "running", "age_s": 12},
                {"id": "r2", "user": "done one", "status": "done", "age_s": 99}]
        live = [{"id": "s1", "created": NOW - 30, "lines": [{"state": "ready"}, {"state": "making"}, {"state": "queued"}]},
                {"id": "s2", "created": NOW - 30, "lines": [{"state": "ready"}]}]
        dict_ = [{"slug": "d1", "status": "running", "started": "2026-11-08T12:00:00", "from": "voice note 3"},
                 {"slug": "d2", "status": "done"}]
        d = running.collect(jobs, runs, live, dict_, NOW)
        self.assertEqual(d["count"], 5)
        kinds = {i["id"]: i["kind"] for i in d["items"]}
        self.assertEqual(kinds, {"p1": "pimsleur", "l1": "lesson", "r1": "phrase", "s1": "drill", "d1": "dictation"})
        by = {i["id"]: i for i in d["items"]}
        self.assertEqual(by["r1"]["elapsed_s"], 12)
        self.assertEqual(by["s1"]["detail"], "1 of 3 lines ready")
        self.assertEqual(by["p1"]["detail"], "planning")
        starts = [i["started"] for i in d["items"]]
        self.assertEqual(starts, sorted(starts))
        self.assertEqual(d["recent"], [])                       # finished an hour ago: not recent

    def test_a_job_that_just_finished_is_in_recent(self):
        jobs = [{"id": "p1", "slug": "chiron-pimsleur-x", "subject": "Coach phrases", "status": "ready", "finished": NOW - 60},
                {"id": "e1", "slug": "chiron-y", "subject": "Y", "status": "error", "finished": NOW - 120}]
        d = running.collect(jobs, [], [], [], NOW)
        self.assertEqual(d["count"], 0)
        self.assertEqual([(r["id"], r["status"], r["kind"]) for r in d["recent"]], [("p1", "ready", "pimsleur"), ("e1", "error", "lesson")])

    def test_eta_is_shown_in_minutes(self):
        d = running.collect([{"id": "a", "slug": "s", "status": "running", "phase": "writing", "eta_seconds": 250, "created": NOW}], [], [], [], NOW)
        self.assertEqual(d["items"][0]["detail"], "writing · about 4 min left")


if __name__ == "__main__":
    unittest.main()
