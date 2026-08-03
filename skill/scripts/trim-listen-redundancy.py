#!/usr/bin/env python3
"""Trim redundant 'listen-with-Lucrezia' narration WITHOUT re-baking — drop whole tts segments by ROLE
and reuse every remaining baked mp3. Default: drop `intro` (the pre-clip preview that voices the Italian
the ACTOR is about to say + Lucrezia then repeats in `explain`). Reusable for any episode/lesson.

Usage: trim-listen-redundancy.py <transcript.json> [--roles intro,debrief] [--dry]
"""
import sys, json, argparse
from pathlib import Path

def trim_timeline(tl, cut):
    out = [s for s in tl if not (s.get("type") == "tts" and s.get("role") in cut)]
    # collapse pauses orphaned by the removals + strip leading/trailing pauses
    collapsed = []
    for s in out:
        if s.get("type") == "pause" and collapsed and collapsed[-1].get("type") == "pause":
            continue
        collapsed.append(s)
    while collapsed and collapsed[0].get("type") == "pause":
        collapsed.pop(0)
    while collapsed and collapsed[-1].get("type") == "pause":
        collapsed.pop()
    return collapsed

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript")
    ap.add_argument("--roles", default="intro", help="comma-list of tts roles to drop")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    cut = {r.strip() for r in a.roles.split(",") if r.strip()}
    p = Path(a.transcript)
    d = json.loads(p.read_text())
    scenes = d if isinstance(d, list) else d.get("scenes", d)
    removed = kept = 0
    for s in scenes:
        tl = s.get("audio_timeline") or []
        before = sum(1 for x in tl if x.get("type") == "tts")
        s["audio_timeline"] = trim_timeline(tl, cut)
        after = sum(1 for x in tl if x.get("type") == "tts" and x.get("role") in cut)
        removed += after
        kept += before - after
    print(f"{p.parent.name}: dropped {removed} tts segments ({', '.join(sorted(cut))}), kept {kept}")
    if not a.dry:
        p.write_text(json.dumps(d, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
