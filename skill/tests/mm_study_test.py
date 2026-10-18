"""mm_study_test — POST /api/mm/study on a tiny synthetic library (and, if present, the real one).
Run: ~/miniconda3/bin/python tests/mm_study_test.py"""
import json, os, sys, tempfile, time, unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import mm_study as M  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(M.router)
client = TestClient(app)


def passage(lid, lesson, sec, secn, text, domain="medical-italian"):
    return {"id": f"{lid}#{sec}-1", "title": f"{lesson} — {secn}", "text": text,
            "meta": {"lesson": lesson, "lessonId": lid, "domain": domain, "section": sec,
                     "href": f"/lessons/{lid.replace('/', '-')}/lesson.html#{sec}"}}


def build(d: Path):
    mi = [passage("it/consenso", "Consenso e DAT", "legge-219", "1 La legge 219/2017",
                  "Il consenso informato è la base della relazione di cura. Il consenso informato si documenta."),
          passage("it/consenso", "Consenso e DAT", "palliative", "2 Parole chiave", "Le cure palliative accompagnano il malato."),
          passage("it/colleghi", "Colleghi, Ordine, SSN", "l-ordine", "3 L'Ordine dei Medici",
                  "L'Ordine ha la potestà disciplinare sugli iscritti."),
          passage("it/codice", "Il Codice di Deontologia Medica", "codice", "1 Che cos'è il Codice",
                  "La deontologia medica è l'insieme delle regole."),
          passage("it/altro", "Altra lezione", "x", "1 Altro",
                  "deontologia medica deontologia medica deontologia medica deontologia medica, citata spesso.")]
    en = [passage("chiron-med-eng", "Palliative care", "o", "1 Overview",
                  "cure palliative (palliative care) is mentioned once, in English prose.", "medicine")]
    (d / "library.corpus.medical-italian.json").write_text(json.dumps(mi))
    (d / "library.corpus.medicine.json").write_text(json.dumps(en))
    (d / "library.corpus.language-it.json").write_text(json.dumps(
        [passage("chiron-italian-passato", "Passato prossimo", "ch-1", "1 Ho detto", "Ieri ho detto la verità.", "language-it")]))
    (d / "listening.index.json").write_text(json.dumps({
        "lessons": {"it/consenso": {"title": "Consenso e DAT", "tags": []},
                    "chiron-italian-passato": {"title": "Passato prossimo", "tags": []}},
        "cards": [{"it": "il consenso informato", "en": "informed consent", "source": "script", "lesson": "it/consenso"},
                  {"it": "consenso informato", "en": "informed consent", "source": "vocab", "lesson": "it/consenso"},
                  {"it": "potestà disciplinare", "en": "disciplinary power", "source": "vocab", "lesson": "it/colleghi",
                   "lesson_title": "Colleghi, Ordine, SSN"},
                  {"it": "ho detto", "en": "I said", "source": "flashcard", "lesson": "chiron-italian-passato"}]}))


def post(words):
    return client.post("/api/mm/study", json={"words": [{"it": w} for w in words]})


class Study(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        build(Path(cls.tmp.name))
        cls.old = M.LIB
        M.LIB = Path(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        M.LIB = cls.old
        cls.tmp.cleanup()

    def test_card_then_section(self):
        j = post(["Consenso Informato"]).json()                       # case folded
        it = j["items"][0]
        self.assertEqual((it["lesson"], it["section"], it["why"]), ("it/consenso", "legge-219", "card"))
        self.assertEqual(it["path"], "/lessons/it-consenso/lesson.html#legge-219")
        self.assertTrue(it["url"].endswith(it["path"]) and it["url"].startswith("http"))
        self.assertIn("consenso informato", it["snippet"].lower())
        self.assertTrue(it["listen"]); self.assertEqual(it["listen_path"], "/ascolto?lesson=it%2Fconsenso")

    def test_accented_word_and_article(self):
        it = post(["potesta disciplinare"]).json()["items"][0]       # accent dropped by the player's keyboard
        self.assertEqual((it["lesson"], it["section"]), ("it/colleghi", "l-ordine"))
        it = post(["la potestà disciplinare"]).json()["items"][0]    # a leading article is ignored for cards
        self.assertEqual(it["lesson"], "it/colleghi")

    def test_passage_phrase_in_lesson_title_beats_repetition(self):
        it = post(["deontologia medica"]).json()["items"][0]
        self.assertEqual((it["lesson"], it["why"]), ("it/codice", "passage"))
        self.assertEqual(it["alternates"][0]["lesson"], "it/altro")

    def test_italian_corpus_beats_english_one(self):
        it = post(["cure palliative"]).json()["items"][0]
        self.assertEqual((it["lesson"], it["section"]), ("it/consenso", "palliative"))
        self.assertEqual([a["lesson"] for a in it["alternates"]], ["chiron-med-eng"])

    def test_card_without_a_passage_links_the_lesson(self):
        it = post(["ho detto"]).json()["items"][0]
        self.assertEqual((it["lesson"], it["why"]), ("chiron-italian-passato", "card"))
        self.assertEqual(it["section"], "ch-1")

    def test_unknown_word_is_unmatched(self):
        j = post(["accanimento terapeutico", "consenso informato"]).json()
        self.assertEqual(j["unmatched"], ["accanimento terapeutico"])
        self.assertEqual([i["it"] for i in j["items"]], ["consenso informato"])

    def test_bounds(self):
        self.assertEqual(post([]).status_code, 400)
        self.assertEqual(post([f"w{i}" for i in range(41)]).status_code, 400)

    def test_at_most_two_alternates(self):
        for it in post(["consenso informato", "deontologia medica"]).json()["items"]:
            self.assertLessEqual(len(it["alternates"]), 2)


class Real(unittest.TestCase):
    """Against the live library, when this box has one. Ids are the real ones from the data (2026-10-18)."""
    @classmethod
    def setUpClass(cls):
        M.LIB = Path(os.environ.get("CHIRON_LIBRARY", Path.home() / "Documents/generated/chiron-library"))
        if not (M.LIB / "listening.index.json").exists():
            raise unittest.SkipTest("no live chiron-library here")

    def lesson(self, w):
        return post([w]).json()["items"][0]["lesson"]

    def test_real(self):
        self.assertEqual(self.lesson("consenso informato"), "chiron-medicina-italiana/situazioni/ordine-consenso-dat")
        self.assertEqual(self.lesson("potestà disciplinare"), "chiron-medicina-italiana/situazioni/ordine-colleghi-ssn-ecm")


if __name__ == "__main__":
    unittest.main()
