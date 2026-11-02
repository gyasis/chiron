"""phrase_related_test — "Study more": BM25 over a synthetic language-it shard, lesson dedupe, the 5-lesson limit and the
missing topics. Run: python3 skill/tests/phrase_related_test.py"""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import phrase_related as R  # noqa: E402


def passage(lid, lesson, section, text):
    return {"id": f"{lid}#{section}", "title": f"{lesson} — {section}", "text": text,
            "meta": {"lesson": lesson, "lessonId": lid, "domain": "language-it", "section": section,
                     "href": f"/lessons/{lid}/lesson.html#{section}"}}


ROWS = [
    passage("modali", "Verbi modali", "chapter-1", "Il verbo dovere si usa con l'infinito: devo fare, devi fare. I verbi modali dovere potere volere."),
    passage("modali", "Verbi modali", "chapter-2", "Dovere e infinito: devo andare, deve partire."),
    passage("interr", "Le domande", "chapter-1", "Gli interrogativi dove, quando, come aprono la domanda. Dove vai? Quando parti?"),
    passage("cortesia", "Dare del Lei", "chapter-1", "La forma di cortesia Lei: Scusi, mi dica. Lei formale."),
    passage("fare", "Il verbo fare", "chapter-1", "Il verbo fare: faccio, fai, fa. Fare la spesa, fare una visita."),
    passage("noise", "Il tempo", "chapter-1", "Oggi piove e fa freddo a Napoli."),
]
TMP = Path(tempfile.mkdtemp())
SHARD = TMP / "shard.json"
SHARD.write_text(json.dumps(ROWS))


def topic(name, kind, query):
    return {"topic": name, "kind": kind, "query": query}


class Related(unittest.TestCase):
    def test_finds_a_lesson_per_topic_and_names_the_topic_and_section(self):
        out = R.find_related([topic("dovere + infinito", "construction", "dovere infinito verbi modali devo")], SHARD)
        self.assertEqual(len(out["lessons"]), 1)
        les = out["lessons"][0]
        self.assertEqual(les["title"], "Verbi modali")
        self.assertEqual(les["topic"], "dovere + infinito")
        self.assertTrue(les["url"].startswith("/lessons/modali/lesson.html"))
        self.assertTrue(les["section"].startswith("chapter-"))
        self.assertEqual(out["missing"], [])

    def test_a_lesson_is_listed_once_even_when_two_topics_match_it(self):
        out = R.find_related([topic("dovere + infinito", "construction", "dovere infinito verbi modali"),
                              topic("dovere", "verb", "verbo dovere devo")], SHARD)
        self.assertEqual([l["title"] for l in out["lessons"]], ["Verbi modali"])
        self.assertEqual(out["missing"], [])        # the second topic is covered by the lesson already chosen

    def test_topic_without_any_matching_passage_is_missing(self):
        out = R.find_related([topic("si impersonale", "construction", "si impersonale"),
                              topic("interrogativi (dove, quando)", "construction", "interrogativi dove quando domande")], SHARD)
        self.assertEqual(out["missing"], ["si impersonale"])
        self.assertEqual([l["title"] for l in out["lessons"]], ["Le domande"])

    def test_construction_needs_two_anchor_terms(self):
        # "interrogativi" alone is in no passage together with "impersonale": the noise lesson must not match on one word
        out = R.find_related([topic("x", "construction", "freddo impersonale")], SHARD)
        self.assertEqual(out["lessons"], [])
        self.assertEqual(out["missing"], ["x"])

    def test_limit_is_five_lessons(self):
        rows = [passage(f"l{i}", f"Lezione {i}", "c", f"argomento{i} uno due tre") for i in range(8)]
        shard = TMP / "many.json"
        shard.write_text(json.dumps(rows))
        topics = [topic(f"t{i}", "verb", f"argomento{i}") for i in range(8)]
        out = R.find_related(topics, shard)
        self.assertEqual(len(out["lessons"]), 5)
        self.assertEqual(len({l["title"] for l in out["lessons"]}), 5)

    def test_missing_is_capped_and_unique(self):
        topics = [topic(f"nulla{i}", "verb", f"zzz{i}") for i in range(9)] + [topic("nulla0", "verb", "zzz0")]
        out = R.find_related(topics, SHARD)
        self.assertEqual(len(out["missing"]), R.MAX_MISSING)
        self.assertEqual(len(set(out["missing"])), len(out["missing"]))

    def test_accents_fold(self):
        self.assertEqual(R.tokens("Perché è già qui"), ["perche", "gia", "qui"])

    def test_missing_shard_is_an_error_not_an_empty_result(self):
        with self.assertRaises(FileNotFoundError):
            R.find_related([topic("a", "verb", "fare")], TMP / "nope.json")


if __name__ == "__main__":
    unittest.main()
