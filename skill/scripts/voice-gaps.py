#!/usr/bin/env python3
"""voice-gaps — give audio to Italian Anki notes that have none, rotating across the Italian voice pool.

Reads the priority list written by `tag-italian-audio.py --report`
(~/Documents/generated/ordine-audio-gaps.json, key `top150` or `all`), voices each note's Italian
with voice.say() (OmniVoice on the Mac -> tts-normalize -16 LUFS -> mp3 -> Anki media), appends
`[sound:...]` to the field that holds the Italian, and retags the note:
audio::manca -> audio::it + audio::fronte|retro + voce::<id>.

Idempotent: a note whose Italian field already has [sound:] is skipped, and a note whose field no
longer matches the report's text is skipped (it was edited since the report).

    voice-gaps.py --dry-run            show what would change
    voice-gaps.py                      voice the top 150
    voice-gaps.py --set all --limit 300
"""
import argparse, json, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import anki   # noqa: E402
import voice  # noqa: E402

REPORT = Path.home() / "Documents/generated/ordine-audio-gaps.json"
TAG = re.compile(r"<[^>]+>")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def plain(html: str) -> str:
    return re.sub(r"\s+", " ", TAG.sub(" ", html or "").replace("&nbsp;", " ")).strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--set", default="top150", choices=["top150", "all"])
    ap.add_argument("--limit", type=int, default=150)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    items = json.load(open(REPORT))[a.set][: a.limit]
    log(f"{len(items)} notes from {REPORT.name} [{a.set}]  voices={voice.pool()}")
    if not anki.reachable():
        log("Anki unreachable — open Anki on the MacBook")
        return 2
    infos = {n["noteId"]: n for n in anki.invoke("notesInfo", notes=[i["noteId"] for i in items]) if n}
    done = skipped = failed = 0
    t0 = time.time()
    for i, it in enumerate(items):
        n = infos.get(it["noteId"])
        if not n:
            log(f"skip {it['noteId']}: note no longer exists"); skipped += 1; continue
        field = next((k for k, v in n["fields"].items() if plain(v["value"]) == it["italian"]), None)
        if not field:
            log(f"skip {it['noteId']}: no field still equals {it['italian']!r}"); skipped += 1; continue
        if "[sound:" in n["fields"][field]["value"]:
            log(f"skip {it['noteId']}: already has audio"); skipped += 1; continue
        vid, speed = voice.pick(i, "voice-gaps")
        side = "fronte" if field == next(iter(n["fields"])) else "retro"
        if a.dry_run:
            log(f"would voice {it['noteId']} {field} [{vid} {speed}x] {it['italian']!r}"); continue
        try:
            fn = voice.say(it["italian"], vid, speed)
            anki.invoke("updateNoteFields", note={"id": it["noteId"],
                        "fields": {field: n["fields"][field]["value"] + f" [sound:{fn}]"}})
            anki.invoke("removeTags", notes=[it["noteId"]], tags="audio::manca")
            anki.invoke("addTags", notes=[it["noteId"]], tags=f"audio::it audio::{side} voce::{vid}")
            done += 1
            if done % 10 == 0 or done == 1:
                rate = (time.time() - t0) / done
                log(f"{done}/{len(items)} voiced ({rate:.1f}s each, ~{rate * (len(items) - i - 1) / 60:.0f} min left)"
                    f"  last: [{vid}] {it['italian']!r}")
        except Exception as e:
            failed += 1
            log(f"FAIL {it['noteId']} {it['italian']!r}: {type(e).__name__}: {e}")
            if failed >= 5 and done == 0:
                log("5 failures before any success — stopping"); break
    log(f"done: voiced={done} skipped={skipped} failed={failed} in {(time.time() - t0) / 60:.1f} min")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
