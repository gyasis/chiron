"""pimsleur_run_report_test — the chain's time + cost report (pure parts, no network).
Run: python3 skill/tests/pimsleur_run_report_test.py"""
import datetime as dt, importlib.util, json, os, tempfile, time, unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location("rr", os.path.join(
    os.path.dirname(__file__), "..", "chains", "2026-10-11_chiron-pimsleur-lesson-chain", "run_report.py"))
rr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rr)

PRICES = {"gemini-3.8-flash": {"input": 0.75, "output": 3.75, "valid_until": "2026-12-31"},
          "gemini-2.5-flash": {"input": 0.30, "audio_input": 1.00, "output": 2.50}}


def _h(hour):  # local-time ISO hour, like `modal billing report --tz local`
    return dt.datetime(2026, 10, 11, hour).astimezone().isoformat()


class Modal(unittest.TestCase):
    ROWS = [{"description": "chiron-bake", "interval_start": _h(6), "cost": "0.349"},
            {"description": "chiron-bake", "interval_start": _h(7), "cost": "0.3734"},
            {"description": "other-app", "interval_start": _h(7), "cost": "9.99"}]

    def test_only_this_app_and_overlapping_hours(self):
        start = dt.datetime(2026, 10, 11, 7, 16).astimezone().timestamp()
        end = dt.datetime(2026, 10, 11, 7, 58).astimezone().timestamp()
        m = rr.modal_cost(self.ROWS, start, end)
        self.assertEqual(m["usd"], 0.3734)
        self.assertEqual(len(m["hours"]), 1)

    def test_run_spanning_two_hours(self):
        start = dt.datetime(2026, 10, 11, 6, 50).astimezone().timestamp()
        end = dt.datetime(2026, 10, 11, 7, 10).astimezone().timestamp()
        self.assertAlmostEqual(rr.modal_cost(self.ROWS, start, end)["usd"], 0.7224, places=4)


class Gemini(unittest.TestCase):
    def test_measured_listen_call(self):
        u = {"modelVersion": "gemini-3.8-flash", "promptTokenCount": 26783, "candidatesTokenCount": 106,
             "promptTokensDetails": [{"modality": "AUDIO", "tokenCount": 21586}]}
        self.assertAlmostEqual(rr.gemini_cost(u, PRICES, dt.date(2026, 10, 11)), 0.02048, places=5)

    def test_audio_rate_and_thinking_at_output_rate(self):
        u = {"modelVersion": "gemini-2.5-flash", "promptTokenCount": 1000, "candidatesTokenCount": 100,
             "thoughtsTokenCount": 100, "promptTokensDetails": [{"modality": "AUDIO", "tokenCount": 1000}]}
        self.assertAlmostEqual(rr.gemini_cost(u, PRICES), (1000 * 1.00 + 200 * 2.50) / 1e6, places=7)

    def test_unknown_model_or_expired_price_is_none_not_zero(self):
        self.assertIsNone(rr.gemini_cost({"modelVersion": "gemini-9"}, PRICES))
        self.assertIsNone(rr.gemini_cost({}, PRICES))
        self.assertIsNone(rr.gemini_cost({"modelVersion": "gemini-3.8-flash"}, PRICES, dt.date(2027, 1, 2)))


class Report(unittest.TestCase):
    def _lesson(self, td, usage=True, gpu=True):
        d = Path(td) / "lesson-01"
        (d / "audio").mkdir(parents=True)
        if usage:
            (d / "audio" / "pimsleur.listen.usage.json").write_text(json.dumps(
                {"modelVersion": "gemini-3.8-flash", "promptTokenCount": 1000, "candidatesTokenCount": 10, "totalTokenCount": 1010}))
        if gpu:
            (d / "audio" / "pimsleur.timeline.json").write_text(json.dumps({"qc": {"modal": {"clips": 66, "gpu_s": 168.6}}}))
        return d

    def test_build_counts_only_files_written_in_the_run(self):
        with tempfile.TemporaryDirectory() as td:
            d = self._lesson(td)
            now = time.time()
            r = rr.build("t", [d], [], now - 60, now + 1, [], PRICES)
            self.assertEqual(len(r["gemini"]["calls"]), 1)
            self.assertEqual(r["modal_gpu"]["lesson-01"]["clips"], 66)
            later = rr.build("t", [d], [], now + 100, now + 200, [], PRICES)   # a later rerun that listened to nothing
            self.assertEqual(later["gemini"]["calls"], [])
            self.assertEqual(later["modal_gpu"], {})

    def test_season_log_render_and_write(self):
        with tempfile.TemporaryDirectory() as td:
            d = self._lesson(td)
            T = rr.Timer()
            with T("P4", "lesson-01"):
                time.sleep(1.05)
            r1 = rr.build("Test season", [d], T.spans, T.start - 5, time.time(), "modal CLI failed: X", PRICES)
            self.assertIsNone(r1["modal"]["usd"])                     # unavailable, not $0
            md = rr.render([r1])
            self.assertIn("unavailable | modal CLI failed", md)
            self.assertIn("Modal GPU time: 169 s across 66 clips", md)
            self.assertIn("at least $", md)                           # an unpriced Modal line makes the total a floor
            stem = Path(td) / "chiron-pimsleur-test"
            rr.write(stem, [r1])
            self.assertEqual(len(rr.load_runs(stem.with_suffix(".run-report.json"))), 1)

    def test_shared_modal_hours_count_once(self):
        h = {"hour": _h(7), "usd": 0.37}
        runs = [{"modal": {"usd": 0.37, "hours": [h]}, "gemini": {"usd": 0.08, "unpriced": 0}, "wall_s": 2400},
                {"modal": {"usd": 0.37, "hours": [h]}, "gemini": {"usd": 0.02, "unpriced": 0}, "wall_s": 60}]
        t = rr.season_totals(runs)
        self.assertEqual(t["modal_usd"], 0.37)
        self.assertAlmostEqual(t["usd"], 0.47, places=4)
        self.assertEqual(t["incomplete"], 0)

    def test_legacy_single_report_loads_as_one_run(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "x.run-report.json"
            p.write_text(json.dumps({"title": "old", "start": 1, "end": 2}))
            self.assertEqual(len(rr.load_runs(p)), 1)

    def test_unpriced_listen_is_flagged_not_zero(self):
        with tempfile.TemporaryDirectory() as td:
            d = self._lesson(td, usage=False, gpu=False)
            (d / "audio" / "pimsleur.listen.md").write_text("VERDICT: PASS")
            now = time.time()
            r = rr.build("t", [d], [], now - 60, now + 1, [], PRICES)
            self.assertEqual(r["gemini"]["unpriced"], 1)
            self.assertIsNone(r["gemini"]["usd"])
            md = rr.render([r])
            self.assertIn("at least $0.00", md)
            self.assertIn("approximate, from file times", md)


if __name__ == "__main__":
    unittest.main()
