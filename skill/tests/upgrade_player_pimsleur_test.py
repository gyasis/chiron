"""upgrade_player_pimsleur_test — every known player shape gets the drill kind, once. Run: python3 -I skill/tests/upgrade_player_pimsleur_test.py"""
import importlib.util, os, unittest

_spec = importlib.util.spec_from_file_location(
    "upg", os.path.join(os.path.dirname(__file__), "..", "scripts", "upgrade_player_pimsleur.py"))
upg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(upg)

DESKTOP = """
  var PANEL_KIND = { summary: 0, shortened: 1, section: 2 };
  function panelLabel(c) {
    if (c.artifact === 'summary') return 'Summary';
  }
  function buildPanel(clips) {
    function group(title, list) {
      if (!list.length) return;
    }
    group('Full lesson', clips.filter(function (c) { return c.artifact === 'summary'; }));
  }
"""
MOBILE = """
  function buildOrderedClips(rawClips) {
    var whole = rawClips.filter(function (c) { return c.artifact === 'summary' || c.artifact === 'shortened'; });
    var sects = rawClips.filter(function (c) { return c.artifact === 'section'; });
    return whole.concat(sects);
  }
  function labelClips(clips) {
    clips.forEach(function (c) {
      if (c.artifact === 'summary')   { c._label = 'Summary'; return; }
    });
  }
"""
COMPACT = ("function labelClips(clips){ clips.forEach(function(c){ if(c.artifact==='summary'){c._label='Riepilogo';return;} });}\n"
           "function buildOrderedClips(raw){ return raw.filter(function(c){return c.artifact==='summary'||c.artifact==='shortened';})"
           ".concat(raw.filter(function(c){return c.artifact==='section';})); }\n"
           "function buildOrderedClips(r){return r.filter(function(c){return c.artifact==='summary'||c.artifact==='shortened';})"
           ".concat(r.filter(function(c){return c.artifact==='section';}));}\n"
           "function labelClips(clips){clips.forEach(function(c){if(c.artifact==='summary'){c._label='Summary';return;}});}\n")


class Upgrade(unittest.TestCase):
    def test_desktop(self):
        js, n = upg.upgrade_js(DESKTOP)
        self.assertEqual(n, 1)
        self.assertIn("pimsleur: -1", js)
        self.assertLess(js.index("group('🎧 Pimsleur drill'"), js.index("group('Full lesson'"))
        self.assertEqual(upg.upgrade_js(js)[1], 0)          # idempotent

    def test_mobile_readable(self):
        js, n = upg.upgrade_js(MOBILE)
        self.assertEqual(n, 1)
        self.assertIn("return drill.concat(whole, sects);", js)
        self.assertIn("c._label = c.label || 'Pimsleur drill'", js)
        self.assertEqual(upg.upgrade_js(js)[1], 0)

    def test_compact_two_copies_in_one_block(self):
        js, n = upg.upgrade_js(COMPACT)
        self.assertEqual(n, 1)
        self.assertEqual(js.count("return c.artifact==='pimsleur'||c.artifact==='summary'"), 2)
        self.assertEqual(js.count("if(c.artifact==='pimsleur'){c._label"), 2)
        self.assertEqual(upg.upgrade_js(js)[1], 0)

    def test_unknown_shape_is_loud(self):
        with self.assertRaises(upg.Unknown):
            upg.upgrade_js("function buildOrderedClips(x){ return x.slice(); }")


class Readalong(unittest.TestCase):
    def test_inlined_once_replaced_when_stale_and_timeline_js_written(self):
        import json, tempfile
        with tempfile.TemporaryDirectory() as td:
            os.makedirs(f"{td}/audio")
            json.dump({"durationS": 9, "timeline": [{"t": 0, "who": "cue", "text": "Hi there."}]},
                      open(f"{td}/audio/pimsleur.timeline.json", "w"))
            page = f"{td}/lesson.html"
            open(page, "w").write("<html><body><p>x</p></body></html>")
            self.assertEqual(upg.upgrade(page), 1)
            self.assertTrue(os.path.exists(f"{td}/audio/pimsleur.timeline.js"))
            self.assertEqual(upg.upgrade(page), 0)                                   # idempotent
            h = open(page).read()
            open(page, "w").write(h.replace("cra-k-", "cra-old-"))                     # simulate an older copy
            self.assertEqual(upg.upgrade(page), 1)
            self.assertEqual(open(page).read().count("Chiron Pimsleur read-along"), 1)


if __name__ == "__main__":
    unittest.main()
