"""harvest_listening_cards_test — extraction on a fixture lesson (pimsleur + sr-card + vocab + dialogue + script alignment).
Run: ~/miniconda3/bin/python tests/harvest_listening_cards_test.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import harvest_listening_cards as H  # noqa: E402

LESSON_HTML = """<html><body>
<div class="sr-deck">
 <div class="sr-card" data-card-type="phrase"><div class="front">il prestanome</div><div class="back"><div class="sr-back-head">
  <strong class="sr-back-gloss">front man / nominee</strong><span class="sr-back-tag">art. 67</span></div>
  <p class="sr-back-note">È vietato fungere da prestanome per chi esercita abusivamente.</p></div></div>
 <div class="sr-card" data-card-type="word"><div class="front">fatto</div><div class="back"><strong class="sr-back-gloss">done (past participle of fare)</strong></div></div>
 <div class="sr-card" data-card-type="word"><div class="front">Ho detto la verità.</div><div class="back"><strong class="sr-back-gloss">I told the truth.</strong></div></div>
</div>
<table class="v-table"><thead><tr><th>Italiano</th><th>English</th><th>Note</th></tr></thead><tbody>
 <tr><td class="it">ho scritto</td><td>I wrote</td><td class="ex">scrivere → scritto. Participio irregolare.</td></tr>
 <tr><td class="it">vedere</td><td></td><td class="ex"></td></tr></tbody></table>
<table class="v-table"><thead><tr><th>Infinito</th><th>Participio</th></tr></thead><tbody>
 <tr><td class="it">dire</td><td>detto</td></tr></tbody></table>
<div class="turn"><span class="speaker">L</span><div class="what"><span class="it">Allora, com'è andata la lezione di ieri?</span><span class="gloss">So, how did yesterday's lesson go?</span></div></div>
<div class="turn"><span class="speaker">G</span><div class="what"><span class="it">Sì.</span><span class="gloss">Yes.</span></div></div>
</body></html>"""

PIMSLEUR = {"title": "P", "items": [
    {"id": "a", "it": "Ho detto la verità.", "en": "I told the truth.", "kind": "phrase", "build": ["la verità", "detto la verità"]},
    {"id": "b", "it": "Cosa hai fatto ieri?", "en": "What did you do yesterday?", "kind": "question", "build": ["ieri"]},
    {"id": "c", "it": "Domani sarò in ospedale tutto il giorno.", "en": "Now imagine a colleague invites you to dinner.", "kind": "talk"}]}

SCRIPTS = {"summary": [
    {"lang": "en", "text": "Remember the rule for"}, {"lang": "it", "text": "essere"}, {"lang": "en", "text": "and avere."},
    {"lang": "it", "text": "Sono andato al mercato con mia madre."}, {"lang": "en", "text": "I went to the market with my mother."},
    {"lang": "it", "text": "ho visto un film"}, {"lang": "en", "text": "or"},
    {"lang": "it", "text": "Dove sei stato ieri sera, Gyasi?"}, {"lang": "en", "text": "Where were you last night?"}]}


class Harvest(unittest.TestCase):
    def setUp(self):
        self.gen = Path(tempfile.mkdtemp())
        d = self.gen / "situazioni" / "lez"
        d.mkdir(parents=True)
        (d / "lesson.html").write_text(LESSON_HTML)
        (d / "pimsleur.json").write_text(json.dumps(PIMSLEUR))
        (d / "audio-scripts.json").write_text(json.dumps(SCRIPTS))
        (d / "content.json").write_text(json.dumps({"srCards": [{"front": "io vado", "back": "I go"}]}))
        (d / "chiron.json").write_text(json.dumps({"title": "Chiron · Lezione &amp; verbi", "domain": "language-it", "labels": ["Verb foundation"]}))
        self.d = d
        for k, v in (("GEN", self.gen), ("LIB", self.gen / "chiron-library")):
            p = unittest.mock.patch.object(H, k, v); p.start(); self.addCleanup(p.stop)
        (self.gen / "chiron-library").mkdir()
        self.out = H.Lesson("situazioni/lez", d).harvest()
        self.by = {c["it"]: c for c in self.out["cards"]}

    def test_sources_and_pairs(self):
        self.assertEqual(self.by["Ho detto la verità."]["source"], "pimsleur")      # pimsleur wins the duplicate flashcard
        self.assertEqual(self.by["il prestanome"]["en"], "front man / nominee")
        self.assertEqual(self.by["il prestanome"]["example_it"], "È vietato fungere da prestanome per chi esercita abusivamente.")
        self.assertEqual(self.by["ho scritto"]["source"], "vocab")
        self.assertEqual(self.by["io vado"]["source"], "flashcard")                 # content.json srCards
        self.assertEqual(self.by["Allora, com'è andata la lezione di ieri?"]["source"], "script")

    def test_never_invents_english_and_skips_non_translations(self):
        self.assertNotIn("vedere", self.by)                      # no English cell
        self.assertNotIn("dire", self.by)                        # conjugation table is not a translation table
        self.assertNotIn("Sì.", self.by)                         # dialogue lines need >= 3 words
        self.assertFalse(any(c["it"].startswith("Domani sarò") for c in self.out["cards"]))   # `talk` en is an instruction
        # counted, not hidden: build chunks (a:2, b:1) + the talk item (1) + the English-less vocab row (1)
        self.assertEqual(self.out["skipped"]["no_en"], 2 + 1 + 1 + 1)

    def test_script_alignment_is_strict(self):
        self.assertEqual(self.by["Sono andato al mercato con mia madre."]["en"], "I went to the market with my mother.")
        self.assertEqual(self.by["Dove sei stato ieri sera, Gyasi?"]["source"], "script")
        self.assertNotIn("ho visto un film", self.by)            # fragment followed by "or": narration, not a translation
        self.assertNotIn("essere", self.by)

    def test_lemma_and_kind(self):
        self.assertEqual(self.by["fatto"]["lemma"], "fare")
        self.assertEqual(self.by["ho scritto"]["lemma"], "scrivere")
        self.assertEqual((self.by["fatto"]["kind"], self.by["ho scritto"]["kind"], self.by["Cosa hai fatto ieri?"]["kind"]),
                         ("word", "phrase", "sentence"))

    def test_card_shape_and_stable_ids(self):
        c = self.by["Ho detto la verità."]
        self.assertEqual(c["id"], H.card_id("ho detto la verita"))               # fold-stable
        self.assertEqual((c["lesson"], c["lesson_title"], c["tags"]), ("situazioni/lez", "Lezione & verbi", ["Verb foundation", "language-it"]))
        self.assertEqual(len([x for x in self.out["cards"] if x["id"] == c["id"]]), 1)   # deduped within the lesson

    def test_run_writes_files_and_is_idempotent(self):
        r1 = H.run(["situazioni/lez"], dry=False)
        self.assertTrue(r1[0]["rewritten"])
        idx = json.loads((self.gen / "chiron-library" / H.INDEX_F).read_text())
        self.assertEqual(idx["lessons"]["situazioni/lez"]["count"], len(idx["cards"]))
        self.assertTrue((self.d / H.CARDS_F).is_file())
        m = (self.d / H.CARDS_F).stat().st_mtime_ns
        r2 = H.run(["situazioni/lez"], dry=False)
        self.assertFalse(r2[0]["rewritten"])
        self.assertEqual((self.d / H.CARDS_F).stat().st_mtime_ns, m)             # untouched: content hash unchanged
        self.assertEqual(H.run(["nope"], dry=False)[0]["error"], "not found")

    def test_dry_run_writes_nothing_and_focus(self):
        H.run(["situazioni/lez"], dry=True)
        self.assertFalse((self.d / H.CARDS_F).exists())
        self.assertEqual(H.focus_ids("verb FOUNDATION"), ["situazioni/lez"])
        self.assertEqual(H.focus_ids("Ordine exam"), [])


import unittest.mock  # noqa: E402  (used by setUp)

if __name__ == "__main__":
    unittest.main(verbosity=2)
