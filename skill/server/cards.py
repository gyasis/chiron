"""Semantic card retrieval over the Anki index.

The index is built by scripts/build-anki-index.py with the SAME embedder the
lesson corpus uses (:8913, bge-m3). This module loads it once and answers
"which cards belong with this question".

It refuses to serve if the index was built by a different model than the one
answering queries — mismatched embedders return confident nonsense rather than
an error, so parity is checked rather than assumed.
"""
from __future__ import annotations

import json
import os
import threading
import urllib.request

CORPUS_DIR = os.path.expanduser("~/Documents/generated/chiron-library")
INDEX = os.path.join(CORPUS_DIR, "anki.index.json")
VECS = os.path.join(CORPUS_DIR, "anki.index.vec.bin")
EMBED_URL = os.environ.get("CHIRON_EMBED_URL", "http://127.0.0.1:8913").rstrip("/")

_LOCK = threading.Lock()
_META: dict | None = None
_V = None                       # numpy float32 matrix, L2-normalised


def load(force: bool = False):
    global _META, _V
    with _LOCK:
        if _META is not None and not force:
            return _META, _V
        if not (os.path.exists(INDEX) and os.path.exists(VECS)):
            _META, _V = None, None
            return None, None
        import numpy as np
        m = json.load(open(INDEX))
        n, dim = len(m["cards"]), m["dim"]
        v = np.fromfile(VECS, dtype=np.int8)
        if v.size != n * dim:
            _META, _V = None, None
            return None, None
        _META, _V = m, v.reshape(n, dim).astype(np.float32) / 127.0
        return _META, _V


def status() -> dict:
    m, _ = load()
    if not m:
        return {"indexed": 0, "model": None, "built": None, "decks": []}
    by: dict[str, int] = {}
    for c in m["cards"]:
        top = c["deck"].split("::")[0]
        by[top] = by.get(top, 0) + 1
    return {"indexed": len(m["cards"]), "model": m["model"], "dim": m["dim"],
            "built": m.get("built"), "decks": by}


def _embed_query(text: str, model: str):
    import numpy as np
    body = json.dumps({"model": model, "input": [text], "input_type": "query"}).encode()
    req = urllib.request.Request(f"{EMBED_URL}/api/embed", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    if d.get("model") and d["model"] != model:
        raise RuntimeError(f"embedder parity: index built with {model}, service serves {d['model']}")
    return np.asarray(d["embeddings"][0], dtype="float32")


def relevant(query: str, k: int = 6, deck_prefix: str | None = None,
             balance: bool = True) -> list[dict]:
    """Cards that belong with this question, best first.

    DEDUPED BY NOTE. `Basic (and reversed card)` yields two cards per note and
    the two sit almost on top of each other in embedding space, so an un-deduped
    top-6 is really three phrases shown twice. The better-scoring direction wins.
    """
    import numpy as np
    m, V = load()
    if not m:
        return []
    qv = _embed_query(query, m["model"])
    sims = V @ qv

    idx = np.argsort(-sims)
    out, seen_note = [], set()
    for i in idx[: max(k * 12, 60)]:
        c = m["cards"][int(i)]
        if deck_prefix and not c["deck"].startswith(deck_prefix):
            continue
        # Both directions of one note share their text; key on the pair so only
        # the stronger direction survives.
        note_key = tuple(sorted((c["front"].lower(), c["back"].lower())))
        if note_key in seen_note:
            continue
        seen_note.add(note_key)
        out.append({**c, "score": round(float(sims[int(i)]), 4)})
        if len(out) >= k * 3:
            break

    if not balance:
        return out[:k]

    # A session that is all vocabulary teaches recognition and no conversation.
    # Take the best of each side first, then fill on score — so what the patient
    # says is never crowded out by what you ask.
    picked, by_side = [], {"you": [], "them": [], "vocab": []}
    for c in out:
        by_side.setdefault(c["side"], []).append(c)
    for side in ("you", "them", "vocab"):
        picked.extend(by_side.get(side, [])[:1])
    for c in out:
        if len(picked) >= k:
            break
        if c not in picked:
            picked.append(c)
    picked.sort(key=lambda c: -c["score"])
    return picked[:k]
