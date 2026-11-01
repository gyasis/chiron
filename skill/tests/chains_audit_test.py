"""chains_audit_test — lesson-chain guards: the persona is sent whole, the user grounding is not truncated,
and claude_p raises (with the cause) when `claude -p` fails.
Each run.py is loaded with importlib; the persona file and grounding file are synthetic temp files.
Run: ~/miniconda3/bin/python tests/chains_audit_test.py"""
import asyncio, importlib.util, io, os, subprocess, sys, tempfile, unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SKILL = Path(__file__).resolve().parent.parent
CHAINS = SKILL / "chains"
PURE = "2026-06-30_chiron-pure-italian-lesson-chain"
PASSAGE = "2026-06-30_chiron-medical-italian-passage-chain"
CLAUDE_P_CHAINS = [PURE, "2026-06-29_chiron-medicine-lesson-chain", "2026-07-05_chiron-medicine-primer-chain",
                   "2026-07-06_chiron-medicine-atlas-chain", "2026-07-06_chiron-medicine-systematic-chain"]
GROUNDING_CHAINS = [PURE, PASSAGE, "2026-06-29_chiron-medicine-lesson-chain", "2026-07-05_chiron-medicine-primer-chain",
                    "2026-07-06_chiron-medicine-systematic-chain", "2026-07-06_chiron-medicine-atlas-chain",
                    "2026-06-30_chiron-wards-lesson-chain"]
LAST_SECTION = "## Guardrails (hard)\nSYNTHETIC-GUARDRAIL-MARKER never break character."

_cache = {}


def load(chain):
    if chain not in _cache:
        env = {"OLLAMA_API_KEY": "test", "CH_SUBJECT": "test", "CH_TOPIC": "test"}
        with mock.patch.dict(os.environ, env):
            spec = importlib.util.spec_from_file_location("audit_" + chain.replace("-", "_"), CHAINS / chain / "run.py")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        _cache[chain] = mod
    return _cache[chain]


class Persona(unittest.TestCase):
    def test_persona_sent_whole(self):
        persona = "# Persona\n" + ("filler line of synthetic persona text.\n" * 150) + LAST_SECTION
        self.assertGreater(len(persona), 4000)
        with tempfile.TemporaryDirectory() as home:
            d = Path(home) / ".chiron/packs/lucrezia"
            d.mkdir(parents=True)
            (d / "persona.md").write_text(persona)
            for chain in (PURE, PASSAGE):
                mod = load(chain)
                with mock.patch.object(mod, "HOME", Path(home)):
                    got = mod.load_persona_block()
                self.assertEqual(got, persona, chain)
                self.assertIn("SYNTHETIC-GUARDRAIL-MARKER", got, chain)


class Grounding(unittest.TestCase):
    def test_grounding_not_truncated(self):
        body = "".join(f"line{i:05d} " for i in range(1250))[:10000]
        self.assertEqual(len(body), 10000)
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "grounding.md"
            f.write_text(body)
            for chain in GROUNDING_CHAINS:
                mod = load(chain)
                buf = io.StringIO()
                with mock.patch.dict(os.environ, {"CH_GROUNDING": str(f)}), redirect_stdout(buf):
                    ctx = mod._user_ctx()
                self.assertIn(body.strip(), ctx, chain)
                self.assertIn(f"{len(body.strip())} chars", buf.getvalue(), chain)


class SourcePack(unittest.TestCase):
    def test_author_chapter_prompt_carries_full_user_grounding(self):
        mod = load("2026-06-29_chiron-medicine-lesson-chain")
        body = "".join(f"line{i:05d} " for i in range(1250))[:10000]
        seen = {}

        async def fake_repair(prompt, *a, **k):
            seen["prompt"] = prompt

        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "grounding.md"
            f.write_text(body)
            with mock.patch.dict(os.environ, {"CH_GROUNDING": str(f)}), redirect_stdout(io.StringIO()):
                ctx = mod._user_ctx()
            avoid = {"covered_concepts": [], "existing_vignettes": []}
            with mock.patch.object(mod, "OUT", Path(d) / "out"), \
                    mock.patch.object(mod, "harrison", return_value="hits"), \
                    mock.patch.object(mod, "json_with_repair", fake_repair), redirect_stdout(io.StringIO()):
                (Path(d) / "out").mkdir()
                asyncio.run(mod.author_chapter({"chapterNumber": 1, "title": "t"}, ctx + "# pack", avoid, 0))
        self.assertIn(body.strip(), seen["prompt"])


class ClaudeP(unittest.TestCase):
    def run_with(self, chain, rc, out, err):
        mod = load(chain)
        cp = subprocess.CompletedProcess(["claude"], rc, stdout=out, stderr=err)
        with mock.patch.object(mod.subprocess, "run", return_value=cp), redirect_stdout(io.StringIO()):
            return mod.claude_p("hi")

    def test_nonzero_exit_raises_with_stderr(self):
        for chain in CLAUDE_P_CHAINS:
            with self.assertRaises(RuntimeError, msg=chain) as cm:
                self.run_with(chain, 1, "", "boom: auth failed")
            self.assertIn("returncode=1", str(cm.exception))
            self.assertIn("boom: auth failed", str(cm.exception))

    def test_usage_limit_message_reaches_the_skip_rung_check(self):
        with self.assertRaises(RuntimeError) as cm:
            self.run_with(PURE, 1, "Claude usage limit reached", "")
        self.assertIn("usage limit", str(cm.exception).lower())

    def test_empty_stdout_with_rc0_raises(self):
        with self.assertRaises(RuntimeError):
            self.run_with(PURE, 0, "  \n", "")

    def test_success_returns_stripped_stdout(self):
        self.assertEqual(self.run_with(PURE, 0, " ok \n", ""), "ok")


if __name__ == "__main__":
    unittest.main()
