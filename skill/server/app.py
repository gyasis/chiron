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
import base64, json, os, subprocess, sys, threading, urllib.request, uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
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


def _ts(s: str):
    try:
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def _dur(j: dict):
    """Wall-clock seconds a job has run (started→finished, or started→now if live)."""
    a = _ts(j.get("started") or j.get("created"))
    if not a:
        return None
    b = _ts(j["finished"]) if j.get("finished") else datetime.now(timezone.utc).timestamp()
    return (b - a) if b else None


def _avg_duration(chain, depth):
    """Mean run-time of recent COMPLETED jobs of the same chain — the ETA basis."""
    ds = [d for j in JOBS.values()
          if j.get("status") in ("ready", "published") and j.get("chain") == chain and j.get("finished")
          for d in [_dur(j)] if d and d > 0]
    return sum(ds) / len(ds) if ds else None


def _enrich_job(j: dict, stamp: bool = False) -> bool:
    """Attach live phase + timing (elapsed, per-phase timeline, ETA). Returns True if the timeline changed."""
    changed = False
    ph = _derive_phase(STATE / f"{j['id']}.log", j.get("status", ""))
    j["phase"] = ph
    if j.get("status") in ("queued", "running") and stamp:
        tl = j.setdefault("phase_log", {})
        if ph not in tl and ph not in ("queued",):
            tl[ph] = _now()
            changed = True
    d = _dur(j)
    j["elapsed_seconds"] = round(d) if d is not None else None
    if j.get("status") == "running":
        avg = _avg_duration(j.get("chain"), j.get("depth"))
        j["eta_seconds"] = max(0, round(avg - (d or 0))) if avg else None
        j["eta_basis"] = round(avg) if avg else None
    j.setdefault("source", None)   # None = started in-app / via the server; else a caller-declared origin
    return changed


def _rebuild_catalog() -> None:
    subprocess.run(["node", str(SKILL / "scripts" / "build-library-index.mjs")],
                   cwd=str(SKILL), capture_output=True)


def _bundle_lesson(slug: str) -> None:
    """Package one lesson → chiron-library/lessons/<slug>.chiron (+ lessons.json upsert) so it's downloadable."""
    subprocess.run(["node", str(SKILL / "scripts" / "build-hub-catalog.mjs"), "--only", slug],
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
    # caller-declared provenance (generic — chiron persists whatever the caller sent, it knows no source names)
    if job.get("source"):
        cj["source"] = job["source"]
    if job.get("source_ref"):
        cj["source_ref"] = job["source_ref"]
    cj[("accepted" if status == "published" else "generated")] = _now()
    cj_path.write_text(json.dumps(cj, indent=2))


# OCR the wizard's captured page images through the Atelier governor (R-AG1/AG2 — vision model,
# governed, NOT raw ollama). Host default matches audio-bake.ts's convention (env-overridable).
VLM_URL = os.environ.get("CHIRON_VLM_URL", "http://192.168.0.159:8799/llm/ollama")
VLM_MODEL = os.environ.get("CHIRON_VLM_MODEL", "qwen2.5vl:7b")
_OCR_PROMPT = ("Transcribe this page image to clean Markdown. Preserve every heading, list, table and "
               "clinical fact verbatim; keep drug names, doses and values exact. Output ONLY the transcription.")


OCR_CACHE = {}   # path → transcription (so /suggest and /generate never double-OCR the same photo)
CLASSIFY_MODEL = os.environ.get("CHIRON_CLASSIFY_MODEL", VLM_MODEL)
_CLASSIFY_PROMPT = (
    'You route study material to the right lesson type. Read the SOURCE and return ONLY JSON:\n'
    '{"subject":"<specific lesson topic, 2-5 words>","domain":"medicine|medical-italian|italian",'
    '"depth":"drug|systematic|atlas|primer|amboss|passage|ward|lesson"}\n'
    'Rules: a drug / drug-class / pharmacology page → medicine, drug (subject = the drug or class, e.g. "Alpha-1 blockers"). '
    'A single disease → medicine, systematic. An organ-system overview → medicine, atlas. Several related conditions / a '
    'broad topic → medicine, primer. A multiple-choice EXAM question (options A–E) in Italian → medical-italian, passage. '
    'An Italian clinical/ward scenario → medical-italian, ward. General Italian language text → italian, lesson.\nSOURCE:\n')


def _ocr_image(path: str) -> str:
    """One image → Markdown via the governor's vision lane (cached). Governed, not raw :11434 (R-AG2)."""
    if path in OCR_CACHE:
        return OCR_CACHE[path]
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    body = json.dumps({"model": VLM_MODEL, "stream": False,
                       "messages": [{"role": "user", "content": _OCR_PROMPT, "images": [b64]}]}).encode()
    req = urllib.request.Request(VLM_URL.rstrip("/") + "/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.loads(r.read()).get("message", {}).get("content", "")
    OCR_CACHE[path] = out
    return out


def _classify(text: str) -> dict:
    """OCR'd content → {subject, domain, depth} via the governor (JSON mode)."""
    body = json.dumps({"model": CLASSIFY_MODEL, "stream": False, "format": "json",
                       "messages": [{"role": "user", "content": _CLASSIFY_PROMPT + text[:6000]}]}).encode()
    req = urllib.request.Request(VLM_URL.rstrip("/") + "/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        c = json.loads(r.read()).get("message", {}).get("content", "{}")
    return json.loads(c)


_DRUG_SUFFIXES = ("blocker", "blockers", "inhibitor", "inhibitors", "statin", "sartan", "agonist",
                  "antagonist", "-pril", "olol", "azole", "mycin", "cycline", "parin", "caine")


def _looks_drug(subject: str, text: str) -> bool:
    """Deterministic drug/pharmacology signal — a drug-class page must route to the drug template."""
    s = (subject or "").lower()
    if any(suf in s for suf in _DRUG_SUFFIXES):
        return True
    blob = (text or "")[:3000].lower()
    return sum(k in blob for k in ("mechanism of action", "adverse effect", "indication",
                                   "contraindication", "pharmacokinet", "adrenoceptor", "dosing")) >= 2


_SYS_PROMPT = ("Name the SINGLE best medical system/specialty for this topic. Reply with ONLY the specialty name — e.g. "
               "Immunology, Dermatology, Radiology, Cardiovascular, Neurology, Endocrine, Hematology/Oncology, Infectious "
               "Disease, Nephrology, Gastroenterology, Respiratory, Musculoskeletal, Psychiatry, Reproductive, Genetics. "
               "No other words.\nTopic: ")


def _infer_system(subject: str) -> str:
    """Infer the medical specialty for a subject via the governor (same idea the chain uses) — for the pre-send preview."""
    body = json.dumps({"model": CLASSIFY_MODEL, "stream": False,
                       "messages": [{"role": "user", "content": _SYS_PROMPT + (subject or "")}]}).encode()
    req = urllib.request.Request(VLM_URL.rstrip("/") + "/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        c = (json.loads(r.read()).get("message", {}).get("content", "") or "").strip()
    return c.splitlines()[0].strip().strip('."*').strip()[:48] if c else ""


def _ingest_images(images: list, out: Path) -> str:
    """Captured page images → OCR'd Markdown (concatenated) for the CH_GROUNDING slot.
    Best-effort — governor unreachable / a bad image yields '' rather than aborting the job."""
    parts = []
    for img in images or []:
        try:
            md = _ocr_image(img)
            if md and md.strip():
                parts.append(md.strip())
        except Exception:
            pass
    md = "\n\n---\n\n".join(parts)
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
# 127.0.0.1-only server; allow the library app to call it whichever local origin it's served from.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
_load()
_reconcile()


def _slug_of(ref: str) -> str:
    return JOBS[ref]["slug"] if ref in JOBS else ref


def _job_for_slug(slug: str) -> dict:
    """An existing job for this slug, else synthesize one from the lesson's chiron.json (for slug-only re-gen)."""
    for j in JOBS.values():
        if j.get("slug") == slug:
            return j
    cj = {}
    p = GEN / slug / "chiron.json"
    if p.exists():
        try:
            cj = json.loads(p.read_text())
        except Exception:
            cj = {}
    jid = uuid.uuid4().hex[:12]
    job = {"id": jid, "created": _now(), "status": "queued", "phase": "queued",
           "domain": cj.get("domain", "medicine"), "subject": cj.get("subject", slug),
           "depth": cj.get("depth"), "slug": slug, "stage": "all", "extra": {}}
    JOBS[jid] = job
    return job


class GenReq(BaseModel):
    domain: str = "medicine"
    subject: str
    depth: str | None = None
    subject_type: str | None = None
    grounding: str | None = None
    images: list | None = None      # file paths already on disk (mobile upload lands them here)
    stage: str = "all"              # all = author→assemble→bake; assemble = no bake (fast preview)
    source: str | None = None       # caller-declared origin (generic — e.g. an external study app), runtime DATA only
    source_ref: str | None = None   # the caller's own record id, used to build a "back to source" link
    extra: dict = {}


class RegenReq(BaseModel):
    note: str = ""


class RegisterReq(BaseModel):
    """Register (or update) a job that ran OUTSIDE the server — a CLI dispatcher run, a PromptChain
    script, a Claude Code session — so it shows up in the Activity journal alongside in-app jobs."""
    subject: str
    domain: str = "medicine"
    depth: str | None = None
    chain: str | None = None
    slug: str | None = None
    source: str = "external"        # a human label of the origin: "Claude Code", "CLI", "PromptChain"…
    status: str = "running"         # running → ready | error
    phase: str | None = None
    job_id: str | None = None       # pass the same id at start + end to UPDATE one job


@app.get("/health")
def health():
    return {"ok": True, "port": PORT, "gen": str(GEN),
            "chains": sorted(f"{d}/{p}" for (d, p) in dispatch.CHAIN),
            "jobs": len(JOBS)}


@app.post("/generate")
def generate(req: GenReq):
    if not (req.subject or "").strip():
        raise HTTPException(400, "subject is required — refusing to generate without one")
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
    changed = False
    for j in items:
        changed = _enrich_job(j, stamp=True) or changed
    if changed:
        _save()
    return {"jobs": items}


@app.get("/activity")
def activity(limit: int = 100):
    """The Activity feed — every generation (active + historical) with timing, for the Activity page.
    Resilient to the app closing: this is disk-backed, so a job started hours ago still shows here."""
    items = sorted(JOBS.values(), key=lambda j: j.get("created", ""), reverse=True)[:limit]
    changed = False
    for j in items:
        changed = _enrich_job(j, stamp=True) or changed
    if changed:
        _save()
    active = [j for j in items if j.get("status") in ("queued", "running")]
    history = [j for j in items if j.get("status") not in ("queued", "running")]
    return {"active": active, "history": history,
            "counts": {"active": len(active), "done": len([j for j in history if j.get("status") in ("ready", "published")]),
                       "error": len([j for j in history if j.get("status") == "error"])}}


@app.post("/retry/{jid}")
def retry(jid: str):
    """Re-fire a FAILED job with its original params. Refuses if the lesson already generated —
    a completed/accepted lesson is never redone (the caller should Preview/Accept it instead)."""
    j = _get(jid)
    if j.get("status") in ("ready", "published"):
        raise HTTPException(409, "already generated — a completed lesson is never redone")
    try:
        res = dispatch.resolve(j.get("domain", "medicine"), j.get("depth"), j["subject"],
                               j.get("subject_type"), j.get("extra") or {})
    except SystemExit as e:
        raise HTTPException(400, str(e))
    nid = uuid.uuid4().hex[:12]
    job = {"id": nid, "created": _now(), "status": "queued", "phase": "queued",
           "domain": j.get("domain", "medicine"), "subject": j["subject"], "depth": res["depth"],
           "subject_type": j.get("subject_type"), "grounding": j.get("grounding"),
           "images": j.get("images"), "stage": j.get("stage", "all"),
           "source": j.get("source"), "source_ref": j.get("source_ref"), "extra": j.get("extra") or {},
           "slug": res["slug"], "chain": res["chain_name"], "retry_of": jid}
    JOBS[nid] = job
    _save()
    threading.Thread(target=_run_job, args=(job,), daemon=True).start()
    return {"job_id": nid, "slug": res["slug"], "status": "queued"}


@app.post("/register")
def register(req: RegisterReq):
    """Record/update an externally-run generation in the shared journal (Phase-2 hook — a CLI/Claude Code
    run POSTs status=running at start, then the same job_id with status=ready|error at the end)."""
    jid = req.job_id or ("ext-" + uuid.uuid4().hex[:10])
    j = JOBS.get(jid) or {"id": jid, "created": _now(), "started": _now(), "external": True}
    j.update({k: v for k, v in req.model_dump().items() if v is not None and k != "job_id"})
    j["external"] = True
    if req.status in ("ready", "published", "error"):
        j.setdefault("finished", _now())
    JOBS[jid] = j
    _save()
    return {"job_id": jid, "ok": True}


@app.get("/jobs/{jid}")
def job_status(jid: str):
    j = _get(jid)
    log = STATE / f"{jid}.log"
    tail = "\n".join(log.read_text(errors="ignore").splitlines()[-80:]) if log.exists() else ""
    if _enrich_job(j, stamp=True):
        _save()
    return {**j, "log_tail": tail}


@app.post("/accept/{ref}")
def accept(ref: str):
    """ref = a job id OR a lesson slug (the library is slug-centric). Flip chiron.json → published."""
    slug = _slug_of(ref)
    out = GEN / slug
    if not (out / "lesson.html").exists():
        raise HTTPException(409, "lesson not built yet")
    p = out / "chiron.json"
    prior = {}             # capture caller provenance BEFORE bundling (the bundler regenerates chiron.json fresh)
    if p.exists():
        try:
            prior = json.loads(p.read_text())
        except Exception:
            prior = {}
    _bundle_lesson(slug)   # package → .chiron (this REGENERATES chiron.json as the chiron/1 manifest — no status)
    cj = {}                # so stamp status AFTER bundling, merging onto the manifest the bundler wrote
    if p.exists():
        try:
            cj = json.loads(p.read_text())
        except Exception:
            cj = {}
    cj.update(status="published", accepted=_now())
    cj.setdefault("subject", slug)
    for k in ("source", "source_ref"):   # preserve provenance the bundler dropped
        if prior.get(k) and not cj.get(k):
            cj[k] = prior[k]
    p.write_text(json.dumps(cj, indent=2))
    _rebuild_catalog()     # re-index → picks up published status + bundle=true/sizeMB from disk
    if ref in JOBS:
        JOBS[ref]["status"] = "published"
        _save()
    return {"ok": True, "slug": slug, "status": "published"}


@app.post("/regenerate/{ref}")
def regenerate(ref: str, body: RegenReq):
    """ref = a job id OR a lesson slug. Re-run the same routing, appending the reviewer note to grounding."""
    job = JOBS.get(ref) or _job_for_slug(ref)
    if body.note:
        job["grounding"] = (job.get("grounding") or "") + f"\n\nReviewer note: {body.note}"
        job["note"] = body.note
    job.update(status="queued", phase="queued")
    _save()
    threading.Thread(target=_run_job, args=(job,), daemon=True).start()
    return {"ok": True, "job_id": job["id"], "slug": job["slug"], "status": "queued"}


@app.post("/upload")
async def upload(files: list[UploadFile] = File(...)):
    """Mobile/desktop image capture lands here → saved to disk → returned paths go in /generate `images`."""
    updir = STATE / "uploads"
    updir.mkdir(exist_ok=True)
    paths = []
    for f in files:
        dest = updir / f"{uuid.uuid4().hex[:8]}_{Path(f.filename or 'img').name}"
        dest.write_bytes(await f.read())
        paths.append(str(dest))
    return {"paths": paths}


class SuggestReq(BaseModel):
    images: list = []
    grounding: str | None = None


@app.post("/suggest")
def suggest(req: SuggestReq):
    """Blank-subject helper: OCR the attached photos (cached) → classify → suggested {subject, domain, depth}."""
    parts = []
    for img in req.images or []:
        try:
            md = _ocr_image(img)
            if md and md.strip():
                parts.append(md.strip())
        except Exception:
            pass
    text = "\n\n".join(parts)
    if req.grounding:
        text = (req.grounding + "\n\n" + text).strip()
    if not text.strip():
        raise HTTPException(400, "no readable content to classify")
    try:
        c = _classify(text)
    except Exception as e:
        raise HTTPException(502, f"classify failed: {e}")
    domain = c.get("domain") or "medicine"
    depth = c.get("depth")
    if domain == "medicine" and depth != "drug" and _looks_drug(c.get("subject"), text):
        depth = "drug"   # safety net: a drug-class page → the drug template, whatever the model said
    system = None
    if domain == "medicine":
        try:
            system = _infer_system(c.get("subject") or "")
        except Exception:
            system = None
    return {"subject": c.get("subject"), "domain": domain, "depth": depth, "system": system, "chars": len(text)}


class ResolveReq(BaseModel):
    subject: str = ""
    domain: str = "medicine"
    depth: str | None = None


@app.post("/resolve")
def resolve_preview(req: ResolveReq):
    """Pre-send preview — what the chain will actually get. Infers the medical system from a typed subject."""
    subj = (req.subject or "").strip()
    if not subj:
        raise HTTPException(400, "subject required")
    system = None
    if (req.domain or "medicine") == "medicine":
        try:
            system = _infer_system(subj)
        except Exception:
            system = None
    return {"subject": subj, "domain": req.domain or "medicine", "depth": req.depth, "system": system}


# static: open a generated lesson, or the faceted library, straight from the app
app.mount("/lessons", StaticFiles(directory=str(GEN)), name="lessons")
if (GEN / "chiron-library").exists():
    app.mount("/library", StaticFiles(directory=str(GEN / "chiron-library"), html=True), name="library")


if __name__ == "__main__":
    import uvicorn
    # 127.0.0.1 by default; set CHIRON_SERVER_HOST=0.0.0.0 to let the phone connect + sync over home wifi
    host = os.environ.get("CHIRON_SERVER_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=PORT, log_level="info")
