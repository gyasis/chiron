"""sessione_test — Sessione backend with Anki / OmniVoice / the model all mocked.
Run: python tests/sessione_test.py   (needs fastapi, e.g. ~/miniconda3/bin/python)"""
import os, sys, unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import anki  # noqa: E402
import sessione as S  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class Validate(unittest.TestCase):
    def good(self, **kw):
        d = {"situation_en": "Tell the patient you prescribed an antibiotic.",
             "word_bank": ["ho", "prescrivere", "antibiotico", "un", "dormire", "mangiare"],
             "verbs": [{"inf": "prescrivere", "form": "passato prossimo, io"}],
             "answer_it": "Ho prescritto un antibiotico.", "notes": "avere + participle"}
        d.update(kw)
        return d

    def test_ok_keeps_bank_members(self):
        v = S.validate_prod(self.good())
        self.assertEqual(sorted(v["word_bank"]), sorted(self.good()["word_bank"]))
        self.assertEqual(v["verbs"][0]["inf"], "prescrivere")

    def test_rejects_missing_answer_small_bank_nondict(self):
        self.assertIsNone(S.validate_prod(self.good(answer_it="")))
        self.assertIsNone(S.validate_prod(self.good(word_bank=["a", "b"])))
        self.assertIsNone(S.validate_prod("nope"))

    def test_bank_deduped_and_capped(self):
        v = S.validate_prod(self.good(word_bank=[f"w{i}" for i in range(12)] + ["w1"]))
        self.assertEqual(len(v["word_bank"]), 8)

    def test_quaderno(self):
        self.assertEqual(S.validate_quaderno({"it": " Ciao ", "en": "hi"})["it"], "Ciao")
        self.assertIsNone(S.validate_quaderno({"en": "hi"}))


def card(i, deck="Medical Italian", via=None):
    return {"cardId": i, "deck": deck, "front": f"f{i}", "back": "b", "score": 0.5}


class Search(unittest.TestCase):
    def test_dedup_scope_and_tags(self):
        sem = [card(1), card(2), card(3, deck="Spanish"), {**card(4), "score": 0.1}]
        lit = [card(2), card(5)]
        fake_cards = mock.Mock(relevant=mock.Mock(return_value=sem))
        with mock.patch.dict(sys.modules, {"cards": fake_cards}), \
             mock.patch.object(anki, "cards", return_value=lit), \
             mock.patch.object(anki, "notes_for_cards", return_value={1: {"noteId": 9, "tags": ["audio::it"]}}):
            out = S.search("antibiotico")
        self.assertEqual([c["cardId"] for c in out], [1, 2, 5])     # dedup, out-of-scope + low score dropped
        self.assertEqual(out[0]["tags"], ["audio::it"])
        self.assertEqual(out[1]["via"], "semantic")

    def test_literal_query_scopes_decks(self):
        q = S._lit_query("passato prossimo", ["Chiron"])
        self.assertIn('"deck:Chiron"', q)
        self.assertIn('"passato"', q)

    def test_empty_query(self):
        with self.assertRaises(ValueError):
            S.search("  ")


class AddNotes(unittest.TestCase):
    def run_add(self, cards, **kw):
        calls = []

        def inv(action, **p):
            calls.append((action, p))
            return {"canAddNotes": [True] * len(p.get("notes", [])),
                    "addNotes": list(range(100, 100 + len(p.get("notes", []))))}.get(action)
        with mock.patch.object(anki, "invoke", side_effect=inv):
            res = anki.add_notes(cards, **kw)
        return res, calls

    def test_basic_path_unchanged(self):
        res, calls = self.run_add([{"front": "ciao", "back": "hi"}], tags=["x"])
        n = next(p for a, p in calls if a == "addNotes")["notes"][0]
        self.assertEqual(n["modelName"], "Basic")
        self.assertEqual(n["fields"], {"Front": "ciao", "Back": "hi"})
        self.assertEqual(n["tags"], ["chiron", "x"])
        self.assertEqual(n["deckName"], "Chiron")
        self.assertEqual(res["added"], 1)

    def test_model_fields_mapping(self):
        res, calls = self.run_add([{"fields": {"Audio": "[sound:a.mp3]", "Italiano": "Ciao"}, "tags": ["t"]}],
                                  deck="D", tags=["s"], model=anki.LISTEN_MODEL)
        n = next(p for a, p in calls if a == "addNotes")["notes"][0]
        self.assertEqual(n["modelName"], "Chiron Ascolto")
        self.assertEqual(n["fields"]["Italiano"], "Ciao")
        self.assertEqual(n["tags"], ["chiron", "s", "t"])
        self.assertEqual(res["noteIds"], [100])

    def test_model_empty_fields_skipped(self):
        res, _ = self.run_add([{"fields": {"Audio": " "}}], model=anki.LISTEN_MODEL)
        self.assertEqual(res["added"], 0)

    def test_ensure_models_idempotent(self):
        calls = []
        have = {"v": ["Basic", "Chiron Ascolto"]}

        def inv(action, **p):
            calls.append((action, p.get("modelName")))
            return have["v"] if action == "modelNames" else None
        with mock.patch.object(anki, "invoke", side_effect=inv):
            r = anki.ensure_models()
        self.assertEqual(r["created"], ["Chiron Produzione"])
        self.assertEqual([c for c in calls if c[0] == "createModel"], [("createModel", "Chiron Produzione")])


class Tutor(unittest.TestCase):
    def route(self, intent, **extra):
        with mock.patch.object(S, "llm_json", side_effect=lambda s, u, st: (
                {"intent": intent, "topic": "passato prossimo", "n": 3, "focus": ""} if st == "tutor.intent"
                else {"sentences": ["Ho mangiato."], "answer": "Because."})), \
             mock.patch.object(S, "produce", return_value={"items": [], "anki": {}}) as p, \
             mock.patch.object(S, "quaderno", return_value={"items": [], "anki": {}}) as q, \
             mock.patch.object(S, "_post_json", return_value={"job_id": "j1", "lesson_url": "/l"}) as g:
            return S.tutor("x"), p, q, g

    def test_produce(self):
        r, p, q, g = self.route("produce")
        self.assertEqual(r["intent"], "produce")
        p.assert_called_once()
        self.assertEqual(p.call_args.kwargs["n"], 3)

    def test_listen_goes_through_quaderno(self):
        r, p, q, g = self.route("listen")
        self.assertEqual(q.call_args.args[0], ["Ho mangiato."])

    def test_lesson_posts_generate(self):
        r, p, q, g = self.route("lesson")
        self.assertTrue(g.call_args.args[0].endswith("/generate"))
        self.assertEqual(g.call_args.args[1], {"subject": "passato prossimo", "domain": "language-it"})
        self.assertEqual(r["job_id"], "j1")

    def test_explain_and_unknown_intent(self):
        self.assertEqual(self.route("explain")[0]["answer"], "Because.")
        self.assertEqual(self.route("banana")[0]["intent"], "explain")


class Produce(unittest.TestCase):
    def test_end_to_end_mocked(self):
        item = {"situation_en": "s", "word_bank": list("abcde"), "verbs": [], "answer_it": "Ciao.", "notes": "n"}
        res = {"noteIds": [7], "added": 1}
        with mock.patch.object(S, "llm_json", return_value={"items": [item, {"bad": 1}]}), \
             mock.patch.object(S.voice, "say", return_value="chiron_x.mp3"), \
             mock.patch.object(S.anki, "ensure_models"), \
             mock.patch.object(S.anki, "add_notes", return_value=res) as add, \
             mock.patch.object(S.anki, "invoke", return_value=[55]):
            out = S.produce("passato prossimo — pronto soccorso", n=2)
        self.assertEqual(out["anki"]["added"], 1)
        self.assertEqual(out["items"][0]["cardId"], 55)
        self.assertIn("passato-prossimo-pronto-soccorso", add.call_args.kwargs["tags"])

    def test_anki_down_is_503(self):
        with mock.patch.object(S, "produce", side_effect=anki.AnkiUnavailable("down")):
            with self.assertRaises(HTTPException) as c:
                S._guard("produce", S.produce, "x")
        self.assertEqual(c.exception.status_code, 503)


class LlmJsonChain(unittest.TestCase):
    def test_local_tags_go_local_chain_capped(self):
        import mock_oral as mo
        ex = {"local:a:1": {"model": "a:1", "local": True}, "local:b:2": {"model": "b:2", "local": True},
              "local:c:3": {"model": "c:3", "local": True}, "gemma4": {"model": "g", "local": False},
              "deepseek": {"model": "d", "local": False}}
        calls = []

        def fake(model, system, user, key, local=False, source=None):
            calls.append((model, local))
            raise RuntimeError("down")
        env = {"TUTOR_FALLBACKS": "governor:b:2,governor:c:3", "OLLAMA_API_KEY": "k"}
        with mock.patch.dict(mo.EXAMINERS, ex, clear=True), mock.patch.object(mo, "refresh_examiners"), \
             mock.patch.object(mo, "default_examiner", return_value="local:a:1"), \
             mock.patch.object(mo, "_ollama", fake), mock.patch.object(S, "_gateway_json", side_effect=RuntimeError("gw")), \
             mock.patch.object(S.fail_fast, "modal_chat", side_effect=RuntimeError("no lane session")) as modal, \
             mock.patch.dict(os.environ, env):
            with self.assertRaises(HTTPException) as cm:
                S.llm_json("s", "u", "t")
        self.assertEqual(calls, [("a:1", True), ("b:2", True), ("c:3", True), ("g", False)])
        self.assertEqual(modal.call_count, 1)                 # the non-governor rung comes last
        self.assertIn("modal: RuntimeError: no lane session", cm.exception.detail)


if __name__ == "__main__":
    unittest.main()
