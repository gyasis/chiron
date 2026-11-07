"""Dettato — listen to a real Italian recording line by line, type what you hear, say it back; Lucrezia judges.

    GET  /dettato?l=<slug>             the page (shell/dettato.html); no slug -> the list of lessons
    GET  /api/dettato/list             every built lesson (scripts/build_dettato.py writes them)
    GET  /api/dettato/lesson/<slug>    dettato.json (clips are served from /lessons/chiron-dettato/<slug>/audio/)
    POST /api/dettato/judge            {slug, answers:[{n, typed, plays}]} -> per-line word check + Lucrezia's notes
    POST /api/dettato/speak?slug=&n=   <audio> -> what whisper heard + word check against the line
    POST /api/dettato/photo?slug=      <image> of a handwritten page (numbered lines) -> {lines:[{n, text}]}, copied
                                       exactly as written (mistakes kept); the page then sends them to /judge
    GET  /api/dettato/riferimento      the shared grammar + vocabulary reference every judged lesson adds to

The word check is deterministic (accent-insensitive alignment; a word right but for its accent counts as an
accent slip). The model only writes the explanations. Lines the builder marked `uncertain` (two whisper passes
disagreed) are flagged to the model so it does not blame the learner for a transcription error.
Attempts are saved to <lesson>/attempts/<stamp>.json.
"""
import base64, difflib, json, os, re, time, unicodedata, urllib.request
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

import fail_fast
import mock_oral

SKILL = mock_oral.SKILL
GEN = mock_oral.GEN
ROOT = GEN / "chiron-dettato"
REF = ROOT / "riferimento.json"
JUDGE_DEADLINE_S = float(os.environ.get("CHIRON_DETTATO_DEADLINE_S") or 120)

router = APIRouter()


def _lesson(slug: str) -> dict:
    if not re.fullmatch(r"[a-z0-9-]+", slug or ""):
        raise HTTPException(400, "bad slug")
    p = ROOT / slug / "dettato.json"
    if not p.exists():
        raise HTTPException(404, f"no dettato lesson {slug!r} (build it with scripts/build_dettato.py)")
    return json.loads(p.read_text())


def _fold(w: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", w) if unicodedata.category(c) != "Mn")


def tokens(s: str) -> list[str]:
    """Lower-case words; an apostrophe splits (c'è -> c è, l'aula -> l aula) so elisions are checked as words."""
    return re.findall(r"[a-zàèéìíòóùú0-9]+", s.lower().replace("’", " ").replace("'", " "))


def check(target: str, typed: str) -> dict:
    """Align typed words to the target. Each target word: ok | accent | wrong | missing; plus extra typed words."""
    t, y = tokens(target), tokens(typed)
    sm = difflib.SequenceMatcher(None, [_fold(w) for w in t], [_fold(w) for w in y], autojunk=False)
    words, extra = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                words.append({"w": t[i1 + k], "got": y[j1 + k], "s": "ok" if t[i1 + k] == y[j1 + k] else "accent"})
        elif op == "replace" and _fold("".join(t[i1:i2])) == _fold("".join(y[j1:j2])):
            for k in range(i2 - i1):        # c'è typed "ce", l'aula typed "laula": a spelling slip, not a mishearing
                words.append({"w": t[i1 + k], "got": " ".join(y[j1:j2]) if k == 0 else "", "s": "accent"})
        elif op == "replace":
            for k in range(i2 - i1):
                got = y[j1 + k] if j1 + k < j2 else ""
                words.append({"w": t[i1 + k], "got": got, "s": "wrong" if got else "missing"})
            extra += y[j1 + (i2 - i1):j2]
        elif op == "delete":
            words += [{"w": w, "got": "", "s": "missing"} for w in t[i1:i2]]
        else:
            extra += y[j1:j2]
    ok = sum(w["s"] == "ok" for w in words) + 0.5 * sum(w["s"] == "accent" for w in words)
    return {"words": words, "extra": extra, "score": round(100 * ok / max(1, len(t)))}


SYSTEM = """You are Lucrezia, a warm, precise Italian teacher (Learn Italian with Lucrezia). Your student is Gyasi, an \
American doctor starting his anaesthesia residency in Salerno. His weakness is LISTENING: he is doing a dictation of a \
REAL voice message from a classmate, typing each line he hears.

You receive, per line: the correct Italian (a machine transcript), what he typed, and the word check. Explain his \
mistakes so he can HEAR the difference next time: why the sound fooled him (elision, linking, a dropped vowel, the \
southern accent, fast speech), and what the word means. Teach the grammar a line uses only when it explains a mistake \
or is genuinely useful. A line marked "uncertain" may contain a transcription error: if his version is plausible \
there, say so instead of correcting him.

Reply ONLY with a JSON object:
{
 "summary": "2-3 sentences in English: how he did, what to practise (be honest, encouraging, specific)",
 "lines": [{"n": line number, "notes": [{"heard": "what he typed", "correct": "the Italian", "why": "short English \
explanation of the sound and the meaning"}]}],
 "grammar": [{"term": "short Italian name of the point, e.g. 'ci metterò (metterci)'", "explain": "English, 1-2 \
sentences", "example": "the line from the recording that shows it"}],
 "vocab": [{"it": "word or phrase as in the recording", "en": "meaning", "note": "optional: register, regional, usage"}]
}
Only lines with mistakes get notes. At most 6 grammar points and 12 vocab items, the most useful for understanding \
spoken Italian in a hospital in Campania."""


def _judge_prompt(lesson: dict, rows: list[dict]) -> str:
    parts = [f"Recording: {lesson.get('title')} — {lesson.get('context', '')}", ""]
    for r in rows:
        miss = [f"{w['w']}→{w['got'] or '∅'}" for w in r["check"]["words"] if w["s"] != "ok"]
        parts.append(f"Line {r['n']}{' (uncertain transcript)' if r['uncertain'] else ''}: «{r['it']}»\n"
                     f"  typed: «{r['typed']}»  score {r['check']['score']}%  "
                     f"not ok: {', '.join(miss) or 'none'}  extra: {', '.join(r['check']['extra']) or 'none'}")
    return "\n".join(parts)


def lucrezia(user: str) -> dict:
    """One JSON reply through the mock oral's examiner chain (picked default, TUTOR_FALLBACKS, cloud)."""
    key = os.environ.get("OLLAMA_API_KEY", "")
    ex = mock_oral.refresh_examiners()
    order, tried = mock_oral.fallback_chain(mock_oral.default_examiner(), ex), []
    with fail_fast.scope(JUDGE_DEADLINE_S, "dettato judge"):
        for k in order:
            try:
                if not key and not ex[k].get("local"):
                    raise RuntimeError("OLLAMA_API_KEY not set")
                text, usage = mock_oral._ollama(ex[k]["model"], SYSTEM, user, key, ex[k].get("local", False),
                                                source="server:dettato")
                out = mock_oral.parse_json(text)
                out["model"], out["usage"] = k, usage
                if tried:
                    out["fallback_from"] = tried
                return out
            except fail_fast.DeadlineExceeded as e:
                tried.append(f"{k}: {e}"[:200]); break
            except Exception as e:
                tried.append(f"{k}: {type(e).__name__}: {e}"[:200])
                mock_oral._err("dettato", tried[-1])
    raise HTTPException(502, "Lucrezia could not judge (every model failed): " + " | ".join(tried))


def _add_reference(slug: str, out: dict) -> int:
    ref = json.loads(REF.read_text()) if REF.exists() else {"grammar": {}, "vocab": {}}
    added = 0
    for kind, keyf in (("grammar", "term"), ("vocab", "it")):
        for item in out.get(kind) or []:
            k = _fold(str(item.get(keyf, "")).strip().lower())
            if not k:
                continue
            cur = ref[kind].setdefault(k, {**item, "lessons": []})
            if slug not in cur["lessons"]:
                cur["lessons"].append(slug)
                added += 1
    ROOT.mkdir(parents=True, exist_ok=True)
    tmp = REF.with_suffix(".tmp")
    tmp.write_text(json.dumps(ref, ensure_ascii=False, indent=1))
    tmp.replace(REF)
    return added


@router.get("/dettato", response_class=HTMLResponse)
def page():
    return HTMLResponse((SKILL / "shell" / "dettato.html").read_text(),
                        headers={"Cache-Control": "no-cache, must-revalidate"})


@router.get("/api/dettato/list")
def lessons():
    out = []
    for p in sorted(ROOT.glob("*/dettato.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        d = json.loads(p.read_text())
        att = sorted((p.parent / "attempts").glob("*.json"))
        best = max((json.loads(a.read_text()).get("score", 0) for a in att), default=None)
        out.append({"slug": d["slug"], "title": d["title"], "from": d.get("from", ""), "lines": len(d["lines"]),
                    "seconds": d.get("seconds"), "attempts": len(att), "best": best})
    return {"lessons": out}


@router.get("/api/dettato/lesson/{slug}")
def lesson(slug: str):
    d = _lesson(slug)
    d["base"] = f"/lessons/chiron-dettato/{slug}/"
    return d


@router.get("/api/dettato/riferimento")
def reference():
    return json.loads(REF.read_text()) if REF.exists() else {"grammar": {}, "vocab": {}}


@router.post("/api/dettato/judge")
async def judge(req: Request):
    from starlette.concurrency import run_in_threadpool
    b = await req.json()
    les = _lesson(b.get("slug", ""))
    by_n = {ln["n"]: ln for ln in les["lines"]}
    rows = []
    for a in b.get("answers") or []:
        ln = by_n.get(a.get("n"))
        if not ln:
            continue
        typed = str(a.get("typed") or "")
        rows.append({"n": ln["n"], "it": ln["it"], "typed": typed, "plays": a.get("plays", 0),
                     "uncertain": ln.get("uncertain", False), "check": check(ln["it"], typed)})
    if not rows:
        raise HTTPException(400, "no answers")
    score = round(sum(r["check"]["score"] for r in rows) / len(rows))
    t = time.time()
    try:
        notes = await run_in_threadpool(lucrezia, _judge_prompt(les, rows))
        err = None
    except HTTPException as e:
        notes, err = {}, e.detail
    added = _add_reference(les["slug"], notes) if notes else 0
    result = {"slug": les["slug"], "score": score, "rows": rows, "lucrezia": notes, "lucrezia_error": err,
              "reference_added": added, "secs": round(time.time() - t, 1),
              "at": datetime.now().isoformat(timespec="seconds")}
    d = ROOT / les["slug"] / "attempts"
    d.mkdir(exist_ok=True)
    (d / (datetime.now().strftime("%Y%m%d-%H%M%S") + ".json")).write_text(json.dumps(result, ensure_ascii=False, indent=1))
    return result


@router.post("/api/dettato/speak")
async def speak(req: Request):
    from starlette.concurrency import run_in_threadpool
    les = _lesson(req.query_params.get("slug", ""))
    try:
        n = int(req.query_params.get("n", ""))
        ln = next(x for x in les["lines"] if x["n"] == n)
    except (ValueError, StopIteration):
        raise HTTPException(400, "bad line number")
    audio = await req.body()
    if len(audio) < 1000:
        return {"heard": "", "note": "recording too short", "check": check(ln["it"], "")}
    ct = (req.headers.get("content-type") or "").lower()
    ext = ".mp4" if "mp4" in ct else ".ogg" if "ogg" in ct else ".webm"
    try:
        heard = await run_in_threadpool(mock_oral.transcribe, audio, "say" + ext, "it")
    except Exception as e:
        mock_oral._err("dettato-speak", str(e))
        raise HTTPException(502, f"whisper failed: {e}")
    return {"heard": heard["text"], "confidence": heard.get("confidence"), "check": check(ln["it"], heard["text"])}


OCR_MODEL = os.environ.get("CHIRON_DETTATO_OCR_MODEL", "gemma4:31b")
OCR_PROMPT = """This is a photo of a handwritten Italian dictation. Each line starts with its number (e.g. "4." or "4)").
Copy EXACTLY what is written, letter by letter. This is a test of the writer's listening: do NOT correct spelling,
do NOT add missing accents or apostrophes, do NOT fix grammar, do NOT complete words. If a word is crossed out, skip it.
If a word is illegible write [?]. Reply ONLY with JSON: {"lines": [{"n": <line number>, "text": "<exactly as written>"}]}
Only the numbers you can see; never invent a line."""


def read_photo(image: bytes) -> dict:
    """Handwriting -> numbered lines, through the cloud vision model with think:false (verified on gemma4)."""
    key = os.environ.get("OLLAMA_API_KEY", "")
    if not key:
        raise HTTPException(503, "OLLAMA_API_KEY is not set in the server's environment")
    model = mock_oral.chiron_models.resolve(OCR_MODEL)
    body = {"model": model, "stream": False, "format": "json", "think": False, "options": {"temperature": 0},
            "messages": [{"role": "user", "content": OCR_PROMPT, "images": [base64.b64encode(image).decode()]}]}
    req = urllib.request.Request(mock_oral.OLLAMA_CLOUD, json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "Authorization": "Bearer " + key})
    t0 = time.time()
    log_msgs = [{"role": "user", "content": OCR_PROMPT + f" [image {len(image)} bytes]"}]
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=120).read())
    except Exception as e:
        mock_oral.ledger.record("server:dettato-ocr", model, log_msgs, None, endpoint=mock_oral.OLLAMA_CLOUD,
                                status="error", error=f"{type(e).__name__}: {e}"[:500],
                                latency_ms=int((time.time() - t0) * 1000))
        raise HTTPException(502, f"vision model failed: {type(e).__name__}: {e}")
    msg = d.get("message") or {}
    mock_oral.ledger.record("server:dettato-ocr", model, log_msgs, msg.get("content") or "",
                            endpoint=mock_oral.OLLAMA_CLOUD, tokens_in=d.get("prompt_eval_count"),
                            tokens_out=d.get("eval_count"), reasoning_chars=len(msg.get("thinking") or ""),
                            finish_reason=d.get("done_reason"), latency_ms=int((time.time() - t0) * 1000))
    if d.get("done_reason") == "length":
        raise HTTPException(502, "vision model reply was cut off (done_reason=length)")
    try:
        out = mock_oral.parse_json(msg.get("content") or "")
    except ValueError as e:
        raise HTTPException(502, f"vision model gave no JSON: {e}")
    lines = [{"n": int(x["n"]), "text": str(x.get("text", "")).strip()} for x in out.get("lines") or []
             if str(x.get("n", "")).strip().isdigit()]
    return {"lines": lines, "model": model, "secs": round(time.time() - t0, 1),
            "thinking_chars": len(msg.get("thinking") or "")}


@router.post("/api/dettato/photo")
async def photo(req: Request):
    from starlette.concurrency import run_in_threadpool
    les = _lesson(req.query_params.get("slug", ""))
    image = await req.body()
    if len(image) < 2000:
        raise HTTPException(400, "image too small")
    out = await run_in_threadpool(read_photo, image)
    valid = {ln["n"] for ln in les["lines"]}
    out["ignored"] = [x["n"] for x in out["lines"] if x["n"] not in valid]
    out["lines"] = [x for x in out["lines"] if x["n"] in valid]
    return out
