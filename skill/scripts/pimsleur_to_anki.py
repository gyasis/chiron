#!/usr/bin/env python3
"""pimsleur_to_anki — export a lesson's Pimsleur item bank into the real Anki collection (Basic notes, baked Italian audio reused).

    pimsleur_to_anki.py <lesson-dir> [<lesson-dir> ...] [--deck "Chiron::Pimsleur::<album>"] [--dry-run]

Per phrase|question item: Front = English cue, Back = Italian + [sound:...]. The audio is the already-baked levelled
clip <lesson>/audio/pimsleur-cache/<key>.lev-20.wav (key as pimsleur_drill.Baker.key), converted to mono ~64k MP3.
A missing clip means no sound (reported); nothing is synthesized. Notes carry the stable tag
chiron_item::<lesson-dir-name>::<item id>, so a re-run updates instead of duplicating. Review items are exported only
when no note for that item id exists yet. Every write is READ BACK (findNotes + notesInfo + retrieveMediaFile);
AnkiConnect can report success without doing the thing (see anki.py). Exit 1 on any mismatch, 2 if Anki is unreachable.
AnkiConnect URL/key come from ~/.chiron/anki.env (CHIRON_ANKI_URL / CHIRON_ANKI_KEY); the key is never printed.
"""
from __future__ import annotations

import argparse, base64, hashlib, importlib.util, json, os, subprocess, sys, tempfile

DEFAULT_VOICES = {"cue": "pauls_tutor", "target": "lucrezia_italian"}
TARGET_LUFS = "-20"
ENV_FILE = os.path.expanduser("~/.chiron/anki.env")
ANKI_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server", "anki.py")


# ---------------------------------------------------------------- pure logic (unit-tested)

def clip_key(voice: str, text: str) -> str:
    """Same as pimsleur_drill.Baker.key."""
    return hashlib.sha256(f"{voice}|{text}".encode()).hexdigest()[:16]


def item_tag(lesson_name: str, item_id: str) -> str:
    return f"chiron_item::{lesson_name}::{item_id}"


def media_name(key: str) -> str:
    return f"chiron_pimsleur_{key}.mp3"


def build_notes(bank: dict, lesson_dir: str, deck: str | None = None) -> list[dict]:
    """One plan entry per exportable item (phrase|question; talk skipped)."""
    lesson = os.path.basename(os.path.normpath(lesson_dir))
    voice = {**DEFAULT_VOICES, **(bank.get("voices") or {})}["target"]
    deck = deck or f"Chiron::Pimsleur::{bank.get('album') or lesson}"
    out = []
    for where in ("items", "review"):
        for it in bank.get(where) or []:
            if it.get("kind", "phrase") not in ("phrase", "question"):
                continue
            key = clip_key(voice, it["it"])
            wav = os.path.join(lesson_dir, "audio", "pimsleur-cache", f"{key}.lev{TARGET_LUFS}.wav")
            out.append({"id": it["id"], "review": where == "review", "deck": deck, "front": it["en"],
                        "it": it["it"], "wav": wav, "has_clip": os.path.exists(wav), "media": media_name(key),
                        "tag": item_tag(lesson, it["id"]), "tags": ["chiron", "pimsleur", item_tag(lesson, it["id"])]})
    return out


def back_field(plan: dict) -> str:
    return plan["it"] + (f" [sound:{plan['media']}]" if plan["has_clip"] else "")


def review_already_exported(item_id: str, existing_tags: list[str]) -> bool:
    """A review item is skipped if any lesson already tagged this item id."""
    return any(t.startswith("chiron_item::") and t.endswith(f"::{item_id}") for t in existing_tags)


def verify_note(plan: dict, info: dict) -> list[str]:
    """Problems between the plan and what notesInfo returned (empty = ok)."""
    f = info.get("fields") or {}
    errs = []
    if f.get("Front", {}).get("value") != plan["front"]:
        errs.append(f"Front {f.get('Front', {}).get('value')!r} != {plan['front']!r}")
    if f.get("Back", {}).get("value") != back_field(plan):
        errs.append(f"Back {f.get('Back', {}).get('value')!r} != {back_field(plan)!r}")
    if plan["tag"] not in (info.get("tags") or []):
        errs.append("stable tag missing")
    return errs


# ---------------------------------------------------------------- anki I/O

def load_anki():
    if os.path.exists(ENV_FILE):
        for line in open(ENV_FILE):
            line = line.strip().removeprefix("export ")
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))
    spec = importlib.util.spec_from_file_location("chiron_anki", ANKI_PY)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def to_mp3(wav: str) -> bytes:
    with tempfile.TemporaryDirectory() as td:
        mp3 = os.path.join(td, "o.mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-b:a", "64k", mp3], check=True)
        return open(mp3, "rb").read()


def export_lesson(anki, lesson_dir: str, deck_arg: str | None) -> dict:
    bank = json.load(open(os.path.join(lesson_dir, "pimsleur.json")))
    plans = build_notes(bank, lesson_dir, deck_arg)
    s = {"lesson": os.path.basename(os.path.normpath(lesson_dir)), "added": 0, "updated": 0, "skipped": 0,
         "verified": 0, "missing_clips": [], "problems": []}
    if not plans:
        return s
    anki.invoke("createDeck", deck=plans[0]["deck"])
    done = []
    for p in plans:
        if p["review"]:
            ids = anki.invoke("findNotes", query=f"tag:chiron_item::*::{p['id']}")
            if ids:
                tags = [t for n in anki.invoke("notesInfo", notes=ids) for t in n["tags"]]
                if review_already_exported(p["id"], tags):
                    s["skipped"] += 1
                    continue
        if not p["has_clip"]:
            s["missing_clips"].append(p["id"])
        else:
            anki.invoke("storeMediaFile", filename=p["media"], data=base64.b64encode(to_mp3(p["wav"])).decode())
        ids = anki.invoke("findNotes", query=f'"tag:{p["tag"]}"')
        fields = {"Front": p["front"], "Back": back_field(p)}
        if ids:
            anki.invoke("updateNoteFields", note={"id": ids[0], "fields": fields})
            anki.invoke("addTags", notes=ids[:1], tags=" ".join(p["tags"]))
            s["updated"] += 1
        else:
            anki.invoke("addNote", note={"deckName": p["deck"], "modelName": "Basic", "fields": fields,
                                         "tags": p["tags"], "options": {"allowDuplicate": True}})
            s["added"] += 1
        done.append(p)
    for p in done:  # read back everything, independent of the write results
        ids = anki.invoke("findNotes", query=f'"tag:{p["tag"]}"')
        if len(ids) != 1:
            s["problems"].append(f"{p['id']}: expected 1 note, found {len(ids)}")
            continue
        errs = verify_note(p, anki.invoke("notesInfo", notes=ids)[0])
        if p["has_clip"] and not anki.invoke("retrieveMediaFile", filename=p["media"]):
            errs.append(f"media {p['media']} not in collection")
        if errs:
            s["problems"].append(f"{p['id']}: " + "; ".join(errs))
        else:
            s["verified"] += 1
    return s


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("lessons", nargs="+")
    ap.add_argument("--deck")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if a.dry_run:
        for d in a.lessons:
            bank = json.load(open(os.path.join(d, "pimsleur.json")))
            plans = build_notes(bank, d, a.deck)
            print(f"{os.path.basename(os.path.normpath(d))}: deck {plans[0]['deck'] if plans else '-'}, {len(plans)} notes")
            for p in plans:
                print(f"  {'R' if p['review'] else ' '} {p['id']:24} {p['front'][:40]!r} -> {p['it'][:40]!r} "
                      f"{'clip ok' if p['has_clip'] else 'NO CLIP'}")
        return 0
    anki = load_anki()
    try:
        anki.invoke("version")
    except anki.AnkiUnavailable as e:
        print(f"Anki unreachable: {e}", file=sys.stderr)
        return 2
    bad = 0
    for d in a.lessons:
        s = export_lesson(anki, d, a.deck)
        print(f"{s['lesson']}: added {s['added']} updated {s['updated']} skipped {s['skipped']} verified {s['verified']}"
              + (f" missing_clips {s['missing_clips']}" if s["missing_clips"] else ""))
        for pr in s["problems"]:
            print("  MISMATCH", pr)
        bad += len(s["problems"])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
