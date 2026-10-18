"""mm_define_test — POST /api/mm/define with the model call mocked. Never touches a model or Anki.
Run: ~/miniconda3/bin/python tests/mm_define_test.py"""
import os, sys, unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import fail_fast  # noqa: E402
import mm_define as M  # noqa: E402
import sessione  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(M.router)
client = TestClient(app)


def post(terms, reply=None, usage=None, exc=None, **kw):
    gj = mock.patch.object(sessione, "_gateway_json", side_effect=exc) if exc else \
        mock.patch.object(sessione, "_gateway_json", return_value=(reply, usage or {"thinking_chars": 0}))
    with gj as m:
        r = client.post("/api/mm/define", json={"terms": terms, **kw})
    return r, m


class Define(unittest.TestCase):
    def test_batch_one_call_ordered_and_shaped(self):
        reply = {"items": [
            {"i": 1, "term": "mi fa male la schiena", "it": "mi fa male la schiena", "en": "my back hurts", "kind": "phrase"},
            {"i": 0, "term": "schiena", "it": "la schiena", "en": "back", "kind": "word", "note": "feminine"},
            {"i": 2, "term": "vado", "it": "vado", "en": "I go", "kind": "verb-form", "lemma": "andare"}]}
        r, m = post(["schiena", "mi fa male la schiena", "vado"], reply)
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertEqual(m.call_count, 1)                                   # ONE call for the batch
        self.assertEqual([i["term"] for i in j["items"]], ["schiena", "mi fa male la schiena", "vado"])
        self.assertEqual(j["items"][0], {"term": "schiena", "it": "la schiena", "en": "back", "kind": "word", "note": "feminine"})
        self.assertEqual(j["items"][2]["lemma"], "andare")
        self.assertEqual((j["model"], j["thinking_chars"]), (sessione.GATEWAY_MODEL, 0))

    def test_per_term_errors_do_not_fail_the_batch(self):
        reply = {"items": [{"i": 0, "term": "a", "it": "a", "en": ""},          # incomplete
                           {"i": 1, "term": "b", "error": "unknown word"},       # refused
                           {"i": 3, "term": "ghost", "it": "x", "en": "y"},      # index out of range: ignored
                           {"i": 4}]}
        r, _ = post(["a", "b", "c"], reply)
        self.assertEqual(r.status_code, 200)
        errs = [i.get("error") for i in r.json()["items"]]
        self.assertTrue(all(errs), errs)
        self.assertIn("incomplete", errs[0]); self.assertEqual(errs[1], "unknown word")
        self.assertIn("nothing", errs[2])                                        # skipped by the model

    def test_kind_is_defaulted_not_trusted(self):
        r, _ = post(["ciao", "come stai oggi"], {"items": [
            {"i": 0, "it": "ciao", "en": "hi", "kind": "bogus"}, {"i": 1, "it": "come stai oggi", "en": "how are you today"}]})
        self.assertEqual([i["kind"] for i in r.json()["items"]], ["word", "phrase"])

    def test_dedupe_and_validation(self):
        r, m = post(["Ciao", " ciao ", "CIAO"], {"items": [{"i": 0, "it": "ciao", "en": "hi"}]})
        self.assertEqual(len(r.json()["items"]), 1)
        self.assertEqual(client.post("/api/mm/define", json={"terms": ["", "  "]}).status_code, 400)
        self.assertEqual(client.post("/api/mm/define", json={"terms": ["x"] * 0}).status_code, 400)
        self.assertEqual(client.post("/api/mm/define", json={"terms": [f"t{i}" for i in range(41)]}).status_code, 400)
        self.assertEqual(client.post("/api/mm/define", json={"terms": ["x" * 201]}).status_code, 400)

    def test_model_down_is_a_named_503(self):
        r, _ = post(["ciao"], exc=OSError("connection refused"))
        self.assertEqual(r.status_code, 503)
        self.assertIn("unreachable", r.json()["detail"]); self.assertIn("connection refused", r.json()["detail"])

    def test_deadline_is_a_503_and_one_scope(self):
        r, _ = post(["ciao"], exc=fail_fast.DeadlineExceeded("mm-define deadline: 0s left of 20s"))
        self.assertEqual(r.status_code, 503); self.assertIn("did not answer", r.json()["detail"])
        seen = []
        with mock.patch.object(sessione, "_gateway_json",
                               side_effect=lambda s, u: (seen.append(fail_fast.current().total), ({"items": []}, {}))[1]):
            client.post("/api/mm/define", json={"terms": ["ciao"]})
        self.assertEqual(seen, [M.DEADLINE_S])

    def test_thinking_is_reported(self):
        r, _ = post(["ciao"], {"items": [{"i": 0, "it": "ciao", "en": "hi"}]}, usage={"thinking_chars": 812})
        self.assertEqual(r.json()["thinking_chars"], 812)


if __name__ == "__main__":
    unittest.main()
