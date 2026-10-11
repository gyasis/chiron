"""chiron_models_thinking_test — the per-lane thinking-off ladder (probe faked, no network).
Run: python3 skill/tests/chiron_models_thinking_test.py"""
import importlib.util, os, tempfile, types, unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "cm", os.path.join(os.path.dirname(__file__), "..", "chains", "chiron_models.py"))
cm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cm)

OLL = {"name": "openai/deepseek-v4.1-flash", "params": {"api_base": "https://ollama.com/v1", "api_key": "k"}}
GEM = {"name": "gemini/gemini-flash-latest", "params": {"api_key": "k"}}
OAI = {"name": "openai/gpt-5-mini", "params": {"api_key": "k"}}


def _resp(content="yes", rc="", psf=None, rt=None):
    msg = types.SimpleNamespace(content=content, reasoning_content=rc, provider_specific_fields=psf or {})
    usage = types.SimpleNamespace(completion_tokens_details=types.SimpleNamespace(reasoning_tokens=rt))
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)], usage=usage)


class Lane(unittest.TestCase):
    def test_lanes(self):
        self.assertEqual(cm.think_lane(OLL), "openai-compatible")
        self.assertEqual(cm.think_lane({"name": "openai/gemma4:12b", "params": {"api_base": "http://h:8799/llm/ollama/v1"}}),
                         "openai-compatible")
        self.assertEqual(cm.think_lane(GEM), "gemini")
        self.assertEqual(cm.think_lane(OAI), "openai")
        self.assertIsNone(cm.think_lane({"name": "claude", "_claude": True}))


class ReasoningSize(unittest.TestCase):
    def test_reads_all_three_places(self):
        self.assertEqual(cm.reasoning_size(_resp(rc="x" * 5)), 5)                  # Ollama via litellm
        self.assertEqual(cm.reasoning_size(_resp(psf={"reasoning": "x" * 7})), 7)  # provider field
        self.assertEqual(cm.reasoning_size(_resp(rt=262)), 262)                    # Gemini / OpenAI tokens
        self.assertEqual(cm.reasoning_size(_resp()), 0)


class Ladder(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        cm.PROBE_CACHE = Path(self.td.name) / "probe.json"
        self.calls = []

    def tearDown(self):
        self.td.cleanup()

    def fake(self, verdicts):
        def probe(md, method):
            self.calls.append(method)
            return verdicts[len(self.calls) - 1]
        cm._probe_think_off = probe

    def test_first_rung_that_reaches_zero_wins_and_is_cached(self):
        self.fake([("rejected", 0), ("ok", 0)])
        out = cm.thinking_off(OLL)
        self.assertEqual(out["params"]["extra_body"], {"reasoning_effort": "none"})
        self.assertEqual(out["params"]["api_base"], "https://ollama.com/v1")      # original params kept
        self.assertNotIn("extra_body", OLL["params"])                             # input not mutated
        n = len(self.calls)
        cm.thinking_off(OLL)                                                     # cache hit: no new probes
        self.assertEqual(len(self.calls), n)

    def test_least_reasoning_when_nothing_reaches_zero(self):
        self.fake([("still-thinking", 300), ("still-thinking", 40)])
        self.assertEqual(cm.thinking_off(OAI)["params"]["reasoning_effort"], "low")

    def test_nothing_works_leaves_md_unchanged(self):
        self.fake([("rejected", 0)] * 3)
        self.assertEqual(cm.thinking_off(GEM), GEM)

    def test_transient_is_not_cached(self):
        self.fake([("transient", 0)] * 3 + [("ok", 0)])
        out = cm.thinking_off(OLL)
        self.assertEqual(out["params"]["reasoning_effort"], "none")              # first rung, uncached
        cm.thinking_off(OLL)
        self.assertEqual(len(self.calls), 4)                                     # probed again next time

    def test_claude_untouched(self):
        md = {"name": "claude", "_claude": True}
        self.assertIs(cm.thinking_off(md), md)


if __name__ == "__main__":
    unittest.main()
