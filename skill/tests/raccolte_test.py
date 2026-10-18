"""raccolte_test — the "⭐ Raccogli" collections API on a temp state file and a tiny synthetic listening index.
Run: ~/miniconda3/bin/python tests/raccolte_test.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path

TMP = Path(tempfile.mkdtemp())
os.environ["CHIRON_COLLECTIONS_FILE"] = str(TMP / "collections.json")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import raccolte as R  # noqa: E402
import pool  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(R.router)
c = TestClient(app)
D = "/api/collections"


class T(unittest.TestCase):
    def setUp(self):
        R.STATE_F.unlink(missing_ok=True)
        R.GENERATE = None

    def test_default_always_exists(self):
        cols = c.get(D).json()["collections"]
        self.assertEqual([x["id"] for x in cols], ["parole-deboli"])
        self.assertEqual(cols[0]["name"], "Parole deboli")

    def test_create_and_existing(self):
        a = c.post(D, json={"name": "Cardio"}).json()
        self.assertEqual((a["id"], a["existing"]), ("cardio", False))
        self.assertTrue(c.post(D, json={"name": " cardio "}).json()["existing"])
        self.assertEqual(c.post(D, json={"name": ""}).status_code, 400)

    def test_add_dedupe_soft_delete_revive(self):
        u = f"{D}/parole-deboli/items"
        r = c.post(u, json={"items": [{"it": "Il Consenso", "source": "mm"}, {"it": "il consenso"}, {"it": "più"}]}).json()
        self.assertEqual((r["added"], r["duplicates"], r["count"]), (2, 1, 2))
        self.assertEqual(c.post(u, json={"items": [{"it": "piu"}]}).json()["duplicates"], 1)   # folded: accents ignored
        self.assertEqual(c.delete(u, params={"it": "più"}).json()["count"], 1)
        self.assertEqual([i["it"] for i in c.get(f"{D}/parole-deboli").json()["items"]], ["Il Consenso"])
        raw = json.loads(R.STATE_F.read_text())["collections"][0]["items"]
        self.assertEqual(len(raw), 2)                                    # never hard-deleted
        self.assertTrue(next(i for i in raw if i["it"] == "più")["removed_at"])
        self.assertEqual(c.post(u, json={"items": [{"it": "più"}]}).json()["revived"], 1)
        self.assertEqual(c.get(D).json()["collections"][0]["count"], 2)
        self.assertEqual(c.delete(u, params={"it": "nope"}).status_code, 404)
        self.assertEqual(c.post(u, json={"items": []}).status_code, 400)
        self.assertEqual(c.post(f"{D}/zzz/items", json={"items": [{"it": "x"}]}).status_code, 404)

    def test_pairs(self):
        c.post(f"{D}/parole-deboli/items", json={"items": [{"it": "febbre", "en": "fever"}]})
        self.assertEqual(c.get(f"{D}/parole-deboli/pairs").json()["pairs"], [{"it": "febbre", "en": "fever"}])

    def test_lesson_is_confirm_first_and_uses_generate(self):
        c.post(f"{D}/parole-deboli/items", json={"items": [{"it": "febbre", "en": "fever"}]})
        u = f"{D}/parole-deboli/lesson"
        self.assertEqual(c.post(u, json={}).status_code, 400)                      # no confirm -> nothing happens
        d = c.post(u, json={"confirm": True, "dry": True}).json()
        self.assertTrue(d["dry"])
        self.assertEqual(d["request"]["domain"], "medical-italian")
        self.assertIn("febbre — fever", d["request"]["grounding"])
        self.assertEqual(c.post(u, json={"confirm": True}).status_code, 503)       # not wired
        seen = []
        R.GENERATE = lambda r: (seen.append(r), {"job_id": "j1", "status": "queued"})[1]
        self.assertEqual(c.post(u, json={"confirm": True}).json()["job_id"], "j1")
        self.assertEqual(seen[0]["source_ref"], "parole-deboli")

    def test_audio_cards_dry(self):
        idx = TMP / "listening.index.json"
        idx.write_text(json.dumps({"lessons": {"L1": {"title": "Consenso", "tags": []}}, "cards": [
            {"it": "il consenso informato è la base della cura", "en": "informed consent is the base of care",
             "lesson": "L1", "lesson_title": "Consenso", "source": "pimsleur", "kind": "sentence"}]}))
        pool.LISTEN_INDEX = idx
        pool._li["mtime"] = None
        c.post(f"{D}/parole-deboli/items", json={"items": [{"it": "consenso informato"}, {"it": "parolainesistente"}]})
        d = c.get(f"{D}/parole-deboli/cards", params={"dry": 1}).json()
        self.assertEqual(len(d["sentences"]), 1)
        self.assertEqual(d["sentences"][0]["deck"], "Chiron::Raccolte::Parole deboli")
        self.assertEqual(d["uncovered"], ["parolainesistente"])
        self.assertIsNone(d["next"])
        self.assertIsNone(d["sentences"][0]["noteId"])                            # dry: no Anki note

    def test_from_lesson_is_idempotent_and_reads_both_formats(self):
        gen = TMP / "gen"
        (gen / "a" / "x").mkdir(parents=True)
        (gen / "b").mkdir()
        (gen / "a" / "x" / "lesson.html").write_text(
            '<title>Chiron · Passaggio di consegne</title><section id="match-madness"><script>'
            "var PAIRS = [\n { id: 'p1', it: \"il medico curante\", en: \"the GP\" },\n"
            " { id: 'p2', it: 'l\\'ospedale', en: 'the hospital' },\n ];</script></section>")
        (gen / "b" / "lesson.html").write_text(
            "<title>Chiron · Perch\u00e9 l'anestesia?</title><section id=\"match-madness\"><script>const CONFIG = "
            + json.dumps({"sets": [{"pairs": [{"left": "Ho intubato", "right": "I intubated"},
                                                 {"left": "ho intubato", "right": "dup"}]}]}) + ";</script></section>")
        R.GEN = gen
        u = f"{D}/from-lesson"
        a = c.post(u, json={"lesson": "a/x"}).json()
        self.assertEqual((a["name"], a["count"], a["existing"]), ("Passaggio di consegne", 2, False))
        self.assertEqual(c.get(f"{D}/{a['id']}/pairs").json()["pairs"],
                         [{"it": "il medico curante", "en": "the GP"}, {"it": "l'ospedale", "en": "the hospital"}])
        b = c.post(u, json={"lesson": "a/x"}).json()                       # re-send: same collection, no duplicates
        self.assertEqual((b["id"], b["count"], b["existing"]), (a["id"], 2, True))
        self.assertEqual(len([x for x in c.get(D).json()["collections"] if x["id"] == a["id"]]), 1)
        (gen / "a" / "x" / "lesson.html").write_text((gen / "a" / "x" / "lesson.html").read_text().replace("the GP", "the family doctor"))
        c.post(u, json={"lesson": "a/x"})                                  # a corrected English is refreshed
        self.assertEqual(c.get(f"{D}/{a['id']}/pairs").json()["pairs"][0]["en"], "the family doctor")
        m = c.post(u, json={"lesson": "b"}).json()                         # CONFIG form, deduped by folded Italian
        self.assertEqual((m["name"], m["count"]), ("Perché l'anestesia?", 1))
        self.assertEqual(c.post(u, json={"lesson": "nope"}).status_code, 404)
        self.assertEqual(c.post(u, json={"lesson": "../etc"}).status_code, 400)
        (gen / "b" / "lesson.html").write_text("<title>x</title>")
        self.assertEqual(c.post(u, json={"lesson": "b"}).status_code, 404)  # no match-madness section


if __name__ == "__main__":
    unittest.main()
