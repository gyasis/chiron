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
import base64, json, os, re, signal, subprocess, sys, threading, time, urllib.request, uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
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
import queue as _queuemod
_BAKE_Q: "_queuemod.Queue" = _queuemod.Queue()   # rebakes queue here; one worker bakes them one at a time
_GEN_Q: "_queuemod.Queue" = _queuemod.Queue()    # GENERATION queue — Chiron (the server) owns concurrency,
GEN_CONC = int(os.environ.get("CHIRON_GEN_CONC", "2") or 2)  # not the client. Clients push all; N workers drain.
_CANCELLED: set = set()   # slugs cancelled while still queued → the bake worker skips them when popped
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
    # 'baking' is authoritative — don't let the OLD generation log (which ends '=== done')
    # override a live re-bake back to a stale 'ready'/'writing' phase.
    if status in ("ready", "published", "error", "queued", "baking"):
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
    else:
        j["eta_seconds"] = None; j["eta_basis"] = None   # baking/queued/done → no stale generation ETA
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


def _log_error_tail(log: Path, n: int = 6) -> str:
    """Mine a chain log for WHY it failed — traceback / API error / rate-limit / bad-JSON / assertion —
    skipping the noisy litellm INFO chatter. Returns a compact one-line reason for the timeline + job.error."""
    try:
        lines = log.read_text(errors="ignore").splitlines()
    except Exception:
        return ""
    keys = ("traceback", "error", "exception", "rate limit", "ratelimit", "429", "401", "403",
            "invalid", "refus", "timeout", "timed out", "max retr", "empty response", "assert",
            "not found", "connection", "unauthor", "quota", "overloaded")
    noise = ("litellm completion()", "litellm:info", "- info -", "preprompt:", "scan complete")
    hits = [l.strip() for l in lines[-160:]
            if any(k in l.lower() for k in keys) and not any(nz in l.lower() for nz in noise)]
    if hits:
        return " · ".join(hits[-n:])[:400]
    # No explicit error logged → a SILENT death (process killed by a signal: server restart / OOM /
    # cancel), NOT a chain exception. Report the last real step it reached so it isn't a blank 'error'.
    steps = [l.strip() for l in lines if l.strip().startswith("[phase") or " chapter " in l.lower()]
    if steps:
        return "no error logged — process was killed (restart/OOM/cancel) during: " + steps[-1][:180]
    return (lines[-1].strip()[:200] if lines else "")


def _lesson_complete(out: Path, log: Path):
    """After an rc==0 run, verify the lesson is actually COMPLETE — all planned chapters authored, no
    failed widgets, not a stub. Catches a chain that skipped a broken step and assembled a PARTIAL lesson
    that would otherwise be served as 'ready'. Returns (ok: bool, reason: str)."""
    try:
        text = log.read_text(errors="ignore")
    except Exception:
        text = ""
    m = re.search(r"authored\s+(\d+)\s*/\s*(\d+)\s+chapters", text)
    if m and int(m.group(1)) < int(m.group(2)):
        return False, f"only {m.group(1)}/{m.group(2)} chapters authored"
    m2 = re.search(r"Total rendered:\s*(\d+)\s*/\s*(\d+)\s+widgets\s*\((\d+)\s+failed\)", text)
    if m2 and int(m2.group(3)) > 0:
        return False, f"{m2.group(3)} widget(s) failed to render"
    try:
        if (out / "lesson.html").stat().st_size < 5000:
            return False, "lesson.html is a stub (<5 KB) — assemble produced almost nothing"
    except Exception:
        pass
    return True, ""


_FAILURES_FILE = STATE / "failures.jsonl"

def _record_failure(job: dict, reason: str, kind: str = "error") -> None:
    """Durable, queryable audit trail of every failure/incomplete → state/failures.jsonl. Lets us
    identify what broke and flag it for rerun (kind: died | incomplete | error)."""
    try:
        with open(_FAILURES_FILE, "a") as f:
            f.write(json.dumps({"ts": _now(), "slug": job.get("slug"), "id": job.get("id"),
                                "domain": job.get("domain"), "depth": job.get("depth"),
                                "kind": kind, "rc": job.get("rc"), "reason": (reason or "")[:400]}) + "\n")
    except Exception:
        pass


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

    # CH_SLUG: tell the chain the EXACT output slug the server will look for, so its self-computed slug
    # can never diverge (the 5α-reductase '-drug' vs '-systematic' mismatch). Chains honor it if they read it.
    env = {**os.environ, **res["env"], "CH_STAGE": job.get("stage", "all"), "CH_SLUG": res["slug"]}
    if grounding.strip():
        env["CH_GROUNDING"] = str(out / "_grounding.md")  # chain-dependent consumption

    # AUTO-RETRY (3×): a dropped/failed step is re-run — the chain RESUMES from where it died (completed
    # chapters are skipped), so each attempt makes progress. We recognize the failure signal (traceback /
    # rate-limit / partial lesson / silent kill), record it, back off (longer on a rate-limit), and retry.
    MAX_TRIES, last_err, rc = 3, "", -1
    lesson = out / "lesson.html"
    for attempt in range(1, MAX_TRIES + 1):
        with open(log, "w" if attempt == 1 else "a") as lf:   # keep the log history across retries
            if attempt > 1:
                lf.write(f"\n=== AUTO-RETRY {attempt}/{MAX_TRIES} — resuming (prev: {last_err[:150]}) ===\n"); lf.flush()
                _append_step(out, {"kind": "event", "event_type": "STEP_ERROR",
                                   "step_instruction": f"↻ auto-retry {attempt}/{MAX_TRIES} (resuming): {last_err[:120]}"})
            p = subprocess.Popen([sys.executable, res["runpy"]], env=env, stdout=lf, stderr=subprocess.STDOUT)
            job.update(pid=p.pid, status="running", phase="running"); _save()
            rc = p.wait()
        ok, why = (_lesson_complete(out, log) if (rc == 0 and lesson.exists()) else (False, ""))
        if rc == 0 and lesson.exists() and ok:
            _write_status(out, job, "staged")
            _rebuild_catalog()
            job.update(status="ready", rc=rc, lesson_url=f"/lessons/{res['slug']}/lesson.html", error=None,
                       finished=_now())
            _save()
            return
        # failed this attempt — capture the REAL reason, record it durably, back off, and (if tries remain) resume
        last_err = ("unfinished — " + why) if (rc == 0 and lesson.exists()) else \
                   (_log_error_tail(log) or f"chain exited rc={rc}; no lesson.html produced")
        _record_failure(job, last_err, kind=(("incomplete" if (rc == 0 and lesson.exists()) else "died") + f"/try{attempt}"))
        if attempt < MAX_TRIES:
            time.sleep(15 if ("rate" in last_err.lower() or "429" in last_err or "quota" in last_err.lower()) else 4)
    # exhausted all retries → final failure, surfaced on the timeline + recorded
    job.update(status="error", rc=rc, error=last_err, finished=_now())
    _append_step(out, {"kind": "event", "event_type": "STEP_ERROR",
                       "step_instruction": f"✗ failed after {MAX_TRIES} auto-retries — {last_err}",
                       "metadata": {"error": last_err}})
    _save()


def _append_step(out: Path, rec: dict) -> None:
    """Append one observability record to a lesson's steps.jsonl (best-effort — never raises)."""
    try:
        rec = {**rec, "ts": _now()}
        with open(out / "steps.jsonl", "a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _recovery(slug: str) -> dict:
    """What already exists for a lesson (from disk + the per-lesson SQLite audio_clips table) — so a
    retry can reuse it and never redo work. Drives the 🔥 needs-rebake pill + the recovery message."""
    out = GEN / slug
    text = (out / "lesson.html").exists()
    breakdown = (out / "breakdown.json").exists()
    scripts = (out / "audio-scripts.json").exists()
    done = total = failed = 0
    missing = []
    db = out / ".chiron-state.db"
    if db.exists():
        c = None
        try:
            import sqlite3
            # short timeout + never block on a write-lock (a lesson mid-bake) — a status peek must be instant
            c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=0.3)
            c.execute("PRAGMA busy_timeout=200")
            for art, sid, st in c.execute("SELECT artifact, section_id, status FROM audio_clips"):
                total += 1
                if st in ("done", "reused"): done += 1
                elif st == "failed": failed += 1
                else: missing.append(sid or art)
        except Exception:
            pass
        finally:
            if c is not None:
                try: c.close()
                except Exception: pass
    if total == 0 and (out / "audio").exists():          # no db rows → fall back to counting mp3s
        done = len(list((out / "audio").rglob("*.mp3")))
    audio_complete = total > 0 and done >= total and failed == 0
    return {"slug": slug, "text": text, "breakdown": breakdown, "scripts": scripts,
            "clips_done": done, "clips_total": total, "clips_failed": failed,
            "audio_complete": audio_complete, "needs_rebake": bool(text and not audio_complete),
            "missing": missing[:12]}


def _bake_worker() -> None:
    """Single worker: bakes queued lessons one at a time (the Mac TTS can't take parallel bakes)."""
    while True:
        slug = _BAKE_Q.get()
        try:
            if slug in _CANCELLED:                       # cancelled while still in the queue → skip it
                _CANCELLED.discard(slug)
                j = next((x for x in JOBS.values() if x.get("slug") == slug
                          and x.get("status") in ("queued", "baking")), None)
                if j:
                    lesson = GEN / slug / "lesson.html"
                    j.update(status="audio-failed" if lesson.exists() else "cancelled",
                             phase="cancelled", finished=_now())
                    _save()
                continue
            _run_bake(_job_for_slug(slug), GEN / slug)
        except Exception:
            pass
        finally:
            _BAKE_Q.task_done()


# ── central corpus (Postgres 127.0.0.1:5442) — accept-time migration + verify + sunset ─────────
def _pg():
    import psycopg, os
    dsn = os.environ.get("CHIRON_PG_DSN")
    if not dsn:
        envf = Path.home() / ".chiron" / "corpus.env"
        if envf.exists():
            for line in envf.read_text().splitlines():
                if line.startswith("CHIRON_PG_DSN="):
                    dsn = line.split("=", 1)[1].strip()
    if not dsn:
        raise RuntimeError("CHIRON_PG_DSN not set (see ~/.chiron/corpus.env)")
    return psycopg.connect(dsn, autocommit=True)


def _ems(v):   # sqlite epoch-ms int → aware datetime
    from datetime import datetime, timezone
    try: return datetime.fromtimestamp(int(v) / 1000.0, tz=timezone.utc) if v else None
    except Exception: return None


# ── captured_items — the ONE store behind the unified learning protocol ─────────────────
# ⭐ starred tutor answers · 🖉 highlighted term pills · 📌 SSM collected items all land here.
# PROVENANCE IS THE VALUE: a bare term makes garbage cards; the term + the section it came from
# + the answer that explained it makes a good one. So we store the context, never just the string.
# PRD: prd/chiron_unified_learning_protocol_2026-07-17.md
_CAPTURE_DDL = """
create table if not exists captured_items (
  id               bigserial primary key,
  kind             text not null,              -- term | answer | note
  text             text not null,              -- the handle (the term, or a short title)
  question         text,                       -- what the learner asked (kind=answer)
  source_answer    text,                       -- the explanation that taught it
  surrounding_text text,                       -- the section text it was captured from
  lesson_slug      text,
  section_id       text,
  concept          text,
  model            text,
  source           text,                       -- tutor | ssm-collect | …
  created_at       timestamptz not null default now(),
  processed_at     timestamptz                 -- null = unprocessed (drives the inbox count)
);
create index if not exists captured_items_slug_idx   on captured_items(lesson_slug);
create index if not exists captured_items_unproc_idx on captured_items(processed_at) where processed_at is null;
create index if not exists captured_items_fts_idx    on captured_items using gin(
  to_tsvector('english', coalesce(text,'') || ' ' || coalesce(question,'') || ' ' || coalesce(source_answer,''))
);
"""
_capture_ready = False

def _ensure_capture_schema() -> None:
    """Idempotent, self-healing: create captured_items on first use (the corpus schema was applied
    out-of-band, so ship the DDL with the code rather than depending on a manual migration)."""
    global _capture_ready
    if _capture_ready:
        return
    with _pg() as pg:
        pg.cursor().execute(_CAPTURE_DDL)
    _capture_ready = True


# ── images — RETRIEVED visual assets (radiology / signs / pathways / ecg / algorithms) ──────
# Bytes live content-addressed on disk (dedup by sha — the economy rule: never re-store the same
# image); this row is the recapture INDEX + provenance (retrieved-from / license), sibling to
# captured_items. We NEVER fabricate a medical image — only persist what hypersearch retrieved.
IMG_STORE = GEN / "chiron-assets" / "images"

_IMAGES_DDL = """
create table if not exists images (
  id            bigserial primary key,
  sha           text not null unique,          -- content hash → the bytes on disk
  ext           text,
  kind          text,                          -- radiograph|derm-sign|ecg|pathway|mechanism|algorithm|figure
  concept       text,                          -- what it illustrates
  caption       text,
  source_type   text not null default 'retrieved',  -- retrieved | generated
  source_url    text,                          -- origin page (provenance)
  source_domain text,
  license       text,
  engine        text,                          -- brave | openserp | …
  width         int,
  height        int,
  bytes         int,
  capture_id    bigint,                        -- the captured_items row it rode in on (nullable)
  lesson_slug   text,                          -- set when copied into a lesson bundle (deferred use)
  created_at    timestamptz not null default now()
);
create index if not exists images_concept_idx on images(concept);
create index if not exists images_kind_idx    on images(kind);
create index if not exists images_fts_idx     on images using gin(
  to_tsvector('english', coalesce(concept,'') || ' ' || coalesce(caption,'') || ' ' || coalesce(source_domain,''))
);
"""
_images_ready = False


def _ensure_images_schema() -> None:
    """Idempotent, self-healing: create images on first use + the on-disk asset store dir."""
    global _images_ready
    if _images_ready:
        return
    with _pg() as pg:
        pg.cursor().execute(_IMAGES_DDL)
    IMG_STORE.mkdir(parents=True, exist_ok=True)
    _images_ready = True


_IMG_EXT = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif",
            "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif"}


def _store_image(url: str, meta: dict | None = None) -> dict:
    """Download a RETRIEVED image → content-addressed asset store (dedup by sha) + an images row.
    meta carries concept/caption/kind/source_url/source_domain/license/engine/width/height/capture_id.
    Returns {sha, path, id, deduped}. Never generates — only persists what was retrieved."""
    import hashlib, urllib.request
    meta = meta or {}
    _ensure_images_schema()
    req = urllib.request.Request(url, headers={"User-Agent": "chiron/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        data = r.read(12 * 1024 * 1024)                     # 12 MB cap — bounded
    if not data:
        raise RuntimeError("empty image body")
    sha = hashlib.sha256(data).hexdigest()
    tail = url.rsplit("/", 1)[-1]
    ext = _IMG_EXT.get(ctype) or (tail.rsplit(".", 1)[-1].split("?")[0][:4].lower() if "." in tail else "jpg")
    path = IMG_STORE / f"{sha}.{ext}"
    if not path.exists():
        path.write_bytes(data)
    with _pg() as pg:
        cur = pg.cursor()
        cur.execute("select id from images where sha=%s", (sha,))
        row = cur.fetchone()
        if row:
            return {"sha": sha, "path": str(path), "id": row[0], "deduped": True}
        cur.execute("""insert into images
              (sha,ext,kind,concept,caption,source_type,source_url,source_domain,license,engine,width,height,bytes,capture_id,lesson_slug)
              values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
              (sha, ext, meta.get("kind"), meta.get("concept"), (meta.get("caption") or "")[:600],
               meta.get("source_type", "retrieved"), meta.get("source_url") or url, meta.get("source_domain"),
               meta.get("license"), meta.get("engine"), meta.get("width"), meta.get("height"),
               len(data), meta.get("capture_id"), meta.get("lesson_slug")))
        new_id = cur.fetchone()[0]
    return {"sha": sha, "path": str(path), "id": new_id, "deduped": False}


# per-lesson study tables → (pg upsert). counts returned for verify.
def _migrate_lesson_to_corpus(slug: str) -> dict:
    import sqlite3
    out = GEN / slug
    rec = _recovery(slug)
    cat = {}
    try:
        idx = json.loads((GEN / "chiron-library" / "library.index.json").read_text())
        cat = next((l for l in idx.get("lessons", []) if l.get("id") == slug), {})
    except Exception: pass
    cj = {}
    if (out / "chiron.json").exists():
        try: cj = json.loads((out / "chiron.json").read_text())
        except Exception: pass
    counts = {}
    with _pg() as pg:
        c = pg.cursor()
        c.execute("""insert into lessons(slug,title,subject,system,domain,source_ref,trend,clips_done,clips_total,needs_rebake,status,accepted_at)
            values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
            on conflict(slug) do update set title=excluded.title,subject=excluded.subject,system=excluded.system,domain=excluded.domain,
              source_ref=excluded.source_ref,trend=excluded.trend,clips_done=excluded.clips_done,clips_total=excluded.clips_total,
              needs_rebake=excluded.needs_rebake,status='published',accepted_at=coalesce(lessons.accepted_at,now())""",
            (slug, cat.get("title"), cat.get("subject"), cat.get("system"), cat.get("domain"),
             cat.get("source_ref") or cj.get("source_ref"), cat.get("trend"),
             rec["clips_done"], rec["clips_total"], rec["needs_rebake"], "published"))
        counts["lessons"] = 1
        db = out / ".chiron-state.db"
        if db.exists():
            sq = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            def rows(t):
                try:
                    cur = sq.execute(f"select * from {t}")
                    cols = [d[0] for d in cur.description]
                    return [dict(zip(cols, r)) for r in cur.fetchall()]
                except Exception: return []
            n = 0
            for d in rows("quiz_attempts"):
                c.execute("""insert into quiz_attempts(lesson_slug,learner_id,chapter_id,question_id,variant_id,selected_answer,is_correct,confidence,attempted_at)
                    values(%s,'gyasi',%s,%s,%s,%s,%s,%s,%s) on conflict do nothing""",
                    (slug, d.get("chapter_id"), d.get("question_id"), d.get("variant_id"), d.get("selected_answer"),
                     d.get("correct") == 1, d.get("confidence"), _ems(d.get("timestamp")))); n += 1
            counts["quiz_attempts"] = n
            n = 0
            for d in rows("mastery"):
                c.execute("""insert into mastery(lesson_slug,learner_id,concept_id,score,last_reviewed_at) values(%s,'gyasi',%s,%s,%s)
                    on conflict(lesson_slug,learner_id,concept_id) do update set score=excluded.score,last_reviewed_at=excluded.last_reviewed_at""",
                    (slug, d.get("concept_id"), d.get("score"), _ems(d.get("last_reviewed_at")))); n += 1
            counts["mastery"] = n
            n = 0
            for d in rows("sr_cards"):
                c.execute("""insert into sr_cards(lesson_slug,learner_id,chapter_id,concept_id,card_type,front,back,tags,ease_factor,interval_days,repetitions,next_due_at,last_reviewed_at,suspended)
                    values(%s,'gyasi',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict(lesson_slug,learner_id,concept_id,card_type,front) do update
                    set ease_factor=excluded.ease_factor,interval_days=excluded.interval_days,repetitions=excluded.repetitions,
                        next_due_at=excluded.next_due_at,last_reviewed_at=excluded.last_reviewed_at,suspended=excluded.suspended""",
                    (slug, d.get("chapter_id"), d.get("concept_id"), d.get("card_type"), d.get("front"), d.get("back"), d.get("tags"),
                     d.get("ease_factor"), d.get("interval_days"), d.get("repetitions"), _ems(d.get("next_due_at")),
                     _ems(d.get("last_reviewed_at")), bool(d.get("suspended")))); n += 1
            counts["sr_cards"] = n
            n = 0
            for d in rows("weakness_log"):
                c.execute("""insert into weakness_log(lesson_slug,learner_id,concept_id,error_pattern,occurred_at) values(%s,'gyasi',%s,%s,%s) on conflict do nothing""",
                    (slug, d.get("concept_id"), d.get("error_pattern"), _ems(d.get("timestamp")))); n += 1
            counts["weakness_log"] = n
            n = 0
            for d in rows("chapter_completion"):
                c.execute("""insert into chapter_completion(lesson_slug,learner_id,chapter_id,completed_at) values(%s,'gyasi',%s,%s)
                    on conflict(lesson_slug,learner_id,chapter_id) do update set completed_at=excluded.completed_at""",
                    (slug, d.get("chapter_id"), _ems(d.get("completed_at")))); n += 1
            counts["chapter_completion"] = n
            n = 0
            for d in rows("bookmarks"):
                c.execute("""insert into bookmarks(lesson_slug,learner_id,chapter_id,scroll_position,last_visited_at,note) values(%s,'gyasi',%s,%s,%s,%s) on conflict do nothing""",
                    (slug, d.get("chapter_id"), d.get("scroll_position"), _ems(d.get("last_visited_at")), d.get("note"))); n += 1
            counts["bookmarks"] = n
            counts["_sr_review_log_skipped"] = len(rows("sr_review_log"))  # needs card-id remap; deferred (0 now)
            sq.close()
    return counts


def _verify_migration(slug: str) -> dict:
    """Row-count match between the per-lesson SQLite and Postgres — the gate before sunset."""
    import sqlite3
    out = GEN / slug
    db = out / ".chiron-state.db"
    checks, ok = {}, True
    tabs = ["quiz_attempts", "mastery", "sr_cards", "weakness_log", "chapter_completion", "bookmarks"]
    sq = sqlite3.connect(f"file:{db}?mode=ro", uri=True) if db.exists() else None
    with _pg() as pg:
        c = pg.cursor()
        for t in tabs:
            s = 0
            if sq:
                try: s = sq.execute(f"select count(*) from {t}").fetchone()[0]
                except Exception: s = 0
            c.execute(f"select count(*) from {t} where lesson_slug=%s", (slug,))
            p = c.fetchone()[0]
            checks[t] = {"sqlite": s, "postgres": p, "ok": p >= s}
            ok = ok and p >= s
    if sq: sq.close()
    return {"verified": ok, "checks": checks}


def _sunset_sqlite(slug: str) -> dict:
    """Delete a lesson's per-lesson SQLite — ONLY safe after accept + verified migration. GATED: caller
    must pass a verified state. (Not auto-fired on accept yet — accepted lessons still write locally until
    the lesson player is switched to POST to the corpus API.)"""
    out = GEN / slug
    removed = []
    for suf in (".chiron-state.db", ".chiron-state.db-wal", ".chiron-state.db-shm"):
        f = out / suf
        if f.exists():
            try: f.unlink(); removed.append(suf)
            except Exception: pass
    return {"sunset": removed}


_BAKE_TAG = "[chiron][audio-bake]"

def _emit_bake_event(out: Path, line: str) -> "str | None":
    """Turn one bake-subprocess line into a per-clip sub-chip on the 'Baking audio' timeline —
    each section/clip shows its own status (reused · baking · baked · failed). Returns the TERMINAL
    status ('reused'|'baked'|'failed') when a clip finishes (so the caller can count progress), else None."""
    s = line.strip()
    if _BAKE_TAG not in s:
        return None
    body = s.split(_BAKE_TAG, 1)[1].strip()
    def _clip(name: str) -> str:
        return name.split("/", 1)[1] if name.startswith("section/") else name
    inst, status = None, None
    try:
        if body.startswith("reused "):
            inst = "♻ " + _clip(body[7:].split(" ")[0]) + " — reused"; status = "reused"
        elif body.startswith("FAILED "):
            inst = "⚠ " + _clip(body[7:].split(":", 1)[0].strip()) + " — failed"; status = "failed"
        elif ": segment " in body:
            name, seg = body.split(": segment ", 1)
            cur, _, tot = seg.split(" ")[0].partition("/")
            if "produced by" in body and cur == tot:            # last segment → section done
                inst = "✓ " + _clip(name) + " — baked"; status = "baked"
            elif cur == "1" and "synth" in body:                # first segment → section started
                inst = "🎙 " + _clip(name) + " — baking (" + (tot or "?") + " seg)"
    except Exception:
        return None
    if inst:
        _append_step(out, {"kind": "event", "phase": "Baking audio",
                           "event_type": "CLIP", "step_instruction": inst})
    return status


_BAKE_RATE_FILE = STATE / "bake_rate.json"

def _bake_rate() -> "float | None":
    """Learned avg seconds to bake ONE clip (EMA over past bakes) — the ETA prior. None until we have data."""
    try:
        return float(json.loads(_BAKE_RATE_FILE.read_text()).get("sec_per_clip")) or None
    except Exception:
        return None

def _update_bake_rate(sec_per_clip: float) -> None:
    """Blend this bake's measured per-clip time into the running average (EMA, α=0.3) — sharpens the ETA."""
    if sec_per_clip <= 0:
        return
    prev = _bake_rate()
    new = sec_per_clip if prev is None else (0.3 * sec_per_clip + 0.7 * prev)
    try:
        _BAKE_RATE_FILE.write_text(json.dumps({"sec_per_clip": round(new, 1)}))
    except Exception:
        pass


def _run_bake(job: dict, out: Path) -> None:
    """Phase 2 — bake audio into an already-written lesson (reuses done clips by hash). Non-fatal:
    the lesson stays viewable regardless; only the audio state changes."""
    jid = job["id"]
    log = STATE / f"{jid}.bake.log"
    domain = job.get("domain", "medical-italian")
    bake_domain = "language-it" if domain == "medical-italian" else "medicine"
    # persona MUST match what the generation chain used, else opts.voices (filtered to the persona's
    # declared voice ids) won't contain the segments' voice → "no voice ref registered". Medicine =
    # 'pauls-tutor' (HYPHEN — the pack dir id; every medicine chain passes --persona pauls-tutor;
    # activePersonaFor('medicine') is unset in active.json so it must be explicit). NOT 'pauls_tutor'.
    persona = "lucrezia" if domain == "medical-italian" else (job.get("persona") or "pauls-tutor")
    cmd = ["node", str(SKILL / "scripts" / "bake-lesson-audio.mjs"), str(out),
           "--domain", bake_domain, "--persona", persona]
    job.update(status="baking", phase="baking", started=_now(), finished=None)  # finished=None: this job is RE-running, drop the old end time (else elapsed goes negative)
    _save()
    # announce the recovery into the timeline: what's reused vs what we bake (so we never redo text)
    rec = _recovery(job["slug"])
    _append_step(out, {"kind": "phase", "name": "Baking audio", "status": "start"})
    recovered = "Recovered: text " + ("✓" if rec["text"] else "✗") + \
                (f", {rec['clips_done']}/{rec['clips_total']} audio clips ✓ → rebaking {rec['clips_total'] - rec['clips_done']} remaining"
                 if rec["clips_total"] else " → baking audio")
    _append_step(out, {"kind": "event", "phase": "Baking audio", "event_type": "RECOVERY",
                       "step_instruction": recovered, "metadata": {**rec}})
    # tqdm-style progress + ETA on the 'Baking audio' header: count clips done/total, estimate time
    # left from the live pace blended with the learned per-clip rate (sharpens across bakes).
    total = rec.get("clips_total") or 0
    prior = _bake_rate()
    t0 = datetime.now(timezone.utc).timestamp()
    done, baked_n = 0, 0
    def _eta_txt(sec: int) -> str:
        return "" if sec <= 0 else (f"~{sec}s left" if sec < 60 else f"~{sec // 60}m left")
    try:
        with open(log, "w") as lf:
            # stream the bake output: tee to the log AND emit a per-clip sub-chip onto the timeline
            p = subprocess.Popen(cmd, env={**os.environ}, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, bufsize=1)
            job["pid"] = p.pid
            _save()
            for line in p.stdout:
                lf.write(line); lf.flush()
                st = _emit_bake_event(out, line)
                if st in ("reused", "baked", "failed"):
                    done += 1
                    if st == "baked":
                        baked_n += 1
                    el = datetime.now(timezone.utc).timestamp() - t0
                    per = el / done                                   # measured wall-clock per clip
                    if prior and done < 3:                            # early on, lean on the learned prior
                        per = (per + prior) / 2
                    eta = round(per * max(0, total - done))
                    job["bake_progress"] = {"done": done, "total": total, "eta_seconds": eta}
                    prog_txt = f"{done}/{total} clips" + (f" · {_eta_txt(eta)}" if done < total and eta else "")
                    _append_step(out, {"kind": "event", "phase": "Baking audio", "event_type": "PROGRESS",
                                       "step_instruction": prog_txt,
                                       "metadata": {"done": done, "total": total, "eta_seconds": eta}})
            rc = p.wait()
    except Exception as e:
        job.update(status="audio-failed", phase="error", error=str(e), finished=_now())
        _save()
        return
    if baked_n and done:                                              # learn the pace ONLY from real bakes
        _update_bake_rate((datetime.now(timezone.utc).timestamp() - t0) / done)
    job.pop("bake_progress", None)
    # ready ONLY when the clips are actually complete — not merely "some mp3 exists". A partial
    # bake (e.g. 4/6 done, 2 failed) must stay re-bakeable, not false-ready. Use the same recovery
    # verdict the panel uses (needs_rebake = text ok but clips incomplete/failed).
    post = _recovery(job["slug"])
    complete = rc == 0 and post.get("clips_total", 0) > 0 and not post.get("needs_rebake", True)
    if complete:
        job.update(status="ready", phase="ready", rc=rc, lesson_url=f"/lessons/{job['slug']}/lesson.html")
    else:
        # lesson is still viewable — the bake just didn't finish; leave it re-bakeable
        job.update(status="audio-failed", phase="error", rc=rc)
    _append_step(out, {"kind": "phase", "name": "Baking audio", "status": "end"})
    _write_status(out, job, "staged")
    _rebuild_catalog()
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
threading.Thread(target=_bake_worker, daemon=True).start()   # the single bake queue-worker


def _resume_orphaned_bakes() -> None:
    """A restart wipes the in-memory _BAKE_Q and kills any in-flight bake subprocess, leaving jobs
    stuck in 'baking'/'queued' forever (zombies). On startup, re-enqueue those with viewable text so
    they resume; mark the textless ones failed instead of leaving them a phantom 'baking'."""
    seen = set()
    for j in list(JOBS.values()):
        sl = j.get("slug")
        if not sl or j.get("status") not in ("baking", "queued"):
            continue
        if not (GEN / sl / "lesson.html").exists():
            j.update(status="error", phase="interrupted (no text)")
            continue
        if sl in seen:
            continue
        seen.add(sl)
        j.update(status="queued", phase="queued for bake", started=_now(), finished=None)
        _BAKE_Q.put(sl)
    _save()


_resume_orphaned_bakes()   # recover bakes interrupted by the last restart


def _gen_worker() -> None:
    """Drain the generation queue. A bounded pool of these (GEN_CONC) is the whole point: clients
    push as many lessons as they want, Chiron runs only GEN_CONC at a time and queues the rest."""
    while True:
        job = _GEN_Q.get()
        try:
            if job.get("status") == "queued":          # skip cancelled/already-resolved jobs
                _run_job(job)
        except Exception as e:                          # never let one job kill the worker
            job.update(status="error", phase="worker error", error=str(e)[:400]); _save()
        finally:
            _GEN_Q.task_done()


def _resume_queued_generations() -> None:
    """A restart wipes the in-memory _GEN_Q, so jobs left 'queued' (or 'running' but with no text on
    disk — died mid-generation) would hang forever. Re-enqueue them so the queue survives a restart."""
    for j in list(JOBS.values()):
        sl = j.get("slug") or ""
        if (GEN / sl / "lesson.html").exists():
            continue                                    # already produced text → nothing to resume
        if j.get("status") == "queued":
            _GEN_Q.put(j)
        elif j.get("status") == "running":              # interrupted mid-gen → requeue (dedup makes it safe)
            j.update(status="queued", phase="requeued after restart"); _GEN_Q.put(j)
    _save()


for _ in range(max(1, GEN_CONC)):
    threading.Thread(target=_gen_worker, daemon=True).start()   # the bounded generation worker pool
_resume_queued_generations()   # recover generations interrupted / still queued at the last restart


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


@app.get("/")
def _root():
    # the library lives at /library/ — send the bare host there so http://<host>:PORT just works
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/library/", status_code=307)


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
    slug = res["slug"]
    # DEDUP by slug (= subject + type/depth). Same subject at a DIFFERENT type has a different slug
    # → allowed (atrial-fib amboss ≠ atrial-fib systematic). Same subject+type is a duplicate.
    if not (req.extra or {}).get("force"):
        # 1) already generated (a lesson.html exists — ready, or viewable-but-audio-pending) → don't remake
        lesson_url = f"/lessons/{slug}/lesson.html"
        if (GEN / slug / "lesson.html").exists():
            ex = next((j for j in JOBS.values() if j.get("slug") == slug and j.get("status") in ("ready", "published")), None)
            if ex:
                jid = ex["id"]
            else:
                job = _job_for_slug(slug); job.update(status="ready", lesson_url=lesson_url); _save(); jid = job["id"]
            return {"job_id": jid, "slug": slug, "depth": res["depth"], "chain": res["chain_name"],
                    "status": "ready", "lesson_url": lesson_url, "duplicate": True,
                    "note": "already generated — not regenerating (use /regenerate to redo, or bake to finish audio)"}
        # 2) already generating (queued/running) → join that job, don't spawn a twin
        infl = next((j for j in JOBS.values() if j.get("slug") == slug and j.get("status") in ("queued", "running")), None)
        if infl:
            return {"job_id": infl["id"], "slug": slug, "depth": res["depth"], "chain": res["chain_name"],
                    "status": infl.get("status", "running"), "duplicate": True,
                    "note": "already generating — joined the in-flight job"}
    jid = uuid.uuid4().hex[:12]
    job = {"id": jid, "created": _now(), "status": "queued", "phase": "queued",
           **req.model_dump(), "slug": slug, "chain": res["chain_name"], "depth": res["depth"]}
    JOBS[jid] = job
    _save()
    _GEN_Q.put(job)          # enqueue — the bounded worker pool runs it when a slot frees (Chiron owns concurrency)
    return {"job_id": jid, "slug": slug, "depth": res["depth"], "chain": res["chain_name"],
            "status": "queued", "queued_ahead": _GEN_Q.qsize()}



@app.post("/bake/{ref}")
def bake(ref: str):
    """Phase 2 of the 2-part flow: bake audio into an existing (viewable) lesson. `ref` = a job id or a slug."""
    slug = _slug_of(ref)
    out = GEN / slug
    if not (out / "lesson.html").exists():
        raise HTTPException(404, f"no viewable lesson for '{slug}' — generate the text first (stage=audio)")
    # refuse only if ACTIVELY baking (don't interrupt). A stale 'queued' (worker never grabbed it — the
    # in-memory queue was lost on a restart) is NOT a real duplicate → fall through and re-enqueue it.
    infl = next((j for j in JOBS.values() if j.get("slug") == slug and j.get("status") == "baking"), None)
    if infl:
        return {"job_id": infl["id"], "slug": slug, "status": "baking", "duplicate": True}
    job = _job_for_slug(slug)
    job.update(status="queued", phase="queued for bake", started=_now(), finished=None)
    _save()
    _BAKE_Q.put(slug)                       # a single worker bakes one at a time (Mac TTS can't take parallel)
    return {"job_id": job["id"], "slug": slug, "status": "queued", "queued": _BAKE_Q.qsize()}


@app.post("/bake-all")
def bake_all():
    """Queue an audio bake for EVERY viewable-but-unbaked lesson (text done, audio incomplete) —
    the batch backfill for quick-preview lessons. REFUSES while any TEXT generation is running, so
    bakes never compete with generation for the Mac TTS. One-at-a-time via the shared bake queue."""
    generating = [j for j in JOBS.values() if j.get("status") == "running"]
    if generating:
        return {"ok": False, "reason": "generation in progress — try again when text lessons finish",
                "generating": len(generating)}
    seen, queued = set(), []
    for j in JOBS.values():
        slug = j.get("slug")
        if not slug or slug in seen or j.get("status") == "published":
            continue
        seen.add(slug)
        if j.get("status") in ("queued", "baking") or slug in _CANCELLED:
            continue                                   # already in flight
        if not (GEN / slug / "lesson.html").exists():
            continue                                   # no viewable text yet
        rec = _recovery(slug)                          # non-blocking (ro, short timeout)
        if rec.get("text") and rec.get("needs_rebake"):
            job = _job_for_slug(slug)
            job.update(status="queued", phase="queued for bake", started=_now(), finished=None)
            _BAKE_Q.put(slug)
            queued.append(slug)
    _save()
    return {"ok": True, "queued": len(queued), "slugs": queued, "pending": _BAKE_Q.qsize()}


@app.get("/jobs/{ref}/steps")
def job_steps(ref: str):
    """The rich generation timeline for a lesson: parent phases + nested PromptChain events, reduced
    from steps.jsonl (written by the chain via obs.py). Prepopulates from disk → any device, any time."""
    import datetime as _dt
    slug = _slug_of(ref)
    out = GEN / slug
    job = next((j for j in JOBS.values() if j.get("slug") == slug), None)
    status = (job or {}).get("status") or ("ready" if (out / "lesson.html").exists() else "running")
    finished = status in ("ready", "published", "error", "audio-failed", "done")
    sp = out / "steps.jsonl"

    def _parse(ts):
        try: return _dt.datetime.fromisoformat(ts)
        except Exception: return None

    if sp.exists():
        phases, cur = [], {}
        for line in sp.read_text(errors="ignore").splitlines():
            if not line.strip():
                continue
            try: r = json.loads(line)
            except Exception: continue
            if r.get("kind") == "phase":
                nm = r.get("name")
                if r.get("status") == "start":
                    ph = {"name": nm, "status": "running", "started": r.get("ts"), "ended": None, "events": []}
                    phases.append(ph); cur[nm] = ph
                elif nm in cur:
                    cur[nm]["ended"] = r.get("ts"); cur[nm]["status"] = "done"
            elif r.get("kind") == "event":
                ph = cur.get(r.get("phase")) or (phases[-1] if phases else None)
                if not ph:
                    ph = {"name": r.get("phase") or "…", "status": "running", "started": r.get("ts"), "ended": None, "events": []}
                    phases.append(ph); cur[r.get("phase")] = ph
                md = r.get("metadata") or {}
                ph["events"].append({"event_type": r.get("event_type"), "model": r.get("model_name"),
                                     "instruction": r.get("step_instruction"), "tokens": md.get("tokens_used"),
                                     "ms": md.get("execution_time_ms"), "error": md.get("error"), "ts": r.get("ts")})
        for ph in phases:
            st, en = _parse(ph.get("started")), _parse(ph.get("ended"))
            ph["seconds"] = round((en - st).total_seconds()) if (st and en) else None
            if ph["status"] == "running" and finished:
                ph["status"] = "error" if status in ("error", "audio-failed") else "done"
        return {"slug": slug, "status": status, "running": not finished, "source": "steps", "phases": phases}

    # fallback: no steps.jsonl (older / just-started job) → one coarse phase from the log
    coarse = _derive_phase(STATE / f"{(job or {}).get('id', '')}.log", status) if job else status
    return {"slug": slug, "status": status, "running": not finished, "source": "log",
            "phases": [{"name": coarse, "status": "done" if finished else "running", "seconds": None, "events": []}]}


@app.get("/jobs/{ref}/recovery")
def job_recovery(ref: str):
    """What already exists for a lesson (text / clips done-of-total) so a retry reuses it — queried
    from the per-lesson SQLite. Drives the 🔥 needs-rebake pill + smart Retry."""
    return _recovery(_slug_of(ref))


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
    active = [j for j in items if j.get("status") in ("queued", "running", "baking")]
    history = [j for j in items if j.get("status") not in ("queued", "running", "baking")]
    # NOTE: recovery (text?/clips) is fetched LAZILY per-row by the client via /jobs/{slug}/recovery —
    # NOT here, so /activity stays fast (was hanging on 24 SQLite reads/poll when a db was mid-bake locked).
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


@app.post("/cancel/{ref}")
def cancel(ref: str):
    """Stop an in-flight job — generating, queued-for-bake, or baking. Kills the subprocess (or
    de-queues it) but KEEPS the lesson text, so a partially-done lesson stays viewable + rebakeable."""
    slug = JOBS[ref]["slug"] if ref in JOBS else ref
    job = JOBS.get(ref) or next((j for j in JOBS.values() if j.get("slug") == slug
                                 and j.get("status") in ("queued", "running", "baking")), None)
    if not job:
        return {"ok": False, "error": "no active job for that ref"}
    st, pid, killed = job.get("status"), job.get("pid"), False
    if st in ("running", "baking") and pid:                 # a live subprocess → SIGTERM it
        try:
            os.kill(int(pid), signal.SIGTERM); killed = True
        except (ProcessLookupError, ValueError):
            pass
        except Exception:
            pass
    if st == "queued":                                      # sitting in the bake queue → worker skips it on pop
        _CANCELLED.add(job.get("slug") or slug)
    lesson = GEN / (job.get("slug") or slug) / "lesson.html"
    job.update(status="audio-failed" if lesson.exists() else "cancelled",
               phase="cancelled", finished=_now())
    _save()
    return {"ok": True, "slug": job.get("slug") or slug, "killed": killed, "status": job["status"]}


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
    # flip EVERY job for this slug → published (accept is called with the slug, not a job-id, and there
    # may be several old retry/rebake job records for it) — so the row actually clears from the activity.
    for j in JOBS.values():
        if j.get("slug") == slug:
            j["status"] = "published"
    _save()
    # unify into the central Postgres corpus (best-effort — never block an accept on the DB)
    corpus = {"ok": False}
    try:
        migrated = _migrate_lesson_to_corpus(slug)
        ver = _verify_migration(slug)
        corpus = {"ok": True, "migrated": migrated, "verified": ver["verified"]}
        # SUNSET is held: accepted lessons still write to the local SQLite until the player POSTs to the
        # corpus API. Delete only when explicitly enabled AND verified (avoids nuking a live store).
        if ver["verified"] and os.environ.get("CHIRON_SUNSET_ON_ACCEPT") == "1":
            corpus["sunset"] = _sunset_sqlite(slug)
    except Exception as e:
        corpus = {"ok": False, "error": str(e)[:200]}
    return {"ok": True, "slug": slug, "status": "published", "corpus": corpus}


@app.post("/corpus/migrate/{ref}")
def corpus_migrate(ref: str):
    slug = _slug_of(ref)
    return {"slug": slug, "migrated": _migrate_lesson_to_corpus(slug), **_verify_migration(slug)}


@app.post("/corpus/sunset/{ref}")
def corpus_sunset(ref: str):
    """Delete a lesson's per-lesson SQLite — GATED on a verified migration. Manual/explicit only."""
    slug = _slug_of(ref)
    ver = _verify_migration(slug)
    if not ver["verified"]:
        raise HTTPException(409, "migration not verified — refusing to sunset")
    return {"slug": slug, "verified": True, **_sunset_sqlite(slug)}


class ImageIn(BaseModel):
    url: str                              # the origin image URL (retrieved, never generated)
    concept: str | None = None           # what it illustrates (the highlighted term)
    caption: str | None = None
    kind: str | None = None              # radiograph|derm-sign|ecg|pathway|mechanism|algorithm|figure
    source_url: str | None = None        # origin page (provenance)
    source_domain: str | None = None
    license: str | None = None
    engine: str | None = None
    width: int | None = None
    height: int | None = None


class ImageKeepIn(BaseModel):
    images: list[ImageIn]                 # the ones the learner ⭐-kept from the grid
    lesson_slug: str | None = None
    section_id: str | None = None


@app.post("/images/keep")
def images_keep(b: ImageKeepIn):
    """⭐ Persist the images the learner kept from the highlight grid: each → content-addressed
    asset store (dedup) + an images row (provenance) + a kind=image capture so it flows into the
    Captures browser / decompose / train. Retrieved images only — nothing fabricated."""
    if not b.images:
        raise HTTPException(400, "no images")
    _ensure_images_schema(); _ensure_capture_schema()
    kept, errors = [], []
    for im in b.images:
        try:
            cap_id = None
            with _pg() as pg:
                cur = pg.cursor()
                cur.execute("""insert into captured_items
                      (kind,text,question,source_answer,surrounding_text,lesson_slug,section_id,concept,model,source)
                      values ('image',%s,%s,%s,%s,%s,%s,%s,%s,'tutor-image') returning id""",
                    ((im.concept or im.caption or "image")[:400], None, (im.caption or ""),
                     (im.source_url or im.url), b.lesson_slug, b.section_id, im.concept, im.engine))
                cap_id = cur.fetchone()[0]
            r = _store_image(im.url, {
                "concept": im.concept, "caption": im.caption, "kind": im.kind,
                "source_url": im.source_url or im.url, "source_domain": im.source_domain,
                "license": im.license, "engine": im.engine, "width": im.width, "height": im.height,
                "capture_id": cap_id})
            kept.append({"sha": r["sha"], "id": r["id"], "capture_id": cap_id, "deduped": r["deduped"]})
        except Exception as e:
            errors.append({"url": im.url[:80], "error": str(e)})
    unprocessed = 0
    try:
        with _pg() as pg:
            cur = pg.cursor(); cur.execute("select count(*) from captured_items where processed_at is null")
            unprocessed = cur.fetchone()[0]
    except Exception:
        pass
    return {"ok": True, "kept": kept, "errors": errors, "unprocessed": unprocessed}


@app.get("/images/{sha}")
def image_bytes(sha: str):
    """Serve a stored image by sha (the grid/lesson references bytes we already hold)."""
    import glob
    from fastapi.responses import FileResponse
    hits = glob.glob(str(IMG_STORE / (sha + ".*")))
    if not hits:
        raise HTTPException(404, "not stored")
    return FileResponse(hits[0])


class CaptureIn(BaseModel):
    kind: str = "answer"                 # term | answer | note
    text: str                            # the handle (the term, or a short title)
    question: str | None = None
    source_answer: str | None = None
    surrounding_text: str | None = None  # PROVENANCE — the section it came from
    lesson_slug: str | None = None
    section_id: str | None = None
    concept: str | None = None
    model: str | None = None
    source: str | None = "tutor"


@app.post("/capture")
def capture(c: CaptureIn):
    """⭐/🖉 one-click capture → captured_items. Fire-and-forget from the lesson: must be fast and
    must never interrupt study. Stores PROVENANCE (question + answer + section) so the downstream
    card/MCQ/lesson generators have something worth generating from."""
    if not (c.text or "").strip():
        raise HTTPException(400, "empty capture")
    _ensure_capture_schema()
    with _pg() as pg:
        cur = pg.cursor()
        cur.execute("""insert into captured_items
              (kind,text,question,source_answer,surrounding_text,lesson_slug,section_id,concept,model,source)
              values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                    (c.kind, c.text.strip()[:400], c.question, c.source_answer,
                     (c.surrounding_text or "")[:4000], c.lesson_slug, c.section_id,
                     c.concept, c.model, c.source))
        new_id = cur.fetchone()[0]
        cur.execute("select count(*) from captured_items where processed_at is null")
        unprocessed = cur.fetchone()[0]
    return {"ok": True, "id": new_id, "unprocessed": unprocessed}


@app.get("/captures")
def captures(slug: str | None = None, q: str | None = None, unprocessed: bool = False, limit: int = 100):
    """Browse/search everything ever flagged — the inbox. `q` = Postgres FTS across the term, the
    question and the answer (so 'biliary vomiting' finds it months later)."""
    _ensure_capture_schema()
    where, args = [], []
    if slug:
        where.append("lesson_slug = %s"); args.append(slug)
    if unprocessed:
        where.append("processed_at is null")
    if q:
        where.append("to_tsvector('english', coalesce(text,'') || ' ' || coalesce(question,'') || ' ' "
                     "|| coalesce(source_answer,'')) @@ plainto_tsquery('english', %s)")
        args.append(q)
    sql = ("select id,kind,text,question,lesson_slug,section_id,concept,source,"
           "created_at,processed_at from captured_items"
           + (" where " + " and ".join(where) if where else "")
           + " order by created_at desc limit %s")
    args.append(max(1, min(limit, 500)))
    with _pg() as pg:
        cur = pg.cursor()
        cur.execute(sql, args)
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        cur.execute("select count(*) from captured_items where processed_at is null")
        unproc = cur.fetchone()[0]
    for r in rows:
        for k in ("created_at", "processed_at"):
            if r.get(k):
                r[k] = r[k].isoformat()
    return {"items": rows, "count": len(rows), "unprocessed": unproc}


@app.get("/captures/{cid}")
def capture_detail(cid: int):
    """Full detail for the browser's expand view — the whole captured answer + its provenance."""
    _ensure_capture_schema()
    with _pg() as pg:
        cur = pg.cursor()
        cur.execute("select id,kind,text,question,source_answer,surrounding_text,lesson_slug,"
                    "section_id,concept,model,source,created_at,processed_at from captured_items where id=%s", (cid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "not found")
        cols = [d[0] for d in cur.description]
    r = dict(zip(cols, row))
    for k in ("created_at", "processed_at"):
        if r.get(k):
            r[k] = r[k].isoformat()
    return r


@app.delete("/captures/{cid}")
def capture_delete(cid: int):
    """Dismiss a capture (the inbox needs a delete or it can't be curated)."""
    _ensure_capture_schema()
    with _pg() as pg:
        pg.cursor().execute("delete from captured_items where id=%s", (cid,))
    return {"ok": True, "deleted": cid}


TUTOR_URL = os.environ.get("CHIRON_TUTOR_URL", "http://127.0.0.1:8912")


def _tutor_post(path: str, body: dict, timeout: int = 180) -> dict:
    req = urllib.request.Request(TUTOR_URL.rstrip("/") + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def _spine_dispatch(note, question, concept, slug, section_id, ids, kind="cards"):
    """capture(s) → 🧬 spine → a generator (cards|mcqs|train) → (cards land in the lesson SR rotation) →
    drain the inbox. Shared by single- and batch-dispatch; kind picks the destination."""
    spine = _tutor_post("/decompose", {"note": note, "question": question or "", "concept": concept or ""})
    if not spine.get("topics"):
        raise HTTPException(502, f"decompose produced nothing: {spine.get('error','')}")
    payload = {"topics": spine["topics"], "discriminators": spine.get("discriminators") or [], "concept": concept or ""}
    result, written = {}, 0
    if kind == "cards":
        made = _tutor_post("/cards", payload); made_cards = made.get("cards") or []
        if not made_cards:
            raise HTTPException(502, "card generation produced nothing")
        db = GEN / (slug or "_") / ".chiron-state.db"
        if slug and db.exists():
            import sqlite3, time as _t
            con = sqlite3.connect(str(db), timeout=5)
            try:
                now = int(_t.time()*1000)
                for c in made_cards:
                    con.execute("insert into sr_cards(course_id,chapter_id,concept_id,card_type,front,back,tags,"
                                "ease_factor,interval_days,repetitions,next_due_at,suspended) values (?,?,?,?,?,?,?,?,?,?,?,0)",
                                (slug, section_id, c.get("concept_id"), c.get("card_type"), c["front"], c["back"],
                                 "tutor-capture", 2.5, 1, 0, now)); written += 1
                con.commit()
            finally: con.close()
        result = {"cards": made_cards}
    elif kind == "mcqs":
        result = {"mcqs": (_tutor_post("/mcqs", payload).get("mcqs") or [])}
        if not result["mcqs"]: raise HTTPException(502, "mcq generation produced nothing")
    elif kind == "train":
        tr = _tutor_post("/train", payload)
        if not tr.get("steps"): raise HTTPException(502, "train generation produced nothing")
        result = {"train": tr}
    elif kind == "lesson":
        # 📚 the heavy escalation — a full Chiron lesson (+ audio) on the concept, via the EXISTING
        # generation pipeline. The spine seeds it as grounding so the lesson is built around the exact
        # seams the learner flagged, not a cold LLM-guessed structure.
        seed = "Structure this lesson around these teaching seams and boundaries:\n" + json.dumps(payload, ensure_ascii=False)
        jr = generate(GenReq(subject=(concept or "review topic"), domain="medicine",
                             grounding=seed, source="tutor-capture", source_ref=slug, stage="all"))
        result = {"lesson_job": jr}
    else:
        raise HTTPException(400, f"unknown kind: {kind}")
    if ids:
        with _pg() as pg:
            pg.cursor().execute("update captured_items set processed_at=now() where id = any(%s)", (list(ids),))
    return {"ok": True, "kind": kind, "captures": list(ids), "topics": len(spine["topics"]),
            "discriminators": len(spine.get("discriminators") or []), "written_to_sr": written, **result}


def _spine_to_sr(note, question, concept, slug, section_id, ids):
    return _spine_dispatch(note, question, concept, slug, section_id, ids, "cards")


class BatchIn(BaseModel):
    ids: list[int]
    kind: str = "cards"   # cards | mcqs | train


@app.post("/captures/cards")
def captures_to_cards_batch(b: BatchIn):
    """🎴 BATCH dispatch — N selected pills/notes → ONE coherent card set. Highlighting five terms and
    sending them together must yield a set that knows they're related, never five disconnected cards:
    the relationships between the terms are half the learning."""
    if not b.ids:
        raise HTTPException(400, "no ids")
    _ensure_capture_schema()
    with _pg() as pg:
        cur = pg.cursor()
        cur.execute("select id,kind,text,question,source_answer,surrounding_text,concept,lesson_slug,"
                    "section_id from captured_items where id = any(%s) order by id", (b.ids,))
        rows = cur.fetchall()
    if not rows:
        raise HTTPException(404, "no such captures")
    terms = [r[2] for r in rows]
    parts = ["The learner flagged these while studying — teach them AS A CONNECTED SET:",
             "\n".join("- " + t for t in terms)]
    ctx = next((r[5] for r in rows if r[5]), None)
    ans = "\n\n".join(dict.fromkeys([r[4] for r in rows if r[4]]))     # dedup, keep order
    if ctx:
        parts.append("\nContext they were reading:\n" + ctx[:2500])
    if ans:
        parts.append("\nThe explanation that taught them:\n" + ans[:5000])
    concept = ", ".join(dict.fromkeys([r[6] for r in rows if r[6]])) or ", ".join(terms[:3])
    question = next((r[3] for r in rows if r[3]), "")
    slug = next((r[7] for r in rows if r[7]), None)
    section_id = next((r[8] for r in rows if r[8]), None)
    return _spine_dispatch("\n".join(parts), question, concept, slug, section_id, [r[0] for r in rows], b.kind)


@app.post("/captures/{cid}/cards")
def captured_to_cards(cid: int):
    """🎴 A single captured note → the spine → cards → the lesson's REAL SR rotation.

    This is what makes "I don't want to redo this session to remember it" actually true: the cards
    re-surface on schedule. Cards encode the DISCRIMINATORS (the 'X excludes Y' boundaries), not the
    prose. Marks the capture processed so the inbox drains."""
    _ensure_capture_schema()
    with _pg() as pg:
        cur = pg.cursor()
        cur.execute("select text,question,source_answer,concept,lesson_slug,section_id "
                    "from captured_items where id=%s", (cid,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"capture {cid} not found")
    text, question, answer, concept, slug, section_id = row
    return _spine_to_sr(answer or text, question, concept, slug, section_id, [cid])


@app.get("/corpus/status")
def corpus_status():
    """Is the central corpus reachable + row counts (the unification health)."""
    try:
        with _pg() as pg:
            c = pg.cursor()
            n = {}
            for t in ("lessons", "quiz_attempts", "mastery", "sr_cards", "weakness_log"):
                c.execute(f"select count(*) from {t}"); n[t] = c.fetchone()[0]
        return {"ok": True, "counts": n}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


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


# tutor injection: serve the shared shell/tutor.js + tutor.css at /shell/**, and
# inject <link>/<script> tags into every lesson.html at serve-time so the tutor
# is ONE file the server injects — not copied/assembled per-lesson.
app.mount("/shell", StaticFiles(directory=str(SKILL / "shell")), name="shell")


@app.get("/lessons/{slug}/lesson.html", response_class=HTMLResponse)
def _lesson_with_tutor(slug: str):
    p = GEN / slug / "lesson.html"
    if not p.exists():
        raise HTTPException(404, "lesson not found")
    html = p.read_text(encoding="utf-8")
    v = int((SKILL / "shell" / "tutor.js").stat().st_mtime)
    tags = f'<link rel="stylesheet" href="/shell/tutor.css?v={v}"><script src="/shell/tutor.js?v={v}" defer></script>'
    if "/shell/tutor.js" not in html:
        html = html.replace("</body>", tags + "</body>", 1) if "</body>" in html else html + tags
    return HTMLResponse(html)


# static: open a generated lesson, or the faceted library, straight from the app
app.mount("/lessons", StaticFiles(directory=str(GEN)), name="lessons")
if (GEN / "chiron-library").exists():
    app.mount("/library", StaticFiles(directory=str(GEN / "chiron-library"), html=True), name="library")


if __name__ == "__main__":
    import uvicorn
    # 127.0.0.1 by default; set CHIRON_SERVER_HOST=0.0.0.0 to let the phone connect + sync over home wifi
    host = os.environ.get("CHIRON_SERVER_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=PORT, log_level="info")
