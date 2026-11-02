"""pimsleur_jobs_test — POST /api/pimsleur/from-phrases and the Pimsleur basket in Raccolte, on temp state with a MOCK job
launcher (no real Pimsleur run is ever started). Run: python3 skill/tests/pimsleur_jobs_test.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="chiron-pj-"))
os.environ["CHIRON_COLLECTIONS_FILE"] = str(TMP / "collections.json")
os.environ["CHIRON_GEN"] = str(TMP / "gen")
os.environ["CHIRON_PIMSLEUR_STATE"] = str(TMP / "state")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import raccolte as R  # noqa: E402
import pimsleur_jobs as P  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

REAL_SUGGEST = P.suggest_topic
app = FastAPI()
app.include_router(R.router)
app.include_router(P.router)
c = TestClient(app)
URL = "/api/pimsleur/from-phrases"
BASKET = "/api/collections/pimsleur-basket"
PH = [{"it": "Dov'è l'ambulatorio?", "en": "Where is the clinic?", "register": "neutral"},
      {"it": "Scusi, chi è il mio tutor?", "en": "Who is my tutor?", "register": "lei"},
      {"it": "A che ora è il corso di sicurezza?", "en": "What time is the safety course?", "register": "neutral"},
      {"it": "Dove si svolge il tirocinio?", "en": "Where is the rotation held?", "register": "neutral"}]


class Launcher:
    def __init__(self):
        self.calls = []

    def __call__(self, req):
        self.calls.append(req)
        jid = f"job{len(self.calls)}"
        P.JOBS[jid] = {"id": jid, "status": "queued", "subject": req["subject"], "extra": req["extra"]}
        return {"job_id": jid, "slug": "chiron-pimsleur-x", "status": "queued"}


class Base(unittest.TestCase):
    def setUp(self):
        R.STATE_F.unlink(missing_ok=True)
        (TMP / "gen").mkdir(exist_ok=True)
        for f in (TMP / "gen").glob("*"):
            f.unlink()
        P.JOBS.clear()
        P._topic_cache.clear()
        for f in P.STATE.glob("*.json"):
            f.unlink()
        self.launch = Launcher()
        P.SUBMIT, P.ORIGIN_OK = self.launch, None
        P.mac_warning = lambda: None

    def fill_basket(self, phrases=PH):
        r = c.post(BASKET + "/items", json={"items": [
            {"it": p["it"], "en": p["en"], "source": "ask-phrase", "note": f"register:{p['register']}"} for p in phrases]})
        self.assertEqual(r.status_code, 200, r.text)


class Raccolte(Base):
    def test_ask_phrase_source_is_accepted_and_kept(self):
        self.fill_basket(PH[:1])
        row = c.get(BASKET).json()["items"][0]
        self.assertEqual(row["source"], "ask-phrase")
        self.assertEqual(row["note"], "register:neutral")

    def test_the_basket_collection_always_exists(self):
        ids = [x["id"] for x in c.get("/api/collections").json()["collections"]]
        self.assertIn("pimsleur-basket", ids)
        self.assertIn("parole-deboli", ids)

    def test_add_remove_and_dedupe(self):
        self.fill_basket(PH[:2])
        again = c.post(BASKET + "/items", json={"items": [{"it": "DOV'È L'AMBULATORIO", "source": "ask-phrase"}]}).json()
        self.assertEqual((again["added"], again["duplicates"]), (0, 1))          # folded `it`
        self.assertEqual(c.get(BASKET).json()["items"].__len__(), 2)
        self.assertEqual(c.delete(BASKET + "/items", params={"it": PH[0]["it"]}).status_code, 200)
        self.assertEqual([i["it"] for i in c.get(BASKET).json()["items"]], [PH[1]["it"]])


class Route(Base):
    def post(self, **body):
        return c.post(URL, json=body)

    def test_missing_confirm_is_400_and_starts_nothing(self):
        r = self.post(phrases=PH)
        self.assertEqual(r.status_code, 400)
        self.assertIn("confirm:true", r.json()["error"])
        self.assertEqual(self.launch.calls, [])

    def test_bad_bodies_are_400(self):
        self.assertEqual(c.post(URL, content=b"nope").status_code, 400)
        self.assertEqual(c.post(URL, json=[1]).status_code, 400)
        self.assertEqual(self.post(confirm=True).status_code, 400)
        self.assertEqual(self.post(confirm=True, phrases=[]).status_code, 400)
        self.assertEqual(self.post(confirm=True, phrases=[{"en": "x"}]).status_code, 400)
        self.assertEqual(self.post(confirm=True, phrases=PH, lessons=99).status_code, 400)
        self.assertEqual(self.post(confirm=True, phrases=PH, topic=5).status_code, 400)
        self.assertEqual(self.launch.calls, [])

    def test_foreign_origin_is_403(self):
        P.ORIGIN_OK = lambda request: False
        r = self.post(phrases=PH, confirm=True)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.launch.calls, [])

    def test_the_wired_origin_check_blocks_a_foreign_page(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
        P.ORIGIN_OK = lambda request: request.headers.get("origin", "http://testserver") in ("http://testserver", "http://tauri.localhost") or False
        self.assertEqual(c.post(URL, json={"phrases": PH, "confirm": True}, headers={"origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(c.post(URL, json={"phrases": PH, "dry": True, "confirm": True}, headers={"origin": "http://tauri.localhost"}).status_code, 200)

    def test_dry_run_returns_source_and_env_and_starts_nothing(self):
        r = self.post(phrases=PH, confirm=True, dry=True, lessons=2).json()
        self.assertTrue(r["dry"])
        self.assertEqual([t["it"] for t in r["source_file"]["content"]["targets"]], [p["it"] for p in PH])
        self.assertIn("exact phrases", r["source_file"]["content"]["_instructions"])
        env = r["env"]
        self.assertEqual(env["CH_STAGE"], "all")
        self.assertEqual(env["CH_DOMAIN"], "language-it")
        self.assertEqual(env["CH_TARGETS"], "given")
        self.assertEqual(env["CH_LESSONS"], "2")
        self.assertEqual(env["CH_SOURCE"], r["source_file"]["path"])
        self.assertEqual(env["CHIRON_PIMSLEUR_ENGINE"], "mac")                    # never modal
        self.assertTrue(env["CH_TOPIC"].startswith("Coach phrases:"))
        self.assertEqual(self.launch.calls, [])
        self.assertFalse(Path(r["source_file"]["path"]).exists())                  # a dry run writes nothing

    def test_start_writes_the_source_and_submits_through_generate(self):
        r = self.post(phrases=PH, confirm=True, topic="Il primo giorno").json()
        self.assertTrue(r["ok"] and not r["duplicate"])
        req = self.launch.calls[0]
        self.assertEqual((req["domain"], req["depth"], req["stage"], req["subject"]), ("language-it", "pimsleur", "all", "Il primo giorno"))
        src = json.loads(Path(req["extra"]["source_file"]).read_text())
        self.assertEqual(len(src["targets"]), 4)
        self.assertIn("Do not invent", src["_instructions"])

    def test_same_phrase_set_is_a_duplicate(self):
        self.post(phrases=PH, confirm=True)
        r = self.post(phrases=list(reversed(PH)), confirm=True).json()
        self.assertTrue(r["duplicate"])
        self.assertIn("already exists", r["note"])
        self.assertEqual(len(self.launch.calls), 1)

    def test_mac_away_still_queues_with_a_warning(self):
        P.mac_warning = lambda: "Mac Studio is away — the audio bake will wait/fail"
        r = self.post(phrases=PH, confirm=True).json()
        self.assertIn("Mac Studio is away", r["warning"])
        self.assertEqual(len(self.launch.calls), 1)

    def test_existing_season_on_the_topic_with_other_phrases_is_409(self):
        (TMP / "gen" / f"{P.topic_slug('Il primo giorno')}.season.json").write_text("{}")
        self.assertEqual(self.post(phrases=PH, confirm=True, topic="Il primo giorno").status_code, 409)
        self.assertEqual(self.launch.calls, [])

    def test_single_phrase_is_allowed_from_a_reply_but_a_basket_needs_three(self):
        self.assertEqual(self.post(phrases=PH[:1], confirm=True).status_code, 200)
        self.fill_basket(PH[:2])
        r = self.post(collection="pimsleur-basket", confirm=True)
        self.assertEqual(r.status_code, 400)
        self.assertIn("at least 3", r.json()["error"])

    def test_basket_is_read_server_side_then_moved_and_emptied(self):
        self.fill_basket()
        r = self.post(collection="pimsleur-basket", topic="Il primo giorno", confirm=True).json()
        self.assertTrue(r["ok"] and not r["duplicate"])
        self.assertEqual([t["it"] for t in json.loads(Path(self.launch.calls[0]["extra"]["source_file"]).read_text())["targets"]],
                         [p["it"] for p in PH])
        regs = [t["register"] for t in json.loads(Path(self.launch.calls[0]["extra"]["source_file"]).read_text())["targets"]]
        self.assertEqual(regs, ["neutral", "lei", "neutral", "neutral"])
        self.assertEqual(c.get(BASKET).json()["items"], [])                         # emptied
        season = c.get("/api/collections/" + r["moved_to"]["id"]).json()
        self.assertEqual(season["name"], "Il primo giorno")
        self.assertEqual(len(season["items"]), 4)

    def test_duplicate_does_not_empty_the_basket(self):
        self.fill_basket()
        self.post(phrases=PH, confirm=True)                                         # the same set already has a run
        r = self.post(collection="pimsleur-basket", confirm=True).json()
        self.assertTrue(r["duplicate"])
        self.assertEqual(len(c.get(BASKET).json()["items"]), 4)

    def test_dry_run_from_the_basket_leaves_it_alone(self):
        self.fill_basket()
        r = self.post(collection="pimsleur-basket", confirm=True, dry=True).json()
        self.assertTrue(r["dry"])
        self.assertEqual(len(c.get(BASKET).json()["items"]), 4)

    def test_unknown_collection_is_404(self):
        self.assertEqual(self.post(collection="nope", confirm=True).status_code, 404)

    def test_dispatch_routes_the_pimsleur_depth(self):
        import dispatch
        res = dispatch.resolve("language-it", "pimsleur", "Il primo giorno", None, {"source_file": "/x.json", "lessons": 3})
        self.assertTrue(res["runpy"].endswith("2026-10-11_chiron-pimsleur-lesson-chain/run.py"))
        self.assertEqual(res["slug"], "chiron-pimsleur-il-primo-giorno")
        self.assertEqual((res["env"]["CH_SOURCE"], res["env"]["CH_LESSONS"], res["env"]["CH_TARGETS"]), ("/x.json", "3", "given"))

    def test_long_slug_is_cut_at_a_hyphen_not_mid_word(self):
        import dispatch
        slug = P.topic_slug("Procedure amministrative per la presa di servizio in specializzazione")
        self.assertEqual(slug, "chiron-pimsleur-procedure-amministrative-per-la-presa-di")
        self.assertLessEqual(len(slug) - len("chiron-pimsleur-"), 40)
        self.assertEqual(dispatch.clip_slug("a" * 50, 40), "a" * 40)                  # one long word: hard cut
        self.assertEqual(dispatch.clip_slug("abc-defg-hij", 8), "abc-defg")            # the cut lands on a hyphen
        self.assertEqual(dispatch.clip_slug("abc-defg-hij", 9), "abc-defg")
        slug2 = P.topic_slug("Procedure amministrative per l'ammissione")          # old rule cut this to "...amministrati"
        self.assertFalse(slug2.endswith("amministrati"))
        self.assertEqual(dispatch.clip_slug("short", 40), "short")

    def test_the_chain_and_dispatch_agree_on_the_slug(self):
        import re, importlib.util
        src = (Path(__file__).resolve().parent.parent / "chains/2026-10-11_chiron-pimsleur-lesson-chain/run.py").read_text()
        ns = {"re": re}
        exec(src[src.index("def _clip_slug"):src.index("TOPIC_SLUG = ")], ns)
        import dispatch
        for base in ("procedure-amministrative-per-la-presa-di-servizio", "il-primo-giorno", "x" * 60):
            self.assertEqual(ns["_clip_slug"](base), dispatch.clip_slug(base, 40))


class Topic(Base):
    def setUp(self):
        super().setUp()
        self.asked = []

        def fake(phrases):
            self.asked.append([p["it"] for p in phrases])
            return "Primo giorno di specializzazione"
        P.suggest_topic = fake

    def post(self, **body):
        return c.post("/api/pimsleur/topic", json=body)

    def test_title_comes_from_the_model_and_is_cached_per_basket_content(self):
        self.fill_basket()
        a = self.post(collection="pimsleur-basket").json()
        b = self.post(collection="pimsleur-basket").json()
        self.assertEqual((a["topic"], a["source"]), ("Primo giorno di specializzazione", "model"))
        self.assertEqual(b["source"], "cache")
        self.assertEqual(len(self.asked), 1)                                       # one model call for the same content
        c.post(BASKET + "/items", json={"items": [{"it": "Una frase nuova.", "source": "ask-phrase"}]})
        self.assertEqual(self.post(collection="pimsleur-basket").json()["source"], "model")   # changed content: asked again
        self.assertEqual(len(self.asked), 2)

    def test_model_failure_gives_the_flagged_fallback_and_is_not_cached(self):
        def boom(phrases):
            raise ValueError("no usable title")
        P.suggest_topic = boom
        r = self.post(phrases=PH).json()
        self.assertEqual(r["source"], "fallback")
        self.assertTrue(r["topic"].startswith("Coach phrases:"))
        self.assertEqual(P._topic_cache, {})

    def test_guards(self):
        P.ORIGIN_OK = lambda request: False
        self.assertEqual(self.post(phrases=PH).status_code, 403)
        P.ORIGIN_OK = None
        self.assertEqual(c.post("/api/pimsleur/topic", content=b"x").status_code, 400)
        self.assertEqual(self.post(phrases=[]).status_code, 400)
        self.assertEqual(self.post(collection="nope").status_code, 404)

    def test_a_cached_title_names_the_season_when_no_topic_is_sent(self):
        self.fill_basket()
        self.post(collection="pimsleur-basket")
        r = c.post(URL, json={"collection": "pimsleur-basket", "confirm": True}).json()
        self.assertEqual(r["topic"], "Primo giorno di specializzazione")

    def test_the_fallback_title_is_short(self):
        t = P.derive_topic(PH)
        self.assertLessEqual(len(t), 60)
        self.assertEqual(t, "Coach phrases: Where is the clinic / Who is my tutor")

    def test_suggest_topic_reads_one_stop_reply_and_rejects_the_rest(self):
        import httpx
        real = httpx.post

        class R:
            def __init__(self, content, reason="stop"): self.c, self.r = content, reason
            def raise_for_status(self): pass
            def json(self): return {"message": {"content": self.c}, "done_reason": self.r}
        fn = REAL_SUGGEST
        try:
            httpx.post = lambda *a, **k: R('"Primo giorno di specializzazione."\nextra line')
            self.assertEqual(fn(PH), "Primo giorno di specializzazione")
            httpx.post = lambda *a, **k: R("Titolo", "length")
            with self.assertRaises(ValueError):
                fn(PH)
            httpx.post = lambda *a, **k: R("")
            with self.assertRaises(ValueError):
                fn(PH)
        finally:
            httpx.post = real


if __name__ == "__main__":
    unittest.main()
