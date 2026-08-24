#!/usr/bin/env python3
"""il centro — ingest a recorded lesson: diarize → per-turn ASR → review payload.

    ~/Documents/code/VoxStruct/.venv/bin/python ingest_recording.py REC.m4a \
        --out ~/.chiron/il-centro/day-3 [--num-speakers 2] [--series il-centro]

WHY THIS FILE EXISTS (and why it is not an edit to episode_ingest.py):
`chiron/skill/scripts/episode_ingest.py` already solves cast separation for `video-it`, and it
solves it GENERALLY — an episode has an unknown cast, so it deliberately leaves the speaker count
to the clusterer. Narrowing that to fit this series would damage a working shared tool. So this
IMPORTS its proven parts and leaves the file byte-identical:

    diarize · assign_speaker (max-overlap merge) · slice_wav · _cos
    VoiceRegistry · load_series_registry · save_series_registry

What differs here, and only here:
  · num_speakers defaults to 2 — for il centro it is always Gyasi + Barbara.
  · ASR runs PER DIARIZED TURN, not per file. Whisper detects language once per request from the
    first ~30s; on a 45-minute Italian/English lesson that means one language wins and the other
    is mangled. Short turns are near-single-language, so each line gets its own detection.
  · model=large (whisper-large-v3), not the sidecar's turbo default — turbo is distilled and is
    weaker exactly where this material lives: code-switching and accented speech.
  · Emits day<N>_ingest.json for the review form: speaker snippets, registry match + confidence,
    language split. Nothing downstream runs until a human confirms who is who — an inverted map
    would teach the learner's own mistakes back to him as correct Italian.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SHARED = Path.home() / "Documents/code/chiron/skill/scripts"
sys.path.insert(0, str(SHARED))
try:
    from episode_ingest import (              # noqa: E402  — reused, never modified
        diarize, assign_speaker, slice_wav, _cos,
        VoiceRegistry, load_series_registry, save_series_registry, series_registry_path,
    )
except Exception as e:                        # pragma: no cover
    sys.exit(f"cannot import the shared pipeline at {SHARED}: {e}")

WHISPER = os.getenv("CHIRON_WHISPER_URL", "http://localhost:8766")
# Her recurring vocabulary — biases the decoder so proper nouns survive.
PROMPT = ("Barbara, Cilento, Ferragosto, Okinawa, la dieta mediterranea, riflessivo, "
          "ci vuole tempo, la gente, riunioni di lavoro, il regista.")


def ffmpeg_wav(src: Path, dst: Path) -> None:
    """16k mono wav — what both sidecars want. Bare audio in, no stream selection needed."""
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src),
                    "-vn", "-ac", "1", "-ar", "16000", str(dst)], check=True)


def transcribe_turn(wav: Path, model: str = "large") -> tuple[str, str]:
    """One diarized turn → (text, detected_language). Per-turn is the whole point: a single
    whole-file request would pin ONE language onto a bilingual lesson."""
    import requests
    with open(wav, "rb") as fh:
        r = requests.post(f"{WHISPER}/transcribe",
                          files={"file": (wav.name, fh, "audio/wav")},
                          data={"model": model, "word_timestamps": "false",
                                "response_format": "verbose_json",
                                "normalize": "speech", "initial_prompt": PROMPT},
                          timeout=900)
    r.raise_for_status()
    d = r.json()
    txt = (d.get("text") or "").strip()
    lang = (d.get("language") or "").lower()[:2] or "??"
    return txt, lang


def pick_snippets(turns: list[dict], speaker: str, n: int = 3) -> list[dict]:
    """Clean exemplars for the review form: 3–6s, and NOT overlapping the other speaker —
    crosstalk makes a snippet useless for deciding who someone is."""
    others = [t for t in turns if t["speaker"] != speaker]

    def clean(t):
        return not any(o["start"] < t["end"] and t["start"] < o["end"] for o in others)

    cands = [t for t in turns if t["speaker"] == speaker and 3.0 <= (t["end"] - t["start"]) <= 6.0
             and clean(t)]
    cands.sort(key=lambda t: t["end"] - t["start"], reverse=True)
    if len(cands) < n:                       # relax the window rather than return nothing
        extra = [t for t in turns if t["speaker"] == speaker and (t["end"] - t["start"]) >= 2.0
                 and t not in cands]
        extra.sort(key=lambda t: t["end"] - t["start"], reverse=True)
        cands += extra
    return cands[:n]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("recording")
    ap.add_argument("--out", required=True)
    ap.add_argument("--num-speakers", type=int, default=2,
                    help="il centro is always 2 (Gyasi + Barbara); override if a guest appears")
    ap.add_argument("--series", default="il-centro")
    ap.add_argument("--model", default="large")
    ap.add_argument("--voice-thresh", type=float, default=0.5)
    a = ap.parse_args()

    src = Path(a.recording).expanduser().resolve()
    if not src.is_file():
        sys.exit(f"no such recording: {src}")
    out = Path(a.out).expanduser().resolve()
    (out / "snippets").mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        wav = td / "full.wav"
        print("1/4  extracting 16k mono wav…")
        ffmpeg_wav(src, wav)

        print(f"2/4  diarizing (num_speakers={a.num_speakers})…")
        dia = diarize(wav, num_speakers=a.num_speakers)
        turns = dia.get("segments", []) if isinstance(dia, dict) else (dia or [])
        embs = dia.get("embeddings", {}) if isinstance(dia, dict) else {}
        if not turns:
            sys.exit("diarization returned nothing — is :8767 up?")
        speakers = sorted({t["speaker"] for t in turns})
        print(f"     {len(turns)} turns · {len(speakers)} speakers: {', '.join(speakers)}")

        print(f"3/4  transcribing PER TURN with model={a.model} …")
        lines = []
        for i, t in enumerate(turns, 1):
            if t["end"] - t["start"] < 0.6:            # too short to carry a word
                continue
            clip = td / f"t{i:05d}.wav"
            slice_wav(wav, t["start"], t["end"], clip)
            try:
                txt, lang = transcribe_turn(clip, a.model)
            except Exception as e:
                print(f"     turn {i}: ASR failed ({e})"); continue
            if not txt:
                continue
            lines.append({"start": round(t["start"], 2), "end": round(t["end"], 2),
                          "speaker": t["speaker"], "lang": lang, "text": txt})
            if i % 25 == 0:
                print(f"     {i}/{len(turns)} turns…")

        print("4/4  building the review payload…")
        seed, existing = load_series_registry(series_registry_path(a.series))
        clusters = []
        for sp in speakers:
            mine = [l for l in lines if l["speaker"] == sp]
            talk = sum(l["end"] - l["start"] for l in mine)
            it_n = sum(1 for l in mine if l["lang"] == "it")
            emb = embs.get(sp)
            best, score = None, 0.0
            for e, name in seed:                       # registry match → proposed name
                if emb:
                    c = _cos(emb, e)
                    if c > score:
                        best, score = name, c
            snips = []
            for k, t in enumerate(pick_snippets(turns, sp), 1):
                dst = out / "snippets" / f"{sp}-{k}.mp3"
                clip = td / f"snip{sp}{k}.wav"
                slice_wav(wav, t["start"], t["end"], clip)
                subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(clip),
                                "-c:a", "libmp3lame", "-b:a", "64k", str(dst)], check=True)
                snips.append({"file": f"snippets/{dst.name}",
                              "start": round(t["start"], 1), "dur": round(t["end"] - t["start"], 1)})
            clusters.append({
                "speaker": sp, "turns": len(mine), "talk_s": round(talk, 1),
                "italian_pct": round(100 * it_n / max(1, len(mine))),
                "proposed": best if score >= a.voice_thresh else None,
                "confidence": round(score, 3),
                "snippets": snips,
                "embedding": emb,
            })

        total = sum(l["end"] - l["start"] for l in lines)
        payload = {
            "recording": str(src), "series": a.series,
            "expected_speakers": a.num_speakers, "found_speakers": len(speakers),
            "model": a.model, "turns": len(lines), "speech_s": round(total, 1),
            "lang_split": {k: round(100 * sum(1 for l in lines if l["lang"] == k) / max(1, len(lines)))
                           for k in sorted({l["lang"] for l in lines})},
            "clusters": clusters, "confirmed": False,
        }
        (out / "ingest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), "utf-8")
        (out / "transcript.json").write_text(json.dumps(lines, ensure_ascii=False, indent=1), "utf-8")

    print(f"\n  → {out}/ingest.json      ({len(speakers)} clusters, snippets cut)")
    print(f"  → {out}/transcript.json  ({len(lines)} lines)")
    print(f"  language split: {payload['lang_split']}")
    if len(set(payload["lang_split"]) ) == 1:
        print("  !! only ONE language detected across the whole lesson — check 3b in the plan")
    print("\n  NOT confirmed yet — open the review form and name the speakers before authoring.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
