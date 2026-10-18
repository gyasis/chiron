"""mazzi_test — GET /api/anki/decks + /mazzi with AnkiConnect mocked (never touches the live collection).
Run: ~/miniconda3/bin/python tests/mazzi_test.py   (needs fastapi)"""
import os, sys, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ["CHIRON_SKILL"] = os.path.join(HERE, "..")   # mock_oral defaults to the MAIN checkout and re-prepends its server/ to sys.path
sys.path.insert(0, os.path.join(HERE, "..", "server"))
import anki  # noqa: E402
import mazzi as M  # noqa: E402
import sessione as S  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

DECKS = {"Medical Italian": 1, "Medical Italian::Esame medico": 2, "Medical Italian::Vuoto": 3,
         "Chiron": 4, "Chiron::Quaderno": 5, "Solo*Star": 6}
DIRECT = {"Medical Italian": 10, "Medical Italian::Esame medico": 334, "Medical Italian::Vuoto": 0,
          "Chiron": 0, "Chiron::Quaderno": 0, "Solo*Star": 3}
QUERIES = []


def fake_invoke(action, **p):
    if action == "deckNamesAndIds":
        return DECKS
    assert action == "findCards", action
    QUERIES.append(p["query"])
    for n in sorted(DECKS, key=len, reverse=True):   # '"deck:<n>" -"deck:<n>::*"' -> that deck's direct cards
        q = n.replace("*", r"\*").replace("_", r"\_")
        if p["query"] == f'"deck:{q}" -"deck:{q}::*"':
            return list(range(DIRECT[n]))
    raise AssertionError("unexpected query " + p["query"])


def client():
    app = FastAPI(); app.include_router(M.router)
    return TestClient(app)


class Decks(unittest.TestCase):
    def setUp(self):
        M._cache.update(at=0.0, out=None); QUERIES.clear()

    def test_shape_totals_and_empty(self):
        with mock.patch.object(anki, "invoke", fake_invoke):
            r = client().get("/api/anki/decks")
        self.assertEqual(r.status_code, 200)
        d = r.json(); by = {x["name"]: x for x in d["decks"]}
        self.assertEqual(list(by), sorted(DECKS))                         # every deck, sorted so parents precede children
        self.assertEqual(by["Medical Italian::Esame medico"]["cards"], 334)
        self.assertEqual(by["Medical Italian"]["cards"], 10)
        self.assertEqual(by["Medical Italian"]["total"], 344)             # itself + sub-decks
        self.assertTrue(by["Medical Italian::Vuoto"]["empty"])
        self.assertTrue(by["Chiron"]["empty"] and by["Chiron"]["total"] == 0)   # parent of only-empty children is empty
        self.assertFalse(by["Medical Italian"]["empty"])
        self.assertEqual(d["total_cards"], 347)
        self.assertEqual(by["Solo*Star"]["cards"], 3)                     # '*' escaped, not a wildcard
        self.assertTrue(any(r"Solo\*Star" in q for q in QUERIES))

    def test_prefix_is_not_a_child(self):
        decks = {"Ita": 1, "Italiano": 2}; direct = {"Ita": 1, "Italiano": 5}
        with mock.patch.object(anki, "invoke", lambda a, **p: decks if a == "deckNamesAndIds" else list(range(direct[p["query"].split('"')[1][5:]]))):
            out = M.decks()
        self.assertEqual({x["name"]: x["total"] for x in out["decks"]}, {"Ita": 1, "Italiano": 5})

    def test_cache_then_fresh(self):
        calls = []
        def counting(a, **p): calls.append(a); return fake_invoke(a, **p)
        with mock.patch.object(anki, "invoke", counting):
            c = client(); c.get("/api/anki/decks"); n1 = len(calls)
            c.get("/api/anki/decks"); self.assertEqual(len(calls), n1)          # served from cache
            c.get("/api/anki/decks?fresh=1"); self.assertGreater(len(calls), n1)  # fresh=1 re-reads

    def test_anki_down_is_503_with_a_message(self):
        def down(a, **p): raise anki.AnkiUnavailable("ConnectionRefusedError: nope")
        with mock.patch.object(anki, "invoke", down):
            r = client().get("/api/anki/decks")
        self.assertEqual(r.status_code, 503)
        self.assertIn("Anki is unreachable", r.json()["detail"]); self.assertIn("nope", r.json()["detail"])
        self.assertIsNone(M._cache["out"])                                      # a failure is not cached

    def test_page_served(self):
        r = client().get("/mazzi")
        self.assertEqual(r.status_code, 200); self.assertIn("Mazzi", r.text); self.assertIn("/api/anki/decks", r.text)


class DeckLimit(unittest.TestCase):
    def test_limit_puts_due_first(self):
        seen = []
        def inv(a, **p):
            seen.append((a, p))
            if a == "findCards": return [1, 2, 3, 4, 5] if "is:due" not in p["query"] else [4, 5]
            if a == "cardsInfo": return []
            return None
        with mock.patch.object(anki, "invoke", inv):
            S.deck_cards("Big", limit=3)
        self.assertEqual([p for a, p in seen if a == "cardsInfo"][0]["cards"], [4, 5, 1])

    def test_no_limit_unchanged(self):
        with mock.patch.object(anki, "invoke", lambda a, **p: [1, 2, 3] if a == "findCards" else []) as m:
            S.deck_cards("Small")


if __name__ == "__main__":
    unittest.main()
