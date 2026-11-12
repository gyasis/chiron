"""Videos — the anesthesia video library (Netflix-style rows over locally downloaded YouTube videos).

    GET  /videos                         the page (shell/videos.html)
    GET  /api/videos                     {drive_mounted, videos: [... + local, vtt, thumb]}
    GET  /videos/media/{vid}/{name}      <vid>.mp4 | <vid>.jpg | <vid>.en.vtt from VIDEO_DIR (HTTP Range supported)
    POST /api/videos/{vid}/phone         start or queue a 480p encode for the phone
    GET  /api/videos/{vid}/phone         {state: none|queued|encoding|ready|error, bytes, error}
    GET  /videos/phone/{vid}.mp4         the ready phone copy

VIDEO_DIR comes from CHIRON_VIDEO_DIR. A video that is not downloaded yet, or a drive that is not mounted, simply
reports local=false. Encodes run one at a time on a single worker thread fed by a bounded queue.
"""
import json, os, queue, re, subprocess, sys, threading, time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

import mock_oral

SKILL = mock_oral.SKILL
DEFAULT_DIR = "/media/gyasis/Drive 2/chiron-videos/anesthesia"
CATALOG = Path(os.environ.get("CHIRON_VIDEO_CATALOG", os.path.expanduser("~/Documents/generated/chiron-anesthesia-videos/videos.json")))
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
CACHE_S = 60.0
QUEUE_MAX = 20

router = APIRouter()


def video_dir() -> Path:
    return Path(os.environ.get("CHIRON_VIDEO_DIR", DEFAULT_DIR))


def log(msg: str) -> None:
    print(f"chiron videos: {msg}", file=sys.stderr, flush=True)


def _safe_path(vid: str, name: str, base: Path | None = None) -> Path | None:
    """Resolved path of an allowed media file inside the video dir, else None."""
    if not ID_RE.match(vid) or name not in (vid + ".mp4", vid + ".jpg", vid + ".en.vtt"):
        return None
    base = (base or video_dir()).resolve()
    try:
        p = (base / vid / name).resolve()
        p.relative_to(base)
    except (ValueError, OSError):
        return None
    return p if p.is_file() else None


# ---- catalog + local state -------------------------------------------------------------------------------------

_cache: dict = {"at": 0.0, "key": None, "out": None}
_lock = threading.Lock()


def _catalog() -> list:
    try:
        return json.loads(CATALOG.read_text())
    except FileNotFoundError:
        log(f"catalog missing at {CATALOG}; run scripts/build_video_catalog.py")
    except (OSError, ValueError) as e:
        log(f"catalog unreadable at {CATALOG}: {e}")
    return []


def listing() -> dict:
    base = video_dir()
    key = (str(base), str(CATALOG))
    with _lock:
        if _cache["out"] is not None and _cache["key"] == key and time.time() - _cache["at"] < CACHE_S:
            return _cache["out"]
    mounted = base.is_dir()
    present = set()
    if mounted:
        try:
            present = {e.name for e in os.scandir(base) if e.is_dir()}
        except OSError as e:
            log(f"cannot list {base}: {e}")
            mounted = False
    vids = []
    for v in _catalog():
        d = dict(v)
        vid = v["id"]
        has = vid in present
        d["local"] = has and (base / vid / f"{vid}.mp4").is_file()
        d["vtt"] = has and (base / vid / f"{vid}.en.vtt").is_file()
        d["thumb"] = has and (base / vid / f"{vid}.jpg").is_file()
        vids.append(d)
    out = {"drive_mounted": mounted, "videos": vids}
    with _lock:
        _cache.update(at=time.time(), key=key, out=out)
    return out


@router.get("/videos")
def page():
    return HTMLResponse((SKILL / "shell" / "videos.html").read_text(),
                        headers={"Cache-Control": "no-cache, must-revalidate"})


@router.get("/api/videos")
def api_videos():
    return listing()


@router.get("/videos/media/{vid}/{name}")
def media(vid: str, name: str):
    p = _safe_path(vid, name)
    if p is None:
        raise HTTPException(404, "no such video file")
    return FileResponse(p)


# ---- phone copy ------------------------------------------------------------------------------------------------

_jobs: dict = {}                       # vid -> {"state", "error"}; one entry per requested video
_q: "queue.Queue[str]" = queue.Queue(maxsize=QUEUE_MAX)
_jlock = threading.Lock()
_worker: threading.Thread | None = None


def phone_path(vid: str) -> Path:
    return video_dir() / "phone" / f"{vid}.mp4"


def ffmpeg_cmd(src: Path, tmp: Path) -> list:
    return ["nice", "-n", "10", "ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", "scale=-2:480",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "64k", "-ac", "1",
            "-movflags", "+faststart", str(tmp)]


def _encode(vid: str) -> None:
    src = _safe_path(vid, vid + ".mp4")
    if src is None:
        raise RuntimeError(f"source {vid}.mp4 is not on the drive")
    dst = phone_path(vid)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f".{vid}.part.mp4")
    r = subprocess.run(ffmpeg_cmd(src.resolve(), tmp.resolve()), capture_output=True, text=True)
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg exit {r.returncode}: {(r.stderr or '').strip()[-300:]}")
    os.replace(tmp, dst)


def _run() -> None:
    while True:
        vid = _q.get()
        with _jlock:
            _jobs[vid] = {"state": "encoding", "error": None}
        t0 = time.time()
        try:
            _encode(vid)
            with _jlock:
                _jobs[vid] = {"state": "ready", "error": None}
            log(f"phone copy ready {vid} in {time.time() - t0:.0f}s")
        except Exception as e:
            log(f"phone encode failed for {vid}: {e}")
            with _jlock:
                _jobs[vid] = {"state": "error", "error": str(e)}
        finally:
            _q.task_done()


def _ensure_worker() -> None:
    global _worker
    with _jlock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="video-phone-encoder", daemon=True)
            _worker.start()


def phone_status(vid: str) -> dict:
    p = phone_path(vid)
    with _jlock:
        j = _jobs.get(vid)
    if j and j["state"] in ("queued", "encoding", "error"):
        return {"state": j["state"], "bytes": 0, "error": j["error"]}
    if p.is_file():
        return {"state": "ready", "bytes": p.stat().st_size, "error": None}
    return {"state": "none", "bytes": 0, "error": None}


@router.get("/api/videos/{vid}/phone")
def phone_get(vid: str):
    if not ID_RE.match(vid):
        raise HTTPException(404, "bad video id")
    return phone_status(vid)


@router.post("/api/videos/{vid}/phone")
def phone_post(vid: str):
    if not ID_RE.match(vid):
        raise HTTPException(404, "bad video id")
    st = phone_status(vid)
    if st["state"] in ("queued", "encoding", "ready"):
        return st
    if _safe_path(vid, vid + ".mp4") is None:
        raise HTTPException(404, "this video is not downloaded yet")
    with _jlock:
        _jobs[vid] = {"state": "queued", "error": None}
    try:
        _q.put_nowait(vid)
    except queue.Full:
        with _jlock:
            _jobs.pop(vid, None)
        log(f"phone queue full ({QUEUE_MAX}); refused {vid}")
        raise HTTPException(429, f"{QUEUE_MAX} phone copies are already queued; try again later")
    _ensure_worker()
    return phone_status(vid)


@router.get("/videos/phone/{vid}.mp4")
def phone_file(vid: str):
    if not ID_RE.match(vid):
        raise HTTPException(404, "bad video id")
    p = phone_path(vid)
    if not p.is_file():
        raise HTTPException(404, "no phone copy yet")
    return FileResponse(p, filename=f"{vid}-phone.mp4")
