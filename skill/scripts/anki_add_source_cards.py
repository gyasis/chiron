#!/usr/bin/env python3
"""anki_add_source_cards — add the words a source-audio lesson marks "new" to Anki, with the source's own audio.

    anki_add_source_cards.py <lesson-dir> [<lesson-dir> ...] [--dry-run]

Reads <lesson-dir>/cards.json ("new": [entry id…]) and content.json (the "parole" vocab rows), then adds one
"Basic (and reversed card)" note per new word to the deck chiron::Lezioni::<lesson title>:
  Front = Italian word + [sound:…] (the word clip cut from the source, audio/phrase/vocab-<id>.mp3)
  Back  = English, then the example sentence in italics
Tags: chiron, source-audio, lesson:<slug>. Duplicates are skipped (canAddNotes first: addNotes fails the whole batch
on one duplicate). Every write is read back with notesInfo. The created note ids go into cards.json "created".
Exit 1 when a read-back does not match, 2 when Anki is unreachable. AnkiConnect URL/key come from ~/.chiron/anki.env.
"""
from __future__ import annotations

import base64, html, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anki_link import URL, anki  # noqa: E402


def plan_notes(lesson_dir: str) -> tuple[str, list[dict]]:
    content = json.load(open(os.path.join(lesson_dir, "content.json")))
    cards = json.load(open(os.path.join(lesson_dir, "cards.json")))
    slug = json.load(open(os.path.join(lesson_dir, "chiron.json"))).get("slug") or os.path.basename(os.path.normpath(lesson_dir))
    sections = {s["id"]: s for s in content["sections"]}
    words = {v["slug"]: v for v in sections["parole"]["vocab"]}
    examples = {v["slug"][:-3]: v for v in sections.get("frasi", {}).get("vocab", [])}
    deck = f"chiron::Lezioni::{content['title']}"
    notes = []
    for eid in cards.get("new", []):
        w = words.get(eid)
        if not w:          # not a table row (a play-only block): nothing to learn as a card
            continue
        ex = examples.get(eid)
        mp3 = os.path.join(lesson_dir, "audio", "phrase", f"vocab-{eid}.mp3")
        media = f"{slug}-{eid}.mp3"
        back = html.escape(w["en"], quote=False) + (f"<br><i>{html.escape(ex["it"], quote=False)}</i>" if ex and ex.get("it") else "")
        notes.append({"id": eid, "deck": deck, "mp3": mp3 if os.path.exists(mp3) else None, "media": media,
                      "fields": {"Front": html.escape(w["it"], quote=False) + (f" [sound:{media}]" if os.path.exists(mp3) else ""),
                                 "Back": back},
                      "tags": ["chiron", "source-audio", f"lesson:{slug}"]})
    return deck, notes


def add_lesson(lesson_dir: str, dry: bool) -> int:
    deck, notes = plan_notes(lesson_dir)
    name = os.path.basename(os.path.normpath(lesson_dir))
    if not notes:
        print(f"{name}: no new words"); return 0
    payload = [{"deckName": n["deck"], "modelName": "Basic (and reversed card)", "fields": n["fields"], "tags": n["tags"]}
               for n in notes]
    if dry:
        for n in notes:
            print(f"{name}: would add {n['fields']['Front']!r} -> {n['fields']['Back']!r} [{deck}]")
        return 0
    anki("createDeck", deck=deck)
    ok = anki("canAddNotes", notes=payload)
    for n, can in zip(notes, ok):
        if not can:
            print(f"{name}: {n['id']} skipped — Anki calls it a duplicate", file=sys.stderr)
    todo = [(n, p) for n, p, can in zip(notes, payload, ok) if can]
    for n, _ in todo:
        if n["mp3"]:
            anki("storeMediaFile", filename=n["media"], data=base64.b64encode(open(n["mp3"], "rb").read()).decode())
    ids = anki("addNotes", notes=[p for _, p in todo]) if todo else []
    bad = 0
    created = {}
    info = {i["noteId"]: i for i in anki("notesInfo", notes=[i for i in ids if i])} if any(ids) else {}
    for (n, _), nid in zip(todo, ids):
        got = info.get(nid)
        if not nid or not got or got["fields"]["Front"]["value"] != n["fields"]["Front"]:
            print(f"{name}: {n['id']} NOT written (note id {nid})", file=sys.stderr); bad += 1; continue
        created[n["id"]] = nid
        print(f"{name}: added {n['id']} {html.unescape(n['fields']['Front'].split(' [sound:')[0])} -> note {nid}")
    cp = os.path.join(lesson_dir, "cards.json")
    cards = json.load(open(cp))
    cards["created"] = {**cards.get("created", {}), **{k: v for k, v in created.items()}}
    json.dump(cards, open(cp, "w"), ensure_ascii=False, indent=1)
    print(f"{name}: {len(created)} added to {deck}, {len(notes) - len(todo)} duplicates skipped, {bad} failed")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    dirs = [a for a in argv if a != "--dry-run"]
    if not dirs:
        print(__doc__); return 2
    if not dry:
        try:
            anki("version")
        except Exception as ex:
            print(f"anki_add_source_cards: Anki unreachable at {URL}: {ex}", file=sys.stderr); return 2
    return max(add_lesson(d, dry) for d in dirs)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
