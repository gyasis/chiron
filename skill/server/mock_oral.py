"""Mock oral — the OMCeO Italian oral with Lucrezia as the examiner, on the computer.

    GET  /oral                    the page (shell/mock-oral.html)
    GET  /api/oral/status         TTS / ASR / model reachability + the last errors (poll this when it misbehaves)
    GET  /api/oral/questions      every exam item ({q, en, it}) from the exam Pimsleur seasons, by lesson
    POST /api/oral/say   {text}   Lucrezia speaks it -> audio/wav (OmniVoice on the Mac, cached by text)
    POST /api/oral/hear  <webm>   the candidate's answer -> {text, confidence, secs} (whisper on the Mac, Italian forced)
    POST /api/oral/turn  {...}    the examiner reacts: spoken reply (+ maybe one follow-up) and the written feedback
    POST /api/oral/save  {...}    the finished session -> ~/Documents/generated/chiron-mock-oral/<stamp>.{json,md}

The examiner never corrects aloud — a real commission doesn't. Corrections are written, separately.
The examiner models are thinking models: every call sends think:false, and the reply is checked for
leaked reasoning (GLM puts it in `content` despite the flag — measured 2026-10-12 — so it is not offered).
"""
import glob, hashlib, json, os, re, subprocess, sys, tempfile, time, urllib.request
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse

SKILL = Path(os.environ.get("CHIRON_SKILL", Path.home() / "Documents/code/chiron/skill"))
GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
OUT = GEN / "chiron-mock-oral"
OLLAMA_CLOUD = "https://ollama.com/api/chat"
TTS_CACHE = SKILL / "server" / "state" / "oral-tts"

sys.path.insert(0, str(SKILL / "scripts"))
sys.path.insert(0, str(SKILL / "chains"))
import pimsleur_drill  # noqa: E402  the same OmniVoice + whisper sidecars and voice refs as the drills
import chiron_models  # noqa: E402

ASR_URL = pimsleur_drill.ASR_URL   # same whisper sidecar + env override (CHIRON_WHISPER_URL) as the drills

# Ollama Cloud thinking models whose think:false was verified to emit 0 reasoning.
EXAMINERS = {
    "gemma4": {"label": "Gemma 4 31B · cloud", "model": "gemma4:31b"},
    "deepseek": {"label": "DeepSeek Flash · cloud", "model": "deepseek-flash@latest"},
}
DEFAULT_EXAMINER = os.environ.get("TUTOR_DEFAULT_MODEL", "gemma4")
if DEFAULT_EXAMINER not in EXAMINERS:
    DEFAULT_EXAMINER = "gemma4"

ERRORS: list[dict] = []          # last few failures, newest last — surfaced by /api/oral/status

router = APIRouter()


def _err(stage: str, msg: str) -> None:
    ERRORS.append({"t": time.strftime("%H:%M:%S"), "stage": stage, "error": msg[:300]})
    del ERRORS[:-20]
    sys.stderr.write(f"[oral] {stage}: {msg}\n")


def questions(gen: Path = GEN) -> list[dict]:
    """Exam items of every Pimsleur lesson that has them, in season/track order."""
    out = []
    for f in sorted(glob.glob(str(gen / "chiron-pimsleur-*" / "pimsleur.json"))):
        try:
            bank = json.load(open(f))
        except Exception as e:
            _err("questions", f"{f}: {e}")
            continue
        lesson = bank.get("title", "").replace("Pimsleur · ", "")
        for it in bank.get("items", []):
            if it.get("kind") == "exam" and it.get("q") and it.get("it"):
                out.append({"id": it["id"], "lesson": lesson, "slug": Path(f).parent.name,
                            "q": it["q"], "en": it.get("en", ""), "it": it["it"]})
    return out


def parse_json(text: str) -> dict:
    """The model's JSON, tolerating ```json fences and prose around it."""
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1)
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b < a:
        raise ValueError(f"no JSON object in reply: {text[:120]!r}")
    return json.loads(t[a:b + 1])


SYSTEM = """Sei Lucrezia, membro della commissione dell'Ordine dei Medici di Napoli. Stai conducendo la prova \
orale di conoscenza della lingua italiana per un medico straniero che si è laureato in Italia in un corso in inglese. Il livello richiesto è funzionale: il candidato deve farsi capire da pazienti e colleghi.

Ricevi la domanda che hai fatto, la traccia di una buona risposta, e la trascrizione automatica (whisper) \
di ciò che il candidato ha detto. La trascrizione può contenere errori di riconoscimento: non punire \
parole chiaramente storpiate dal riconoscimento, ma segnala gli errori di lingua veri.

Rispondi SOLO con un oggetto JSON:
{
 "reply": "ciò che dici ad alta voce, in italiano, 1-2 frasi brevi e naturali. Mai correggere ad alta voce. \
Se fai una domanda di approfondimento, deve essere UNA sola domanda breve legata a ciò che ha detto. \
Se non la fai, chiudi con una transizione cortese (es. 'Bene, grazie.').",
 "followup": true o false (hai fatto una domanda di approfondimento?),
 "understood": 1-5 (5 = una commissione capisce tutto senza sforzo; 1 = incomprensibile),
 "accuracy": 1-5 (correttezza grammaticale e lessicale),
 "errors": [{"said": "parole esatte del candidato", "better": "forma corretta", "why": "spiegazione breve in inglese"}],
 "better_answer": "la risposta del candidato riscritta in italiano corretto e naturale, mantenendo il SUO contenuto",
 "tip": "un consiglio pratico in inglese, una frase"
}
Massimo 5 errori, i più importanti. Se la risposta è corretta, "errors": []."""


def _examiner_prompt(b: dict) -> str:
    fu = ("Hai GIÀ fatto una domanda di approfondimento su questo tema: ora NON farne un'altra (followup=false)."
          if b.get("followup_asked") else
          "Puoi fare UNA domanda di approfondimento se la risposta la invita (circa una volta su due); altrimenti no.")
    return (f"Domanda della commissione: {b.get('question','')}\n"
            f"Che cosa ci si aspetta: {b.get('guidance','')}\n"
            f"Esempio di buona risposta: {b.get('model_answer','')}\n\n"
            f"Trascrizione del candidato: «{b.get('answer','').strip()}»\n\n{fu}")


def _ollama(model: str, system: str, user: str, key: str) -> tuple[str, dict]:
    body = {"model": chiron_models.resolve(model), "stream": False, "think": False, "format": "json",
            "options": {"temperature": 0.4},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    req = urllib.request.Request(OLLAMA_CLOUD, json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "Authorization": "Bearer " + key})
    d = json.loads(urllib.request.urlopen(req, timeout=90).read())
    msg = d.get("message") or {}
    usage = {"model": d.get("model"), "prompt_tokens": d.get("prompt_eval_count"),
             "output_tokens": d.get("eval_count"), "thinking_chars": len(msg.get("thinking") or "")}
    if usage["thinking_chars"]:
        _err("turn", f"{model} emitted {usage['thinking_chars']} chars of thinking despite think:false")
    return msg.get("content") or "", usage


def examine(b: dict) -> dict:
    key = os.environ.get("OLLAMA_API_KEY", "")
    if not key:
        raise HTTPException(503, "OLLAMA_API_KEY is not set in the server's environment")
    first = b.get("examiner") if b.get("examiner") in EXAMINERS else DEFAULT_EXAMINER
    order = [first] + [k for k in EXAMINERS if k != first]
    user, tried = _examiner_prompt(b), []
    for k in order:
        t = time.time()
        try:
            text, usage = _ollama(EXAMINERS[k]["model"], SYSTEM, user, key)
            out = parse_json(text)
            if not str(out.get("reply", "")).strip():
                raise ValueError("empty reply")
            if b.get("followup_asked"):
                out["followup"] = False
            out["examiner"], out["usage"], out["secs"] = k, usage, round(time.time() - t, 1)
            if tried:
                out["fallback_from"] = tried
            return out
        except Exception as e:
            tried.append(f"{k}: {type(e).__name__}: {e}"[:200])
            _err("turn", tried[-1])
    raise HTTPException(502, "every examiner model failed: " + " | ".join(tried))


# A live examiner cannot wait 11 s per line (the drills' 48 steps). 16 steps answered in 4.0 s and
# whisper heard it word-for-word (2026-10-12); one voice only, so no levelling between voices is needed.
ORAL_STEPS = 16


def synth(text: str) -> str:
    """Lucrezia says `text` -> cached wav path."""
    ref = json.load(open(pimsleur_drill.VOICES_FILE))["lucrezia_italian"]
    path = TTS_CACHE / (hashlib.sha256(f"lucrezia_italian|{ORAL_STEPS}|{text}".encode()).hexdigest()[:16] + ".wav")
    if not path.exists():
        TTS_CACHE.mkdir(parents=True, exist_ok=True)
        body = json.dumps({"text": text, "ref_audio": ref["refAudio"], "ref_text": ref["refText"], "language": "it",
                           "num_step": ORAL_STEPS, "guidance_scale": 2.0, "class_temperature": 0.3,
                           "pitch_semitones": 0}).encode()
        req = urllib.request.Request(f"{pimsleur_drill.OV_URL}/tts", body, {"content-type": "application/json"})
        data = urllib.request.urlopen(req, timeout=120).read()
        if len(data) < 2000:
            raise RuntimeError(f"OmniVoice returned {len(data)} bytes for {text!r}")
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
    return str(path)


def transcribe(audio: bytes, filename: str = "answer.webm") -> dict:
    """whisper on the Mac, Italian forced. The sidecar self-restarts (exit 42) — an empty reply is retried."""
    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix or ".webm", delete=False) as f:
        f.write(audio)
        path = f.name
    try:
        last = ""
        for wait in (3, 8, None):
            t = time.time()
            last = subprocess.run(["curl", "-s", "--max-time", "120", "-F", f"file=@{path}", "-F", "language=it",
                                   "-F", "model=turbo", f"{ASR_URL}/transcribe"],
                                  capture_output=True, text=True).stdout
            try:
                d = json.loads(last)
            except ValueError:
                if wait is None:
                    break
                time.sleep(wait)
                continue
            text = (d.get("text") or " ".join(s.get("text", "") for s in d.get("segments", []))).strip()
            q = d.get("quality") or {}
            return {"text": text, "confidence": q.get("confidence"), "low_confidence": q.get("low_confidence"),
                    "secs": round(time.time() - t, 1)}
        raise RuntimeError(f"whisper unreachable at {ASR_URL} (last reply {last[:80]!r})")
    finally:
        os.unlink(path)


def report_md(s: dict) -> str:
    turns = s.get("turns", [])
    def avg(k):
        v = [t["feedback"][k] for t in turns if isinstance((t.get("feedback") or {}).get(k), (int, float))]
        return f"{sum(v) / len(v):.1f}/5" if v else "–"
    L = [f"# Mock oral — {s.get('started', '')}", "",
         f"Examiner model: {s.get('examiner', '')} · answers: {len(turns)} · "
         f"understood {avg('understood')} · accuracy {avg('accuracy')}", ""]
    for i, t in enumerate(turns, 1):
        fb = t.get("feedback") or {}
        L += [f"## {i}. {t.get('question', '')}", "",
              f"**You said** (whisper, confidence {t.get('confidence', '–')}): {t.get('answer', '') or '_(nothing heard)_'}", "",
              f"**Lucrezia:** {fb.get('reply', '')}", "",
              f"Understood {fb.get('understood', '–')}/5 · accuracy {fb.get('accuracy', '–')}/5", ""]
        for e in fb.get("errors") or []:
            L.append(f"- ~~{e.get('said', '')}~~ → **{e.get('better', '')}** — {e.get('why', '')}")
        if fb.get("better_answer"):
            L += ["", f"**Your answer, corrected:** {fb['better_answer']}"]
        if t.get("model_answer"):
            L += ["", f"**Model answer from the lesson:** {t['model_answer']}"]
        if fb.get("tip"):
            L += ["", f"_Tip: {fb['tip']}_"]
        L.append("")
    return "\n".join(L)


# ── routes ────────────────────────────────────────────────────────────────────

@router.get("/oral", response_class=HTMLResponse)
def page():
    return HTMLResponse((SKILL / "shell" / "mock-oral.html").read_text(),
                        headers={"Cache-Control": "no-cache, must-revalidate"})


@router.get("/api/oral/status")
def status():
    def up(url):
        try:
            urllib.request.urlopen(url, timeout=4)
            return True
        except urllib.error.HTTPError:
            return True          # the sidecars answer 404 on / — reachable is what matters
        except Exception:
            return False
    return {"tts": up(pimsleur_drill.OV_URL), "asr": up(ASR_URL), "ollama_key": bool(os.environ.get("OLLAMA_API_KEY")),
            "examiners": {k: v["label"] for k, v in EXAMINERS.items()}, "default": DEFAULT_EXAMINER,
            "questions": len(questions()), "tts_cache": str(TTS_CACHE), "errors": ERRORS[-10:]}


@router.get("/api/oral/questions")
def get_questions():
    return {"questions": questions()}


@router.post("/api/oral/say")
async def say(req: Request):
    text = ((await req.json()).get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    try:
        from starlette.concurrency import run_in_threadpool
        path = await run_in_threadpool(synth, text)
    except Exception as e:
        _err("say", f"{type(e).__name__}: {e}")
        raise HTTPException(502, f"TTS failed: {e}")
    return Response(open(path, "rb").read(), media_type="audio/wav")


@router.post("/api/oral/hear")
async def hear(req: Request):
    audio = await req.body()
    if len(audio) < 1000:
        return {"text": "", "confidence": None, "secs": 0, "note": "recording too short"}
    try:
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(transcribe, audio)
    except Exception as e:
        _err("hear", str(e))
        raise HTTPException(502, str(e))


@router.post("/api/oral/turn")
async def turn(req: Request):
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(examine, await req.json())


@router.post("/api/oral/save")
async def save(req: Request):
    s = await req.json()
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    (OUT / f"{stamp}.json").write_text(json.dumps(s, ensure_ascii=False, indent=1))
    (OUT / f"{stamp}.md").write_text(report_md(s))
    return {"saved": str(OUT / f"{stamp}.md")}
