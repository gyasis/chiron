"""Mazzi — every Anki deck as a tree with card counts; tap one to drill it in Sessione.

    GET /mazzi             the page (shell/mazzi.html)
    GET /api/anki/decks    {decks: [{name, id, cards, total, empty}], total_cards, host}

`cards` = cards directly in the deck, `total` = it plus every sub-deck (what a drill of that deck covers, since
Anki's deck: search includes children). Read-only: deckNamesAndIds + findCards. getDeckStats would give due/new
cheaply but AnkiConnect on the Studio answers "Deck counts unavailable", so counts come from findCards, one per deck
on a small pool, cached CACHE_S so a re-open does not cost another ~3 s. 503 with a plain message when Anki is down.
"""
import sys, threading, time
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

import anki
import mock_oral

SKILL = mock_oral.SKILL
CACHE_S = 60.0
_cache: dict = {"at": 0.0, "out": None}   # one entry, so it cannot grow
_lock = threading.Lock()

router = APIRouter()


def _q(name: str) -> str:
    """Anki search term for a deck: quoted, with the search wildcards (* _) and quotes made literal."""
    esc = name.replace('"', "").replace("*", r"\*").replace("_", r"\_")
    return esc


def _direct(name: str) -> int:
    """Cards sitting in this deck itself, not in its sub-decks."""
    q = _q(name)
    return len(anki.invoke("findCards", query=f'"deck:{q}" -"deck:{q}::*"') or [])


def decks() -> dict:
    ids = anki.invoke("deckNamesAndIds") or {}
    names = sorted(ids)
    with ThreadPoolExecutor(6) as ex:
        direct = dict(zip(names, ex.map(_direct, names)))
    out = []
    for n in names:
        total = sum(c for m, c in direct.items() if m == n or m.startswith(n + "::"))
        out.append({"name": n, "id": ids[n], "cards": direct[n], "total": total, "empty": total == 0})
    return {"decks": out, "total_cards": sum(direct.values()), "host": anki.host_label(anki.URL)}


def cached_decks(now: float | None = None) -> dict:
    now = time.monotonic() if now is None else now
    with _lock:
        if _cache["out"] is not None and now - _cache["at"] < CACHE_S:
            return _cache["out"]
    out = decks()   # outside the lock: a slow Anki must not block a cache hit elsewhere
    with _lock:
        _cache["at"], _cache["out"] = now, out
    return out


@router.get("/mazzi", response_class=HTMLResponse)
def page():
    return HTMLResponse((SKILL / "shell" / "mazzi.html").read_text(),
                        headers={"Cache-Control": "no-cache, must-revalidate"})


@router.get("/api/anki/decks")
def api_decks(fresh: int = 0):
    if fresh:
        _cache["out"] = None
    try:
        return cached_decks()
    except anki.AnkiUnavailable as e:
        sys.stderr.write(f"[mazzi] anki down: {e}\n")
        raise HTTPException(503, f"Anki is unreachable (open Anki on the Mac Studio): {e}")
    except Exception as e:
        sys.stderr.write(f"[mazzi] {type(e).__name__}: {e}\n")
        raise HTTPException(500, f"deck list failed: {type(e).__name__}: {e}")
