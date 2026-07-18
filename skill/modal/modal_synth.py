#!/usr/bin/env python3
"""Bridge between the Node bake orchestrator and the deployed chiron-bake Modal lane.

Given ONE lesson's segments (already extracted by audio-bake, so identity is exact), call the Modal
`bake_lesson` function (length-bucketed CUDA synth) and write the raw per-segment WAVs into a prefetch
dir as <prefetch>/<section_id>/<i>.wav. audio-bake.ts (engine=modal) then COPIES these in place of
synthesizing — every other step (tts-normalize → manifest → tts-splice → mp3) is unchanged, so the
output is byte-identical to a Mac bake.

Usage:  modal_synth.py <job.json> <prefetch_dir>
  job.json = {"slug","num_step"?,"bucket"?,"refs":{lang:{wav,txt}},"sections":{sid:[{lang,text},…]}}
Prints one JSON line: {"slug","clips","synth_s","prefetch"} (or {"error"} + exit 1)."""
import base64
import json
import os
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"error": "usage: modal_synth.py <job.json> <prefetch_dir>"}))
        return 2
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    pref = sys.argv[2]
    try:
        import modal
        fn = modal.Function.from_name("chiron-bake", "bake_lesson")
        r = fn.remote(job)
    except Exception as e:                      # unreachable/unauthed → caller falls back to the Mac
        print(json.dumps({"error": f"{type(e).__name__}: {e}"[:200]}))
        return 1
    n = 0
    for sid, wavs in r.get("sections", {}).items():
        d = os.path.join(pref, sid)
        os.makedirs(d, exist_ok=True)
        for i, b64 in enumerate(wavs):
            if not b64:
                continue
            with open(os.path.join(d, f"{i}.wav"), "wb") as f:
                f.write(base64.b64decode(b64))
            n += 1
    print(json.dumps({"slug": r.get("slug"), "clips": n, "synth_s": r.get("synth_s"), "prefetch": pref}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
