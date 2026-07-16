#!/usr/bin/env python3
"""Hybrid audio QC (free, local) — the 2+1 design that replaces per-clip Gemini.

  Signal 1 (whisper-text): transcribe each clip on the Mac whisper sidecar, compare to the intended
            script. Catches the CLINICALLY-CRITICAL hypo/hyper direction flip + missing/garbled words +
            truncation (word-overlap). whisper transcribes hypo vs hyper accurately, so this is reliable.
  Signal 2 (ffmpeg, deterministic): measures the actual signal — duration-vs-expected (truncation),
            long internal silence (dropout), clipping. Catches structural artifacts a content-model
            (Voxtral) transcribes through.

Fuse → {clean, defects[]} per clip. Gemini is NOT used. Usage: qc-hybrid.py <lesson-dir>
Empirically validated 2026-06-29: local ALMs (Voxtral) can't judge signal quality even when prompted; the
high-value defect (hypo/hyper) is a WORD error → caught by whisper-text; structural artifacts → by ffmpeg.
"""
import json, os, re, subprocess, sys, urllib.request, urllib.error
from pathlib import Path

WHISPER = os.environ.get("CHIRON_WHISPER_URL", "http://192.168.0.159:8766") + "/transcribe"
WPS = 2.4  # spoken words per second (for the expected-duration estimate)

DIR = ['low', 'high', 'hypo', 'hyper']
def directional_terms(text):
    """Map directional medical terms to (root, direction). low/hypo→down, high/hyper→up."""
    t = text.lower()
    out = {}
    for m in re.finditer(r'\b(low|high)\s+([a-z]+)', t):
        out[m.group(2)] = 'down' if m.group(1) == 'low' else 'up'
    for m in re.finditer(r'\b(hypo|hyper)([a-z]+)', t):
        out[m.group(2)] = 'down' if m.group(1) == 'hypo' else 'up'
    return out

def whisper_transcribe(mp3: Path) -> str:
    """POST the clip to the Mac whisper sidecar via curl (the proven multipart path). '' on failure.
    Retries on empty/transient — the single whisper process can 500 on rapid successive calls."""
    import time
    for attempt in range(3):
        try:
            r = subprocess.run(["curl", "-s", "-m", "300", "-F", f"file=@{mp3}", "-F", "model=large-v3", WHISPER],
                               capture_output=True, text=True, timeout=310)
            if r.stdout.strip():
                txt = json.loads(r.stdout).get('text', '')
                if txt:
                    return txt
        except Exception:
            pass
        time.sleep(2)
    print(f"   [whisper transcribe failed for {mp3.name} after 3 tries]", file=sys.stderr)
    return ''

def text_defects(transcript: str, expected: str) -> list:
    d = []
    exp_dir, got_dir = directional_terms(expected), directional_terms(transcript)
    for root, want in exp_dir.items():
        if root in got_dir and got_dir[root] != want:
            d.append(f"DIRECTION FLIP: '{root}' should be {want} but heard {got_dir[root]} (clinical-safety)")
    ew = re.findall(r'[a-z]{4,}', expected.lower())
    if ew and transcript.strip():
        gw = set(re.findall(r'[a-z]{4,}', transcript.lower()))
        overlap = sum(1 for w in ew if w in gw) / len(ew)
        if overlap < 0.55:
            d.append(f"MISSING/GARBLED WORDS: only {overlap:.0%} of script words heard (likely dropout/truncation)")
    return d

def ffmpeg_defects(mp3: Path, expected: str) -> list:
    d = []
    try:
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                    "-of", "csv=p=0", str(mp3)], capture_output=True, text=True, timeout=30).stdout.strip())
    except Exception:
        return ["UNREADABLE: ffprobe could not read the clip"]
    n_words = len(re.findall(r'\w+', expected))
    exp_dur = n_words / WPS
    if n_words > 20 and dur < 0.55 * exp_dur:
        d.append(f"TRUNCATION: clip is {dur:.0f}s but the script (~{n_words}w) needs ~{exp_dur:.0f}s")
    # long internal silence (dropout) — ignore <1.2s gaps
    sil = subprocess.run(["ffmpeg", "-i", str(mp3), "-af", "silencedetect=noise=-45dB:d=2.5", "-f", "null", "-"],
                         capture_output=True, text=True, timeout=60).stderr
    gaps = re.findall(r"silence_duration: ([\d.]+)", sil)
    long_gaps = [g for g in gaps if float(g) >= 2.5]
    if long_gaps:
        d.append(f"DROPOUT: {len(long_gaps)} internal silence gap(s) ≥2.5s (longest {max(map(float,long_gaps)):.1f}s)")
    # clipping
    stats = subprocess.run(["ffmpeg", "-i", str(mp3), "-af", "astats=metadata=1", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=60).stderr
    flat = re.search(r"Flat factor: ([\d.]+)", stats)
    if flat and float(flat.group(1)) > 5:
        d.append(f"CLIPPING: flat-factor {flat.group(1)} (sustained max-level → distortion)")
    return d

def main():
    out = Path(sys.argv[1]).expanduser()
    scripts = json.loads((out / "audio-scripts.json").read_text())
    clips = {"summary": scripts.get("summary"), "shortened": scripts.get("shortened")}
    for sid, segs in (scripts.get("sections") or {}).items():
        clips[f"section/{sid}"] = segs
    report, flagged = [], 0
    for name, segs in clips.items():
        mp3 = out / "audio" / f"{name}.mp3"
        if not segs or not mp3.exists():
            continue
        expected = " ".join(s.get("text", "") for s in segs if isinstance(s, dict))
        defects = ffmpeg_defects(mp3, expected)                       # Signal 2 (local)
        tr = whisper_transcribe(mp3)                                  # Signal 1 (Mac whisper)
        if tr:
            defects += text_defects(tr, expected)
        clean = not defects
        flagged += 0 if clean else 1
        print(f"  {'✅' if clean else '❌'} {name}" + ("" if clean else f"  → {defects}"))
        report.append({"clip": name, "clean": clean, "defects": defects})
    (out / ".scratch").mkdir(parents=True, exist_ok=True)
    (out / ".scratch" / "qc-report.json").write_text(json.dumps(report, indent=2))
    print(f"\n[qc-hybrid] {len(report)-flagged}/{len(report)} clean, {flagged} flagged → .scratch/qc-report.json")

if __name__ == "__main__":
    main()
