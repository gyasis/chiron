"""pool_test — Pool backend with Anki / OmniVoice / the model all mocked. Never touches the live Anki.
Run: ~/miniconda3/bin/python tests/pool_test.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import anki  # noqa: E402
import pool as P  # noqa: E402


def note(model, nid=1, tags=None, **fields):
    return {"noteId": nid, "modelName": model, "tags": tags or [],
            "fields": {k: {"value": v, "order": i} for i, (k, v) in enumerate(fields.items())}}


class FieldMap(unittest.TestCase):
    def test_hirasawa(self):
        x = P.extract(note("hirasawa_yui-9e1ef", audio="[sound:a.mp3]", sentence="Il paziente dorme.",
                           **{"english translation": "The patient sleeps.", "frequency ranks": "[ 5 900 22 ]"}))
        self.assertEqual((x["it"], x["en"], x["audio"], x["difficulty"]), ("Il paziente dorme.", "The patient sleeps.", "a.mp3", 900))

    def test_basic_a8344_audio_in_front(self):
        x = P.extract(note("Basic-a8344", Front="[sound:b.mp3]", sentence="Tom guida.", translation="Tom drives."))
        self.assertEqual((x["it"], x["audio"]), ("Tom guida.", "b.mp3"))

    def test_subs2srs_swapped_fields(self):          # Reading = Italian, Meaning = English
        x = P.extract(note("subs2srs", Audio="[sound:c.mp3]", Expression="", Meaning="Yes but gross.", Reading="Sì ma fa schifo."))
        self.assertEqual((x["it"], x["en"]), ("Sì ma fa schifo.", "Yes but gross."))

    def test_neri_br_and_no_audio(self):
        n = note("0 Neri's Sentences (Read)", Sentence="Ciao a tutti. <br> Ciao.", **{"Sentence (English)": "Hi all.", "[1]": "[sound:n.mp3]"})
        self.assertEqual(P.extract(n)["it"], "Ciao a tutti. / Ciao.")
        n["fields"]["[1]"]["value"] = ""
        self.assertIsNone(P.extract(n))              # a listening drill needs audio

    def test_basic_front_italian_vs_pimsleur_back_italian(self):
        a = P.extract(note("Basic (and reversed card)", Front="Da quanto abiti qui? [sound:d.mp3]", Back="How long?<br><i>teacher note</i>"))
        self.assertEqual((a["it"], a["en"]), ("Da quanto abiti qui?", "How long?"))
        b = P.extract(note("Basic", Front="Do you think it works?", Back="Pensa che funzioni? [sound:e.mp3]"))
        self.assertEqual((b["it"], b["en"], b["audio"]), ("Pensa che funzioni?", "Do you think it works?", "e.mp3"))
        self.assertIsNone(P.extract(note("Basic", Front="rule", Back="no sound")))

    def test_unmapped_model_and_ascolto(self):
        self.assertIsNone(P.extract(note("Chiron Produzione", Audio="[sound:z.mp3]")))
        x = P.extract(note(anki.LISTEN_MODEL, Audio="[sound:f.mp3]", Italiano="Buongiorno a tutti.", English="Good morning all."))
        self.assertEqual(x["audio"], "f.mp3")


class PickCard(unittest.TestCase):
    def cards(self, q0, q1):
        return [{"ord": 0, "cardId": 10, "note": 1, "question": q0}, {"ord": 1, "cardId": 11, "note": 1, "question": q1}]

    def test_audio_on_front_picks_ord0(self):
        c = P.pick_audio_card(self.cards("Da quanto abiti qui? [sound:d.mp3]", "How long?"), "d.mp3")
        self.assertEqual(c["cardId"], 10)

    def test_pimsleur_audio_on_back_picks_ord1(self):
        c = P.pick_audio_card(self.cards("Do you think it works?", "Pensa che funzioni? [sound:e.mp3]"), "e.mp3")
        self.assertEqual(c["cardId"], 11)

    def test_no_question_info_falls_back_to_lowest_ord(self):
        self.assertEqual(P.pick_audio_card(self.cards("", ""), "e.mp3")["cardId"], 10)
        self.assertIsNone(P.pick_audio_card([], "e.mp3"))


class Matching(unittest.TestCase):
    def test_whole_word_not_substring(self):
        self.assertEqual(P.match_kind("consenso", "Il consenso deve essere libero."), "exact")
        self.assertIsNone(P.match_kind("sentire", "Il consensus resta."))
        self.assertIsNone(P.match_kind("tomo", "Il tomografo non va."))        # substring only

    def test_accent_and_case_folded(self):
        self.assertEqual(P.match_kind("perché", "PERCHE non vieni?"), "exact")
        self.assertEqual(P.match_kind("città", "La città è bella."), "exact")

    def test_simple_inflection_stem(self):
        self.assertEqual(P.match_kind("paziente", "I pazienti aspettano qui."), "stem")
        self.assertEqual(P.match_kind("ricetta", "Ho scritto due ricette."), "stem")
        self.assertEqual(P.match_kind("firmare", "Ha firmato il modulo."), "stem")
        self.assertIsNone(P.match_kind("casa", "Il casello è chiuso."))        # stem too short -> exact only

    def test_multiword(self):
        self.assertEqual(P.match_kind("consenso informato", "Serve il consenso informato scritto."), "exact")
        self.assertIsNone(P.match_kind("consenso informato", "Il consenso è dato, informato no."))

    def test_rank_exact_first_then_short(self):
        self.assertLess(P.rank_key("exact", 12, 999), P.rank_key("stem", 3, 1))
        self.assertLess(P.rank_key("exact", 4, 500), P.rank_key("exact", 12, 1))
        self.assertLess(P.rank_key("exact", 5, 10), P.rank_key("exact", 5, 99))

    def test_query_uses_typed_spelling_stem(self):
        self.assertIn('"ricett"', P.anki_query("ricetta"))
        self.assertIn('"citt"', P.anki_query("città"))


class Weak(unittest.TestCase):
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.p = [mock.patch.object(P, "WEAK_F", d / "weak.json"), mock.patch.object(P, "GATHERED_F", d / "g.json"),
                  mock.patch.object(P, "WORDS_F", d / "w.json")]
        [p.start() for p in self.p]
        self.addCleanup(lambda: [p.stop() for p in self.p])

    def test_rank_merge_exclude_mastered(self):
        P.merge_weak("phone", [{"it": "ricetta", "wrong": 1, "hesitations": 1}, {"it": "paziente", "wrong": 3},
                               {"it": "farmaco", "wrong": 9, "mastered": True}, {"it": "dolore", "wrong": 0, "hesitations": 2},
                               {"it": "pulita", "wrong": 0, "seen": 4}])
        self.assertEqual([w["it"] for w in P.weak_ranked()], ["paziente", "ricetta", "dolore"])   # 6, 3, 2
        self.assertNotIn("pulita", P._load(P.WEAK_F))          # a clean word creates no entry
        self.assertEqual(P.merge_weak("phone", [{"it": "dolore", "wrong": 5, "en": "pain"}, {"it": " "}])["stored"], 1)
        top = P.weak_ranked(1)[0]
        self.assertEqual((top["it"], top["en"], top["device"], top["hesitations"]), ("dolore", "pain", "phone", 2))

    def test_deltas_accumulate_clean_pass_keeps_misses(self):
        P.merge_weak("d", [{"it": "uno", "wrong": 3, "seen": 3}], batch="b1")
        P.merge_weak("d", [{"it": "uno", "wrong": 0, "hesitations": 0, "seen": 5}], batch="b2")
        P.merge_weak("d", [{"it": "uno", "wrong": 1, "hesitations": 2, "seen": 1}], batch="b3")
        w = P._load(P.WEAK_F)["uno"]
        self.assertEqual((w["wrong"], w["hesitations"], w["seen"]), (4, 2, 9))

    def test_duplicate_batch_is_noop(self):
        self.assertEqual(P.merge_weak("d", [{"it": "uno", "wrong": 2}], batch="x")["stored"], 1)
        r = P.merge_weak("d", [{"it": "uno", "wrong": 2}], batch="x")
        self.assertEqual(r, {"ok": True, "stored": 0, "duplicate": True})
        self.assertEqual(P._load(P.WEAK_F)["uno"]["wrong"], 2)
        P.merge_weak("d", [{"it": "uno", "wrong": 1}])             # no batch id (old client) still merges
        self.assertEqual(P._load(P.WEAK_F)["uno"]["wrong"], 3)

    def test_batch_ids_bounded(self):
        for i in range(P.BATCH_KEEP + 20):
            P.merge_weak("d", [{"it": "uno", "wrong": 1}], batch=f"b{i}")
        ids = P._load(P._batches_file())["ids"]
        self.assertEqual((len(ids), ids[-1]), (P.BATCH_KEEP, f"b{P.BATCH_KEEP + 19}"))

    def test_mastered_flag_excludes_existing(self):
        P.merge_weak("d", [{"it": "uno", "wrong": 2}])
        P.merge_weak("d", [{"it": "uno", "mastered": True}])
        self.assertEqual(P.weak_ranked(), [])

    def test_ties_recent_first(self):
        with mock.patch.object(P.time, "time", return_value=100.0):
            P.merge_weak("d", [{"it": "uno", "wrong": 1}])
        with mock.patch.object(P.time, "time", return_value=200.0):
            P.merge_weak("d", [{"it": "due", "wrong": 1}])
        self.assertEqual([w["it"] for w in P.weak_ranked()], ["due", "uno"])


class Gather(unittest.TestCase):
    """cap / more de-dup with every external piece mocked."""

    def setUp(self):
        d = Path(tempfile.mkdtemp())
        for n in ("WEAK_F", "GATHERED_F", "WORDS_F", "LESSON_NOTES_F"):
            p = mock.patch.object(P, n, d / (n + ".json")); p.start(); self.addCleanup(p.stop)
        p = mock.patch.object(P, "LISTEN_INDEX", d / "none.json"); p.start(); self.addCleanup(p.stop)   # never the real index
        self.cands = [{"id": f"id{i}", "it": f"Questo e il paziente numero {i}.", "en": f"en{i}", "audio": f"a{i}.mp3",
                       "noteId": 100 + i, "tags": [], "kind": "exact", "key": (0, 0, i, 5), "difficulty": i} for i in range(8)]

        def anki_cands(word, exclude):
            return [c for c in self.cands if c["id"] not in exclude]

        def finish(c, word, tag):
            return [{"id": x["id"], "it": x["it"], "en": x["en"], "audio": x["audio"], "source": "anki", "label": "Anki",
                     "deck": "D", "cardId": x["noteId"] + 1000, "noteId": x["noteId"], "match": "exact"} for x in c]
        self.tagged = []
        for t, v in [("anki_candidates", anki_cands), ("finish_anki", finish),
                     ("baby_candidates", lambda w, e: []), ("mm_candidates", lambda w, e: []),
                     ("generate", mock.Mock(return_value=[]))]:
            p = mock.patch.object(P, t, v); p.start(); self.addCleanup(p.stop)
        p = mock.patch.object(P.voice, "say", return_value="w.mp3"); p.start(); self.addCleanup(p.stop)
        p = mock.patch.object(P, "word_en", return_value="patient"); p.start(); self.addCleanup(p.stop)

    def test_cap_default_and_more_never_repeats(self):
        a = P.gather_word({"it": "paziente"}, 5)
        self.assertEqual(len(a["sentences"]), 5)
        b = P.gather_word({"it": "paziente"}, 5, more=True)
        self.assertEqual(len(b["sentences"]), 3)                       # only 8 exist
        ids = [s["id"] for s in a["sentences"] + b["sentences"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(b["short"], 2)
        c = P.gather_word({"it": "paziente"}, 5, more=True)
        self.assertEqual(c["sentences"], [])                           # exhausted, never a repeat

    def test_fresh_gather_restarts(self):
        P.gather_word({"it": "paziente"}, 5)
        P.gather_word({"it": "paziente"}, 5, more=True)
        again = P.gather_word({"it": "paziente"}, 5)
        self.assertEqual([s["id"] for s in again["sentences"]], [f"id{i}" for i in range(5)])

    def test_falls_through_to_generation_only_when_short(self):
        gen = [{"it": "Il paziente sta bene oggi.", "en": "The patient is fine today.", "id": "g1", "kind": "exact"}]
        with mock.patch.object(P, "generate", return_value=gen) as g, \
             mock.patch.object(P, "make_note", return_value=(7, 8)), mock.patch.object(P.voice, "pick", return_value=("v", 1.0)):
            full = P.gather_word({"it": "paziente"}, 5)
            self.assertFalse(g.called)                                  # Anki satisfied the cap: no create, no LLM
            self.cands = self.cands[:4]
            part = P.gather_word({"it": "paziente"}, 5)
        self.assertEqual([s["source"] for s in part["sentences"]], ["anki"] * 4 + ["gen"])
        self.assertEqual(part["sources"]["gen"], 1)
        self.assertEqual(part["sentences"][-1]["cardId"], 8)

    def test_model_down_returns_partial_not_503(self):
        self.cands = self.cands[:2]
        down = P.HTTPException(503, "language model unavailable: gateway 400")
        with mock.patch.object(P, "generate", side_effect=down):
            r = P.gather_word({"it": "paziente"}, 5)
        self.assertEqual(len(r["sentences"]), 2)
        self.assertEqual(r["short"], 3)
        self.assertIn("generation unavailable", r["warnings"][0])

    def test_dry_creates_nothing(self):
        with mock.patch.object(P, "make_note") as mk, mock.patch.object(P, "cut_clip") as cc:
            r = P.gather_word({"it": "paziente"}, 5, dry=True)
        self.assertFalse(mk.called or cc.called or P.voice.say.called)
        self.assertIsNone(r["word"]["audio"])


def _card(it, en, source="pimsleur", kind="sentence", lesson="verbi-1", title="Verbi irregolari", tags=("Verb foundation",), **x):
    return {"id": "h" + str(abs(hash(it)))[:6], "it": it, "en": en, "kind": kind, "source": source, "lesson": lesson,
            "lesson_title": title, "tags": list(tags), **x}


class LessonCards(unittest.TestCase):
    """listening.index.json -> lesson-first ranking in gather, and GET /api/pool/lesson."""

    def setUp(self):
        d = Path(tempfile.mkdtemp())
        for n in ("WEAK_F", "GATHERED_F", "WORDS_F", "LESSON_NOTES_F"):
            p = mock.patch.object(P, n, d / (n + ".json")); p.start(); self.addCleanup(p.stop)
        cards = [_card("Ho detto la verità.", "I told the truth."),
                 _card("Ieri sono andato al mercato con mia madre.", "Yesterday I went to the market with my mother.", source="script"),
                 _card("Ho già detto tutto al medico stamattina.", "I already told the doctor everything this morning.", source="vocab"),
                 _card("andato", "gone", kind="word", source="flashcard"),
                 _card("io vado", "I go", kind="phrase", source="flashcard"),
                 _card("Il consenso è libero.", "Consent is free.", lesson="ordine-1", title="Ordine: consenso", tags=("Ordine exam",),
                       source="vocab"),
                 _card("fatto", "done", kind="word", example_it="Ho fatto colazione alle sette.", example_en="I had breakfast at seven.",
                       lesson="verbi-1", source="flashcard")]
        (d / "idx.json").write_text(json.dumps({"lessons": {
            "verbi-1": {"count": 6, "title": "Verbi irregolari", "tags": ["Verb foundation", "language-it"]},
            "ordine-1": {"count": 1, "title": "Ordine: consenso", "tags": ["Ordine exam"]}}, "cards": cards}))
        p = mock.patch.object(P, "LISTEN_INDEX", d / "idx.json"); p.start(); self.addCleanup(p.stop)
        P._li["mtime"] = None
        self.say = mock.patch.object(P.voice, "say", side_effect=lambda t, v="x", sp=1.0: "a_" + str(len(t)) + ".mp3"); self.say.start()
        self.addCleanup(self.say.stop)
        self.mk = mock.patch.object(P, "make_note", side_effect=lambda *a, **k: (500 + len(a[0]), 900 + len(a[0]))); self.mk.start()
        self.addCleanup(self.mk.stop)
        p = mock.patch.object(P.voice, "pick", return_value=("v", 1.0)); p.start(); self.addCleanup(p.stop)
        p = mock.patch.object(P, "word_en", return_value="x"); p.start(); self.addCleanup(p.stop)     # never a real model call

    def test_candidates_exact_then_rank_and_no_words_as_sentences(self):
        c = P.lesson_candidates("ho detto", set())
        self.assertEqual([x["it"] for x in c], ["Ho detto la verità."])        # "ho già detto" is not the phrase "ho detto"
        self.assertEqual(c[0]["kind"], "exact")
        a = P.lesson_candidates("andato", set())
        self.assertEqual([x["it"] for x in a], ["Ieri sono andato al mercato con mia madre."])   # the bare word card is not a sentence
        self.assertEqual(P.lesson_candidates("andato", {a[0]["id"]}), [])                          # exclude honoured
        f = P.lesson_candidates("fatto", set())                                                     # example pair becomes a sentence
        self.assertEqual([x["it"] for x in f], ["Ho fatto colazione alle sette."])

    def test_pimsleur_before_script_among_equals(self):
        a = _card("Ho preso il caffè al bar con te.", "x", source="script")
        b = _card("Ho preso il caffè al bar con lui.", "y", source="pimsleur")
        with mock.patch.dict(P._li, {"mtime": P._li["mtime"], "sents": [a, b]}):
            with mock.patch.object(P, "listen_index", return_value={}):
                self.assertEqual([x["source"] for x in P.lesson_candidates("caffè", set())], ["pimsleur", "script"])

    def test_gather_puts_lesson_before_anki_and_creates_in_lezioni_deck(self):
        anki_c = [{"id": "ak1", "it": "Ho detto di no a tutti.", "en": "I said no.", "audio": "z.mp3", "noteId": 1, "tags": [],
                   "kind": "exact", "key": (0, 0, 1, 5), "difficulty": 1}]
        fin = lambda c, w, tag: [{"id": x["id"], "it": x["it"], "en": x["en"], "audio": "z.mp3", "source": "anki", "label": "Anki",
                                  "deck": "D", "cardId": 77, "noteId": 1, "match": "exact"} for x in c]
        with mock.patch.object(P, "anki_candidates", return_value=anki_c) as ac, mock.patch.object(P, "finish_anki", side_effect=fin), \
             mock.patch.object(P, "baby_candidates", return_value=[]), mock.patch.object(P, "mm_candidates", return_value=[]), \
             mock.patch.object(P, "generate", return_value=[]):
            r = P.gather_word({"it": "ho detto"}, 3)
        src = [s["source"] for s in r["sentences"]]
        self.assertEqual(src[0], "lesson")                                  # lesson sentence ranked before Anki
        self.assertEqual(src.index("anki"), src.index("lesson") + len([x for x in src if x == "lesson"]))
        self.assertEqual(r["sources"]["lesson"], src.count("lesson"))
        kw = P.make_note.call_args.kwargs
        self.assertEqual(kw["deck"], "Chiron::Lezioni::Verbi irregolari")
        self.assertIn("pool::tag::verb-foundation", kw["extra_tags"])
        self.assertEqual(P.make_note.call_args.args[4], "lesson")
        self.assertEqual(r["sentences"][0]["deck"], "Chiron::Lezioni::Verbi irregolari")
        self.assertTrue(r["sentences"][0]["label"].startswith("Lezione · "))
        self.assertEqual(ac.call_args.args[1] & {s["id"] for s in r["sentences"] if s["source"] == "lesson"},
                         {s["id"] for s in r["sentences"] if s["source"] == "lesson"})   # Anki is told what lesson already gave

    def test_lesson_full_cap_skips_anki_entirely(self):
        with mock.patch.object(P, "anki_candidates") as ac:
            r = P.gather_word({"it": "detto"}, 2)
        self.assertEqual(len(r["sentences"]), 2)
        self.assertFalse(ac.called)

    def test_note_made_once_per_card(self):
        P.gather_word({"it": "ho detto"}, 1)
        P.gather_word({"it": "ho detto"}, 1)
        self.assertEqual(P.make_note.call_count, 1)                           # second time: remembered in lesson_notes.json

    def test_dry_creates_nothing(self):
        with mock.patch.object(P, "anki_candidates", return_value=[]):
            r = P.gather_word({"it": "ho detto"}, 3, dry=True)
        self.assertFalse(P.make_note.called or P.voice.say.called)
        self.assertEqual((r["sentences"][0]["source"], r["sentences"][0]["cardId"]), ("lesson", None))

    def test_lesson_endpoint_shape(self):
        r = P.lesson_cards("verbi-1", None, 3, 0, False)
        self.assertEqual(r["lesson"]["title"], "Verbi irregolari")
        self.assertEqual(r["lesson"]["deck"], "Chiron::Lezioni::Verbi irregolari")
        self.assertEqual((r["total"], r["offset"], r["next"], r["dry"]), (6, 0, 3, False))
        s = r["sentences"][0]
        self.assertEqual(set(s) >= {"id", "it", "en", "audio", "source", "label", "deck", "cardId", "noteId", "match"}, True)
        self.assertEqual((s["source"], s["it"], s["lesson"]), ("lesson", "Ho detto la verità.", "verbi-1"))   # pimsleur sentence first
        self.assertEqual([x["kind"] for x in r["sentences"]].count("word"), 0)           # words sort after phrases/sentences
        last = P.lesson_cards("verbi-1", None, 3, 3, True)
        self.assertIsNone(last["next"])
        self.assertTrue(all(x["cardId"] is None for x in last["sentences"]))           # dry: no audio, no notes

    def test_lesson_endpoint_uses_lucrezia(self):
        P.lesson_cards("verbi-1", None, 1, 0, False)
        self.assertEqual(P.voice.say.call_args.args[1:], (P.voice.DEFAULT_VOICE, 1.0))

    def test_lesson_endpoint_focus_flat_slug_and_errors(self):
        self.assertEqual(P.lesson_cards(None, "ordine EXAM", 5, 0, True)["total"], 1)
        self.assertEqual(P.lesson_cards("verbi-1", None, 1, 0, True)["lesson"]["id"], "verbi-1")
        with self.assertRaises(P.HTTPException) as e:
            P.lesson_cards("nope", None, 5, 0, True)
        self.assertEqual(e.exception.status_code, 404)
        with self.assertRaises(P.HTTPException) as e:
            P.lesson_cards(None, None, 5, 0, True)
        self.assertEqual(e.exception.status_code, 400)
        with self.assertRaises(P.HTTPException) as e:
            P.lesson_cards(None, "no such tag", 5, 0, True)
        self.assertEqual(e.exception.status_code, 404)

    def test_nested_lesson_found_by_flat_slug(self):
        idx = json.loads(P.LISTEN_INDEX.read_text())
        idx["lessons"]["a/b/c"] = {"count": 1, "title": "Nested", "tags": []}
        idx["cards"].append(_card("Ciao a tutti voi.", "Hello all.", lesson="a/b/c", title="Nested", tags=()))
        P.LISTEN_INDEX.write_text(json.dumps(idx))
        self.assertEqual(P.lesson_cards("a-b-c", None, 5, 0, True)["lesson"]["id"], "a/b/c")

    def test_unreadable_index_is_a_warning_not_a_failed_gather(self):
        P.LISTEN_INDEX.write_text("{not json")
        P._li["mtime"] = None
        with mock.patch.object(P, "anki_candidates", return_value=[]), mock.patch.object(P, "baby_candidates", return_value=[]), \
             mock.patch.object(P, "mm_candidates", return_value=[]), mock.patch.object(P, "generate", return_value=[]):
            r = P.gather_word({"it": "ho detto"}, 3)
        self.assertTrue(any("lesson cards unavailable" in w for w in r["warnings"]))


class PickAudioCardTemplateTest(unittest.TestCase):
    """The live AnkiConnect `question` has no [sound:] (checked 2026-10-17): the card
    must come from the note-type template that shows the audio field."""

    def test_template_decides_the_card(self):
        cards = [{"cardId": 10, "ord": 0, "question": "<div>Hello</div>"},
                 {"cardId": 11, "ord": 1, "question": "<div>Ciao</div>"}]
        tmpl = ["{{Front}}", "{{Back}}"]
        back = {"fields": {"Front": {"value": "Hello"}, "Back": {"value": "Ciao [sound:x.mp3]"}}}
        front = {"fields": {"Front": {"value": "Ciao [sound:x.mp3]"}, "Back": {"value": "Hello"}}}
        self.assertEqual(P.pick_audio_card(cards, "x.mp3", back, tmpl)["cardId"], 11)
        self.assertEqual(P.pick_audio_card(cards, "x.mp3", front, tmpl)["cardId"], 10)
        self.assertEqual(P.pick_audio_card(cards, "x.mp3")["cardId"], 10)


if __name__ == "__main__":
    unittest.main(verbosity=2)
