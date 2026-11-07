"""dettato_test — the dictation page's pure parts (no network: no whisper or model calls).
Run: python3 skill/tests/dettato_test.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import dettato as dt  # noqa: E402
import build_dettato as bd  # noqa: E402


class Check(unittest.TestCase):
    def states(self, target, typed):
        return [(w["w"], w["s"]) for w in dt.check(target, typed)["words"]]

    def test_perfect(self):
        r = dt.check("Quindi se hai difficoltà mi puoi aspettare", "quindi se hai difficoltà mi puoi aspettare")
        self.assertEqual(r["score"], 100)

    def test_accent_slip_is_half(self):
        self.assertIn(("difficoltà", "accent"), self.states("hai difficoltà", "hai difficolta"))
        self.assertEqual(dt.check("hai difficoltà", "hai difficolta")["score"], 75)

    def test_wrong_missing_extra(self):
        r = dt.check("devi arrivare al polo didattico", "devi arrivare a polo di dattico")
        s = dict((w["w"], w["s"]) for w in r["words"])
        self.assertEqual(s["devi"], "ok")
        self.assertNotEqual(s["didattico"], "ok")
        self.assertTrue(r["score"] < 100)

    def test_elision_splits(self):
        self.assertEqual(dt.tokens("c'è un po' di traffico, l’aula"), ["c", "è", "un", "po", "di", "traffico", "l", "aula"])

    def test_dropped_apostrophe_is_a_slip(self):
        self.assertEqual(self.states("che c'è tutta", "che ce tutta"),
                         [("che", "ok"), ("c", "accent"), ("è", "accent"), ("tutta", "ok")])

    def test_empty_typed_all_missing(self):
        r = dt.check("ti individueremo", "")
        self.assertEqual([w["s"] for w in r["words"]], ["missing", "missing"])
        self.assertEqual(r["score"], 0)


class Lines(unittest.TestCase):
    def w(self, word, a, b):
        return {"word": word, "start": a, "end": b}

    def test_cuts_at_period_and_comma(self):
        ws = [self.w(" Allora,", 0, 0.5), self.w(" va", 0.5, 1.0), self.w(" bene.", 1.0, 2.0),
              self.w(" Poi", 2.1, 2.5), self.w(" sali,", 2.5, 5.0), self.w(" entri", 5.0, 5.6), self.w(" qui.", 5.6, 6.5)]
        lines = bd.lines_from_words(ws)
        self.assertEqual([l["it"] for l in lines], ["Allora, va bene.", "Poi sali,", "entri qui."])

    def test_forced_cut_at_max(self):
        ws = [self.w(f" w{i}", i * 0.5, i * 0.5 + 0.5) for i in range(30)]
        self.assertTrue(all(l["end"] - l["start"] <= bd.MAX_S + bd.MIN_S for l in bd.lines_from_words(ws)))

    def test_short_tail_joins_previous(self):
        ws = [self.w(" Uno", 0, 1), self.w(" due.", 1, 2.5), self.w(" Ok.", 2.6, 3.0)]
        self.assertEqual(len(bd.lines_from_words(ws)), 1)


class Reference(unittest.TestCase):
    def test_merges_and_dedupes(self):
        with tempfile.TemporaryDirectory() as d:
            dt.ROOT, dt.REF = Path(d), Path(d) / "riferimento.json"
            out = {"grammar": [{"term": "metterci", "explain": "x", "example": "ci metterò"}],
                   "vocab": [{"it": "spiazzale", "en": "forecourt"}, {"it": "Spiazzale", "en": "forecourt"}]}
            self.assertEqual(dt._add_reference("a", out), 2)
            self.assertEqual(dt._add_reference("b", out), 2)
            ref = json.loads(dt.REF.read_text())
            self.assertEqual(ref["vocab"]["spiazzale"]["lessons"], ["a", "b"])
            self.assertEqual(len(ref["grammar"]), 1)


if __name__ == "__main__":
    unittest.main()
