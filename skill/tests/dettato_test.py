"""dettato_test — the dictation page's pure parts (no network: no whisper or model calls).
Run: python3 skill/tests/dettato_test.py"""
import json, os, sys, tempfile, unittest, unittest.mock
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


class Effort(unittest.TestCase):
    def test_slow_replays_weigh_more(self):
        self.assertEqual(dt.listens(2, 2), 5.0)

    def test_difficulty_uses_replays_not_just_score(self):
        self.assertEqual(dt.difficulty(100, 1, 0), "facile")
        self.assertEqual(dt.difficulty(100, 4, 0), "media")
        self.assertEqual(dt.difficulty(100, 10, 0), "difficile")
        self.assertEqual(dt.difficulty(40, 8, 2), "molto difficile")

    def test_anki_ease(self):
        self.assertEqual(dt.anki_ease(100, 1, 0), 4)    # right first time: Easy
        self.assertEqual(dt.anki_ease(100, 4, 0), 3)    # right after a few listens: Good
        self.assertEqual(dt.anki_ease(100, 10, 0), 2)   # right only after ten: Hard
        self.assertEqual(dt.anki_ease(50, 1, 0), 1)     # wrong: Again

    def test_hardest_ranks_by_mean_listens(self):
        with tempfile.TemporaryDirectory() as d:
            rows = lambda l4, l7: {"rows": [
                {"n": 4, "it": "a", "listens": l4, "check": {"score": 100}},
                {"n": 7, "it": "b", "listens": l7, "check": {"score": 60}}]}
            Path(d, "1.json").write_text(json.dumps(rows(2, 9)))
            Path(d, "2.json").write_text(json.dumps(rows(1, 7)))
            h = dt.hardest(Path(d))
            self.assertEqual([x["n"] for x in h], [7, 4])
            self.assertEqual(h[0]["listens"], 8.0)
            self.assertEqual(h[0]["tries"], 2)


class AnkiLine(unittest.TestCase):
    def card(self, model, fields, ord_=0):
        return {"cardId": 11, "note": 5, "ord": ord_, "modelName": model,
                "fields": {k: {"value": v} for k, v in fields.items()}}

    def test_listen_model(self):
        import anki
        ln = dt._anki_line(self.card(anki.LISTEN_MODEL, {"Audio": "[sound:x.mp3]", "Italiano": "Ho prescritto",
                                                          "English": "I prescribed", "Note": ""}))
        self.assertEqual((ln["it"], ln["en"], ln["audio"]), ("Ho prescritto", "I prescribed", "x.mp3"))

    def test_basic_with_audio_in_front(self):
        ln = dt._anki_line(self.card("Basic", {"Front": "Dove sei? [sound:y.mp3]", "Back": "Where are you?"}))
        self.assertEqual((ln["it"], ln["audio"]), ("Dove sei?", "y.mp3"))

    def test_no_audio_or_reversed_is_skipped(self):
        self.assertIsNone(dt._anki_line(self.card("Basic", {"Front": "Ciao", "Back": "Hi"})))
        self.assertIsNone(dt._anki_line(self.card("Basic", {"Front": "Ciao [sound:z.mp3]", "Back": "Hi"}, ord_=1)))


class AnkiJudge(unittest.TestCase):
    """The Anki path end to end with Anki and the model faked: reference text from the server, ease written back."""
    def test_writes_ease_from_score_and_replays(self):
        import asyncio, anki
        from unittest import mock
        card = {"cardId": 77, "note": 9, "ord": 0, "modelName": anki.LISTEN_MODEL,
                "fields": {"Audio": {"value": "[sound:a.mp3]"}, "Italiano": {"value": "Dove sei?"},
                           "English": {"value": "Where are you?"}, "Note": {"value": ""}}}
        sent = {}

        def fake_answer(reviews):
            sent["reviews"] = reviews
            return {"ok": True, "written": len(reviews), "of": len(reviews), "results": []}

        class Req:
            async def json(self):
                return {"deck": "chiron::Pool", "answers": [{"n": 1, "cardId": 77, "typed": "dove sei",
                                                              "plays": 9, "slow": 0, "it": "IGNORED client text"}]}
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(dt, "ANKI_DIR", Path(d)), mock.patch.object(dt, "REF", Path(d) / "r.json"), \
                mock.patch.object(dt, "ROOT", Path(d)), \
                mock.patch.object(anki, "invoke", lambda action, **kw: [card] if action == "cardsInfo" else []), \
                mock.patch.object(anki, "answer", fake_answer), \
                mock.patch.object(dt, "lucrezia", lambda user: {"summary": "ok", "lines": []}):
            r = asyncio.run(dt.judge(Req()))
        self.assertEqual(r["rows"][0]["it"], "Dove sei?")              # server text, not the client's
        self.assertEqual(r["rows"][0]["check"]["score"], 100)
        self.assertEqual(r["rows"][0]["difficulty"], "difficile")       # right, but after nine listens
        self.assertEqual(sent["reviews"], [{"cardId": 77, "ease": 2}])  # so Anki gets Hard, not Good


class VoicePending(unittest.TestCase):
    """verbal-check's pending list: which voice notes still need a lesson."""
    def setUp(self):
        import verbal_check as vc
        self.vc = vc
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.wa, self.out = d / "wa", d / "out"
        (self.wa / "audio").mkdir(parents=True)
        rows = [
            {"phone_file": "PTT-1-WA0001.opus", "seconds": 20.0, "paired": True, "day": "2026-11-06",
             "time": "1:07 PM", "from": " Marti", "file": "audio/2026-11-06_1307_Marti_WA0001.opus", "text": "Allora"},
            {"phone_file": "PTT-1-WA0002.opus", "seconds": 30.0, "paired": False, "file": "audio/unpaired/PTT-1-WA0002.opus"},
            {"phone_file": "PTT-1-WA0003.opus", "seconds": 1.5, "paired": True, "day": "2026-11-06", "time": "1:08 PM",
             "from": "Laura", "file": "audio/2026-11-06_1308_Laura_WA0003.opus"},
            {"phone_file": "PTT-1-WA0004.opus", "seconds": 40.0, "paired": True, "day": "2026-11-06", "time": "1:09 PM",
             "from": "Anna", "file": "audio/2026-11-06_1309_Anna_WA0004.opus"},
            {"phone_file": "PTT-1-WA0005.opus", "seconds": 40.0, "paired": True, "day": "2026-11-06", "time": "1:10 PM",
             "from": "Anna", "file": "audio/missing.opus"},
        ]
        (self.wa / "audio" / "unpaired").mkdir()
        for r in rows[:4]:
            (self.wa / r["file"]).write_bytes(b"x")
        (self.wa / "voice.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        built = self.out / "anything"          # WA0004 already has a lesson, under another slug
        built.mkdir(parents=True)
        (built / "dettato.json").write_text(json.dumps({"origin": {"phone_file": "PTT-1-WA0004.opus"}}))
        self.patch = unittest.mock.patch.object(vc.bd, "OUT", self.out)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_only_paired_long_unbuilt_on_disk(self):
        p = self.vc.pending(wa_dir=self.wa)
        self.assertEqual([n["phone_file"] for n in p], ["PTT-1-WA0001.opus"])
        self.assertEqual(p[0]["slug"], "wa-2026-11-06-1307-marti-wa0001")

    def test_unpaired_on_request(self):
        p = self.vc.pending(include_unpaired=True, wa_dir=self.wa)
        self.assertEqual([n["phone_file"] for n in p], ["PTT-1-WA0001.opus", "PTT-1-WA0002.opus"])

    def test_build_voice_passes_origin_and_clean_name(self):
        got = {}
        def fake_build(audio, title, speaker, context, slug, origin=None):
            got.update(title=title, speaker=speaker, slug=slug, origin=origin)
            return {"slug": slug}
        with unittest.mock.patch.object(self.vc.bd, "build", fake_build):
            self.vc.build_voice(self.vc.pending(wa_dir=self.wa)[0])
        self.assertEqual(got["speaker"], "Marti")
        self.assertEqual(got["title"], "Marti, 2026-11-06 1:07 PM")
        self.assertEqual(got["origin"]["phone_file"], "PTT-1-WA0001.opus")


class BuildRoute(unittest.TestCase):
    """POST /api/dettato/build queues one build per note, runs it on the worker, reports done or the error."""
    def test_queue_runs_and_reports(self):
        import asyncio
        note = {"phone_file": "P1.opus", "slug": "wa-p1", "from": "Marti", "seconds": 9}
        bad = {"phone_file": "P2.opus", "slug": "wa-p2", "from": "Anna", "seconds": 9}

        def fake_build_voice(n):
            if n["slug"] == "wa-p2":
                raise dt.verbal_check.bd.BuildError("whisper down")
            return {"lines": [{"uncertain": False}, {"uncertain": True}]}

        class Req:
            def __init__(self, b): self.b = b
            async def json(self): return self.b
        dt.BUILD_JOBS.clear()
        with unittest.mock.patch.object(dt.verbal_check, "pending", lambda: [note, bad]), \
                unittest.mock.patch.object(dt.verbal_check, "build_voice", fake_build_voice):
            r = asyncio.run(dt.build_lessons(Req({"all": True})))
            self.assertEqual([j["slug"] for j in r["queued"]], ["wa-p1", "wa-p2"])
            dt._BUILD_Q.join()
            jobs = {j["slug"]: j for j in dt.build_jobs()["jobs"]}
        self.assertEqual((jobs["wa-p1"]["status"], jobs["wa-p1"]["lines"], jobs["wa-p1"]["uncertain"]), ("done", 2, 1))
        self.assertEqual(jobs["wa-p2"]["status"], "failed")
        self.assertIn("whisper down", jobs["wa-p2"]["error"])
        with unittest.mock.patch.object(dt.verbal_check, "pending", lambda: []):
            with self.assertRaises(dt.HTTPException):
                asyncio.run(dt.build_lessons(Req({"phone_file": "nope.opus"})))


if __name__ == "__main__":
    unittest.main()
