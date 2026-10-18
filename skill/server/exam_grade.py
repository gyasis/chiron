"""exam_grade — grade a practice-exam answer (OMCeO Napoli Ordine simulator) with the Claude CLI.

    POST /api/exam/grade   {exam_id, task_type, prompt_it, rubric, model_answer, answer}
        -> {score, max:30, pass, verdict_it, feedback_it, feedback_en, corrections:[{wrong,right,why_en}],
            missing:[...], improved_version_it, model, duration_s}
    GET  /api/exam/grade/health -> {ok, claude_path, claude_version, model}

Runs `claude -p` with the prompt on stdin, ALL tools disabled (--tools ""), in a throwaway cwd. The extra flags
(--setting-sources "", --strict-mcp-config, --disable-slash-commands, --system-prompt) keep the user's CLAUDE.md /
hooks / MCP servers out of the call: without them one grade costs ~$0.49 (121k tokens of config), with them ~$0.01.
Never --dangerously-skip-permissions. Output is parsed twice: the CLI envelope's `result`, then the model's JSON;
a parse failure is retried once. At most 2 grades run at once; each call has a 180 s deadline.
"""
import asyncio, json, logging, re, shutil, subprocess, tempfile, time

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

MODEL = "claude-sonnet-5-5"   # chosen by Gyasi 2026-10-18
TIMEOUT_S = 180
MAX_CONCURRENT = 2
MAX_ANSWER_CHARS = 20000
_SEM = asyncio.Semaphore(MAX_CONCURRENT)

log = logging.getLogger("exam_grade")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[exam-grade] %(levelname)s %(message)s"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False

SYSTEM = "You are a strict Italian medical-licensing examiner. You answer with ONE JSON object and nothing else."

PROMPT = """You are an examiner of the Ordine dei Medici (OMCeO, Napoli) grading a NON-EU doctor who is applying to
practise in Italy. The exam checks written Italian and knowledge of the rules for practising. Be fair but exact.

TASK TYPE: {task_type}
TASK (Italian): {prompt_it}

RUBRIC (grade against this; for "ricetta" and "certificato" CHECK EVERY REQUIRED FIELD it names and list each
missing one in "missing"):
{rubric}

MODEL ANSWER (a reference, not the only valid answer):
{model_answer}

CANDIDATE ANSWER:
\"\"\"
{answer}
\"\"\"

Score 0-30 on the rubric (18 = pass). Judge Italian grammar, spelling, register, completeness and content.
For "dettato" compare the candidate with the passage word by word (spelling, accents, punctuation).
Reply with STRICT JSON only (no markdown fence, no text outside it):
{{"score": <integer 0-30>, "max": 30, "pass": <true if score>=18>, "verdict_it": "<one short Italian sentence>",
"feedback_it": "<2-5 sentences in Italian>", "feedback_en": "<2-5 sentences in English>",
"corrections": [{{"wrong": "<candidate text>", "right": "<corrected Italian>", "why_en": "<short English reason>"}}],
"missing": ["<required element the candidate left out>"], "improved_version_it": "<the candidate's answer rewritten correctly, in Italian>"}}"""


class GradeIn(BaseModel):
    exam_id: str = ""
    task_type: str
    prompt_it: str = ""
    rubric: object = ""
    model_answer: str = ""
    answer: str


class GradeError(Exception):
    def __init__(self, msg: str, status: int = 502):
        super().__init__(msg)
        self.status = status


def _rubric_text(r) -> str:
    if isinstance(r, str):
        return r.strip() or "(none given: use general Italian-language and content criteria)"
    return json.dumps(r, ensure_ascii=False, indent=1)


def build_prompt(b: GradeIn) -> str:
    return PROMPT.format(task_type=b.task_type, prompt_it=b.prompt_it, rubric=_rubric_text(b.rubric),
                         model_answer=b.model_answer or "(none)", answer=b.answer[:MAX_ANSWER_CHARS])


def parse_model_json(text: str) -> dict:
    """The model's reply -> dict. Tolerates a ```json fence or stray prose around ONE object."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        j = json.loads(t)
    except ValueError:
        a, z = t.find("{"), t.rfind("}")
        if a < 0 or z <= a:
            raise ValueError("no JSON object in the model reply")
        j = json.loads(t[a:z + 1])
    if not isinstance(j, dict) or "score" not in j:
        raise ValueError("model JSON has no 'score'")
    return j


def parse_envelope(stdout: str) -> dict:
    """`claude -p --output-format json` stdout -> the model's graded dict (envelope.result, then its JSON)."""
    try:
        env = json.loads(stdout)
    except ValueError as e:
        raise ValueError(f"CLI output is not JSON: {e}")
    if isinstance(env, list):                       # some CLI versions emit an event array; take the last result
        env = next((x for x in reversed(env) if isinstance(x, dict) and x.get("type") == "result"), {})
    if env.get("is_error"):
        raise GradeError(f"claude reported an error: {str(env.get('result'))[:300]}")
    return normalise(parse_model_json(env.get("result") or ""))


def normalise(j: dict) -> dict:
    try:
        score = max(0, min(30, int(round(float(j["score"])))))
    except (TypeError, ValueError):
        raise ValueError("score is not a number")
    out = {"score": score, "max": 30, "pass": score >= 18,
           "verdict_it": str(j.get("verdict_it") or ""), "feedback_it": str(j.get("feedback_it") or ""),
           "feedback_en": str(j.get("feedback_en") or ""), "improved_version_it": str(j.get("improved_version_it") or "")}
    out["corrections"] = [{"wrong": str(c.get("wrong", "")), "right": str(c.get("right", "")), "why_en": str(c.get("why_en", ""))}
                          for c in (j.get("corrections") or []) if isinstance(c, dict)]
    out["missing"] = [str(m) for m in (j.get("missing") or [])]
    return out


def _run_claude(prompt: str) -> str:
    claude = shutil.which("claude")
    if not claude:
        raise GradeError("claude CLI not found on PATH", 503)
    with tempfile.TemporaryDirectory(prefix="exam-grade-") as cwd:
        try:
            p = subprocess.run(
                [claude, "-p", "--model", MODEL, "--output-format", "json", "--tools", "",
                 "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config",
                 "--disable-slash-commands", "--system-prompt", SYSTEM],
                input=prompt, capture_output=True, text=True, timeout=TIMEOUT_S, cwd=cwd)
        except subprocess.TimeoutExpired:
            raise GradeError(f"grader timed out after {TIMEOUT_S}s", 504)
    if p.returncode != 0 and not p.stdout.strip():
        raise GradeError(f"claude exited {p.returncode}: {(p.stderr or '').strip()[:300]}")
    return p.stdout


def grade_sync(prompt: str) -> dict:
    last = None
    for attempt in (1, 2):                          # one retry on a parse failure (timeouts / CLI errors are not retried)
        out = _run_claude(prompt)
        try:
            return parse_envelope(out)
        except ValueError as e:
            last = e
            log.warning("parse failure attempt %d: %s", attempt, e)
    raise GradeError(f"could not parse the grader's reply after 2 tries: {last}")


@router.post("/api/exam/grade")
async def grade(body: GradeIn):
    if not body.answer.strip():
        return JSONResponse({"error": "empty answer", "detail": "write something to grade"}, status_code=400)
    t0 = time.time()
    try:
        async with _SEM:
            res = await asyncio.to_thread(grade_sync, build_prompt(body))
    except GradeError as e:
        log.error("exam=%s type=%s FAILED in %.1fs: %s", body.exam_id, body.task_type, time.time() - t0, e)
        return JSONResponse({"error": "grading failed", "detail": str(e)}, status_code=e.status)
    except Exception as e:                          # never a bare 500 with no cause
        log.exception("exam=%s type=%s crashed", body.exam_id, body.task_type)
        return JSONResponse({"error": "grading failed", "detail": f"{type(e).__name__}: {e}"}, status_code=500)
    dur = round(time.time() - t0, 1)
    log.info("exam=%s type=%s answer_chars=%d score=%d duration=%.1fs", body.exam_id, body.task_type, len(body.answer), res["score"], dur)
    return {**res, "model": MODEL, "duration_s": dur}


@router.get("/api/exam/grade/health")
def health():
    claude = shutil.which("claude")
    if not claude:
        return JSONResponse({"ok": False, "error": "claude CLI not found on PATH", "model": MODEL}, status_code=503)
    try:
        v = subprocess.run([claude, "--version"], capture_output=True, text=True, timeout=15).stdout.strip()
    except Exception as e:
        return JSONResponse({"ok": False, "claude_path": claude, "error": f"{type(e).__name__}: {e}", "model": MODEL}, status_code=503)
    return {"ok": True, "claude_path": claude, "claude_version": v, "model": MODEL, "timeout_s": TIMEOUT_S, "max_concurrent": MAX_CONCURRENT}
