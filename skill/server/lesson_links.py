"""lesson_links — per-lesson companion actions for Italian lessons: does the lesson have Anki cards, was a Pimsleur season
made from it, and the endpoints that add either on demand (never in a batch, never twice).

    GET  /api/lesson-status/{slug}         anki + pimsleur + mm status of one lesson, with ready-made Match Madness links
    GET  /api/lesson-status                the same for every Italian lesson (cached; Anki is read with bounded concurrency)
    POST /api/lesson/{slug}/anki           cards exist -> returned unchanged; else add the lesson's word pairs as notes
    POST /api/lesson/{slug}/pimsleur       {confirm:true, dry?} -> a season exists -> {duplicate:true}; else 5-10 phrases
                                           of the lesson go to the Pimsleur from-phrases job

`slug` is the lesson's folder under the generated root with "/" written as "~" (a nested lesson id has slashes); the
flattened "-" form the phone app uses is accepted too.

The link store (state/lesson_links.json) keys by lesson key: {anki:{deck,tag,count,source,checked_at},
pimsleur:{job_id,season,phrase_hash,created}, mm:{collection_id}}. Writes take a file lock, write a temp file and rename it.
"""
from __future__ import annotations
import concurrent.futures as cf, fcntl, json, os, re, sys, threading, time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlencode

from fastapi import APIRouter
from starlette.requests import Request
from starlette.responses import JSONResponse

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / "scripts"))
import anki  # noqa: E402
import pimsleur_jobs  # noqa: E402
import pool  # noqa: E402
import raccolte  # noqa: E402

GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
STORE_F = Path(os.environ.get("CHIRON_LESSON_LINKS", SKILL / "server" / "state" / "lesson_links.json"))
ITALIAN_DOMAINS = ("language-it", "medical-italian", "video-it")
DETTATO_ROOT = GEN / "chiron-dettato"
MIN_PHRASES, MAX_PHRASES = 5, 10
NEWEST = 20                         # words per Match Madness session
ANKI_TTL_S = 300                    # a status read from Anki is reused this long by the all-lessons listing
ANKI_WORKERS = 4                    # concurrent lesson probes against AnkiConnect
LESSONS_TTL_S = 60
PIMSLEUR_LIVE = ("queued", "running", "baking")
PIMSLEUR_DONE = ("ready", "published")
RECORD = True           # a status read records the cards it found in the link store; a read-only caller clears this
MM_WEB_BASE = os.environ.get("CHIRON_MM_WEB_URL", "")

router = APIRouter()
ORIGIN_OK = None        # app.py: fn(request) -> True | None | False (the /api/anki/* origin check)
JOBS: dict = {}         # app.py's job table
_store_lock = threading.RLock()
_lessons_cache: dict = {"at": 0.0, "by_key": {}, "root": ""}
_anki_cache: dict = {}  # key -> (monotonic time, status)
_action_locks: dict = {}
_action_locks_guard = threading.Lock()


def _log(msg: str) -> None:
    sys.stderr.write(f"[lesson-links] {msg}\n")
    sys.stderr.flush()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _reply(status: int, error: str, **kw) -> JSONResponse:
    return JSONResponse({"ok": False, "error": error, **kw}, status_code=status)


# ── the link store ────────────────────────────────────────────────────────────
@contextmanager
def _locked():
    """Exclusive access to the store across threads (RLock) and processes (flock on a sidecar file)."""
    STORE_F.parent.mkdir(parents=True, exist_ok=True)
    with _store_lock, open(STORE_F.with_name(STORE_F.name + ".lock"), "a") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def _read() -> dict:
    try:
        d = json.loads(STORE_F.read_text())
    except FileNotFoundError:
        return {}
    except ValueError as e:        # a corrupt store is reported, never replaced by an empty one
        raise RuntimeError(f"{STORE_F} is unreadable: {e}")
    return d if isinstance(d, dict) else {}


def _write(d: dict) -> None:
    tmp = STORE_F.with_name(STORE_F.name + f".tmp{os.getpid()}.{threading.get_ident()}")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    os.replace(tmp, STORE_F)


def get_links(key: str) -> dict:
    with _locked():
        return dict(_read().get(key) or {})


def update_link(key: str, part: str, value: dict) -> dict:
    """Merge `value` into the `part` record (anki | pimsleur | mm) of lesson `key` and return the lesson's record."""
    with _locked():
        d = _read()
        rec = d.setdefault(key, {})
        rec[part] = {**(rec.get(part) or {}), **value}
        _write(d)
        return dict(rec)


# ── which lessons are Italian ─────────────────────────────────────────────────
def url_slug(key: str) -> str:
    return key.replace("/", "~")


def flat(key: str) -> str:
    return key.replace("/", "-")


def _read_json(p: Path) -> dict:
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


def _lesson_row(key: str, d: Path, meta: dict, kind: str = "lesson") -> dict:
    return {"key": key, "slug": url_slug(key), "dir": str(d), "title": str(meta.get("title") or key),
            "domain": meta.get("domain"), "format": meta.get("lessonFormat") or meta.get("depth"), "kind": kind,
            "meta_slug": meta.get("slug")}


def italian_lessons(force: bool = False) -> dict[str, dict]:
    """key -> row for every Italian lesson: a folder under the generated root whose chiron.json domain is Italian (or a
    `chiron-ward-*` folder), the nested lessons the library index lists, and the Verbal Check lessons."""
    now = time.monotonic()
    if not force and now - _lessons_cache["at"] < LESSONS_TTL_S and _lessons_cache["root"] == str(GEN):
        return _lessons_cache["by_key"]
    out: dict[str, dict] = {}
    try:
        names = sorted(os.listdir(GEN))
    except OSError:
        names = []
    for name in names:
        d = GEN / name
        meta = _read_json(d / "chiron.json")
        if not meta or not (d / "lesson.html").is_file():
            continue
        if meta.get("domain") in ITALIAN_DOMAINS or (name.startswith("chiron-ward-") and not meta.get("domain")) \
                or (name.startswith("chiron-ward-") and meta.get("domain") in ITALIAN_DOMAINS):
            out[name] = _lesson_row(name, d, meta)
    idx = _read_json(GEN / "chiron-library" / "library.index.json").get("lessons")
    for it in idx if isinstance(idx, list) else []:
        lid = it.get("id") if isinstance(it, dict) else None
        if lid and "/" in lid and it.get("domain") in ITALIAN_DOMAINS and (GEN / lid / "lesson.html").is_file():
            meta = _read_json(GEN / lid / "chiron.json") or {"title": it.get("title"), "domain": it.get("domain")}
            out[lid] = _lesson_row(lid, GEN / lid, {**meta, "title": meta.get("title") or it.get("title")})
    try:
        dnames = sorted(os.listdir(DETTATO_ROOT))
    except OSError:
        dnames = []
    for name in dnames:
        meta = _read_json(DETTATO_ROOT / name / "dettato.json")
        if meta:
            key = f"chiron-dettato/{name}"
            out[key] = _lesson_row(key, DETTATO_ROOT / name, {"title": meta.get("title") or name, "domain": "verbal-check",
                                                              "slug": name}, "dettato")
    _lessons_cache.update(at=now, by_key=out, root=str(GEN))
    return out


def resolve(slug: str) -> dict | None:
    """The lesson row for a URL slug ("~" for "/"), a key, or the flattened "-" id; None if it is not an Italian lesson."""
    lessons = italian_lessons()
    key = slug.replace("~", "/")
    if key in lessons:
        return lessons[key]
    return next((r for k, r in lessons.items() if flat(k) == slug), None)


def is_italian(key: str) -> bool:
    return key in italian_lessons()


# ── Anki ──────────────────────────────────────────────────────────────────────
def _esc(s: str) -> str:
    return re.sub(r'([\\"*_])', r"\\\1", s)


def _titles(row: dict) -> list[str]:
    """The titles a lesson's cards may have been filed under: its chiron.json title and its page <title>."""
    out = [row["title"]]
    f = Path(row["dir"]) / "lesson.html"
    if f.is_file():
        try:
            t = raccolte.lesson_title(f.read_text(encoding="utf-8", errors="replace"), "")
        except OSError:
            t = ""
        if t and t not in out:
            out.append(t)
    return out


def anki_conventions(row: dict) -> list[dict]:
    """Every way a lesson's cards have been filed so far, as {name, query, deck, tag}."""
    key, titles = row["key"], _titles(row)
    base = Path(row["dir"]).name
    tags = list(dict.fromkeys([f"lesson:{flat(key)}", *([f"lesson:{row['meta_slug']}"] if row.get("meta_slug") else [])]))
    conv = [{"name": "lesson-tag", "query": f'"tag:{_esc(t)}"', "deck": pool.lesson_deck(row["title"]), "tag": t} for t in tags]
    for t in titles:
        pt = f"pool::lesson::{pool.slug(t)}"
        conv.append({"name": "pool-tag", "query": f'"tag:{_esc(pt)}"', "deck": pool.lesson_deck(t), "tag": pt})
    for t in titles:
        dk = pool.lesson_deck(t)
        conv.append({"name": "lesson-deck", "query": f'"deck:{_esc(dk)}"', "deck": dk, "tag": ""})
    conv.append({"name": "pimsleur-item", "query": f'"tag:chiron_item::{_esc(base)}::*"', "deck": "", "tag": f"chiron_item::{base}::*"})
    seen, out = set(), []
    for c in conv:
        if c["query"] not in seen:
            seen.add(c["query"])
            out.append(c)
    return out


def anki_status(key_or_row) -> dict:
    """{status: "cards"|"none"|"unreachable"|"error", count, deck, tag, matched:[{name,count}], detail?}.
    "none" is returned only when every convention was searched and Anki answered; an unreachable Anki is "unreachable"."""
    row = key_or_row if isinstance(key_or_row, dict) else italian_lessons().get(key_or_row)
    if row is None:
        raise KeyError(key_or_row)
    ids: set = set()
    matched, best = [], None
    try:
        for c in anki_conventions(row):
            found = anki.invoke("findNotes", query=c["query"]) or []
            if found:
                matched.append({"name": c["name"], "count": len(found), "tag": c["tag"], "deck": c["deck"]})
                ids.update(found)
                best = best or c
    except anki.AnkiUnavailable as e:
        return {"status": "unreachable", "count": None, "matched": [], "detail": str(e)[:200]}
    except Exception as e:
        _log(f"{row['key']}: anki read failed: {type(e).__name__}: {e}")
        return {"status": "error", "count": None, "matched": [], "detail": f"{type(e).__name__}: {e}"[:200]}
    if not ids:
        return {"status": "none", "count": 0, "deck": None, "tag": None, "matched": []}
    st = {"status": "cards", "count": len(ids), "deck": best["deck"] or None, "tag": best["tag"] or None, "matched": matched}
    if RECORD:
        update_link(row["key"], "anki", {"deck": st["deck"], "tag": st["tag"], "count": st["count"],
                                         "source": best["name"], "checked_at": _now()})
    return st


def anki_status_cached(row: dict) -> dict:
    hit = _anki_cache.get(row["key"])
    if hit and time.monotonic() - hit[0] < ANKI_TTL_S:
        return hit[1]
    st = anki_status(row)
    if st["status"] in ("cards", "none"):
        _anki_cache[row["key"]] = (time.monotonic(), st)
    return st


# ── Pimsleur ──────────────────────────────────────────────────────────────────
def _season_file(slug: str | None) -> bool:
    return bool(slug) and (GEN / f"{slug}.season.json").is_file()


def pimsleur_status(key_or_row) -> dict:
    """{state: "generating"|"ready"|"is_pimsleur"|"none", job_id?, season?, url?}: the recorded link, else a job started
    from this lesson, else the lesson being a Pimsleur season itself."""
    row = key_or_row if isinstance(key_or_row, dict) else italian_lessons().get(key_or_row)
    key = row["key"] if row else key_or_row
    link = get_links(key).get("pimsleur") or {}
    job = JOBS.get(link.get("job_id")) if link.get("job_id") else None
    if job is None:
        job = next((j for j in JOBS.values() if (j.get("extra") or {}).get("source_lesson") == key
                    and j.get("status") in PIMSLEUR_LIVE + PIMSLEUR_DONE), None)
    if job is not None:
        st = job.get("status")
        if st in PIMSLEUR_LIVE:
            return {"state": "generating", "job_id": job["id"], "status": st, "slug": job.get("slug")}
        if st in PIMSLEUR_DONE:
            return {"state": "ready", "job_id": job["id"], "status": st, "slug": job.get("slug"),
                    "url": job.get("lesson_url") or f"/lessons/{job.get('slug')}/lesson.html"}
    elif link.get("season") and _season_file(link["season"]):
        return {"state": "ready", "job_id": link.get("job_id"), "slug": link["season"],
                "url": f"/lessons/{link['season']}/lesson.html"}
    if row and (row.get("format") or "") == "pimsleur":
        return {"state": "is_pimsleur"}
    return {"state": "none"}


# ── Match Madness ─────────────────────────────────────────────────────────────
def mm_status(key_or_row) -> dict:
    """{collection_id|None, count}: the Match Madness collection made from this lesson (raccolte keys it by `lesson`)."""
    key = key_or_row["key"] if isinstance(key_or_row, dict) else key_or_row
    try:
        with raccolte._lock:
            col = next((c for c in raccolte._load()["collections"] if c.get("lesson") == key), None)
            count = len(raccolte._active(col)) if col else 0
    except RuntimeError as e:
        _log(f"collections unreadable: {e}")
        return {"collection_id": None, "count": 0, "error": str(e)[:200]}
    return {"collection_id": col["id"] if col else None, "count": count}


def mm_links(row: dict, anki_st: dict) -> dict | None:
    """The Match Madness links for the lesson's newest Anki words, or None when the lesson has no cards."""
    if anki_st.get("status") != "cards":
        return None
    q = {"deck": anki_st.get("deck") or "", "tag": anki_st.get("tag") or "", "newest": NEWEST, "title": row["title"]}
    phone = "matchmadness://anki-lesson?" + urlencode(q, quote_via=quote)
    web_q = urlencode({"flavour": "anki-lesson", **q}, quote_via=quote)
    return {"phone": phone, "web_query": "?" + web_q, **({"web": MM_WEB_BASE + "?" + web_q} if MM_WEB_BASE else {})}


# ── status payloads ───────────────────────────────────────────────────────────
def lesson_status(row: dict, cached: bool = False) -> dict:
    a = anki_status_cached(row) if cached else anki_status(row)
    return {"slug": row["slug"], "key": row["key"], "title": row["title"], "kind": row["kind"], "anki": a,
            "pimsleur": pimsleur_status(row), "mm": {**mm_status(row), "links": mm_links(row, a)}}


@router.get("/api/lesson-status/{slug}")
def api_status(slug: str):
    row = resolve(slug)
    if row is None:
        return _reply(404, f"no Italian lesson {slug!r}")
    return lesson_status(row)


@router.get("/api/lesson-status")
def api_status_all():
    rows = list(italian_lessons().values())
    with cf.ThreadPoolExecutor(max_workers=ANKI_WORKERS) as ex:
        out = list(ex.map(lambda r: lesson_status(r, cached=True), rows))
    return {"count": len(out), "lessons": out}


# ── actions ───────────────────────────────────────────────────────────────────
def _action_lock(key: str, action: str) -> threading.Lock:
    with _action_locks_guard:
        return _action_locks.setdefault((key, action), threading.Lock())


def _guard_request(request: Request):
    return _reply(403, "origin not allowed") if (ORIGIN_OK(request) if ORIGIN_OK else None) is False else None


def lesson_pairs(row: dict) -> list[dict]:
    """The lesson's word pairs [{it, en}] (its Match Madness section); [] for a lesson without one."""
    f = Path(row["dir"]) / "lesson.html"
    if row["kind"] != "lesson" or not f.is_file():
        return []
    return raccolte.lesson_mm_pairs(f.read_text(encoding="utf-8", errors="replace"))


def pick_phrases(pairs: list[dict]) -> list[dict] | None:
    """5-10 phrases for a Pimsleur season: multi-word pairs with an English side first (closest to four words first),
    single words only to reach the minimum. Returned in lesson order. None when fewer than MIN_PHRASES are usable."""
    usable = [p for p in pairs if p.get("it") and p.get("en")]
    if len(usable) < MIN_PHRASES:
        return None
    multi = [(i, p) for i, p in enumerate(usable) if len(p["it"].split()) >= 2]
    single = [(i, p) for i, p in enumerate(usable) if len(p["it"].split()) < 2]
    multi.sort(key=lambda t: (abs(len(t[1]["it"].split()) - 4), t[0]))
    chosen = multi[:MAX_PHRASES]
    if len(chosen) < MIN_PHRASES:
        chosen += single[:MIN_PHRASES - len(chosen)]
    chosen.sort(key=lambda t: t[0])
    return [{"it": p["it"], "en": p["en"], "register": ""} for _, p in chosen]


def add_to_anki(row: dict) -> dict:
    """Idempotent: a lesson that already has cards is returned as is; otherwise its pairs become notes in
    Chiron::Lezioni::<title> tagged lesson:<slug>."""
    with _action_lock(row["key"], "anki"):
        st = anki_status(row)
        if st["status"] in ("unreachable", "error"):
            return {"_http": 503, "error": f"Anki is not reachable: {st.get('detail')}", "anki": st}
        if st["status"] == "cards":
            _anki_cache.pop(row["key"], None)
            return {"ok": True, "added": 0, "existing": True, "anki": st}
        pairs = lesson_pairs(row)
        if not pairs:
            return {"_http": 422, "error": "this lesson has no word pairs to turn into cards"}
        tag = f"lesson:{flat(row['key'])}"
        deck = pool.lesson_deck(row["title"])
        res = anki.add_notes([{"front": p["it"], "back": p["en"]} for p in pairs], deck=deck, tags=[tag])
        _anki_cache.pop(row["key"], None)
        after = anki_status(row)
        if after["status"] != "cards":
            return {"_http": 502, "error": f"cards were not found in Anki after adding ({res.get('detail') or res})", "anki": after}
        _log(f"{row['key']}: added {res.get('added')} of {res.get('of')} to {deck!r}")
        return {"ok": True, "added": res.get("added", 0), "existing": False, "deck": deck, "anki": after}


def start_pimsleur(row: dict, dry: bool) -> dict:
    """Idempotent: a lesson with a season (generating, ready, or itself a Pimsleur lesson) returns {duplicate:true}."""
    with _action_lock(row["key"], "pimsleur"):
        cur = pimsleur_status(row)
        if cur["state"] != "none":
            return {"ok": True, "duplicate": True, "pimsleur": cur,
                    "note": "this lesson already has a Pimsleur season" if cur["state"] != "is_pimsleur" else "this lesson is a Pimsleur season"}
        phrases = pick_phrases(lesson_pairs(row))
        if phrases is None:
            return {"_http": 422, "error": f"the lesson has fewer than {MIN_PHRASES} usable word pairs for a Pimsleur season"}
        body = {"phrases": phrases, "topic": row["title"], "confirm": True, "source_lesson": row["key"], **({"dry": True} if dry else {})}
        res = pimsleur_jobs.start_from_phrases(body)
        if isinstance(res, JSONResponse):
            return {"_http": res.status_code, **json.loads(res.body)}
        if dry:
            return {**res, "phrases": phrases}
        if not res.get("duplicate") and res.get("job_id"):
            update_link(row["key"], "pimsleur", {"job_id": res["job_id"], "season": res.get("slug"),
                                                 "phrase_hash": pimsleur_jobs.phrase_hash(phrases), "created": _now()})
        return {**res, "phrases": phrases}


def _respond(res: dict):
    code = res.pop("_http", None)
    return JSONResponse({"ok": False, **res}, status_code=code) if code else res


@router.post("/api/lesson/{slug}/anki")
def api_add_anki(slug: str, request: Request):
    refused = _guard_request(request)
    if refused:
        return refused
    row = resolve(slug)
    if row is None:
        return _reply(404, f"no Italian lesson {slug!r}")
    return _respond(add_to_anki(row))


@router.post("/api/lesson/{slug}/pimsleur")
async def api_pimsleur(slug: str, request: Request):
    refused = _guard_request(request)
    if refused:
        return refused
    try:
        b = await request.json()
    except ValueError:
        b = None
    if not isinstance(b, dict) or b.get("confirm") is not True:
        return _reply(400, "a Pimsleur season costs a generation run plus an audio bake: send {confirm:true}")
    row = resolve(slug)
    if row is None:
        return _reply(404, f"no Italian lesson {slug!r}")
    import asyncio
    return _respond(await asyncio.to_thread(start_pimsleur, row, bool(b.get("dry"))))
