"""Verbal Check (dettato) — listen to real Italian line by line, write what you hear, say it back; Lucrezia judges.

Two sources, one page: a built lesson (a real recording, scripts/build_dettato.py) or an ANKI deck's listening
cards (each card's audio is a line). For Anki cards the result is written back to Anki's scheduler, because a
card reviewed here must advance Anki or it returns tomorrow as if unseen (anki.py).

    GET  /verbal-check (= /dettato)    the page. ?l=<slug> a lesson, ?deck=<anki deck>&n=15 an Anki session
    GET  /api/dettato/list             every built lesson (scripts/build_dettato.py writes them)
    GET  /api/dettato/lesson/<slug>    dettato.json (clips are served from /lessons/chiron-dettato/<slug>/audio/)
    GET  /api/dettato/anki?deck=&limit=   an Anki session: cards with audio + Italian text, due first
    GET  /api/dettato/anki-decks       decks that have cards with audio, with counts
    GET  /api/dettato/anki-media?f=&slow=1   a card's audio (cached; slow = atempo 0.75)
    POST /api/dettato/judge            {slug, answers:[{n, typed, plays, slow}]} or {deck, answers:[{cardId, ...}]}
    GET  /api/dettato/hard?slug=       the lines that cost the most listens across every attempt
    POST /api/dettato/speak?slug=&n=   <audio> -> what whisper heard + word check (?cardId= for an Anki card)
    POST /api/dettato/photo?slug=      <image> of a handwritten page (numbered lines) -> {lines:[{n, text}]}, copied
                                       exactly as written (mistakes kept); the page then sends them to /judge
    GET  /api/dettato/riferimento      the shared grammar + vocabulary reference every judged lesson adds to

The word check is deterministic (accent-insensitive alignment; a word right but for its accent counts as an
accent slip). The model only writes the explanations. Lines the builder marked `uncertain` (two whisper passes
disagreed) are flagged to the model so it does not blame the learner for a transcription error.
Replays are evidence: how many times a line was played (and how many of those slowed) before it was written is
the line's DIFFICULTY for this learner, kept beside the score. A line right after 1-2 listens is easy; right after
ten is still hard. Difficulty sets the Anki ease, goes to Lucrezia, and ranks /hard.
Attempts are saved to <lesson>/attempts/<stamp>.json (Anki sessions: chiron-dettato/anki/<deck>/attempts/).
"""
import base64, difflib, json, os, re, subprocess, time, unicodedata, urllib.parse, urllib.request
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


def listens(plays: int, slow: int) -> float:
    """Effort to hear a line: a slowed replay counts 1.5 (it means the normal speed was not enough)."""
    return max(0, int(plays or 0)) + 1.5 * max(0, int(slow or 0))


def difficulty(score: int, plays: int, slow: int) -> str:
    n = listens(plays, slow)
    if score >= 90:
        return "facile" if n <= 2 else "media" if n <= 5 else "difficile"
    if score >= 70:
        return "media" if n <= 3 else "difficile"
    return "difficile" if n <= 3 else "molto difficile"


def anki_ease(score: int, plays: int, slow: int) -> int:
    """Anki ease from the result AND the effort: right but only after many listens is Hard, not Good."""
    n = listens(plays, slow)
    if score >= 95 and n <= 2:
        return 4
    if score >= 85 and n <= 5:
        return 3
    if score >= 70:
        return 2
    return 1


SYSTEM = """You are Lucrezia, a warm, precise Italian teacher (Learn Italian with Lucrezia). Your student is Gyasi, an \
American doctor starting his anaesthesia residency in Salerno. His weakness is LISTENING: he is doing a dictation of a \
REAL voice message from a classmate, typing each line he hears.

You receive, per line: the correct Italian (a machine transcript or an Anki card), what he typed, the word check, \
and how many times he had to replay it (normal and slowed). Many replays on a line he finally got right still mean \
that line is hard for his ear: say what makes it hard (speed, run-together words, an unfamiliar word). Explain his \
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
                     f"  replays: {r['plays']} normal, {r['slow']} slowed ({r['difficulty']})\n"
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
@router.get("/verbal-check", response_class=HTMLResponse)
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


ANKI_DIR = ROOT / "anki"
MEDIA = ROOT / "anki-media"


def _deck_slug(deck: str) -> str:
    return "anki-" + (re.sub(r"[^a-z0-9]+", "-", _fold(deck.lower())).strip("-")[:60] or "deck")


def _anki_line(c: dict) -> dict | None:
    """An Anki card as a Verbal Check line: its audio and the Italian it speaks. None when it has neither."""
    import anki
    f = c.get("fields") or {}
    if c.get("modelName") == anki.LISTEN_MODEL:
        it = anki._clean(f.get("Italiano", {}).get("value", ""))[0]
        en = anki._clean(f.get("English", {}).get("value", ""))[0]
        m = anki.SOUND.search(f.get("Audio", {}).get("value", "") or "")
        audio = m.group(1) if m else None
    else:
        fr, a1 = anki._clean(anki._field(f, anki.FRONT_KEYS))
        bk, a2 = anki._clean(anki._field(f, anki.BACK_KEYS))
        m = anki.SOUND.search(f.get("Audio", {}).get("value", "") or "")
        audio, it, en = (m.group(1) if m else None) or a1 or a2, fr, bk
    if not audio or not it or c.get("ord") == 1:        # ord 1 = the reversed (English-first) card of a note
        return None
    return {"cardId": c["cardId"], "noteId": c.get("note"), "it": it, "en": en, "audio": audio}


def _anki_cards(card_ids: list[int]) -> dict[int, dict]:
    import anki
    return {ln["cardId"]: ln for ln in (_anki_line(c) for c in anki.invoke("cardsInfo", cards=card_ids) or []) if ln}


def anki_session(deck: str, limit: int = 15) -> dict:
    import anki
    if not anki.reachable():
        raise HTTPException(503, "Anki is not reachable (AnkiConnect on the Mac Studio / MacBook is closed)")
    ids = anki.invoke("findCards", query=f'"deck:{deck}"') or []
    due = set(anki.invoke("findCards", query=f'"deck:{deck}" (is:due or is:learn)') or [])
    ids = [i for i in ids if i in due] + [i for i in ids if i not in due]
    lines, seen = [], set()
    for i in range(0, len(ids), 200):                   # cardsInfo in pages until enough lines with audio
        for c in anki.invoke("cardsInfo", cards=ids[i:i + 200]) or []:
            ln = _anki_line(c)
            if ln and ln["noteId"] not in seen:
                seen.add(ln["noteId"])
                lines.append(ln)
        if len(lines) >= limit:
            break
    lines = lines[:limit]
    if not lines:
        raise HTTPException(404, f"deck {deck!r} has no cards with audio and Italian text")
    for n, ln in enumerate(lines, 1):
        q = urllib.parse.quote(ln.pop("audio"))
        ln.update(n=n, clip=f"/api/dettato/anki-media?f={q}", slow=f"/api/dettato/anki-media?f={q}&slow=1",
                  due=ln["cardId"] in due)
    return {"slug": _deck_slug(deck), "source": "anki", "deck": deck, "title": deck.split("::")[-1],
            "from": "Anki", "context": deck, "base": "", "lines": lines, "seconds": None}


@router.get("/api/dettato/anki")
def anki_lesson(deck: str, limit: int = 15):
    return anki_session(deck, max(1, min(limit, 60)))


# Decks that are not Italian listening material (German, USMLE) stay out of the list; override with the env var.
SKIP_DECKS = re.compile(os.environ.get("CHIRON_VERBAL_SKIP_DECKS", r"german|deutsch|goethe|wortliste|anking|step \d"), re.I)
DECK_CACHE_S = 600
_decks_cache: dict = {}


@router.get("/api/dettato/anki-decks")
def anki_decks(fresh: int = 0):
    """Decks holding cards with audio (one findCards per deck, ~8 s for 70 decks), cached DECK_CACHE_S."""
    import anki
    if not fresh and _decks_cache.get("t", 0) > time.time() - DECK_CACHE_S:
        return _decks_cache["v"]
    if not anki.reachable():
        raise HTTPException(503, "Anki is not reachable")
    out = []
    for d in sorted(anki.invoke("deckNames") or []):
        if SKIP_DECKS.search(d):
            continue
        # bare "sound" matches the [sound:…] tag; "[" cannot be escaped in Anki search
        n = len(anki.invoke("findCards", query=f'"deck:{d}" -"deck:{d}::*" sound') or [])
        if n:
            out.append({"deck": d, "cards": n})
    _decks_cache.update(t=time.time(), v={"decks": out})
    return _decks_cache["v"]


@router.get("/api/dettato/anki-media")
def anki_media(f: str, slow: int = 0):
    from fastapi.responses import FileResponse
    import anki
    if not re.fullmatch(r"[\w.\-]+\.(mp3|ogg|wav|m4a|opus)", f or ""):
        raise HTTPException(400, "bad media name")
    MEDIA.mkdir(parents=True, exist_ok=True)
    src = MEDIA / f
    if not src.exists():
        data = anki.media(f)
        if not data:
            raise HTTPException(404, f"Anki has no media file {f}")
        src.write_bytes(data)
    if not slow:
        return FileResponse(src)
    dst = MEDIA / (src.stem + ".slow.mp3")
    if not dst.exists():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", "atempo=0.75", str(dst)], check=True)
    return FileResponse(dst)


def _session_for(b: dict) -> tuple[dict, dict, Path]:
    """(lesson meta, {key: line}, attempts dir). Reference text always comes from the server, never the client."""
    if b.get("deck"):
        ids = [int(a["cardId"]) for a in b.get("answers") or [] if str(a.get("cardId", "")).isdigit()]
        cards = _anki_cards(ids) if ids else {}
        meta = {"slug": _deck_slug(b["deck"]), "title": b["deck"], "context": "Anki listening cards", "source": "anki"}
        return meta, cards, ANKI_DIR / meta["slug"] / "attempts"
    les = _lesson(b.get("slug", ""))
    return les, {ln["n"]: ln for ln in les["lines"]}, ROOT / les["slug"] / "attempts"


@router.post("/api/dettato/judge")
async def judge(req: Request):
    from starlette.concurrency import run_in_threadpool
    b = await req.json()
    les, by_key, att_dir = await run_in_threadpool(_session_for, b)
    anki_src = les.get("source") == "anki"
    rows = []
    for a in b.get("answers") or []:
        ln = by_key.get(int(a.get("cardId") or 0) if anki_src else a.get("n"))
        if not ln:
            continue
        typed, plays, slow = str(a.get("typed") or ""), int(a.get("plays") or 0), int(a.get("slow") or 0)
        c = check(ln["it"], typed)
        rows.append({"n": a.get("n", ln.get("n")), "cardId": ln.get("cardId"), "it": ln["it"], "en": ln.get("en", ""),
                     "typed": typed, "plays": plays, "slow": slow, "listens": listens(plays, slow),
                     "difficulty": difficulty(c["score"], plays, slow), "uncertain": ln.get("uncertain", False),
                     "input": a.get("input", "typed"), "check": c})
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
    anki_res = None
    if anki_src:
        import anki
        reviews = [{"cardId": r["cardId"], "ease": anki_ease(r["check"]["score"], r["plays"], r["slow"])} for r in rows]
        try:
            anki_res = await run_in_threadpool(anki.answer, reviews)
            anki_res["eases"] = {str(r["cardId"]): r["ease"] for r in reviews}
        except Exception as e:
            anki_res = {"ok": False, "written": 0, "of": len(reviews), "detail": f"{type(e).__name__}: {e}"[:300]}
    result = {"slug": les["slug"], "source": les.get("source", "lesson"), "score": score, "rows": rows,
              "lucrezia": notes, "lucrezia_error": err, "reference_added": added, "anki": anki_res,
              "secs": round(time.time() - t, 1), "at": datetime.now().isoformat(timespec="seconds")}
    att_dir.mkdir(parents=True, exist_ok=True)
    (att_dir / (datetime.now().strftime("%Y%m%d-%H%M%S") + ".json")).write_text(json.dumps(result, ensure_ascii=False, indent=1))
    return result


def hardest(att_dir: Path, top: int = 10) -> list[dict]:
    """Lines ranked by mean listens across attempts (then lowest mean score): what this ear keeps missing."""
    agg: dict = {}
    for f in sorted(att_dir.glob("*.json")):
        for r in json.loads(f.read_text()).get("rows", []):
            k = str(r.get("cardId") or r.get("n"))
            a = agg.setdefault(k, {"n": r.get("n"), "cardId": r.get("cardId"), "it": r["it"], "tries": 0,
                                   "listens": 0.0, "score": 0})
            a["tries"] += 1
            a["listens"] += r.get("listens", listens(r.get("plays", 0), r.get("slow", 0)))
            a["score"] += r["check"]["score"]
    out = [{**a, "listens": round(a["listens"] / a["tries"], 1), "score": round(a["score"] / a["tries"])} for a in agg.values()]
    return sorted(out, key=lambda a: (-a["listens"], a["score"]))[:top]


@router.get("/api/dettato/hard")
def hard(slug: str = "", deck: str = ""):
    d = (ANKI_DIR / _deck_slug(deck) if deck else ROOT / _lesson(slug)["slug"]) / "attempts"
    return {"lines": hardest(d) if d.exists() else []}


@router.post("/api/dettato/speak")
async def speak(req: Request):
    from starlette.concurrency import run_in_threadpool
    cid = req.query_params.get("cardId", "")
    if cid.isdigit():
        ln = (await run_in_threadpool(_anki_cards, [int(cid)])).get(int(cid))
        if not ln:
            raise HTTPException(404, "no such Anki card with audio")
    else:
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
OCR_PROMPT = """This is a photo of handwritten Italian: a learner's dictation, written in a notebook.
Copy EXACTLY what is written, letter by letter. This is a test of the writer's listening: do NOT correct spelling,
do NOT add missing accents or apostrophes, do NOT fix grammar, do NOT complete words. If a word is crossed out, skip it.
If a word is illegible write [?].
If the lines start with numbers ("4." or "4)"), return one entry per number. If there are no numbers, return ONE
entry with "n": null holding all the writing in reading order.
Reply ONLY with JSON: {"lines": [{"n": <line number or null>, "text": "<exactly as written>"}]}
Never invent a line or a number."""


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
    lines = [{"n": int(x["n"]) if str(x.get("n", "")).strip().isdigit() else None,
              "text": str(x.get("text", "")).strip()} for x in out.get("lines") or [] if str(x.get("text", "")).strip()]
    return {"lines": lines, "model": model, "secs": round(time.time() - t0, 1),
            "thinking_chars": len(msg.get("thinking") or "")}


@router.post("/api/dettato/photo")
async def photo(req: Request):
    """?slug= (a lesson) or ?count= (an Anki session's line count), and ?n= the line on screen: an unnumbered
    photo is that line's answer; a numbered page fills every line it shows."""
    from starlette.concurrency import run_in_threadpool
    q = req.query_params
    if q.get("count", "").isdigit():
        valid = set(range(1, int(q["count"]) + 1))
    else:
        valid = {ln["n"] for ln in _lesson(q.get("slug", ""))["lines"]}
    image = await req.body()
    if len(image) < 2000:
        raise HTTPException(400, "image too small")
    out = await run_in_threadpool(read_photo, image)
    cur = int(q["n"]) if q.get("n", "").isdigit() else None
    unnumbered = [x for x in out["lines"] if x["n"] is None]
    if unnumbered and cur in valid:
        out["lines"] = [x for x in out["lines"] if x["n"] is not None] + \
                       [{"n": cur, "text": " ".join(x["text"] for x in unnumbered)}]
    out["ignored"] = [x["n"] for x in out["lines"] if x["n"] not in valid]
    out["lines"] = [x for x in out["lines"] if x["n"] in valid]
    return out
