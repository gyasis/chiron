#!/usr/bin/env python3
"""Repair language misdetection in a per-turn transcript.

    python3 repair_transcript.py REC.m4a transcript.json --out transcript.repaired.json

Per-turn ASR fixed the big failure (a whole-file detection pinning ONE language onto a bilingual
lesson) but introduced a smaller one: on SHORT turns whisper picks a neighbouring language and then
transcribes into that language's ORTHOGRAPHY. The text, not just the tag, comes out wrong —

    "Exato, sim."      should be  "Esatto, sì."
    "¿Por qué?"        should be  "Perché?"
    "Sí, sí, espérate" should be  "Sì, sì, aspetta"

and on near-silent fragments it hallucinates outright ("KORON!", "MS Cruiser", "mental mental…").

This lesson is only ever Italian or English, so: re-transcribe every non-it/en turn TWICE with the
language FORCED (it, then en) and keep whichever comes back more confident. Turns that are still
low-confidence AND very short are noise, not speech, and are dropped rather than left to pollute
the transcript.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

WHISPER = os.getenv("CHIRON_WHISPER_URL", "http://localhost:8766")
PROMPT_IT = ("Barbara, Cilento, Ferragosto, la dieta mediterranea, riflessivo, ci vuole tempo, "
             "la gente, esatto, sì, perché, aspetta, allora, quindi.")
PROMPT_EN = "Right, exactly, yeah, okay, so, because, I think, let me."
NOISE_MAX_S = 1.6          # below this, a low-confidence result is almost certainly not speech
LOGPROB_FLOOR = -1.0       # whisper convention: < -1.0 is unreliable


def slice_wav(src: Path, start: float, end: float, dst: Path) -> None:
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-ss", str(start),
                    "-t", str(max(0.2, end - start)), "-i", str(src),
                    "-ac", "1", "-ar", "16000", str(dst)], check=True)


def asr(wav: Path, lang: str) -> tuple[str, float]:
    """→ (text, mean avg_logprob). Forced language; no auto-detect."""
    import requests
    with open(wav, "rb") as fh:
        r = requests.post(f"{WHISPER}/transcribe",
                          files={"file": (wav.name, fh, "audio/wav")},
                          data={"model": "large", "language": lang,
                                "response_format": "verbose_json", "normalize": "speech",
                                "initial_prompt": PROMPT_IT if lang == "it" else PROMPT_EN},
                          timeout=600)
    r.raise_for_status()
    d = r.json()
    segs = d.get("segments") or []
    lps = [s.get("avg_logprob") for s in segs if isinstance(s.get("avg_logprob"), (int, float))]
    return (d.get("text") or "").strip(), (sum(lps) / len(lps) if lps else -99.0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("recording")
    ap.add_argument("transcript")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    lines = json.loads(Path(a.transcript).read_text(encoding="utf-8"))
    odd = [l for l in lines if l["lang"] not in ("it", "en")]
    print(f"{len(lines)} lines · {len(odd)} to repair")

    fixed = repaired = dropped = 0
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        full = td / "full.wav"
        print("extracting reference wav…")
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(a.recording),
                        "-vn", "-ac", "1", "-ar", "16000", str(full)], check=True)

        for i, l in enumerate(odd, 1):
            clip = td / "c.wav"
            slice_wav(full, l["start"], l["end"], clip)
            try:
                t_it, p_it = asr(clip, "it")
                t_en, p_en = asr(clip, "en")
            except Exception as e:
                print(f"  [{i}] ASR failed: {e}"); continue
            best_lang, best_txt, best_p = ("it", t_it, p_it) if p_it >= p_en else ("en", t_en, p_en)
            dur = l["end"] - l["start"]

            if not best_txt or (best_p < LOGPROB_FLOOR and dur <= NOISE_MAX_S):
                l["_drop"] = True; dropped += 1
            else:
                if best_txt != l["text"]:
                    repaired += 1
                l["text"], l["lang"], l["logprob"] = best_txt, best_lang, round(best_p, 3)
                fixed += 1
            if i % 25 == 0:
                print(f"  {i}/{len(odd)}…")

    out = [l for l in lines if not l.get("_drop")]
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter
    c = Counter(l["lang"] for l in out)
    print(f"\nrepaired {repaired} · relabelled {fixed} · dropped as noise {dropped}")
    print(f"{len(out)} lines remain · languages: {dict(c.most_common())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
