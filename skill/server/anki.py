"""AnkiConnect client — Chiron's link to the real collection.

WHY ANKI IS AUTHORITATIVE
-------------------------
Chiron owns spaced repetition for the cards it generates (`.chiron-state.db`).
It does NOT own it for cards that already live in Anki. A card reviewed in
Chiron must advance Anki's scheduler, or the same card comes back tomorrow in
Anki as though it were never seen — two schedulers quietly disagreeing about
one memory. So every review Chiron takes is written straight back, and if it
cannot be written the card is not shown at all (see `reachable`).

WHERE IT LIVES
--------------
AnkiConnect runs inside the Anki app on the MacBook, bound to the LAN
(`webBindAddress: 0.0.0.0`). It answers only while Anki is open, which is why
`reachable()` is a first-class part of this module rather than an afterthought.

The default host here is deliberately LOCAL. This repo is public, so the real
LAN address is supplied by CHIRON_ANKI_URL (see ~/.chiron/anki.env) and never
committed.

    CHIRON_ANKI_URL   default http://127.0.0.1:8765
    CHIRON_ANKI_KEY   optional; AnkiConnect's apiKey, if one is configured
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

URL = os.environ.get("CHIRON_ANKI_URL", "http://127.0.0.1:8765").rstrip("/")
KEY = os.environ.get("CHIRON_ANKI_KEY") or None
TIMEOUT = float(os.environ.get("CHIRON_ANKI_TIMEOUT", 8))

# Anki embeds media as [sound:file.mp3] inside a field rather than in a field of
# its own, so the text and the audio have to be separated before either is used.
SOUND = re.compile(r"\[sound:([^\]]+)\]")
TAG = re.compile(r"<[^>]+>")


class AnkiUnavailable(RuntimeError):
    """Anki is closed, asleep, or unreachable. Never studied through."""


def invoke(action: str, **params):
    body = {"action": action, "version": 6, "params": params}
    if KEY:
        body["key"] = KEY
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            out = json.loads(r.read())
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise AnkiUnavailable(f"{type(e).__name__}: {e}") from e
    if out.get("error"):
        raise RuntimeError(f"anki: {out['error']}")
    return out.get("result")


def reachable() -> bool:
    try:
        invoke("version")
        return True
    except Exception:
        return False


# ── reading ────────────────────────────────────────────────────────────────

def _clean(html: str) -> tuple[str, str | None]:
    """Field text and its audio filename, separated."""
    audio = None
    m = SOUND.search(html or "")
    if m:
        audio = m.group(1)
    text = SOUND.sub("", html or "")
    text = text.replace("<br>", " · ").replace("<br/>", " · ")
    text = TAG.sub("", text)
    return " ".join(text.split()), audio


# Note types differ per deck — `il centro di italia` is Basic (and reversed
# card) with Front/Back, the sentence decks use sentence / english translation.
# Assuming Front/Back would silently produce blank cards for half the corpus.
FRONT_KEYS = ("front", "sentence", "expression", "word")
BACK_KEYS = ("back", "english translation", "meaning", "translation")


def _field(fields: dict, keys) -> str:
    for k in keys:
        for name, v in fields.items():
            if name.strip().lower() == k:
                return v.get("value", "")
    return ""


def cards(query: str, limit: int | None = None) -> list[dict]:
    """Cards matching an Anki search, normalised to one shape."""
    ids = invoke("findCards", query=query)
    if limit:
        ids = ids[:limit]
    if not ids:
        return []
    out = []
    for c in invoke("cardsInfo", cards=ids):
        f = c.get("fields") or {}
        front, a1 = _clean(_field(f, FRONT_KEYS))
        back, a2 = _clean(_field(f, BACK_KEYS))
        if not front:
            continue
        deck = c.get("deckName", "")
        # `Basic (and reversed card)` makes TWO cards per note, and reading the
        # note's fields makes both look identical — the same phrase twice in a
        # session. The card's template ordinal is what distinguishes them:
        # ord 0 asks in Italian (recall the meaning), ord 1 asks in English
        # (produce the Italian). They are genuinely different exercises, so the
        # sides are swapped rather than the duplicate being dropped.
        reversed_ = c.get("ord") == 1
        if reversed_:
            front, back = back, front
            a1, a2 = a2, a1
        out.append({
            "cardId": c.get("cardId"),
            "deck": deck,
            "direction": "en→it" if reversed_ else "it→en",
            "front": front,
            "back": back,
            "audio": a1 or a2,
            # Which side of the consultation this is. Esame medico is what the
            # doctor asks; Necessità dei pazienti is what the patient answers.
            # A doctor studies those differently — one is production, the other
            # comprehension — so the distinction is carried, not flattened.
            "side": ("them" if "Necessità dei pazienti" in deck
                     else "you" if "Esame medico" in deck and front.rstrip().endswith("?")
                     else "vocab"),
            "due": c.get("due"),
            "interval": c.get("interval"),
        })
    return out


def media(filename: str) -> bytes | None:
    """Card audio, straight out of Anki's media folder."""
    import base64
    b64 = invoke("retrieveMediaFile", filename=filename)
    return base64.b64decode(b64) if b64 else None


# ── writing ────────────────────────────────────────────────────────────────

EASE = {"again": 1, "hard": 2, "good": 3, "easy": 4}


def _reps(card_ids: list[int]) -> dict[int, int]:
    """Review count per card — the only honest evidence a review landed."""
    out = {}
    for c in invoke("cardsInfo", cards=card_ids) or []:
        if c.get("cardId") is not None:
            out[int(c["cardId"])] = int(c.get("reps") or 0)
    return out


def answer(reviews: list[dict]) -> dict:
    """Write reviews back, and VERIFY each one actually landed.

    `answerCards` returns true for a card it did not really grade. Measured:
    a six-card session returned six trues while only three cards gained a rep,
    because Anki's per-deck NEW-CARDS-PER-DAY limit (7 on these decks) had
    already been spent — cards past the day's allowance are not answerable and
    the call no-ops silently.

    Reporting that as "6 reviews written to Anki" is the exact failure this
    whole feature exists to prevent: the user believes the scheduler advanced
    when it did not, and finds the cards again tomorrow. So reps are read
    before and after, and only a real increase counts as written.
    """
    answers = [{"cardId": int(r["cardId"]),
                "ease": int(EASE.get(str(r.get("ease")).lower(), r.get("ease", 3)))}
               for r in reviews]
    if not answers:
        return {"ok": True, "written": 0, "of": 0, "results": []}

    ids = [a["cardId"] for a in answers]
    before = _reps(ids)
    claimed = invoke("answerCards", answers=answers) or []
    after = _reps(ids)

    results, written = [], 0
    for a, said in zip(answers, list(claimed) + [None] * len(answers)):
        cid = a["cardId"]
        landed = after.get(cid, 0) > before.get(cid, -1)
        written += 1 if landed else 0
        results.append({"cardId": cid, "written": landed, "claimed": bool(said),
                        "reps": after.get(cid)})

    missed = len(answers) - written
    return {
        "ok": missed == 0,
        "written": written,
        "of": len(answers),
        "results": results,
        # Name the likely cause rather than leaving a bare number. The daily
        # limit is the common one and is a setting, not a fault.
        "detail": None if missed == 0 else
        (f"{missed} card(s) were not graded — Anki accepted the call but the review "
         f"did not apply. The usual cause is the deck's new-cards/day limit being "
         f"spent; raise it in Anki's deck options, or study the rest tomorrow."),
    }
