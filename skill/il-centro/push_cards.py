#!/usr/bin/env python3
"""Push a day's cards into Anki — the ONE place card pushing happens.

    python3 push_cards.py 6              # add net-new notes, with audio if it exists
    python3 push_cards.py 6 --dry-run    # report what would change, touch nothing

Card pushing used to be an ad-hoc snippet retyped per day. That is how the tag vocabulary
drifted: `slug()` was rewritten from memory each time, and one version stripped non-ASCII
before punctuation, so `Dieta e longevità` became `dieta-e-longevit` and `Santhià` became
`santhi-`. Those tags were repaired in place, but a repair is worthless if the next push
regenerates them — hence this file.

Deck layout (R-IC8):

    il centro di italia          parent, holds NOTHING directly
    └── Day <N>                  every card lives in a day subdeck, filed by the day it was
                                 created and never moved afterwards

Tags, three layers, each doing a job the deck cannot:

    il-centro-di-italia          the series — survives any deck reorganisation
    day-<N>                      duplicates the deck ON PURPOSE: tags cross decks, decks don't
    <chapter-slug>              the chapter, so one topic can be drilled on its own

R-IC10: dedupe against the WHOLE series with `[sound:]` stripped, and report `N new,
M already present` — never silently.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import unicodedata
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ANKI = "http://127.0.0.1:8765"
PARENT = "il centro di italia"
MODEL = "Basic (and reversed card)"


def slug(s: str) -> str:
    """Chapter title -> tag.

    NFKD-transliterate BEFORE stripping, or accented letters vanish instead of degrading:
    `Società` must become `societa`, never `societ`. This ordering is the entire bug that
    produced four malformed tags across Days 1-6.
    """
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def inv(action: str, **params):
    req = urllib.request.Request(
        ANKI, data=json.dumps({"action": action, "version": 6, "params": params}).encode(),
        headers={"Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    if d.get("error"):
        raise RuntimeError(f"{action}: {d['error']}")
    return d["result"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("day")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    deck = f"{PARENT}::Day {a.day}"
    cards = json.load(open(f"{HERE}/il-centro-day-{a.day}/cards.json", encoding="utf-8"))
    src = f"{HERE}/.audio-src/day-{a.day}"

    have = {n["fields"]["Front"]["value"].split(" [sound:")[0]
            for n in inv("notesInfo", notes=inv("findNotes", query=f'deck:"{PARENT}::*"'))}

    new = [c for c in cards if c["it"] not in have]
    print(f"il centro — Day {a.day}: {len(cards)} cards defined · {len(new)} net-new · "
          f"{len(cards) - len(new)} already in the series")
    if a.dry_run:
        for c in new:
            snd = "audio" if os.path.exists(f"{src}/{c['clip']}.mp3") else "NO AUDIO"
            print(f"    + {c['it'][:58]:60} [{snd}]")
        return 0

    if deck not in inv("deckNames"):
        inv("createDeck", deck=deck)
        print(f"  created deck {deck}")

    added = withaudio = 0
    for c in new:
        front, clip = c["it"], f"{src}/{c['clip']}.mp3"
        if os.path.exists(clip):
            fn = f"icdi-d{a.day}-{c['clip']}.mp3"
            inv("storeMediaFile", filename=fn,
                data=base64.b64encode(open(clip, "rb").read()).decode())
            front = f"{c['it']} [sound:{fn}]"
            withaudio += 1
        back = c["en"] + (f"<br><i>{c['note']}</i>" if c.get("note") else "")
        inv("addNotes", notes=[{
            "deckName": deck, "modelName": MODEL,
            "fields": {"Front": front, "Back": back},
            "options": {"allowDuplicate": False},
            "tags": ["il-centro-di-italia", f"day-{a.day}", slug(c["chapter"])]}])
        added += 1

    day_n = len(inv("findNotes", query=f'deck:"{deck}"'))
    tot = len(inv("findNotes", query=f'deck:"{PARENT}::*"'))
    print(f"  {added} added ({withaudio} with audio)")
    print(f"  Day {a.day}: {day_n} notes · series: {tot}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
