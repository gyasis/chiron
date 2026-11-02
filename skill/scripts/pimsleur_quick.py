#!/usr/bin/env python3
"""pimsleur_quick — a fast Pimsleur-style drill for one sentence from ONE synthesized take.

Rule: the sentence is synthesized once. Pieces are only ever cut out of that take, and only where the audio is
truly silent between two word groups; when there is no such place the whole phrase is repeated instead.

    take -> word times (whisper) -> clean breaks between chunks (>= MIN_QUIET_S below CLEAN_DB)
      break found : whole 100%, end part 50% then 100%, whole 75% then 100%
      no break    : whole 100% (listen), then repeats at 50%, 75%, 100%

Repeats ramp up in speed (speeds_for): two repeats play at 50% and 100%, three at 50%, 75% and 100%. Slow copies
are time-stretched locally (ffmpeg rubberband, pitch kept), so they cost no extra synthesis.

A break is only considered between chunks (pimsleur_deconstruct.chunk_words, words_only), so a small word
(gli, le, a, è...) never ends up alone. The narrator only speaks fixed lines, which are synthesized once and
cached, so a new sentence costs one synthesis plus one transcription.

CLI:  pimsleur_quick.py "Mi dica dove le fa male" [--out DIR]   (needs the Mac OmniVoice + whisper sidecars)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import unicodedata

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pimsleur_deconstruct import chunk_words, pause_after  # noqa: E402

CLEAN_DB = -40.0          # below the take's loudest 10 ms: treated as silence
MIN_QUIET_S = 0.03        # silence must last this long to cut inside it
LEVEL = 3

CUES = {
    "listen": "Listen to this sentence.",
    "repeat": "Now repeat after her.",
    "end": "Now just the end of the sentence.",
    "whole": "Now the whole sentence again.",
    "again": "Say it once more.",
    "full": "Now at full speed.",
}


def speeds_for(n: int) -> list[float]:
    """Speeds for n repeats, slowest first and ending at normal speed."""
    if n <= 1:
        return [1.0]
    if n == 2:
        return [0.5, 1.0]
    return [round(0.5 + 0.5 * i / (n - 1), 2) for i in range(n)]


def stretched(path: str, speed: float) -> str:
    """A pitch-preserving slowed copy of a clip (cached next to it)."""
    if speed == 1.0:
        return path
    out = path.replace(".wav", f".x{int(speed * 100)}.wav")
    if not os.path.exists(out):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-af",
                        f"rubberband=tempo={speed}:pitchq=quality:transients=smooth", out], check=True)
    return out


def _fold(w: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", w.lower()) if unicodedata.category(c) != "Mn").strip(".,!?'\"")


def frame_db(path: str, hop: float = 0.005, win: float = 0.01) -> tuple[np.ndarray, float]:
    """Per-frame loudness in dB below the loudest frame, and the hop in seconds."""
    x, sr = sf.read(path)
    if x.ndim > 1:
        x = x.mean(axis=1)
    w, h = int(win * sr), int(hop * sr)
    n = max(1, (len(x) - w) // h + 1)
    rms = np.array([np.sqrt((x[i * h:i * h + w] ** 2).mean()) for i in range(n)])
    peak = rms.max() or 1e-9
    return 20 * np.log10(np.maximum(rms, 1e-9) / peak), hop


def clean_breaks(path: str, words: list[dict], text: str) -> list[dict]:
    """Chunk boundaries of `text` that fall in true silence in the take. Each: {after_word, t, quiet_s, min_db}."""
    toks = text.split()
    if [_fold(w["w"]) for w in words] != [_fold(t) for t in toks]:
        return []                                       # timings do not match the text: do not cut blind
    db, hop = frame_db(path)
    out, k = [], 0
    for chunk in chunk_words(text, words_only=True)[:-1]:
        k += len(chunk.split())
        a, b = words[k - 1]["e"] - 0.04, words[k]["s"] + 0.04
        seg = db[int(max(0, a) / hop):int(b / hop) + 1]
        quiet = seg < CLEAN_DB
        best = run = 0
        best_end = 0
        for i, q in enumerate(quiet):
            run = run + 1 if q else 0
            if run > best:
                best, best_end = run, i
        if best * hop >= MIN_QUIET_S:
            mid = a + (best_end - best / 2) * hop
            out.append({"after_word": k, "t": round(mid, 3), "quiet_s": round(best * hop, 3),
                        "min_db": round(float(seg.min()), 1)})
    return out


def plan(text: str, breaks: list[dict]) -> list[dict]:
    """Steps for one sentence. A break near the middle splits it; otherwise the whole phrase repeats."""
    toks = text.split()
    if breaks:
        mid = len(toks) / 2
        br = min(breaks, key=lambda b: abs(b["after_word"] - mid))
        end_text = " ".join(toks[br["after_word"]:])
        e1, e2 = speeds_for(2)
        return [{"cue": "listen"}, {"say": "whole", "speed": 1.0}, {"cue": "end"},
                {"say": "end", "text": end_text, "from": br["t"], "speed": e1},
                {"say": "end", "text": end_text, "from": br["t"], "speed": e2}, {"cue": "whole"},
                {"say": "whole", "speed": 0.75}, {"say": "whole", "speed": 1.0}]
    r = speeds_for(3)
    return [{"cue": "listen"}, {"say": "whole", "speed": 1.0}, {"cue": "repeat"}, {"say": "whole", "speed": r[0]},
            {"cue": "again"}, {"say": "whole", "speed": r[1]}, {"cue": "full"}, {"say": "whole", "speed": r[2]}]


def transcribe_words(asr_url: str, path: str) -> list[dict]:
    out = subprocess.run(["curl", "-s", "-m", "120", f"{asr_url}/transcribe", "-F", f"file=@{path}", "-F", "model=large",
                          "-F", "language=it", "-F", "response_format=verbose_json", "-F", "word_timestamps=true"],
                         capture_output=True, text=True).stdout
    try:
        segs = json.loads(out)["segments"]
    except (ValueError, KeyError) as e:
        raise RuntimeError(f"whisper at {asr_url} gave no usable reply: {out[:120]!r}") from e
    return [{"w": w["word"].strip(), "s": w["start"], "e": w["end"]} for s in segs for w in s.get("words", [])]


def build(text: str, out_dir: str, baker=None) -> dict:
    """Synthesize once, find breaks, render the drill. Returns the plan with timings (seconds per stage)."""
    import pimsleur_drill as D
    b = baker or D.Baker(os.path.join(out_dir, "cache"), {})
    os.makedirs(out_dir, exist_ok=True)
    text = " ".join(text.split())
    times = {}
    t0 = time.time()
    cached = os.path.exists(b.raw("target", text))
    take = b.clip("target", text)
    times["synth"] = round(time.time() - t0, 2)
    t1 = time.time()
    words = transcribe_words(D.ASR_URL, take)
    times["whisper"] = round(time.time() - t1, 2)
    t2 = time.time()
    breaks = clean_breaks(take, words, text)
    steps = plan(text, breaks)
    times["analyse"] = round(time.time() - t2, 2)
    clips = {"whole": take}
    for s in steps:
        if s.get("say") == "end":
            p = os.path.join(out_dir, f"end_{abs(hash(text)) % 10**8}.wav")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", take, "-ss", f"{s['from']:.3f}", "-af",
                            "afade=t=in:d=0.015", p], check=True)
            clips["end"] = p
    times["total"] = round(time.time() - t0, 2)
    return {"text": text, "cached_take": cached, "words": words, "breaks": breaks, "steps": steps,
            "clips": clips, "times": times}


def render(drills: list[dict], out_mp3: str, baker) -> list[dict]:
    """Concatenate the steps of one or more drills into an MP3; returns the timeline."""
    import pimsleur_drill as D
    parts, tl, t = [], [], 0.0
    for n, d in enumerate(drills, 1):
        for s in d["steps"]:
            if "cue" in s:
                c = baker.clip("cue", CUES[s["cue"]])
                tl.append({"t": round(t, 2), "kind": "cue", "text": CUES[s["cue"]], "line": n})
                parts += [c, baker.silence(0.9)]
                t += D._dur(c) + 0.9
                continue
            clip = stretched(d["clips"][s["say"]], s.get("speed", 1.0))
            dur = D._dur(clip)
            pz = pause_after(dur, LEVEL)
            tl.append({"t": round(t, 2), "kind": s["say"], "text": s.get("text", d["text"]), "line": n,
                       "dur": round(dur, 2), "speed": s.get("speed", 1.0)})
            parts += [clip, baker.silence(pz)]
            t += dur + pz
    lst = out_mp3 + ".txt"
    open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-ar", str(D.RATE),
                    "-ac", "1", "-b:a", "128k", out_mp3], check=True)
    os.remove(lst)
    return tl


def main(argv: list[str] | None = None) -> int:
    import pimsleur_drill as D
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("sentences", nargs="+")
    ap.add_argument("--out", default=os.path.expanduser("~/Documents/generated/pimsleur-quick"))
    a = ap.parse_args(argv)
    b = D.Baker(os.path.join(a.out, "cache"), {})
    drills = []
    for s in a.sentences:
        d = build(s, a.out, b)
        drills.append(d)
        how = f"split after word {d['breaks'][0]['after_word']}" if d["breaks"] else "no clean break: repeat whole"
        print(f"{d['times']}  {how}  | {s}", flush=True)
    tl = render(drills, os.path.join(a.out, "drill.mp3"), b)
    json.dump({"drills": [{k: v for k, v in d.items() if k != "clips"} for d in drills], "timeline": tl},
              open(os.path.join(a.out, "drill.json"), "w"), ensure_ascii=False, indent=1)
    print(f"done: {a.out}/drill.mp3 ({D._dur(os.path.join(a.out, 'drill.mp3')):.0f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
