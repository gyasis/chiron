"""raccolte — "⭐ Raccogli" COLLECTIONS: words/phrases the learner gathers (from Match Madness, lessons, ascolto, captures)
to be studied, drilled as audio cards, played in Match Madness, or taught as a lesson. Stored ONCE on this server,
so Pixel, Galaxy and the web are one learner. (Named raccolte, not collections: that would shadow the stdlib module.)

    GET    /raccolte                               the page (shell/raccolte.html)
    GET    /api/collections                        {collections:[{id,name,count,created_at,default}]}
    POST   /api/collections {name}                 create (an existing name returns that collection)
    GET    /api/collections/{id}                   {id,name,items:[active items]}
    POST   /api/collections/{id}/items             {items:[{it,en?,source,lesson?,section?,note?}], define_missing?:bool}
                                                   dedupe by folded `it`; a removed item is revived; en is filled from the
                                                   lessons' cards / Match Madness pairs, and from the definer ONLY on define_missing
    DELETE /api/collections/{id}/items?it=...      soft delete: removed_at is stamped, the row stays in the file
    GET    /api/collections/{id}/pairs             [{it,en}] for Match Madness "Le mie raccolte"
    GET    /api/collections/{id}/cards             ?n=&offset=&dry=  audio cards, same shape as /api/pool/lesson, deck
                                                   Chiron::Raccolte::<name>; lesson-first sentences from listening.index.json
    POST   /api/collections/from-lesson     {lesson:"<lesson id/path>"} upsert the collection of THAT lesson's Match Madness pairs
                                                   (named after the lesson title, keyed by the lesson so a re-send updates it, never
                                                   duplicates) -> {id,name,count,existing}; the lesson page's "Gioca in Match Madness"
    POST   /api/collections/{id}/lesson            {confirm:true, dry?} submit a lesson ON the collection through the
                                                   existing /generate job path (it shows in Jobs/Activity). No model call here.

Storage: state/collections.json  {"collections":[{id,name,created_at,items:[{it,en,source,lesson,section,note,added_at,
removed_at}]}]}, written atomically (tmp + replace). The default "Parole deboli" (id parole-deboli) always exists.
"""
import json, os, re, sys, threading, time, unicodedata
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

SKILL = Path(__file__).resolve().parent.parent
GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
STATE_F = Path(os.environ.get("CHIRON_COLLECTIONS_FILE", SKILL / "server" / "state" / "collections.json"))
DEFAULT_ID, DEFAULT_NAME = "parole-deboli", "Parole deboli"
SOURCES = {"mm", "lesson", "ascolto", "capture", "manual"}
MAX_ITEMS_PER_POST, PER_WORD_CARDS = 200, 2

router = APIRouter()
_lock = threading.RLock()
GENERATE = None        # set by app.py to its generate(); a test sets a mock. Called with a GenReq-shaped dict.


def _log(msg: str) -> None:
    sys.stderr.write(f"[raccolte] {msg}\n")


def fold(s: str) -> str:
    d = "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", d.lower().replace("’", "'")).strip(" .,;:!?«»\"'")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-") or "raccolta"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── storage ───────────────────────────────────────────────────────────────────
def _load() -> dict:
    try:
        d = json.loads(STATE_F.read_text())
    except FileNotFoundError:
        d = {}
    except Exception as e:      # a corrupt file must not be silently replaced with an empty one
        raise RuntimeError(f"{STATE_F} is unreadable: {type(e).__name__}: {e}")
    cols = d.setdefault("collections", [])
    if not any(c["id"] == DEFAULT_ID for c in cols):
        cols.insert(0, {"id": DEFAULT_ID, "name": DEFAULT_NAME, "created_at": _now(), "items": []})
    return d


def _save(d: dict) -> None:
    STATE_F.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_F.with_name(STATE_F.name + f".tmp{os.getpid()}")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    os.replace(tmp, STATE_F)


def _get(d: dict, cid: str) -> dict:
    c = next((c for c in d["collections"] if c["id"] == cid), None)
    if not c:
        raise HTTPException(404, f"no collection {cid!r}")
    return c


def _active(c: dict) -> list[dict]:
    return [i for i in c["items"] if not i.get("removed_at")]


def _summary(c: dict) -> dict:
    return {"id": c["id"], "name": c["name"], "count": len(_active(c)), "created_at": c.get("created_at"),
            "default": c["id"] == DEFAULT_ID}


# ── missing English: cheap local lookups first ────────────────────────────────
def _known_en() -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        import pool
        for c in pool.listen_index().get("cards", []):
            if c.get("it") and c.get("en"):
                out.setdefault(fold(c["it"]), c["en"])
        for r in pool.mm_pairs():
            if r["en"]:
                out.setdefault(fold(r["it"]), r["en"])
    except Exception as e:
        _log(f"en lookup skipped: {type(e).__name__}: {e}")
    return out


def _define(terms: list[str]) -> dict[str, str]:
    """The existing definer, one batched call; any failure leaves the English empty (never blocks a save)."""
    try:
        import mm_define
        res = mm_define.define(terms[:mm_define.MAX_TERMS])
        return {fold(i["term"]): i["en"] for i in res["items"] if i.get("en")}
    except Exception as e:
        _log(f"define skipped: {type(e).__name__}: {e}")
        return {}


def add_items(cid: str, raw: list, define_missing: bool = False) -> dict:
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "items must be a non-empty list of {it, en?, source}")
    if len(raw) > MAX_ITEMS_PER_POST:
        raise HTTPException(400, f"too many items ({len(raw)} > {MAX_ITEMS_PER_POST})")
    clean = []
    for r in raw:
        r = r if isinstance(r, dict) else {"it": r}
        it = re.sub(r"\s+", " ", str(r.get("it") or "")).strip()
        if it:
            src = r.get("source") if r.get("source") in SOURCES else "manual"
            clean.append({"it": it[:300], "en": str(r.get("en") or "").strip()[:300], "source": src,
                          **{k: str(r[k])[:300] for k in ("lesson", "section", "note") if r.get(k)}})
    if not clean:
        raise HTTPException(400, "no item has an `it`")
    known = _known_en() if any(not c["en"] for c in clean) else {}
    with _lock:
        d = _load()
        col = _get(d, cid)
        by = {fold(i["it"]): i for i in col["items"]}
        added, revived, dup = [], [], 0
        for c in clean:
            k = fold(c["it"])
            if not c["en"]:
                c["en"] = known.get(k, "")
            cur = by.get(k)
            if cur is None:
                row = {**c, "added_at": _now(), "removed_at": None}
                col["items"].append(row)
                by[k] = row
                added.append(row)
            elif cur.get("removed_at"):
                cur.update(removed_at=None, added_at=_now(), **{x: y for x, y in c.items() if y})
                revived.append(cur)
            else:
                dup += 1
                if not cur.get("en") and c["en"]:
                    cur["en"] = c["en"]
        _save(d)
        out_count = len(_active(col))
    if define_missing:                      # outside the lock: a slow model must not block other saves
        miss = [i["it"] for i in added + revived if not i["en"]]
        if miss:
            got = _define(miss)
            with _lock:
                d = _load()
                col = _get(d, cid)
                for i in col["items"]:
                    if not i["en"] and fold(i["it"]) in got:
                        i["en"] = got[fold(i["it"])]
                _save(d)
    _log(f"{cid}: +{len(added)} revived {len(revived)} dup {dup} -> {out_count}")
    return {"id": cid, "added": len(added), "revived": len(revived), "duplicates": dup, "count": out_count}


# ── actions ───────────────────────────────────────────────────────────────────
def audio_cards(cid: str, n: int, offset: int, dry: bool) -> dict:
    """Lesson-first sentences for every item (best PER_WORD_CARDS each), voiced + noted via pool.finish_lesson into
    Chiron::Raccolte::<name>. Same response shape as pool.lesson_cards so ascolto's lesson mode pages it unchanged."""
    import pool
    with _lock:
        col = _get(_load(), cid)
    items = _active(col)
    deck = "Chiron::Raccolte::" + (re.sub(r'[:"\\]+', "-", col["name"]).strip() or "Raccolta")
    pool.listen_index()
    cards, seen, uncovered = [], set(), []
    for it in items:
        got = 0
        for c in pool.lesson_candidates(it["it"], seen):
            seen.add(c["id"])
            cards.append(c)
            got += 1
            if got >= PER_WORD_CARDS:
                break
        if not got:
            uncovered.append(it["it"])
    n, offset = max(1, min(int(n or 10), 40)), max(0, int(offset or 0))
    page = cards[offset:offset + n]
    sents = pool.finish_lesson(page, col["name"], dry, offset, lucrezia=True, deck_for=deck) if page else []
    return {"lesson": {"id": None, "collection": cid, "focus": None, "title": col["name"], "tags": [], "deck": deck},
            "sentences": sents, "total": len(cards), "offset": offset,
            "next": offset + len(page) if offset + len(page) < len(cards) else None, "dry": dry,
            "uncovered": uncovered}


def lesson_request(col: dict) -> dict:
    items = _active(col)
    brief = ("Costruisci una lezione su questa raccolta di parole e frasi che il discente trova difficili. "
             "Insegna ciascuna in contesto clinico, con esempi e un breve esercizio.\n\nVoci:\n" +
             "\n".join(f"- {i['it']}" + (f" — {i['en']}" if i.get("en") else "") for i in items))
    return {"domain": "medical-italian", "depth": "ward", "subject": f"Raccolta: {col['name']}",
            "grounding": brief, "stage": "all", "source": "raccolte", "source_ref": col["id"], "extra": {}}


# ── a lesson's Match Madness pairs → a collection ─────────────────────────────
_JS_STR = r"""("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')"""


def _js_str(lit: str) -> str:
    """A JS string literal -> its value ('…' literals are re-quoted for the JSON parser)."""
    if lit[0] == "'":
        lit = '"' + lit[1:-1].replace("\\'", "'").replace('"', '\\"') + '"'
    return json.loads(lit)


def lesson_mm_pairs(html: str) -> list[dict]:
    """The pairs a lesson's #match-madness section holds: the multi-set `const CONFIG = {...sets:[{pairs:[{left,right}]}]}`
    form, or the single-set inline `var PAIRS = [{id, it, en}]` form. [] when the section or its data is absent."""
    if 'id="match-madness"' not in html:
        return []
    out = []
    i = html.find("const CONFIG = ")
    if i >= 0:
        try:
            cfg, _ = json.JSONDecoder().raw_decode(html[i + len("const CONFIG = "):])
            for st in cfg.get("sets", []):
                out += [{"it": p.get("left", ""), "en": p.get("right", "")} for p in st.get("pairs", [])]
        except ValueError as e:
            _log(f"lesson CONFIG unreadable: {e}")
    if not out:
        m = re.search(r"var PAIRS\s*=\s*\[(.*?)\n\s*\];", html, re.S)
        if m:
            for blk in re.findall(r"\{[^{}]*\}", m.group(1)):
                a = re.search(r"\bit\s*:\s*" + _JS_STR, blk)
                b = re.search(r"\ben\s*:\s*" + _JS_STR, blk)
                if a:
                    try:
                        out.append({"it": _js_str(a.group(1)), "en": _js_str(b.group(1)) if b else ""})
                    except ValueError as e:
                        _log(f"PAIRS entry skipped: {e}")
    seen, rows = set(), []
    for p in out:
        it, en = re.sub(r"\s+", " ", p["it"]).strip(), re.sub(r"\s+", " ", p["en"]).strip()
        if it and fold(it) not in seen:
            seen.add(fold(it))
            rows.append({"it": it, "en": en})
    return rows


def lesson_title(html: str, fallback: str) -> str:
    import html as H
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    t = H.unescape(re.sub(r"<[^>]+>", "", m.group(1))) if m else ""
    t = re.sub(r"^\s*Chiron\s*·\s*", "", t)
    return re.sub(r"\s+", " ", t).strip()[:60] or fallback


def collection_from_lesson(lesson: str) -> dict:
    """Idempotent: the collection is found by the lesson it came from (`lesson` field), so re-sending updates it;
    items dedupe by folded Italian and an English that changed in the lesson is refreshed."""
    parts = Path(str(lesson or "").strip("/")).parts
    if not parts or ".." in parts:
        raise HTTPException(400, "lesson is required (the lesson's id/path)")
    key = "/".join(parts)
    f = GEN / key / "lesson.html"
    if not f.is_file():
        raise HTTPException(404, f"no lesson {key!r}")
    html = f.read_text(encoding="utf-8", errors="replace")
    pairs = lesson_mm_pairs(html)
    if not pairs:
        raise HTTPException(404, f"lesson {key!r} has no Match Madness pairs")
    name = lesson_title(html, parts[-1])
    with _lock:
        d = _load()
        col = next((c for c in d["collections"] if c.get("lesson") == key), None)
        existing = col is not None
        if not col:
            taken = {fold(c["name"]) for c in d["collections"]}
            nm = name if fold(name) not in taken else f"{name} ({parts[-1][:24]})"
            cid, base, n = slug(nm), slug(nm), 2
            while any(c["id"] == cid for c in d["collections"]):
                cid, n = f"{base}-{n}", n + 1
            col = {"id": cid, "name": nm, "created_at": _now(), "lesson": key, "items": []}
            d["collections"].append(col)
        else:
            by = {fold(i["it"]): i for i in col["items"]}
            for p in pairs:                 # refresh an English the lesson has since corrected
                cur = by.get(fold(p["it"]))
                if cur and p["en"] and cur.get("en") != p["en"]:
                    cur["en"] = p["en"]
        _save(d)
        cid, name = col["id"], col["name"]
    for k in range(0, len(pairs), MAX_ITEMS_PER_POST):
        add_items(cid, [{**p, "source": "lesson", "lesson": key, "section": "match-madness"}
                        for p in pairs[k:k + MAX_ITEMS_PER_POST]])
    with _lock:
        count = len(_active(_get(_load(), cid)))
    _log(f"from-lesson {key}: {cid} {count} pairs ({'updated' if existing else 'created'})")
    return {"id": cid, "name": name, "count": count, "existing": existing}


# ── routes ────────────────────────────────────────────────────────────────────
def _guard(fn, *a):
    try:
        return fn(*a)
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(500, str(e)[:300])


@router.get("/raccolte", response_class=HTMLResponse)
def page():
    return HTMLResponse((SKILL / "shell" / "raccolte.html").read_text(),
                        headers={"Cache-Control": "no-cache, must-revalidate"})


@router.get("/api/collections")
def api_list():
    with _lock:
        return {"collections": [_summary(c) for c in _guard(_load)["collections"]]}


@router.post("/api/collections")
def api_create(b: dict):
    name = re.sub(r"\s+", " ", str(b.get("name") or "")).strip()[:60]
    if not name:
        raise HTTPException(400, "name is required")
    with _lock:
        d = _guard(_load)
        ex = next((c for c in d["collections"] if fold(c["name"]) == fold(name)), None)
        if ex:
            return {**_summary(ex), "existing": True}
        cid, base, n = slug(name), slug(name), 2
        while any(c["id"] == cid for c in d["collections"]):
            cid, n = f"{base}-{n}", n + 1
        col = {"id": cid, "name": name, "created_at": _now(), "items": []}
        d["collections"].append(col)
        _save(d)
        return {**_summary(col), "existing": False}


@router.post("/api/collections/from-lesson")
def api_from_lesson(b: dict):
    return _guard(collection_from_lesson, b.get("lesson"))


@router.get("/api/collections/{cid}")
def api_get(cid: str):
    with _lock:
        col = _get(_guard(_load), cid)
        return {"id": col["id"], "name": col["name"], "items": _active(col)}


@router.post("/api/collections/{cid}/items")
def api_add(cid: str, b: dict):
    return _guard(add_items, cid, b.get("items"), bool(b.get("define_missing")))


@router.delete("/api/collections/{cid}/items")
def api_remove(cid: str, it: str):
    with _lock:
        d = _guard(_load)
        col = _get(d, cid)
        row = next((i for i in col["items"] if fold(i["it"]) == fold(it) and not i.get("removed_at")), None)
        if not row:
            raise HTTPException(404, f"{it!r} is not in {cid!r}")
        row["removed_at"] = _now()
        _save(d)
        return {"removed": row["it"], "count": len(_active(col))}


@router.get("/api/collections/{cid}/pairs")
def api_pairs(cid: str):
    with _lock:
        col = _get(_guard(_load), cid)
        return {"id": cid, "name": col["name"], "pairs": [{"it": i["it"], "en": i.get("en", "")} for i in _active(col)]}


@router.get("/api/collections/{cid}/cards")
def api_cards(cid: str, n: int = 10, offset: int = 0, dry: bool = False):
    import sessione
    return sessione._guard("raccolte-cards", audio_cards, cid, n, offset, dry)


@router.post("/api/collections/{cid}/lesson")
def api_lesson(cid: str, b: dict):
    if b.get("confirm") is not True:
        raise HTTPException(400, "a lesson costs a generation run: send confirm:true")
    with _lock:
        col = _get(_guard(_load), cid)
        if not _active(col):
            raise HTTPException(400, "the collection is empty")
        req = lesson_request(col)
    if b.get("dry"):
        return {"dry": True, "request": req}
    if GENERATE is None:
        raise HTTPException(503, "the generate job system is not wired")
    return GENERATE(req)
