"""mm_study — Match Madness "📖 Studia nella lezione": which Chiron lesson SECTION teaches this word?

    POST /api/mm/study   {words:[{it, en?}, ...]}
        -> {items:[{it, en, lesson, lesson_title, section, section_title, path, url, why:'card'|'passage',
                    snippet, listen:bool, listen_path, alternates:[{...same, no alternates...}, up to 2]}],
            unmatched:[it, ...], corpus:{passages, cards}}

No model, no embedding, no network: it ranks plain text.
  1. CARD  the word is a card of a lesson in listening.index.json (accents/case folded, a leading article ignored);
           flashcard/vocab/pimsleur sources beat dialogue. The section is then the best passage of THAT lesson
           that contains the word.
  2. PASSAGE  otherwise the best passages of library.corpus.{medical-italian,language-it,medicine}.json: the whole
           phrase on a word boundary beats "all the words", a hit in the section title beats one in the body,
           medical-italian > language-it > medicine (the English corpus).
Passages of one section (overview-1, overview-2 ...) are one section: the anchor is the lesson's own (meta.href).
The indexes load once and reload when the file's mtime changes.
"""
import json, os, re, sys, threading, unicodedata
from urllib.parse import quote
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

LIB = Path(os.environ.get("CHIRON_LIBRARY", Path.home() / "Documents/generated/chiron-library"))
CORPORA = ("medical-italian", "language-it", "medicine")           # preference order
DOMAIN_W = {"medical-italian": 4.0, "language-it": 3.0, "medicine": 0.0}
SRC_RANK = {"pimsleur": 0, "flashcard": 1, "vocab": 2, "script": 3}
STRONG_SRC = {"pimsleur", "flashcard", "vocab"}
MAX_WORDS, MAX_ALT = 40, 2
ARTICLES = ("il ", "lo ", "la ", "l'", "i ", "gli ", "le ", "un ", "uno ", "una ", "un'")

_lock = threading.Lock()
_cache: dict = {"sig": None, "passages": [], "by_lesson": {}, "cards": [], "lessons": {}}


def _log(msg: str) -> None:
    sys.stderr.write(f"[mm-study] {msg}\n")


_CH: dict = {}


def _fold_char(c: str) -> str:
    r = _CH.get(c)
    if r is None:
        d = "".join(x for x in unicodedata.normalize("NFD", c) if unicodedata.category(x) != "Mn")
        r = (d.lower() if len(d.lower()) == 1 else d[:1].lower()) or c
        _CH[c] = r
    return r


def fold(s: str) -> str:
    """Lower-case, accents stripped, same LENGTH as the input so an index in the folded text is an index in the original."""
    return "".join(map(_fold_char, s or ""))


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", fold(s).replace("’", "'")).strip(" .,;:!?«»\"'")


def strip_article(s: str) -> str:
    for a in ARTICLES:
        if s.startswith(a) and len(s) > len(a) + 2:
            return s[len(a):]
    return s


def toks(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s)


def stem(t: str) -> str:
    return t[:max(4, len(t) - 2)] if len(t) > 5 else t


def _sig() -> tuple:
    out = []
    for n in [f"library.corpus.{c}.json" for c in CORPORA] + ["listening.index.json"]:
        try:
            out.append(((LIB / n).stat().st_mtime, n))
        except FileNotFoundError:
            out.append((None, n))
    return tuple(out)


def _section_title(title: str) -> str:
    t = title.split(" — ")[-1] if " — " in title else title
    return re.sub(r"^\d+\s+", "", t).strip()


def _load() -> dict:
    sig = _sig()
    with _lock:
        if _cache["sig"] == sig:
            return _cache
        passages, by_lesson = [], {}
        for c in CORPORA:
            p = LIB / f"library.corpus.{c}.json"
            if not p.exists():
                _log(f"{p} is missing — that corpus is skipped")
                continue
            try:
                rows = json.loads(p.read_text())
            except Exception as e:
                raise RuntimeError(f"{p} is unreadable: {type(e).__name__}: {e}")
            for r in rows:
                m = r.get("meta") or {}
                lid = m.get("lessonId") or str(r["id"]).split("#")[0]
                href = m.get("href") or f"/lessons/{lid.replace('/', '-')}/lesson.html"
                path, _, anchor = href.partition("#")
                row = {"domain": c, "lesson": lid, "lesson_title": m.get("lesson") or lid,
                       "section": anchor, "section_title": _section_title(r.get("title", "")),
                       "path": href, "text": r.get("text", ""), "ftext": fold(r.get("text", "")),
                       "flesson": fold(m.get("lesson") or ""), "fsec": fold(_section_title(r.get("title", "")))}
                passages.append(row)
                by_lesson.setdefault(lid, []).append(row)
        cards, lessons = [], {}
        lp = LIB / "listening.index.json"
        if lp.exists():
            try:
                idx = json.loads(lp.read_text())
            except Exception as e:
                raise RuntimeError(f"{lp} is unreadable: {type(e).__name__}: {e}")
            lessons = idx.get("lessons", {})
            for c in idx.get("cards", []):
                cards.append({**c, "nit": strip_article(norm(c.get("it", "")))})
        _cache.update(sig=sig, passages=passages, by_lesson=by_lesson, cards=cards, lessons=lessons)
        _log(f"indexed {len(passages)} passages, {len(cards)} cards, {len(lessons)} listening lessons")
        return _cache


def _matcher(word: str):
    """(phrase regex | None, token stems). The phrase must sit on word boundaries."""
    n = norm(word)
    ts = toks(n)
    if not ts:
        return None, []
    phrase = re.compile(r"(?<![a-z0-9])" + r"[^a-z0-9]+".join(map(re.escape, ts)) + r"(?![a-z0-9])")
    return phrase, [stem(t) for t in ts if len(t) > 2 or len(ts) == 1]


def _score(row: dict, phrase, stems: list[str]) -> tuple[float, int]:
    """(score, index of the first hit in the text); 0 = no match. A phrase hit beats an all-words hit."""
    ft = row["ftext"]
    if stems and stems[0] not in ft:                   # cheap reject before any regex (21k passages per word)
        return 0.0, -1
    hits = list(phrase.finditer(ft)) if phrase else []
    s, pos = 0.0, -1
    if hits:
        s, pos = 10 + min(len(hits), 3), hits[0].start()
    elif stems and len(stems) > 1 and all(re.search(r"(?<![a-z0-9])" + re.escape(t), ft) for t in stems):
        m = re.search(r"(?<![a-z0-9])" + re.escape(stems[0]), ft)
        s, pos = 3.0, m.start()
    if not s:
        return 0.0, -1
    if phrase and phrase.search(row["fsec"]):
        s += 6                                         # the word is the section's own subject
    if phrase and phrase.search(row["flesson"]):
        s += 12                                        # ... or the lesson's
    return s + DOMAIN_W[row["domain"]], pos


def _snippet(text: str, pos: int, n: int = 140) -> str:
    a = max(0, pos - n // 3)
    b = min(len(text), a + n)
    sn = re.sub(r"\s+", " ", text[a:b]).strip()
    return ("…" if a else "") + sn + ("…" if b < len(text) else "")


def _sections(rows: list[dict], phrase, stems) -> list[dict]:
    """Best section per (lesson, anchor), highest score first."""
    best: dict = {}
    for r in rows:
        s, pos = _score(r, phrase, stems)
        if not s:
            continue
        k = (r["lesson"], r["section"])
        b = best.get(k)
        if b is None:
            best[k] = {"score": s, "row": r, "pos": pos}
        else:
            b["score"] += 0.25 * s
            if s > _score(b["row"], phrase, stems)[0]:
                b.update(row=r, pos=pos)
    return sorted(best.values(), key=lambda b: -b["score"])


def _shape(b: dict, why: str, idx: dict) -> dict:
    r = b["row"]
    return {"lesson": r["lesson"], "lesson_title": r["lesson_title"], "section": r["section"],
            "section_title": r["section_title"], "path": r["path"], "why": why,
            "snippet": _snippet(r["text"], b["pos"]),
            "listen": r["lesson"] in idx["lessons"], "listen_path": f"/ascolto?lesson={quote(r['lesson'], safe='')}"}


def find(word: dict, idx: dict) -> dict | None:
    it = str(word.get("it") or "").strip()
    phrase, stems = _matcher(it)
    if phrase is None:
        return None
    nit = strip_article(norm(it))
    found: list[dict] = []
    seen: set = set()

    # 1) card -> its lesson -> the section of that lesson that has the word
    cards = sorted((c for c in idx["cards"] if c["nit"] == nit),
                   key=lambda c: (c.get("source") not in STRONG_SRC, SRC_RANK.get(c.get("source"), 9)))
    for c in cards:
        lid = c.get("lesson")
        if lid in seen:
            continue
        secs = _sections(idx["by_lesson"].get(lid, []), phrase, stems)
        if secs:
            found.append(_shape(secs[0], "card", idx))
        else:                                      # the lesson owns the card but no passage shows it: the lesson itself
            rows = idx["by_lesson"].get(lid) or []
            path = rows[0]["path"].split("#")[0] if rows else f"/lessons/{lid.replace('/', '-')}/lesson.html"
            found.append({"lesson": lid, "lesson_title": c.get("lesson_title") or lid, "section": "",
                          "section_title": "", "path": path, "why": "card", "snippet": c.get("it", ""),
                          "listen": lid in idx["lessons"], "listen_path": f"/ascolto?lesson={quote(lid, safe='')}"})
        seen.add(lid)
        if len(found) > MAX_ALT:
            break

    # 2) passages, best section of each lesson not already offered
    if len(found) <= MAX_ALT:
        for b in _sections(idx["passages"], phrase, stems):
            if b["row"]["lesson"] in seen:
                continue
            seen.add(b["row"]["lesson"])
            found.append(_shape(b, "passage", idx))
            if len(found) > MAX_ALT:
                break
    if not found:
        return None
    best = found[0]
    return {"it": it, "en": str(word.get("en") or ""), **best, "alternates": found[1:1 + MAX_ALT]}


def study(words: list[dict]) -> dict:
    idx = _load()
    items, unmatched = [], []
    for w in words:
        r = find(w, idx)
        if r:
            items.append(r)
        else:
            unmatched.append(str(w.get("it") or ""))
    _log(f"{len(words)} words -> {len(items)} matched, {len(unmatched)} unmatched")
    return {"items": items, "unmatched": unmatched,
            "corpus": {"passages": len(idx["passages"]), "cards": len(idx["cards"])}}


class StudyIn(BaseModel):
    words: list[dict]


@router.post("/api/mm/study")
def api_study(body: StudyIn, request: Request):
    seen, words = set(), []
    for w in body.words:
        it = re.sub(r"\s+", " ", str((w or {}).get("it") or "")).strip()
        if it and it.lower() not in seen:
            seen.add(it.lower())
            words.append({"it": it, "en": (w or {}).get("en") or ""})
    if not words:
        raise HTTPException(400, "words is empty")
    if len(words) > MAX_WORDS:
        raise HTTPException(400, f"too many words ({len(words)} > {MAX_WORDS}) — send fewer per call")
    try:
        out = study(words)
    except RuntimeError as e:
        raise HTTPException(503, str(e)[:300])
    base = str(request.base_url).rstrip("/")
    for it in out["items"]:
        for r in [it, *it["alternates"]]:
            r["url"] = base + r["path"]
            r["listen_url"] = base + r["listen_path"] if r["listen"] else None
    return out
