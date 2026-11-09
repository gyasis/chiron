"""thinking_off_chains_test — the lesson chains call models with thinking off and never report a failed step as a result.
Covers: the catalog reader (`name` entries, API ids), the leaked-reasoning refusal, every lesson chain's defaults and
wiring (no glm default, thinking_off in llm(), refuse_leaked in extract_json), and the server's completeness checks
(sections counted, last count wins, missing extras, a lesson.html older than its job). No model is called.
Run: ~/miniconda3/bin/python tests/thinking_off_chains_test.py"""
import importlib.util, json, os, re, sys, tempfile, time, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
CHAINS = SKILL / "chains"
_spec = importlib.util.spec_from_file_location("cm", CHAINS / "chiron_models.py")
cm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cm)

LESSON_CHAINS = sorted(p for p in CHAINS.glob("2026-0[67]-*/run.py") if "fsi" not in p.parent.name)

TMP = Path(tempfile.mkdtemp(prefix="chiron-thinkoff-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name not in ("state", "__pycache__"):
        os.symlink(f, TMP / "skill" / "server" / f.name)
os.environ.update(CHIRON_SKILL=str(TMP / "skill"), CHIRON_GEN=str(TMP / "gen"), CHIRON_HUB_PLAIN="http://127.0.0.1:9")
sys.path.insert(0, str(SKILL / "server"))
(TMP / "gen" / "chiron-library").mkdir(parents=True)
import app as A  # noqa: E402


class Catalog(unittest.TestCase):
    def test_reads_name_entries_as_api_ids(self):
        f = TMP / "models.json"
        f.write_text(json.dumps({"models": [{"name": "glm-5.3:cloud"}, {"name": "gemma4:31b-cloud"},
                                            {"name": "deepseek-v4.1-flash:1017-cloud"}, {"name": "deepseek-v4.1-flash:cloud"}]}))
        old, cm.CATALOG = cm.CATALOG, f
        try:
            ids = cm.live_ids()
        finally:
            cm.CATALOG = old
        self.assertEqual(ids, ["glm-5.3", "gemma4:31b", "deepseek-v4.1-flash:1017", "deepseek-v4.1-flash"])
        self.assertEqual(cm.candidates("deepseek-flash", ids)[0], "deepseek-v4.1-flash")

    def test_empty_catalog_is_unreadable(self):
        f = TMP / "empty.json"
        f.write_text(json.dumps({"models": []}))
        old, cm.CATALOG = cm.CATALOG, f
        try:
            self.assertIsNone(cm.live_ids())
        finally:
            cm.CATALOG = old


class Leak(unittest.TestCase):
    def test_refuses_reasoning_before_json(self):
        with self.assertRaises(ValueError):
            cm.refuse_leaked("Let me think about the sections carefully.\n" + "x" * 400 + '\n{"a": 1}')

    def test_accepts_plain_and_fenced_json(self):
        for ok in ('{"a": 1}', '```json\n{"a": 1}\n```', 'Here it is:\n{"a": 1}'):
            cm.refuse_leaked(ok)


class ChainWiring(unittest.TestCase):
    def test_seven_lesson_chains_found(self):
        self.assertEqual(len(LESSON_CHAINS), 7, [p.parent.name for p in LESSON_CHAINS])

    def test_no_glm_default(self):
        for p in LESSON_CHAINS:
            self.assertNotRegex(p.read_text(), r'os\.environ\.get\("CH_[A-Z_]+",\s*"glm', p.parent.name)

    def test_llm_switches_thinking_off(self):
        for p in LESSON_CHAINS:
            m = re.search(r"async def llm\((\w+)[^\n]*\n\s+(.+)\n", p.read_text())
            self.assertIn("chiron_models.thinking_off(", m.group(2), p.parent.name)

    def test_extract_json_refuses_leaked_reasoning(self):
        for p in LESSON_CHAINS:
            body = p.read_text().split("def extract_json(", 1)[1].split("\ndef ", 1)[0]
            self.assertIn("chiron_models.refuse_leaked(", body, p.parent.name)

    def test_pure_italian_qc_never_passes_unjudged(self):
        src = (CHAINS / "2026-06-30_chiron-pure-italian-lesson-chain" / "run.py").read_text()
        self.assertIn("NOT JUDGED", src)
        self.assertNotIn("verdict is None or verdict.get(\"pass\")", src)


class Markup(unittest.TestCase):
    def test_em_attributes_are_stripped_before_the_check(self):
        os.environ.setdefault("CH_TOPIC", "test topic")
        os.environ.setdefault("CHIRON_LEDGER_DIR", str(TMP / "ledger"))
        sp = importlib.util.spec_from_file_location("pi_chain", CHAINS / "2026-06-30_chiron-pure-italian-lesson-chain" / "run.py")
        pi = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(pi)
        got = pi.plain_markup({"introHtml": 'Say <em style="color: #d32f2f;">ciao</em> and <STRONG class="k">grazie</STRONG>',
                               "vocab": [{"note": "<em>già</em>"}], "n": 3})
        self.assertEqual(got, {"introHtml": "Say <em>ciao</em> and <strong>grazie</STRONG>",
                               "vocab": [{"note": "<em>già</em>"}], "n": 3})


class Completeness(unittest.TestCase):
    def _lesson(self, name, log_text):
        out = TMP / "gen" / name
        out.mkdir(parents=True, exist_ok=True)
        (out / "lesson.html").write_text("x" * 6000)
        log = TMP / f"{name}.log"
        log.write_text(log_text)
        return out, log

    def test_missing_sections_fail(self):
        out, log = self._lesson("l1", "[phase 2] authored 6/8 sections: [1, 2]\n")
        self.assertEqual(A._lesson_complete(out, log), (False, "only 6/8 sections authored"))

    def test_last_count_wins(self):
        out, log = self._lesson("l2", "[phase 2] authored 5/8 sections\n...\n[phase 2] authored 8/8 sections\n")
        self.assertTrue(A._lesson_complete(out, log)[0])

    def test_missing_extras_fail(self):
        out, log = self._lesson("l3", "[phase 2] authored 8/8 sections\n")
        (out / "extras.NEEDS_REVIEW").write_text("x")
        self.assertFalse(A._lesson_complete(out, log)[0])

    def test_old_lesson_is_not_this_jobs_output(self):
        out, _ = self._lesson("l4", "")
        old = time.time() - 3600
        os.utime(out / "lesson.html", (old, old))
        self.assertFalse(A._wrote_lesson({"slug": "l4", "started": A._now()}))
        self.assertTrue(A._wrote_lesson({"slug": "l4", "started": "2020-01-01T00:00:00"}))


if __name__ == "__main__":
    unittest.main(verbosity=1)
