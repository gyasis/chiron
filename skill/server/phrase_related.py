"""phrase_related — "Study more" for the phrase coach: lessons in the learner's own library that teach the topics a
built phrase uses (verb lemmas, constructions, key vocabulary), and the topics no lesson covers yet.

The search is BM25 over the language-it corpus shard (/library/library.corpus.language-it.json), the same passages
Ask's librarian retrieves from. It runs here, server-side, and is separate from acolyte's own RAG (which stays off in
phrase mode). The language-it shard holds no clinical-only lessons, so a clinical-only match cannot occur.

    find_related(topics) -> {"lessons": [{title, url, topic, section?}], "missing": [topic]}
    topics: [{"topic": "dovere + infinito", "kind": "construction|verb|vocabulary", "query": "dovere infinito ..."}]
"""
from __future__ import annotations
import html, json, math, os, re, sys, threading, unicodedata
from pathlib import Path

GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
LIBRARY = Path(os.environ.get("CHIRON_LIBRARY_DIR", GEN / "chiron-library"))
SHARD = "library.corpus.language-it.json"
MAX_LESSONS, MAX_MISSING = 5, 6
K1, B = 1.4, 0.75
GENERIC = {"verbo", "verbi", "forma", "domande", "domanda", "modali"}
# A bare match on one of these says nothing: they are in almost every lesson. Such a verb is a topic only through a
# construction (dovere + infinito, passato prossimo) or a vocabulary phrase (fare la presa di servizio) that contains it.
COMMON_LEMMAS = {"essere", "avere", "fare", "andare", "stare", "dare", "dire", "venire", "potere", "volere", "dovere", "sapere", "vedere"}
_TOKEN = re.compile(r"[a-z0-9']+")
_lock = threading.Lock()
_cache: dict = {}


def _log(msg: str) -> None:
    sys.stderr.write(f"[phrase_related] {msg}\n")
    sys.stderr.flush()


def tokens(text: str) -> list[str]:
    d = "".join(c for c in unicodedata.normalize("NFD", text or "") if unicodedata.category(c) != "Mn")
    return [t.strip("'") for t in _TOKEN.findall(d.lower().replace("’", "'")) if len(t.strip("'")) >= 2]


def _index(path: Path) -> dict:
    """The tokenised passages and BM25 statistics, rebuilt only when the shard file changes."""
    mtime = path.stat().st_mtime
    with _lock:
        hit = _cache.get(str(path))
        if hit and hit["mtime"] == mtime:
            return hit
    rows = json.loads(path.read_text())
    docs, df = [], {}
    for p in rows:
        meta = p.get("meta") or {}
        title_toks = tokens(meta.get("lesson") or p.get("title") or "")
        toks = title_toks * 3 + tokens(p.get("text") or "")     # a title match counts three times
        tf: dict[str, int] = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        for t in tf:
            df[t] = df.get(t, 0) + 1
        docs.append({"p": p, "tf": tf, "len": len(toks)})
    avg = sum(d["len"] for d in docs) / max(1, len(docs))
    idx = {"mtime": mtime, "docs": docs, "df": df, "avg": avg, "n": len(docs)}
    with _lock:
        _cache[str(path)] = idx
    return idx


def _need(kind: str, n_anchors: int) -> int:
    """How many distinct anchor terms a passage must contain to count as teaching the topic."""
    return 1 if kind == "verb" else min(2, n_anchors)


def search(idx: dict, topic: dict, limit: int = 8) -> list[tuple[float, dict]]:
    anchors = list(dict.fromkeys(t for t in tokens(topic.get("query") or topic.get("topic") or "") if t not in GENERIC))
    if not anchors:
        return []
    need = _need(topic.get("kind", ""), len(anchors))
    out = []
    for d in idx["docs"]:
        present = [a for a in anchors if a in d["tf"]]
        if len(present) < need:
            continue
        score = 0.0
        for a in present:
            f, n = d["tf"][a], idx["df"].get(a, 0)
            idf = math.log(1 + (idx["n"] - n + 0.5) / (n + 0.5))
            score += idf * f * (K1 + 1) / (f + K1 * (1 - B + B * d["len"] / idx["avg"]))
        out.append((score, d["p"]))
    out.sort(key=lambda x: -x[0])
    return out[:limit]


def lesson_of(p: dict) -> tuple[str, str, str]:
    """(lesson id, lesson title, section label) of a corpus passage."""
    meta = p.get("meta") or {}
    title = meta.get("lesson") or (p.get("title") or "").split(" — ")[0]
    full = p.get("title") or ""
    section = full[len(title):].lstrip(" —") if full.startswith(title) else full.partition(" — ")[2]
    # the corpus keeps titles HTML-escaped; the page shows them with textContent, so they are decoded once here
    return meta.get("lessonId") or p.get("id", "").split("#")[0], html.unescape(title), html.unescape(section.strip())


def select(per_topic: list[tuple[dict, list[tuple[float, dict]]]], max_lessons: int = MAX_LESSONS, max_missing: int = MAX_MISSING) -> dict:
    """Walk the topics in order: each takes its best lesson not already chosen (one row per lesson), at most
    `max_lessons` in all. A topic with no matching passage at all is missing; one whose matches were all taken by an
    earlier topic is covered and listed nowhere."""
    lessons, chosen, missing = [], set(), []
    for topic, hits in per_topic:
        if not hits:
            if topic["topic"] not in missing:
                missing.append(topic["topic"])
            continue
        if len(lessons) >= max_lessons:
            continue
        for score, p in hits:
            lid, title, section = lesson_of(p)
            if lid in chosen:
                continue
            chosen.add(lid)
            row = {"title": title, "url": (p.get("meta") or {}).get("href") or f"/lessons/{lid}/lesson.html",
                   "topic": topic["topic"]}
            if section:
                row["section"] = section
            lessons.append(row)
            break
    return {"lessons": lessons, "missing": missing[:max_missing]}


def is_bare_common(topic: dict) -> bool:
    """A verb topic that is only a high-frequency lemma: not searched, not reported missing."""
    return topic.get("kind") == "verb" and str(topic.get("topic", "")).strip().lower() in COMMON_LEMMAS


def find_related(topics: list[dict], shard: Path | None = None) -> dict:
    path = shard or (LIBRARY / SHARD)
    if not path.exists():
        raise FileNotFoundError(f"library shard not found: {path}")
    idx = _index(path)
    return select([(t, search(idx, t)) for t in topics if not is_bare_common(t)])
