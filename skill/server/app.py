#!/usr/bin/env python3
"""Chiron generate-server — the HTTP API that runs the lesson chains on this box and bakes
audio on the Mac/Atelier. The app (Wizard + Staging) talks to this; it wraps the chain
DISPATCHER (skill/chains/dispatch.py) so one endpoint covers every domain × depth.

Endpoints
  GET  /health                      liveness + chain inventory
  POST /generate                    {domain, subject, depth?, subject_type?, grounding?, images?, stage?, extra?}
                                     → {job_id, slug, depth, chain, status:queued}   (runs async)
  GET  /jobs                         all jobs, newest first
  GET  /jobs/{id}                    one job + derived phase + log tail (poll this for live status)
  POST /accept/{id}                  flip the lesson chiron.json status staged→published + rebuild catalog
  POST /regenerate/{id}  {note?}     re-run the job's chain (note appended to grounding)
  /lessons/**  /library/**           static: open a generated lesson / the faceted library

A generated lesson lands with chiron.json.status='staged' → it shows in the library's
"🟡 Needs Review" band until Accept publishes it. Run:  python3 app.py   (uvicorn :8911)
"""
import json, os, subprocess, sys, threading, uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

SKILL = Path(os.environ.get("CHIRON_SKILL", Path.home() / "Documents/code/chiron/skill"))
GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
STATE = SKILL / "server" / "state"
STATE.mkdir(parents=True, exist_ok=True)
JOBS_FILE = STATE / "jobs.json"
PORT = int(os.environ.get("CHIRON_SERVER_PORT", "8911"))

sys.path.insert(0, str(SKILL / "chains"))
import dispatch  # noqa: E402  the single routing entry point

JOBS: dict = {}
LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save() -> None:
    with LOCK:
        JOBS_FILE.write_text(json.dumps(list(JOBS.values()), indent=2))


def _load() -> None:
    if JOBS_FILE.exists():
        try:
            for j in json.loads(JOBS_FILE.read_text()):
                JOBS[j["id"]] = j
        except Exception:
            pass


# best-effort live phase, derived from the chain's own stdout markers (observability, not control)
_PHASE_MARKERS = [
    ("=== done", "ready"), ("bake", "baking"), ("[phase 5]", "baking"),
    ("assemble", "assembling"), ("[phase 3]", "assembling"),
    ("chapter", "writing"), ("[phase 2]", "writing"), ("content.json", "writing"),
    ("harrison", "grounding"), ("[phase 1]", "grounding"), ("plan", "planning"),
]


def _derive_phase(log: Path, status: str) -> str:
    if status in ("ready", "published", "error", "queued"):
        return status
    if not log.exists():
        return status
    for line in reversed(log.read_text(errors="ignore").splitlines()[-40:]):
        l = line.lower()
        for m, ph in _PHASE_MARKERS:
            if m in l:
                return ph
    return status


def _rebuild_catalog() -> None:
    subprocess.run(["node", str(SKILL / "scripts" / "build-library-index.mjs")],
                   cwd=str(SKILL), capture_output=True)


def _write_status(out: Path, job: dict, status: str) -> None:
    """Merge {status, domain, depth, subject} into the lesson's chiron.json (create if absent)."""
    cj_path = out / "chiron.json"
    cj = {}
    if cj_path.exists():
        try:
            cj = json.loads(cj_path.read_text())
        except Exception:
            cj = {}
    cj["status"] = status
    cj.setdefault("domain", job.get("domain"))
    cj.setdefault("depth", job.get("depth"))
    cj.setdefault("subject", job.get("subject"))
    cj[("accepted" if status == "published" else "generated")] = _now()
    cj_path.write_text(json.dumps(cj, indent=2))


def _ingest_images(images: list, out: Path) -> str:
    """Server-side OCR: run each image through the node ingest adapter → markdown, concatenated.
    Best-effort — a missing adapter or failure yields '' rather than aborting the job."""
    md_parts = []
    adapter = SKILL / "dist" / "ingest-adapters" / "image.js"
    for img in images or []:
        try:
            r = subprocess.run(["node", str(adapter), img], cwd=str(SKILL),
                               capture_output=True, text=True, timeout=120)
            if r.returncode == 0 and r.stdout.strip():
                md_parts.append(r.stdout.strip())
        except Exception:
            pass
    md = "\n\n".join(md_parts)
    if md:
        (out / "_ingest.md").write_text(md)
    return md


def _run_job(job: dict) -> None:
    jid = job["id"]
    log = STATE / f"{jid}.log"
    try:
        res = dispatch.resolve(job["domain"], job.get("depth"), job["subject"],
                               job.get("subject_type"), job.get("extra") or {})
    except SystemExit as e:
        job.update(status="error", error=str(e), finished=_now())
        _save()
        return
    out = GEN / res["slug"]
    out.mkdir(parents=True, exist_ok=True)
    job.update(status="running", slug=res["slug"], chain=res["chain_name"],
               depth=res["depth"], started=_now())
    _save()

    grounding = job.get("grounding") or ""
    if job.get("images"):
        ocr = _ingest_images(job["images"], out)
        if ocr:
            grounding = ocr + ("\n\n" + grounding if grounding else "")
    if grounding.strip():
        (out / "_grounding.md").write_text(grounding)

    env = {**os.environ, **res["env"], "CH_STAGE": job.get("stage", "all")}
    if grounding.strip():
        env["CH_GROUNDING"] = str(out / "_grounding.md")  # chain-dependent consumption

    with open(log, "w") as lf:
        p = subprocess.Popen([sys.executable, res["runpy"]], env=env,
                             stdout=lf, stderr=subprocess.STDOUT)
        job["pid"] = p.pid
        _save()
        rc = p.wait()

    lesson = out / "lesson.html"
    if rc == 0 and lesson.exists():
        _write_status(out, job, "staged")
        _rebuild_catalog()
        job.update(status="ready", rc=rc, lesson_url=f"/lessons/{res['slug']}/lesson.html")
    else:
        job.update(status="error", rc=rc)
    job["finished"] = _now()
    _save()


def _get(jid: str) -> dict:
    j = JOBS.get(jid)
    if not j:
        raise HTTPException(404, f"no job {jid}")
    return j


def _reconcile() -> None:
    """On startup, a job left 'running' (server died) is resolved by checking disk truth."""
    for j in JOBS.values():
        if j.get("status") == "running":
            lesson = GEN / (j.get("slug") or "") / "lesson.html"
            j["status"] = "ready" if lesson.exists() else "error"
            j.setdefault("finished", _now())
    _save()


app = FastAPI(title="Chiron generate-server")
_load()
_reconcile()


class GenReq(BaseModel):
    domain: str = "medicine"
    subject: str
    depth: str | None = None
    subject_type: str | None = None
    grounding: str | None = None
    images: list | None = None      # file paths already on disk (mobile upload lands them here)
    stage: str = "all"              # all = author→assemble→bake; assemble = no bake (fast preview)
    extra: dict = {}


class RegenReq(BaseModel):
    note: str = ""


@app.get("/health")
def health():
    return {"ok": True, "port": PORT, "gen": str(GEN),
            "chains": sorted(f"{d}/{p}" for (d, p) in dispatch.CHAIN),
            "jobs": len(JOBS)}


@app.post("/generate")
def generate(req: GenReq):
    try:
        res = dispatch.resolve(req.domain, req.depth, req.subject, req.subject_type, req.extra)
    except SystemExit as e:
        raise HTTPException(400, str(e))
    jid = uuid.uuid4().hex[:12]
    job = {"id": jid, "created": _now(), "status": "queued", "phase": "queued",
           **req.model_dump(), "slug": res["slug"], "chain": res["chain_name"], "depth": res["depth"]}
    JOBS[jid] = job
    _save()
    threading.Thread(target=_run_job, args=(job,), daemon=True).start()
    return {"job_id": jid, "slug": res["slug"], "depth": res["depth"],
            "chain": res["chain_name"], "status": "queued"}


@app.get("/jobs")
def jobs():
    items = sorted(JOBS.values(), key=lambda j: j.get("created", ""), reverse=True)
    for j in items:
        j["phase"] = _derive_phase(STATE / f"{j['id']}.log", j.get("status", ""))
    return {"jobs": items}


@app.get("/jobs/{jid}")
def job_status(jid: str):
    j = _get(jid)
    log = STATE / f"{jid}.log"
    tail = "\n".join(log.read_text(errors="ignore").splitlines()[-14:]) if log.exists() else ""
    return {**j, "phase": _derive_phase(log, j.get("status", "")), "log_tail": tail}


@app.post("/accept/{jid}")
def accept(jid: str):
    j = _get(jid)
    out = GEN / j["slug"]
    if not (out / "lesson.html").exists():
        raise HTTPException(409, "lesson not built yet")
    _write_status(out, j, "published")
    _rebuild_catalog()
    j["status"] = "published"
    _save()
    return {"ok": True, "slug": j["slug"], "status": "published"}


@app.post("/regenerate/{jid}")
def regenerate(jid: str, body: RegenReq):
    j = _get(jid)
    if body.note:
        j["grounding"] = (j.get("grounding") or "") + f"\n\nReviewer note: {body.note}"
        j["note"] = body.note
    j.update(status="queued", phase="queued")
    _save()
    threading.Thread(target=_run_job, args=(j,), daemon=True).start()
    return {"ok": True, "job_id": jid, "status": "queued"}


# static: open a generated lesson, or the faceted library, straight from the app
app.mount("/lessons", StaticFiles(directory=str(GEN)), name="lessons")
if (GEN / "chiron-library").exists():
    app.mount("/library", StaticFiles(directory=str(GEN / "chiron-library"), html=True), name="library")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
