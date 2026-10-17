"""local_models_test — governor discovery, filtering, labels, think:false injection, fallback (no network).
Run: python3 skill/tests/local_models_test.py"""
import json, os, sys, time, unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "chains"))
import local_models as lm  # noqa: E402

TAGS = {"models": [{"name": n} for n in (
    "gemma4:12b", "gemma3:27b", "nomic-embed-text:latest", "glm-5.3:cloud", "gemma4:31b-cloud",
    "deepseek-ocr:latest", "hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL", "ornith-1.5-9b:latest", "broken:1b")]}
CAPS = {"gemma4:12b": ["completion", "vision", "audio", "tools", "thinking"],
        "gemma3:27b": ["completion", "vision"],
        "nomic-embed-text:latest": ["embedding"],
        "glm-5.3:cloud": ["completion", "thinking"],
        "gemma4:31b-cloud": ["completion", "thinking"],
        "deepseek-ocr:latest": ["completion", "vision"],
        "hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL": ["completion", "tools", "thinking"],
        "ornith-1.5-9b:latest": ["completion", "tools", "thinking"]}


def fake_http(path, body, timeout):
    if path == "/api/tags":
        return TAGS
    tag = body["model"]
    if tag not in CAPS:
        raise OSError("boom")
    return {"capabilities": CAPS[tag]}


class Base(unittest.TestCase):
    def setUp(self):
        lm._state.update(at=0.0, ttl=0.0, models=None, source="none", error=None)
        lm._caps.clear()


class Discovery(Base):
    def test_filters_and_ids(self):
        with mock.patch.object(lm, "_http", fake_http):
            ms = lm.models()
        ids = [m["id"] for m in ms]
        self.assertEqual(sorted(ids), sorted(["local:gemma4:12b", "local:gemma3:27b",
                                              "local:hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL", "local:ornith-1.5-9b:latest"]))
        self.assertNotIn("local:nomic-embed-text:latest", ids)      # embedding-only
        self.assertFalse([i for i in ids if "cloud" in i or "ocr" in i])  # cloud proxies + OCR
        self.assertNotIn("local:broken:1b", ids)                    # /api/show failed -> not guessed
        self.assertEqual(lm.info()["source"], "governor")

    def test_labels(self):
        self.assertEqual(lm.label_for("gemma4:12b"), "Gemma 4 12B · Mac (local)")
        self.assertEqual(lm.label_for("ornith-1.5-9b:latest"), "Ornith 1.5 9B · Mac (local)")
        self.assertEqual(lm.label_for("mistral-nemo:12b"), "Mistral Nemo 12B · Mac (local)")
        self.assertEqual(lm.label_for("hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL"), "Qwen 3.8 27B · UD-Q4_K_XL · Mac (local)")

    def test_cached_then_refreshed(self):
        calls = []
        def counting(path, body, timeout):
            calls.append(path)
            return fake_http(path, body, timeout)
        with mock.patch.object(lm, "_http", counting):
            lm.models(); n = len(calls); lm.models()
            self.assertEqual(len(calls), n)                          # cache hit: no new calls
            lm._state["at"] = time.time() - lm.CACHE_TTL - 1
            lm.models()
            self.assertGreater(len(calls), n)                        # expired: rediscovered

    def test_bounded(self):
        big = {"models": [{"name": f"m{i}:1b"} for i in range(500)]}
        shown = []
        def h(path, body, timeout):
            if path == "/api/tags":
                return big
            shown.append(body["model"])
            return {"capabilities": ["completion"]}
        with mock.patch.object(lm, "_http", h):
            lm.models()
        self.assertEqual(len(shown), lm.MAX_MODELS)


class Fallback(Base):
    def test_unreachable(self):
        with mock.patch.object(lm, "_http", side_effect=OSError("unreachable")):
            ms = lm.models()
            self.assertEqual([m["id"] for m in ms], ["local:qwen3:32b", "local:gemma3:27b"])
            info = lm.info()
        self.assertEqual(info["source"], "fallback")
        self.assertIn("unreachable", info["error"])

    def test_failure_cached_briefly(self):
        h = mock.Mock(side_effect=OSError("down"))
        with mock.patch.object(lm, "_http", h):
            lm.models(); lm.models()
        self.assertEqual(h.call_count, 1)                           # no connect-timeout on every request

    def test_empty_governor_falls_back(self):
        with mock.patch.object(lm, "_http", lambda p, b, t: {"models": []}):
            self.assertEqual(lm.info()["source"], "fallback")


class ThinkingOff(Base):
    def test_only_when_capable(self):
        with mock.patch.object(lm, "_http", fake_http):
            self.assertTrue(lm.thinking_off("gemma4:12b"))
            self.assertFalse(lm.thinking_off("gemma3:27b"))         # no thinking cap -> flag would be rejected
            self.assertFalse(lm.thinking_off("never-heard-of:1b"))  # unknown -> not guessed


class ChatBody(Base):
    """think:false reaches the wire for thinking models only (tutor_chain._call + mock_oral._ollama)."""
    def _capture(self, reply):
        sent = {}
        class R:
            def read(self_): return json.dumps(reply).encode()
        def urlopen(req, timeout=0):
            sent["url"], sent["body"] = req.full_url, json.loads(req.data)
            return R()
        return sent, urlopen

    def test_tutor_call(self):
        import tutor_chain as tc
        for tag, expect in (("gemma4:12b", False), ("gemma3:27b", None)):
            sent, uo = self._capture({"message": {"content": "Ciao", "thinking": ""}})
            with mock.patch.object(lm, "_http", fake_http), mock.patch.object(tc.urllib.request, "urlopen", uo):
                self.assertEqual(tc._call("governor:" + tag, "sys", [], "hi"), "Ciao")
            self.assertEqual(sent["body"].get("think"), expect)
            self.assertTrue(sent["url"].endswith("/api/chat"))

    def test_cloud_unchanged(self):
        import tutor_chain as tc
        sent, uo = self._capture({"message": {"content": "ok"}})
        with mock.patch.object(tc.urllib.request, "urlopen", uo):
            tc._call("cloud:gemma4:31b", "s", [], "u")
        self.assertNotIn("think", sent["body"])

    def test_leak_logged_and_empty_is_error(self):
        import tutor_chain as tc
        sent, uo = self._capture({"message": {"content": "", "thinking": "hmm"}})
        with mock.patch.object(tc.urllib.request, "urlopen", uo):
            with self.assertRaises(RuntimeError) as cm:
                tc._ollama_chat("http://x/api/chat", "m:1b", {}, "", [], "u", think_off=True)
        self.assertIn("m:1b", str(cm.exception))

    def test_mock_oral_local(self):
        import mock_oral as mo
        sent, uo = self._capture({"message": {"content": "{}", "thinking": ""}, "model": "gemma4:12b"})
        with mock.patch.object(lm, "_http", fake_http), mock.patch.object(mo.urllib.request, "urlopen", uo):
            mo._ollama("gemma4:12b", "s", "u", "", local=True)
        self.assertIs(sent["body"]["think"], False)
        self.assertNotIn("ollama.com", sent["url"])


class Registry(Base):
    def test_models_and_legacy_ids(self):
        import tutor_chain as tc
        with mock.patch.object(lm, "_http", fake_http):
            tc.refresh_models()
            self.assertIn("gemma4", tc.MODELS)                      # curated cloud kept
            self.assertEqual(tc.MODELS["local:gemma4:12b"]["spec"], "governor:gemma4:12b")
            self.assertEqual(tc.MODELS["local:gemma4:12b"]["group"], "Mac (local)")
            self.assertEqual(tc.resolve_model("gemma_local")["spec"], "governor:gemma3:27b")
            self.assertEqual(tc.resolve_model("nope")["spec"], tc.MODELS[tc.DEFAULT_MODEL]["spec"])
        self.assertEqual(tc.DEFAULT_MODEL, "gemma4")

    def test_examiners(self):
        import mock_oral as mo
        with mock.patch.object(lm, "_http", fake_http):
            mo.refresh_examiners()
            self.assertIn("gemma4", mo.EXAMINERS)
            self.assertTrue(mo.EXAMINERS["local:ornith-1.5-9b:latest"]["local"])
            self.assertEqual(mo.default_examiner(), "gemma4")
            # A local default is accepted once discovery has run (it was rejected at import before).
            with mock.patch.object(mo, "_DEFAULT_WANTED", "local:ornith-1.5-9b:latest"):
                self.assertEqual(mo.default_examiner(), "local:ornith-1.5-9b:latest")
            with mock.patch.object(mo, "_DEFAULT_WANTED", "local:not-installed:1b"):
                self.assertEqual(mo.default_examiner(), "gemma4")


if __name__ == "__main__":
    unittest.main()
