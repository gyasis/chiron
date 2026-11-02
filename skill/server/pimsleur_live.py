"""pimsleur_live — a live Pimsleur drill: lines are made in order in the background while the client plays the earlier ones.

    POST /api/pimsleur/live            {sentences:[{it, en?}]}  -> {id, n}
    GET  /api/pimsleur/live/{id}       -> {n, lines:[{i, it, en, state, error?, steps:[{kind, text, url, dur, pause, speed}]}]}
    GET  /api/pimsleur/live/{id}/clip/{name}   one audio file of that session

Each line is built with pimsleur_quick.build (one synthesis, one transcription), its steps resolved to audio files that live
inside the session folder (state/pimsleur-live/<id>/), and its slowed copies made locally. A step carries everything the
player needs: the file url, its duration, the answer pause that follows it, and the speed. One worker thread makes the lines
of every session in order, because the Mac TTS is shared: a second session waits behind a running one. The session JSON
(session.json) is rewritten after each line so a later "save as lesson" can concatenate the files.
"""
from __future__ import annotations
import json, os, queue, re, shutil, sys, threading, time, traceback, uuid
from pathlib import Path

from fastapi import APIRouter
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / "scripts"))

ROOT = Path(os.environ.get("CHIRON_PIMSLEUR_STATE", SKILL / "server" / "state")) / "pimsleur-live"
CACHE = ROOT / "cache"                  # synthesized takes and narrator cues, shared by every session
MAX_LINES, MAX_CHARS = 12, 300
CUE_GAP_S = 0.9                         # the silence pimsleur_quick.render puts after a narrator cue
ID_RE = re.compile(r"^[0-9a-f]{12}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+\.wav$")

router = APIRouter()
ORIGIN_OK = None                        # app.py: fn(request) -> True | None | False (the /api/anki/* origin check)

_SESSIONS: dict[str, dict] = {}
_LOCK = threading.Lock()
_QUEUE: "queue.Queue[str]" = queue.Queue()
_WORKER: threading.Thread | None = None
_BAKER = None


def _log(msg: str) -> None:
    sys.stderr.write(f"[pimsleur-live] {msg}\n")
    sys.stderr.flush()


def _reply(status: int, error: str, **kw) -> JSONResponse:
    return JSONResponse({"ok": False, "error": error, **kw}, status_code=status)


def _save(s: dict) -> None:
    d = ROOT / s["id"]
    tmp = d / "session.json.tmp"
    tmp.write_text(json.dumps(s, ensure_ascii=False, indent=1))
    os.replace(tmp, d / "session.json")


def _load(sid: str) -> dict | None:
    with _LOCK:
        s = _SESSIONS.get(sid)
    if s:
        return s
    p = ROOT / sid / "session.json"
    if not p.is_file():
        return None
    try:
        s = json.loads(p.read_text())
    except ValueError as e:
        _log(f"{sid}: session.json unreadable: {e}")
        return None
    for ln in s["lines"]:                # a line left unfinished by a restart cannot finish by itself
        if ln["state"] in ("queued", "making"):
            ln["state"], ln["error"] = "failed", "server restarted before this line was made"
    with _LOCK:
        return _SESSIONS.setdefault(sid, s)


def _baker():
    global _BAKER
    if _BAKER is None:
        import pimsleur_drill as D
        _BAKER = D.Baker(str(CACHE), {})
    return _BAKER


def _place(src: str, sdir: Path) -> str:
    """The file inside the session folder (hard link, else copy) and its name."""
    name = os.path.basename(src)
    dst = sdir / name
    if not dst.exists():
        try:
            os.link(src, dst)
        except OSError:
            shutil.copyfile(src, dst)
    return name


def _make_line(s: dict, ln: dict) -> None:
    import pimsleur_drill as D
    import pimsleur_quick as Q
    from pimsleur_deconstruct import pause_after
    sdir, b = ROOT / s["id"], _baker()
    d = Q.build(ln["it"], str(sdir / "work"), b)
    steps = []
    for st in d["steps"]:
        if "cue" in st:
            clip, text, pause, speed = b.clip("cue", Q.CUES[st["cue"]]), Q.CUES[st["cue"]], CUE_GAP_S, 1.0
            dur = D._dur(clip)
            kind = "cue"
        else:
            speed = st.get("speed", 1.0)
            clip = Q.stretched(d["clips"][st["say"]], speed)
            dur = D._dur(clip)
            pause, text, kind = pause_after(dur, Q.LEVEL), st.get("text", d["text"]), "say"
        steps.append({"kind": kind, "text": text, "url": f"/api/pimsleur/live/{s['id']}/clip/{_place(clip, sdir)}",
                      "dur": round(dur, 2), "pause": round(pause, 2), "speed": speed})
    ln["steps"], ln["times"] = steps, d["times"]


def _work() -> None:
    while True:
        sid = _QUEUE.get()
        s = _load(sid)
        if not s:
            continue
        for ln in s["lines"]:
            if ln["state"] != "queued":
                continue
            ln["state"], t0 = "making", time.time()
            try:
                _make_line(s, ln)
                ln["state"] = "ready"
                _log(f"{sid} line {ln['i'] + 1}/{s['n']} ready in {time.time() - t0:.1f}s {ln['times']}")
            except BaseException as e:   # one bad line must not stop the next ones
                ln["state"], ln["error"] = "failed", f"{type(e).__name__}: {e}"[:300]
                _log(f"{sid} line {ln['i'] + 1}/{s['n']} FAILED for {ln['it']!r}: {traceback.format_exc()}")
            _save(s)


def _ensure_worker() -> None:
    global _WORKER
    with _LOCK:
        if _WORKER is None or not _WORKER.is_alive():
            _WORKER = threading.Thread(target=_work, name="pimsleur-live", daemon=True)
            _WORKER.start()


@router.post("/api/pimsleur/live")
async def start(request: Request):
    if (ORIGIN_OK(request) if ORIGIN_OK else None) is False:
        _log(f"refused origin {request.headers.get('origin')!r}")
        return _reply(403, "origin not allowed")
    try:
        b = await request.json()
    except ValueError:
        b = None
    raw = b.get("sentences") if isinstance(b, dict) else None
    if not isinstance(raw, list) or not raw:
        return _reply(400, "sentences must be a non-empty list of {it, en}")
    lines = []
    for p in raw[:MAX_LINES]:
        it = " ".join(str(p.get("it", "")).split()) if isinstance(p, dict) else ""
        if not it or len(it) > MAX_CHARS:
            return _reply(400, f"each sentence needs an `it` of 1 to {MAX_CHARS} characters")
        lines.append({"i": len(lines), "it": it, "en": str(p.get("en", ""))[:MAX_CHARS], "state": "queued", "steps": []})
    sid = uuid.uuid4().hex[:12]
    s = {"id": sid, "n": len(lines), "created": time.time(), "lines": lines}
    (ROOT / sid).mkdir(parents=True, exist_ok=True)
    with _LOCK:
        _SESSIONS[sid] = s
    _save(s)
    _QUEUE.put(sid)
    _ensure_worker()
    _log(f"{sid}: {len(lines)} lines queued (queue depth {_QUEUE.qsize()})")
    return {"ok": True, "id": sid, "n": len(lines)}


@router.get("/api/pimsleur/live/{sid}")
def state(sid: str):
    s = _load(sid) if ID_RE.match(sid) else None
    if not s:
        return _reply(404, "no such live drill")
    return {"ok": True, "id": s["id"], "n": s["n"],
            "lines": [{k: ln[k] for k in ("i", "it", "en", "state", "error", "steps") if k in ln} for ln in s["lines"]]}


@router.get("/api/pimsleur/live/{sid}/clip/{name}")
def clip(sid: str, name: str):
    p = ROOT / sid / name
    if not (ID_RE.match(sid) and NAME_RE.match(name) and p.is_file()):
        return _reply(404, "no such clip")
    return FileResponse(p, media_type="audio/wav", headers={"cache-control": "private, max-age=3600"})
