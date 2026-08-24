#!/usr/bin/env python3
"""Finish a day that was built without audio.

    python3 bake_day.py 6

Day 6 was authored while whisper/pyannote/omnivoice/Modal were all unreachable, so the page,
the cards and the narration all exist but nothing has been spoken. This runs the rest of the
pipeline against `day<N>_data.py` + `audio_scripts_day<N>.py`, then fills in what is already
on disk — no re-authoring, no page edits.

  1  preflight    — refuse to start unless the sidecars actually answer
  2  bake         — phrases · EN glosses · narration            (Modal, on razer)
  3  post         — tts-normalize -16 → tts-splice → mp3        (R-IC7, never ffmpeg loudnorm)
  4  podcast      — one continuous track for screen-off listening
  5  wire         — copy clips in, rewrite audio/manifest.json + .js
  6  Anki         — add [sound:] to the existing notes, drop the `audio-pending` tag

Everything is idempotent: re-running skips what is already done.
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SIDECARS = {"omnivoice": 8770, "whisper": 8766}
# Atelier sidecar host. Set CHIRON_ATELIER_HOST to the Mac Studio on your LAN.
ATELIER_HOST = os.getenv("CHIRON_ATELIER_HOST", "localhost")
ANKI = "http://127.0.0.1:8765"


def preflight(day: str) -> bool:
    """Are the clips already on disk, or can we still make them?

    The Studio is NOT a hard requirement. Two things changed the shape of this check:

      1. Steps 5-6 (wire the page, attach [sound:] in Anki) are entirely local. If
         `.audio-src/day-N` is already populated — by a Studio bake or by `modal_bake.py` —
         no sidecar is needed at all, and demanding one just blocks finishing work.
      2. `modal_bake.py` synthesizes on Modal's L4 via razer, using the same OmniVoice
         weights and the same Lucrezia refs. The Studio is one lane, not the only lane.

    So: clips present -> proceed. Clips absent -> report which lane is actually available
    rather than a flat "DOWN", because those two cases need different next commands.
    """
    if os.path.isdir(f"{HERE}/.audio-src/day-{day}"):
        print("  clips already on disk — no synth needed")
        return True

    razer_up = False
    try:
        subprocess.run(["ssh", "-o", "ConnectTimeout=8", "razer", "true"], check=True,
                       capture_output=True, timeout=15)
        razer_up = True
        print("  razer            up")
    except Exception:
        print("  razer            unreachable")

    studio = True
    for name, port in SIDECARS.items():
        try:
            urllib.request.urlopen(f"http://{ATELIER_HOST}:{port}/readyz", timeout=6)
            print(f"  {name:10} :{port}  up")
        except Exception:
            print(f"  {name:10} :{port}  unreachable")
            studio = False

    if not studio and razer_up:
        print("  → Studio unreachable, but razer holds the Modal auth: the Modal lane is up")
    # razer alone is a complete lane (it drives Modal), so it is the only hard requirement.
    return razer_up


def anki(action, **params):
    req = urllib.request.Request(
        ANKI, data=json.dumps({"action": action, "version": 6, "params": params}).encode(),
        headers={"Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=60))
    if d.get("error"):
        raise RuntimeError(f"{action}: {d['error']}")
    return d["result"]


def attach_anki(day: str, audio_src: str) -> None:
    """Add [sound:] to notes that were created without it, and clear the pending tag."""
    q = f'deck:"il centro di italia::Day {day}" tag:audio-pending'
    notes = anki("findNotes", query=q)
    if not notes:
        print("  no audio-pending notes"); return
    cards = {c["it"]: c["clip"] for c in
             json.load(open(f"{HERE}/il-centro-day-{day}/cards.json", encoding="utf-8"))}
    done = 0
    for n in anki("notesInfo", notes=notes):
        front = n["fields"]["Front"]["value"].split(" [sound:")[0]
        clip = cards.get(front)
        src = f"{audio_src}/{clip}.mp3" if clip else None
        if not src or not os.path.exists(src):
            continue
        fn = f"icdi-d{day}-{clip}.mp3"
        anki("storeMediaFile", filename=fn,
             data=base64.b64encode(open(src, "rb").read()).decode())
        anki("updateNoteFields",
             note={"id": n["noteId"], "fields": {"Front": f"{front} [sound:{fn}]"}})
        anki("removeTags", notes=[n["noteId"]], tags="audio-pending")
        done += 1
    print(f"  attached audio to {done}/{len(notes)} notes")


def main() -> int:
    day = sys.argv[1] if len(sys.argv) > 1 else "6"
    print(f"il centro — finishing Day {day}\n\n1/6 preflight")
    if not preflight(day):
        print("\n  No synth lane available and no clips on disk — nothing to do yet.")
        print("  The page and cards already work; re-run when razer or the Studio is back.")
        return 1

    audio_src = f"{HERE}/.audio-src/day-{day}"
    if not os.path.isdir(audio_src):
        print("\n2/6 bake · 3/6 post · 4/6 podcast")
        print(f"  not yet run — {audio_src} is empty.")
        print(f"      python3 modal_bake.py {day}     # Modal L4 via razer, no Studio needed")
        return 1
    print("\n2/6 bake · 3/6 post · 4/6 podcast — already done, clips on disk")

    print("\n5/6 wire the clips into the page")
    out = f"{HERE}/il-centro-day-{day}"
    body = open(f"{out}/lesson.html", encoding="utf-8").read()
    anchors = re.findall(r'id="vocab-([a-z0-9-]+)"', body)
    clips = []
    for sub in ("lecture", "phrase", "drill"):
        os.makedirs(f"{out}/audio/{sub}", exist_ok=True)
    import shutil
    for art, f in (("podcast", "lecture/podcast.mp3"), ("summary", "lecture/summary.mp3"),
                   ("shortened", "lecture/shortened.mp3")):
        p = f"{audio_src}/{f}"
        if os.path.exists(p):
            shutil.copy(p, f"{out}/audio/{f}")
            clips.append({"artifact": art, "sectionId": "", "audioPath": f"audio/{f}",
                          "status": "done", "durationS": None})
    for sid in re.findall(r'<section id="(sec-[a-z-]+)"', body):
        p = f"{audio_src}/lecture/{sid}.mp3"
        if os.path.exists(p):
            shutil.copy(p, f"{out}/audio/lecture/{sid}.mp3")
            clips.append({"artifact": "section", "sectionId": sid,
                          "audioPath": f"audio/lecture/{sid}.mp3", "status": "done",
                          "durationS": None})
    for pid in anchors:
        pair, solo = f"{audio_src}/drill/drill-{pid}.mp3", f"{audio_src}/{pid}.mp3"
        src = pair if os.path.exists(pair) else solo
        if os.path.exists(src):
            shutil.copy(src, f"{out}/audio/phrase/{pid}.mp3")
            clips.append({"artifact": "phrase", "sectionId": f"vocab-{pid}",
                          "audioPath": f"audio/phrase/{pid}.mp3", "status": "done",
                          "durationS": None})
    man = {"clips": clips}
    json.dump(man, open(f"{out}/audio/manifest.json", "w"), ensure_ascii=False, indent=1)
    open(f"{out}/audio/manifest.js", "w", encoding="utf-8").write(
        "window.__chironAudioManifest = " + json.dumps(man, ensure_ascii=False) + ";\n")
    print(f"  {len(clips)} clips wired")

    print("\n6/6 Anki")
    attach_anki(day, audio_src)

    print("\n  then:  python3 add_index.py il-centro-day-%s && python3 make_portable.py "
          "il-centro-day-%s" % (day, day))
    return 0


if __name__ == "__main__":
    sys.exit(main())
