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


# ── creating ───────────────────────────────────────────────────────────────

# Cards Chiron writes go to their OWN deck. Dropping them into the curated
# Medical Italian tree would mix generated cards into decks the user built by
# hand, and there would be no way to tell them apart later or study them
# separately. One deck, tagged with where each came from.
CHIRON_DECK = os.environ.get("CHIRON_ANKI_DECK", "Chiron")


def add_notes(cards: list[dict], deck: str | None = None,
              tags: list[str] | None = None, model: str | None = None) -> dict:
    """Create notes from generated cards. `cards` = [{front, back, ...}].

    Duplicates are REFUSED rather than allowed: capturing the same answer twice
    should not produce two identical cards competing in the same rotation.
    AnkiConnect returns a null id for each note it declined, so the caller is
    told how many were new versus already present.
    """
    deck = deck or CHIRON_DECK
    invoke("createDeck", deck=deck)
    notes = []
    for c in cards:
        if model:
            # Custom note type: the caller supplies the field map itself
            # (c["fields"]); per-card c["tags"] are added to the shared tags.
            flds = {k: str(v) for k, v in (c.get("fields") or {}).items()}
            if not any(v.strip() for v in flds.values()):
                continue
            mname, ctags = model, list(c.get("tags") or [])
        else:
            front, back = (c.get("front") or "").strip(), (c.get("back") or "").strip()
            if not front or not back:
                continue
            flds, mname, ctags = {"Front": front, "Back": back}, "Basic", []
        notes.append({
            "deckName": deck,
            "modelName": mname,
            "fields": flds,
            "tags": list(dict.fromkeys(["chiron"] + list(tags or []) + ctags)),
            "options": {"allowDuplicate": False,
                        "duplicateScope": "deck",
                        "duplicateScopeOptions": {"deckName": deck, "checkChildren": True}},
        })
    if not notes:
        return {"ok": False, "added": 0, "of": 0, "deck": deck,
                "detail": "the generator produced no usable front/back pairs"}

    # PARTITION FIRST. addNotes raises for the WHOLE batch when any one note is
    # a duplicate — measured: "cannot create note because it is a duplicate" —
    # so a capture with four new cards and one repeat would lose all five.
    # canAddNotes reports per-note, so the new ones still land.
    try:
        can = invoke("canAddNotes", notes=notes) or []
    except Exception:
        can = [True] * len(notes)          # older AnkiConnect: try them all
    fresh = [n for n, ok in zip(notes, list(can) + [True] * len(notes)) if ok]
    dupes = len(notes) - len(fresh)

    added: list = []
    if fresh:
        try:
            added = [i for i in (invoke("addNotes", notes=fresh) or []) if i]
        except Exception as e:
            # A duplicate that slipped past canAddNotes (a race, or a scope
            # difference) must not take the rest down with it.
            for n in fresh:
                try:
                    got = invoke("addNote", note=n)
                    if got:
                        added.append(got)
                except Exception:
                    dupes += 1
            if not added:
                raise RuntimeError(f"no cards could be added: {e}") from e

    return {
        "ok": bool(added),
        "added": len(added),
        "of": len(notes),
        "duplicates": dupes,
        "deck": deck,
        "noteIds": added,
        "detail": None if not dupes else
        f"{dupes} already existed in {deck} and were not added again.",
    }


# ── media, note types, tags (Sessione) ─────────────────────────────────────

PROD_DECK = "Chiron::Produzione"
QUADERNO_DECK = "Chiron::Quaderno"
PROD_MODEL = "Chiron Produzione"
LISTEN_MODEL = "Chiron Ascolto"

_CSS = (".card{font-family:system-ui,sans-serif;font-size:20px;text-align:center;"
        "color:#222;background:#fff;max-width:640px;margin:0 auto;padding:12px}"
        ".nightMode .card,.night_mode .card{color:#eee;background:#1e1e1e}"
        ".chip{display:inline-block;margin:3px;padding:3px 10px;border:1px solid #888;"
        "border-radius:14px;font-size:17px}.verbs{margin-top:10px;font-size:16px;opacity:.8}"
        ".note{margin-top:12px;font-size:15px;opacity:.7}.sit{font-size:20px}"
        ".it{font-size:24px;font-weight:600}.en{opacity:.75}")

_MODELS = {
    PROD_MODEL: {
        "fields": ["Situazione", "Banca", "Verbi", "Risposta", "Audio", "Note"],
        "front": ('<div class="sit">{{Situazione}}</div><div class="bank">{{Banca}}</div>'
                  '<div class="verbs">{{Verbi}}</div>'),
        "back": ('{{FrontSide}}<hr id="answer"><div class="it">{{Risposta}}</div>{{Audio}}'
                 '<div class="note">{{Note}}</div>'),
    },
    LISTEN_MODEL: {
        "fields": ["Audio", "Italiano", "English", "Note"],
        "front": "{{Audio}}<div class=\"en\">Ascolta e ripeti</div>",
        "back": ('{{FrontSide}}<hr id="answer"><div class="it">{{Italiano}}</div>'
                 '<div class="en">{{English}}</div><div class="note">{{Note}}</div>'),
    },
}


def store_media(filename: str, data: bytes) -> str:
    import base64
    invoke("storeMediaFile", filename=filename, data=base64.b64encode(data).decode())
    return filename


def chips(words: list[str]) -> str:
    """Word bank as HTML chips for the Banca field."""
    return "".join(f'<span class="chip">{w}</span>' for w in words)


def ensure_models() -> dict:
    """Create the Sessione note types and decks if absent. Idempotent."""
    have = set(invoke("modelNames") or [])
    made = []
    for name, m in _MODELS.items():
        if name in have:
            continue
        invoke("createModel", modelName=name, inOrderFields=m["fields"], css=_CSS,
               cardTemplates=[{"Name": "Card 1", "Front": m["front"], "Back": m["back"]}])
        made.append(name)
    for d in (PROD_DECK, QUADERNO_DECK):
        invoke("createDeck", deck=d)
    return {"created": made, "present": sorted(set(_MODELS) & (have | set(made)))}


def add_tags(note_ids: list[int], tags: str | list[str]) -> None:
    if isinstance(tags, (list, tuple)):
        tags = " ".join(tags)
    if note_ids:
        invoke("addTags", notes=[int(n) for n in note_ids], tags=tags)


def notes_for_cards(card_ids: list[int]) -> dict[int, dict]:
    """cardId -> {noteId, tags} (one cardsInfo + one notesInfo call)."""
    ids = [int(c) for c in card_ids]
    if not ids:
        return {}
    ci = invoke("cardsInfo", cards=ids) or []
    nmap = {int(c["cardId"]): int(c["note"]) for c in ci if c and c.get("cardId") is not None}
    ni = invoke("notesInfo", notes=sorted(set(nmap.values()))) or []
    tg = {int(n["noteId"]): n.get("tags", []) for n in ni if n}
    return {cid: {"noteId": nid, "tags": tg.get(nid, [])} for cid, nid in nmap.items()}
