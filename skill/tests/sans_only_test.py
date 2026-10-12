"""sans_only_test — Chiron is SANS ONLY. Fails if any theme, shell file, builder, chain or the phone app declares a
serif (or serif-looking display) font, and pins the rewriter's behaviour.
Run: python3 skill/tests/sans_only_test.py"""
import io, os, sys, unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(__file__)
SKILL = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(SKILL, "scripts"))
import sans_only as so  # noqa: E402

SOURCES = ["shell", "scripts", "chains", "lib", "player", "library", "ask", "server", "chiron-tauri/mobile", "runtime/src"]


class NoSerifInSource(unittest.TestCase):
    def test_every_builder_theme_and_app_is_sans(self):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = so.main(["check", *[os.path.join(SKILL, p) for p in SOURCES if os.path.exists(os.path.join(SKILL, p))]])
        self.assertEqual(rc, 0, "serif font declared:\n" + out.getvalue())


class Rewriter(unittest.TestCase):
    def test_serif_stack_becomes_system_sans(self):
        self.assertIn("sans-serif", so.fix_text("--chiron-font-body: 'Lora', 'Georgia', serif;"))
        self.assertNotIn("Lora", so.fix_text("--chiron-font-body: 'Lora', 'Georgia', serif;"))

    def test_fallback_inside_var(self):
        self.assertEqual(so.fix_text("font-family:var(--chiron-font-body,Georgia,serif);"),
                         "font-family:var(--chiron-font-body,sans-serif);")

    def test_display_face_removed(self):
        self.assertNotIn("Bricolage", so.fix_text("--font-display: 'Bricolage Grotesque', Georgia, serif;"))

    def test_sans_and_mono_untouched(self):
        for t in ("font-family: system-ui, sans-serif;", "--chiron-font-mono: 'JetBrains Mono', monospace;"):
            self.assertEqual(so.fix_text(t), t)

    def test_google_url_and_js_logic(self):
        t = ('if (a && b) go(); <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital'
             '&family=DM+Sans:wght@400&display=swap">')
        out = so.fix_text(t)
        self.assertIn("a && b", out)                 # 2026-10-12: a global "&&"->"&" tidy-up broke 45 JS files
        self.assertNotIn("Serif", out)
        self.assertIn("css2?family=DM+Sans", out)

    def test_italian_words_are_not_fonts(self):
        t = "const allora = 'Lora'; // allora"
        self.assertEqual(so.fix_text(t), t)


if __name__ == "__main__":
    unittest.main()
