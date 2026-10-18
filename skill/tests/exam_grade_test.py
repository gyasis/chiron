"""exam_grade_test — POST /api/exam/grade with the claude subprocess mocked. Never calls a model.
Run: ~/miniconda3/bin/python tests/exam_grade_test.py"""
import json, os, subprocess, sys, unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import exam_grade as G  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(G.router)
client = TestClient(app)

GOOD = {"score": 22, "max": 30, "pass": True, "verdict_it": "Sufficiente.", "feedback_it": "Bene.", "feedback_en": "Good.",
        "corrections": [{"wrong": "io sono medica", "right": "sono medico", "why_en": "register"}],
        "missing": ["data"], "improved_version_it": "Sono medico."}
BODY = {"exam_id": "s1", "task_type": "presentazione", "prompt_it": "Presentati.", "rubric": {"a": 1}, "model_answer": "m", "answer": "Mi chiamo Ali."}


def env(result, **kw):
    return json.dumps({"type": "result", "is_error": False, "result": result, **kw})


def proc(stdout, rc=0, stderr=""):
    return subprocess.CompletedProcess([], rc, stdout, stderr)


def post(*outputs, body=BODY):
    with mock.patch.object(G.shutil, "which", return_value="/x/claude"), \
         mock.patch.object(G.subprocess, "run", side_effect=list(outputs)) as run:
        return client.post("/api/exam/grade", json=body), run


class Parse(unittest.TestCase):
    def test_plain_and_fenced_and_prose(self):
        for t in (json.dumps(GOOD), "```json\n" + json.dumps(GOOD) + "\n```", "Ecco:\n" + json.dumps(GOOD) + "\nfine"):
            self.assertEqual(G.parse_envelope(env(t))["score"], 22)

    def test_score_clamped_and_pass_recomputed(self):
        j = G.normalise({"score": 99, "pass": False})
        self.assertEqual((j["score"], j["pass"]), (30, True))
        self.assertEqual(G.normalise({"score": 17.6})["pass"], True)
        self.assertEqual(G.normalise({"score": 17.4})["pass"], False)

    def test_bad_inputs_raise(self):
        for bad in ("not json", env("no object here"), env('{"nope":1}')):
            with self.assertRaises(ValueError):
                G.parse_envelope(bad)

    def test_cli_error_envelope(self):
        with self.assertRaises(G.GradeError):
            G.parse_envelope(json.dumps({"is_error": True, "result": "Not logged in"}))


class Endpoint(unittest.TestCase):
    def test_ok_shape_and_safe_flags(self):
        r, run = post(proc(env(json.dumps(GOOD))))
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertEqual((j["score"], j["max"], j["pass"], j["model"]), (22, 30, True, G.MODEL))
        cmd = run.call_args.args[0]
        self.assertIn("--tools", cmd)
        self.assertEqual(cmd[cmd.index("--tools") + 1], "")
        self.assertNotIn("--dangerously-skip-permissions", cmd)
        self.assertIn("Mi chiamo Ali.", run.call_args.kwargs["input"])
        self.assertNotEqual(run.call_args.kwargs["cwd"], os.getcwd())

    def test_retry_once_then_ok(self):
        r, run = post(proc(env("garbage")), proc(env(json.dumps(GOOD))))
        self.assertEqual((r.status_code, run.call_count), (200, 2))

    def test_two_parse_failures_is_clear_error(self):
        r, run = post(proc(env("garbage")), proc(env("garbage")))
        self.assertEqual((r.status_code, run.call_count), (502, 2))
        self.assertEqual(r.json()["error"], "grading failed")

    def test_timeout_is_504_no_retry(self):
        r, run = post(subprocess.TimeoutExpired("claude", 180))
        self.assertEqual((r.status_code, run.call_count), (504, 1))
        self.assertIn("timed out", r.json()["detail"])

    def test_empty_answer_400(self):
        r, _ = post(body={**BODY, "answer": "  "})
        self.assertEqual(r.status_code, 400)

    def test_health(self):
        with mock.patch.object(G.shutil, "which", return_value="/x/claude"), \
             mock.patch.object(G.subprocess, "run", return_value=proc("2.1.302 (Claude Code)\n")):
            j = client.get("/api/exam/grade/health").json()
        self.assertEqual((j["ok"], j["claude_path"], j["claude_version"]), (True, "/x/claude", "2.1.302 (Claude Code)"))


if __name__ == "__main__":
    unittest.main()
