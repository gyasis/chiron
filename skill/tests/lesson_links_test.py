"""lesson_links_test — store atomicity, Anki/Pimsleur status logic with a MOCK Anki and job launcher, phrase picking,
duplicate guards on both POSTs, and the Italian-only injection. No real Anki write or Pimsleur run happens.
Run: python3 skill/tests/lesson_links_test.py"""
import json, os, sys, tempfile, threading, unittest
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="chiron-ll-"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

GEN = TMP / "gen"
_SAVED = {}
anki = L = P = R = None


def setUpModule():
    """Import the server modules now, not at collection, so another test file that sets its own environment before its
    first import keeps winning; then point them at temp state and restore every attribute afterwards."""
    global anki, L, P, R
    import anki, lesson_links as L, pimsleur_jobs as P, raccolte as R  # noqa: E402
    for mod, name, val in [(L, "GEN", GEN), (L, "STORE_F", TMP / "links.json"), (L, "DETTATO_ROOT", GEN / "chiron-dettato"),
                           (R, "GEN", GEN), (R, "STATE_F", TMP / "collections.json"), (P, "GEN", GEN), (P, "STATE", TMP / "pstate"),
                           (P, "SUBMIT", None), (P, "JOBS", {}), (P, "ORIGIN_OK", None)]:
        _SAVED[(mod, name)] = getattr(mod, name)
        setattr(mod, name, val)


def tearDownModule():
    for (mod, name), val in _SAVED.items():
        setattr(mod, name, val)
PAIRS = [("Mi serve un modulo", "I need a form"), ("Come si compila questo campo", "How do I fill in this field"),
         ("Posso mandarlo in chat", "Can I send it in chat"), ("Ne servono due", "Two are needed"),
         ("Riesco a farlo oggi", "I can do it today"), ("modulo", "form"), ("campo", "field")]


def lesson_html(pairs=PAIRS):
    body = ",".join('{"left":%s,"right":%s}' % (json.dumps(a), json.dumps(b)) for a, b in pairs)
    return ('<html><head><title>Chiron · Un modulo</title></head><body><h1>Un modulo</h1>'
            '<section id="match-madness"><script>const CONFIG = {"sets":[{"pairs":[%s]}]};</script></section></body></html>' % body)


def make_lesson(name, domain="language-it", html=None, fmt=None):
    d = GEN / name
    d.mkdir(parents=True, exist_ok=True)
    meta = {"title": "Un modulo", "domain": domain, **({"lessonFormat": fmt} if fmt else {})}
    (d / "chiron.json").write_text(json.dumps(meta))
    (d / "lesson.html").write_text(html if html is not None else lesson_html())


class FakeAnki:
    """findNotes by query substring -> ids; records addNotes."""
    def __init__(self):
        self.notes, self.down, self.queries, self.added = {}, False, [], []

    def invoke(self, action, **p):
        if self.down:
            raise anki.AnkiUnavailable("no Anki")
        if action == "findNotes":
            self.queries.append(p["query"])
            return [i for q, ids in self.notes.items() if q in p["query"] for i in ids]
        raise AssertionError(action)


class Base(unittest.TestCase):
    def setUp(self):
        GEN.mkdir(parents=True, exist_ok=True)
        for p in list(GEN.iterdir()):
            if p.is_dir():
                import shutil; shutil.rmtree(p)
        for f in list(TMP.glob("*.json")):
            f.unlink()
        L._lessons_cache.update(at=0.0, by_key={}); L._anki_cache.clear()
        L.JOBS = {}
        self.fa = FakeAnki()
        self._orig = anki.invoke
        anki.invoke = self.fa.invoke
        make_lesson("chiron-italian-un-modulo")
        self.row = L.italian_lessons(force=True)["chiron-italian-un-modulo"]

    def tearDown(self):
        anki.invoke = self._orig


class StoreTest(Base):
    def test_concurrent_updates_all_land(self):
        ts = [threading.Thread(target=lambda i=i: L.update_link(f"k{i}", "mm", {"collection_id": str(i)})) for i in range(24)]
        [t.start() for t in ts]; [t.join() for t in ts]
        d = json.loads(L.STORE_F.read_text())
        self.assertEqual(len(d), 24)
        self.assertFalse(list(TMP.glob("links.json.tmp*")))

    def test_merge_keeps_other_parts(self):
        L.update_link("k", "anki", {"count": 3}); L.update_link("k", "pimsleur", {"job_id": "j"}); L.update_link("k", "anki", {"deck": "D"})
        self.assertEqual(L.get_links("k"), {"anki": {"count": 3, "deck": "D"}, "pimsleur": {"job_id": "j"}})

    def test_corrupt_store_is_an_error_not_a_reset(self):
        L.STORE_F.write_text("{nope")
        with self.assertRaises(RuntimeError):
            L.get_links("k")


class AnkiStatusTest(Base):
    def test_none_when_no_convention_matches(self):
        st = L.anki_status(self.row)
        self.assertEqual((st["status"], st["count"]), ("none", 0))
        self.assertGreaterEqual(len(self.fa.queries), 4)

    def test_cards_report_conventions_and_record(self):
        self.fa.notes = {"tag:lesson:chiron-italian-un-modulo": [1, 2, 3], "tag:pool::lesson::un-modulo": [3, 4]}
        st = L.anki_status(self.row)
        self.assertEqual((st["status"], st["count"]), ("cards", 4))
        self.assertEqual({m["name"] for m in st["matched"]}, {"lesson-tag", "pool-tag"})
        self.assertEqual(st["tag"], "lesson:chiron-italian-un-modulo")
        self.assertEqual(L.get_links(self.row["key"])["anki"]["count"], 4)

    def test_deck_convention(self):
        self.fa.notes = {"deck:Chiron::Lezioni::Un modulo": [9]}
        self.assertEqual(L.anki_status(self.row)["matched"][0]["name"], "lesson-deck")

    def test_unreachable_is_never_none(self):
        self.fa.down = True
        st = L.anki_status(self.row)
        self.assertEqual(st["status"], "unreachable")
        self.assertIsNone(st["count"])
        self.assertNotIn(self.row["key"], L._anki_cache)
        self.assertEqual(L.anki_status_cached(self.row)["status"], "unreachable")
        self.assertNotIn(self.row["key"], L._anki_cache)

    def test_readonly_flag_records_nothing(self):
        self.fa.notes = {"tag:lesson:chiron-italian-un-modulo": [1]}
        L.RECORD = False
        try:
            L.anki_status(self.row)
        finally:
            L.RECORD = True
        self.assertEqual(L.get_links(self.row["key"]), {})


class PimsleurStatusTest(Base):
    def test_states(self):
        k = self.row["key"]
        self.assertEqual(L.pimsleur_status(self.row)["state"], "none")
        L.JOBS = {"j1": {"id": "j1", "status": "running", "slug": "s", "extra": {"source_lesson": k}}}
        self.assertEqual(L.pimsleur_status(self.row)["state"], "generating")
        L.JOBS["j1"]["status"] = "ready"
        self.assertEqual(L.pimsleur_status(self.row)["state"], "ready")
        L.JOBS["j1"]["status"] = "error"
        self.assertEqual(L.pimsleur_status(self.row)["state"], "none")

    def test_link_and_season_file(self):
        L.update_link(self.row["key"], "pimsleur", {"job_id": "gone", "season": "chiron-pimsleur-x"})
        self.assertEqual(L.pimsleur_status(self.row)["state"], "none")
        (GEN / "chiron-pimsleur-x.season.json").write_text("{}")
        self.assertEqual(L.pimsleur_status(self.row)["state"], "ready")

    def test_is_pimsleur_by_format(self):
        make_lesson("chiron-pimsleur-y", fmt="pimsleur")
        r = L.italian_lessons(force=True)["chiron-pimsleur-y"]
        self.assertEqual(L.pimsleur_status(r)["state"], "is_pimsleur")


class PickTest(unittest.TestCase):
    def pairs(self, n_multi, n_single):
        return [{"it": "frase numero %d qui" % i, "en": "e%d" % i} for i in range(n_multi)] + \
               [{"it": "parola%d" % i, "en": "w%d" % i} for i in range(n_single)]

    def test_caps_at_ten_prefers_multiword(self):
        got = L.pick_phrases(self.pairs(14, 6))
        self.assertEqual(len(got), 10)
        self.assertTrue(all(len(p["it"].split()) > 1 for p in got))

    def test_pads_with_single_words_to_five(self):
        got = L.pick_phrases(self.pairs(2, 6))
        self.assertEqual(len(got), 5)
        self.assertEqual(sum(len(p["it"].split()) > 1 for p in got), 2)

    def test_fewer_than_five_is_none(self):
        self.assertIsNone(L.pick_phrases(self.pairs(2, 2)))
        self.assertIsNone(L.pick_phrases([{"it": "a b", "en": ""}] * 9))


class RouteTest(Base):
    def setUp(self):
        super().setUp()
        self.calls = []

        def submit(d):
            self.calls.append(d)
            jid = "job%d" % len(self.calls)
            L.JOBS[jid] = {"id": jid, "status": "queued", "slug": "chiron-pimsleur-un-modulo", "extra": d["extra"]}
            return {"job_id": jid, "slug": "chiron-pimsleur-un-modulo", "status": "queued"}
        P.SUBMIT, P.JOBS, P.ORIGIN_OK = submit, L.JOBS, None
        P.mac_warning = lambda: None
        app = FastAPI(); app.include_router(L.router)
        self.c = TestClient(app)
        self.added = []
        orig_add = anki.add_notes

        def fake_add(cards, deck=None, tags=None, model=None):
            self.added.append((cards, deck, tags))
            self.fa.notes["tag:" + tags[0]] = list(range(len(cards)))
            return {"ok": True, "added": len(cards), "of": len(cards), "deck": deck}
        anki.add_notes = fake_add
        self.addCleanup(setattr, anki, "add_notes", orig_add)

    def test_status_endpoint_and_links(self):
        self.fa.notes = {"tag:lesson:chiron-italian-un-modulo": [1]}
        r = self.c.get("/api/lesson-status/chiron-italian-un-modulo").json()
        self.assertEqual(r["anki"]["status"], "cards")
        self.assertTrue(r["mm"]["links"]["phone"].startswith("matchmadness://anki-lesson?deck="))
        self.assertIn("newest=20", r["mm"]["links"]["phone"])
        self.assertIn("flavour=anki-lesson", r["mm"]["links"]["web_query"])
        self.assertEqual(self.c.get("/api/lesson-status/nope").status_code, 404)

    def test_no_mm_links_without_cards(self):
        r = self.c.get("/api/lesson-status/chiron-italian-un-modulo").json()
        self.assertIsNone(r["mm"]["links"])

    def test_listing_only_italian(self):
        make_lesson("chiron-med-x", domain="medicine")
        r = self.c.get("/api/lesson-status").json()
        self.assertEqual([x["key"] for x in r["lessons"]], ["chiron-italian-un-modulo"])

    def test_anki_post_adds_once(self):
        r = self.c.post("/api/lesson/chiron-italian-un-modulo/anki").json()
        self.assertEqual((r["added"], r["existing"]), (len(PAIRS), False))
        cards, deck, tags = self.added[0]
        self.assertEqual((deck, tags), ("Chiron::Lezioni::Un modulo", ["lesson:chiron-italian-un-modulo"]))
        r2 = self.c.post("/api/lesson/chiron-italian-un-modulo/anki").json()
        self.assertEqual((r2["added"], r2["existing"]), (0, True))
        self.assertEqual(len(self.added), 1)

    def test_anki_post_unreachable_adds_nothing(self):
        self.fa.down = True
        r = self.c.post("/api/lesson/chiron-italian-un-modulo/anki")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(self.added, [])

    def test_pimsleur_dry_starts_nothing(self):
        r = self.c.post("/api/lesson/chiron-italian-un-modulo/pimsleur", json={"confirm": True, "dry": True}).json()
        self.assertTrue(r["dry"])
        self.assertTrue(5 <= len(r["phrases"]) <= 10)
        self.assertEqual(self.calls, [])

    def test_pimsleur_needs_confirm(self):
        self.assertEqual(self.c.post("/api/lesson/chiron-italian-un-modulo/pimsleur", json={}).status_code, 400)
        self.assertEqual(self.calls, [])

    def test_pimsleur_once_then_duplicate(self):
        r = self.c.post("/api/lesson/chiron-italian-un-modulo/pimsleur", json={"confirm": True}).json()
        self.assertEqual(r["duplicate"], False)
        self.assertEqual(self.calls[0]["extra"]["source_lesson"], "chiron-italian-un-modulo")
        self.assertEqual(self.calls[0]["subject"], "Un modulo")
        self.assertEqual(L.get_links("chiron-italian-un-modulo")["pimsleur"]["job_id"], "job1")
        r2 = self.c.post("/api/lesson/chiron-italian-un-modulo/pimsleur", json={"confirm": True}).json()
        self.assertTrue(r2["duplicate"])
        self.assertEqual(len(self.calls), 1)

    def test_pimsleur_too_few_pairs_is_422(self):
        make_lesson("chiron-italian-poco", html=lesson_html(PAIRS[:3])); L.italian_lessons(force=True)
        r = self.c.post("/api/lesson/chiron-italian-poco/pimsleur", json={"confirm": True})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(self.calls, [])

    def test_origin_guard(self):
        L.ORIGIN_OK = lambda request: False
        self.addCleanup(setattr, L, "ORIGIN_OK", None)
        self.assertEqual(self.c.post("/api/lesson/chiron-italian-un-modulo/anki").status_code, 403)
        self.assertEqual(self.c.post("/api/lesson/chiron-italian-un-modulo/pimsleur", json={"confirm": True}).status_code, 403)

    def test_nested_slug_form(self):
        make_lesson("chiron-medicina-italiana/grammatica/x", domain="medical-italian")
        (GEN / "chiron-library").mkdir(exist_ok=True)
        (GEN / "chiron-library" / "library.index.json").write_text(json.dumps(
            {"lessons": [{"id": "chiron-medicina-italiana/grammatica/x", "domain": "medical-italian", "title": "X"}]}))
        L.italian_lessons(force=True)
        self.assertEqual(self.c.get("/api/lesson-status/chiron-medicina-italiana~grammatica~x").status_code, 200)


class InjectionTest(Base):
    def test_is_italian(self):
        make_lesson("chiron-med-x", domain="medicine")
        L.italian_lessons(force=True)
        self.assertTrue(L.is_italian("chiron-italian-un-modulo"))
        self.assertFalse(L.is_italian("chiron-med-x"))

    def test_serve_handler_injects_only_for_italian(self):
        os.environ["CHIRON_SKILL"] = str(Path(__file__).resolve().parent.parent)
        os.environ["CHIRON_GEN"] = str(GEN)
        saved = {(m, n): getattr(m, n) for m, n in [(P, "SUBMIT"), (P, "JOBS"), (P, "ORIGIN_OK"), (R, "GENERATE"), (L, "JOBS"), (L, "ORIGIN_OK")]}
        self.addCleanup(lambda: [setattr(m, n, v) for (m, n), v in saved.items()])
        self.addCleanup(os.environ.pop, "CHIRON_GEN", None)
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("chiron_server_app", os.environ["CHIRON_SKILL"] + "/server/app.py")
            A = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(A)
        except Exception as e:      # the full server needs its optional dependencies
            self.skipTest(f"app.py not importable here: {type(e).__name__}: {e}")
        make_lesson("chiron-med-x", domain="medicine")
        L.italian_lessons(force=True)
        c = TestClient(A.app)
        self.assertIn("lesson-actions.js", c.get("/lessons/chiron-italian-un-modulo/lesson.html").text)
        self.assertNotIn("lesson-actions.js", c.get("/lessons/chiron-med-x/lesson.html").text)


if __name__ == "__main__":
    unittest.main()
