"""lesson_themes_test — every lesson theme can be picked and switched back, the theme picker stays reachable,
and the acolyte lesson tutor opens, renders and CLOSES in every theme, at desktop and phone width.

Regression for the acolyte panel that could never close: shell/tutor-acolyte.css set `.acolyte-panel{display:flex}`
after acolyte's own `display:none`, so the panel sat open over the lesson — at 412px it covered the hamburger, and
with it the theme picker. Lessons carry COPIES of that css, so the server now serves the canonical shell/ copy for
streamed lessons; the fixture lesson here deliberately carries the OLD buggy copy to prove that repair.

Fixtures are built from the real sources (shell/language-lesson-skeleton.html, the theme switcher in
scripts/assemble-medicine.mjs, ask/vendor/acolyte.js) into a temp CHIRON_GEN, served by the real app on a free
port. The tutor service (:8912) is blocked, so nothing live is touched.
Run: ~/miniconda3/bin/python tests/lesson_themes_test.py"""
import os, re, shutil, socket, sys, tempfile, threading, time, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-themes-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():              # mirror everything but server/ (code is read from there; STATE goes to TMP)
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name != "state" and f.name != "__pycache__":
        os.symlink(f, TMP / "skill" / "server" / f.name)
os.environ["CHIRON_SKILL"] = str(TMP / "skill")
os.environ["CHIRON_GEN"] = str(TMP / "gen")
sys.path.insert(0, str(SKILL / "server"))

SHELL, VENDOR = SKILL / "shell", SKILL / "ask" / "vendor"
BUGGY_CSS = (SHELL / "tutor-acolyte.css").read_text().replace(
    ".acolyte-panel { flex-direction: column; }", ".acolyte-panel { display: flex; flex-direction: column; }")
TUTOR_BLOCK = ('<!-- chiron:tutor -->\n<link rel="stylesheet" href="tutor-acolyte.css">\n'
               '<script type="module" src="tutor-acolyte.js"></script>\n<!-- /chiron:tutor -->')


def _baked(slug, html):
    """A lesson dir as scripts/deploy-lesson-tutor.mjs leaves it — but with the pre-fix tutor-acolyte.css."""
    d = TMP / "gen" / slug
    d.mkdir(parents=True)
    shutil.copytree(SHELL / "themes", d / "themes")
    for f in VENDOR.iterdir():
        if f.suffix == ".js":
            shutil.copy(f, d / f.name)
    shutil.copy(SHELL / "tutor-acolyte.js", d / "tutor-acolyte.js")
    (d / "tutor-acolyte.css").write_text(BUGGY_CSS)
    (d / "lesson.html").write_text(html.replace("</body>", TUTOR_BLOCK + "\n</body>", 1), encoding="utf-8")


# language / Pimsleur / medical-italian shell: a .theme-bar of buttons
_baked("lang", (SHELL / "language-lesson-skeleton.html").read_text(encoding="utf-8"))
# medicine assembler: a <select class="theme-select">, script + markup lifted from the generator itself
_asm = (SKILL / "scripts" / "assemble-medicine.mjs").read_text(encoding="utf-8")
_script = re.search(r"const themeSwitcherScript = `(.*?)`;", _asm, re.S).group(1).replace("${themeId}", "clinical")
_switcher = re.search(r'(<div class="theme-switcher">.*?</div>)', _asm, re.S).group(1)
_baked("med", f"""<!DOCTYPE html><html lang="en" data-theme="clinical"><head><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="themes/_tokens.css">{''.join(f'<link rel="stylesheet" href="themes/{t}.css">' for t in
 ('clinical', 'midnight', 'warm-paper', 'linguistic', 'ocean'))}{_script}
<style>body{{margin:0;background:var(--chiron-bg);color:var(--chiron-fg);display:flex}} aside.side{{width:240px;padding:20px}}</style>
</head><body><aside class="side">{_switcher}</aside><main><h1>Pericardite</h1><p>Lorem.</p></main></body></html>""")

try:
    from playwright.sync_api import sync_playwright
    import uvicorn
    import app as A  # noqa: E402
    OK, WHY = True, ""
except Exception as e:  # pragma: no cover - environment without the server/browser deps
    OK, WHY = False, repr(e)

# Read from the page: which themes the picker offers, which one is applied, whether the picker is reachable (the
# element at its centre — or at the hamburger's, on a phone — is not the tutor), and the tutor panel's state.
STATE = r"""() => {
  const pk = document.querySelector('.theme-select') || document.querySelector('.theme-bar');
  const opts = pk ? (pk.options ? [...pk.options].map(o => o.value) : [...pk.querySelectorAll('[data-set-theme]')].map(b => b.dataset.setTheme)) : [];
  const at = el => { if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
    const x = r.x + r.width / 2, y = r.y + r.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
    return document.elementFromPoint(x, y); };
  const hb = [...document.querySelectorAll('.chiron-hamburger')].find(e => e.getBoundingClientRect().width);
  const target = at(pk) ? pk : hb;                               // on a phone the picker lives behind the hamburger
  const hit = at(target);
  const p = document.querySelector('.acolyte-panel'), cs = p && getComputedStyle(p);
  const lum = c => { const m = c.match(/[\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
  const contrast = cs ? (Math.max(lum(cs.color), lum(cs.backgroundColor)) + .05) / (Math.min(lum(cs.color), lum(cs.backgroundColor)) + .05) : 0;
  return { theme: document.documentElement.dataset.theme, opts, pickerInDom: !!pk,
    reachable: !!(target && hit && (target === hit || target.contains(hit))), coveredBy: hit && !(target && target.contains(hit)) ? hit.className : null,
    panel: !!p, panelOpen: !!p && p.classList.contains('open'), panelShown: !!p && cs.display !== 'none' && p.getBoundingClientRect().width > 0,
    panelContrast: Math.round(contrast * 10) / 10, fab: !!document.querySelector('.acolyte-fab') };
}"""
PICK = """t => { const b = document.querySelector('.theme-bar [data-set-theme="' + t + '"]'); if (b) { b.click(); return; }
  const s = document.querySelector('.theme-select'); s.value = t; s.dispatchEvent(new Event('change', { bubbles: true })); }"""


@unittest.skipUnless(OK, f"server/browser deps unavailable: {WHY}")
class Themes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
        cls.srv = uvicorn.Server(uvicorn.Config(A.app, host="127.0.0.1", port=port, log_level="warning"))
        threading.Thread(target=cls.srv.run, daemon=True).start()
        for _ in range(100):
            if cls.srv.started:
                break
            time.sleep(.05)
        cls.base = f"http://127.0.0.1:{port}"
        cls.pw = sync_playwright().start()
        cls.br = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.br.close(); cls.pw.stop(); cls.srv.should_exit = True

    def page(self, slug, width, query=""):
        ctx = self.br.new_context(viewport={"width": width, "height": 900})
        ctx.route(re.compile(r".*:8912/.*"), lambda r: r.abort())      # never reach the live tutor service
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"{self.base}/lessons/{slug}/lesson.html{query}")
        pg.wait_for_selector(".acolyte-fab", state="attached", timeout=10000) if not query else pg.wait_for_timeout(1500)
        return ctx, pg, errs

    def test_served_adapter_is_the_canonical_copy(self):
        import urllib.request
        css = urllib.request.urlopen(f"{self.base}/lessons/lang/tutor-acolyte.css").read().decode()
        self.assertEqual(css, (SHELL / "tutor-acolyte.css").read_text())
        self.assertNotRegex(css, r"\.acolyte-panel\s*\{[^}]*display")
        with self.assertRaises(Exception):                            # a lesson without the adapter does not grow one
            urllib.request.urlopen(f"{self.base}/lessons/nope/tutor-acolyte.css")
        self.assertEqual(urllib.request.urlopen(f"{self.base}/lessons/lang/acolyte.js").read(),   # other assets: still the mount
                         (VENDOR / "acolyte.js").read_bytes())

    def test_every_theme_round_trip(self):
        for slug in ("lang", "med"):
            for width in (1280, 412):
                with self.subTest(slug=slug, width=width):
                    ctx, pg, errs = self.page(slug, width)
                    first = pg.evaluate(STATE)
                    self.assertGreaterEqual(len(first["opts"]), 5, first)
                    self.assertFalse(first["panelShown"], f"tutor panel open before anyone asked: {first}")
                    for t in first["opts"] + [first["opts"][0]]:          # every theme, then back to the first
                        pg.evaluate(PICK, t); pg.wait_for_timeout(100)
                        st = pg.evaluate(STATE)
                        self.assertEqual(st["theme"], t)
                        self.assertEqual(st["opts"], first["opts"], "picker options changed")
                        self.assertTrue(st["reachable"], f"{t}: picker unreachable, covered by {st['coveredBy']}")
                        pg.click(".acolyte-fab")                          # the tutor opens and renders in this theme
                        pg.wait_for_selector(".acolyte-panel.open", timeout=3000)
                        st = pg.evaluate(STATE)
                        self.assertTrue(st["panelShown"], f"{t}: tutor did not open")
                        self.assertGreaterEqual(st["panelContrast"], 4.5, f"{t}: tutor text unreadable")
                        pg.click(".acolyte-panel .acolyte-iconbtn[title='Close']")
                        pg.wait_for_timeout(100)
                        st = pg.evaluate(STATE)
                        self.assertFalse(st["panelShown"], f"{t}: tutor did not close")
                        self.assertTrue(st["reachable"], f"{t}: picker unreachable after closing the tutor")
                    pg.reload(); pg.wait_for_timeout(500)
                    self.assertEqual(pg.evaluate(STATE)["theme"], first["opts"][0], "theme did not persist")
                    self.assertEqual(errs, [])
                    ctx.close()

    def test_phone_app_hides_the_lesson_tutor(self):
        ctx, pg, errs = self.page("lang", 412, "?inapp=1")
        st = pg.evaluate(STATE)
        self.assertFalse(st["panel"] or st["fab"], "?inapp=1: the app has its own tutor; the lesson's must stay out")
        self.assertTrue(st["reachable"], st)
        ctx.close()

    def test_hidden_sidebar_always_has_a_menu(self):
        """769-880 px: the lessons hide the theme bar and add no ☰ of their own (the Pixel Fold's inner screen,
        2026-10-18). shell/lesson-nav.js must add one; elsewhere exactly one way in must exist."""
        vis = """s => { const e = document.querySelector(s); if (!e) return false; const c = getComputedStyle(e);
                   if (c.display === 'none' || c.visibility === 'hidden') return false;
                   const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left < innerWidth; }"""
        for slug in ("lang", "med"):
            for w in (412, 830, 1200):
                with self.subTest(slug=slug, width=w):
                    ctx, pg, errs = self.page(slug, w, "?inapp=1")
                    ours, theirs = pg.evaluate(f"[({vis})('.cl-nav-btn'), ({vis})('.chiron-hamburger')]")
                    bar = pg.evaluate(f"({vis})('.theme-bar') || ({vis})('.theme-switcher')")
                    self.assertLessEqual(int(ours) + int(theirs), 1, f"{w}px: two ☰ buttons")
                    self.assertTrue(ours or theirs or bar, f"{w}px: no way to reach the theme picker")
                    if ours:
                        pg.click(".cl-nav-btn")
                        t = pg.evaluate("document.querySelector('.cl-nav-themes button:not([aria-pressed=true])').dataset.t")
                        pg.click(f'.cl-nav-themes button[data-t="{t}"]')
                        self.assertEqual(pg.evaluate("document.documentElement.dataset.theme"), t)
                    self.assertEqual(errs, [])
                    ctx.close()


if __name__ == "__main__":
    unittest.main()
