#!/usr/bin/env python3
"""build_dettato — turn one real Italian recording (a WhatsApp voice note, a clip) into a listen-and-type lesson.

    python3 build_dettato.py <audio> --title "..." [--from "Marti"] [--context "..."] [--slug S] [--en]

Steps: whisper (Mac sidecar, large, Italian, word timestamps) -> sentence lines of 2-12 s cut at punctuation
-> per line: the real clip (mp3) and a slowed copy (atempo 0.75, same voice) -> dettato.json.
A second whisper pass (turbo) is compared line by line; where the two disagree the line is marked
`uncertain`, so the judge treats a mismatch there as a possible transcription error, not the learner's.
Output: ~/Documents/generated/chiron-dettato/<slug>/ {dettato.json, source.<ext>, audio/NN.mp3, audio/NN-slow.mp3}
Played by the Chiron page /dettato?l=<slug>.
"""
import argparse, difflib, json, os, re, shutil, subprocess, sys, unicodedata
from datetime import datetime
from pathlib import Path

GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
OUT = GEN / "chiron-dettato"
ASR = os.environ.get("CHIRON_WHISPER_URL", "http://192.168.0.159:8766").rstrip("/") + "/transcribe"
MIN_S, COMMA_S, MAX_S, PAD = 1.5, 2.5, 7.0, 0.15


def whisper(path: Path, model: str, words: bool) -> dict:
    args = ["curl", "-s", "-m", "900", "-F", f"file=@{path}", "-F", f"model={model}", "-F", "language=it",
            "-F", "response_format=verbose_json", "-F", "save=false"]
    if words:
        args += ["-F", "word_timestamps=true"]
    r = subprocess.run(args + [ASR], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        sys.exit(f"build_dettato: whisper at {ASR} gave no JSON ({model}): {r.stdout[:200]!r} {r.stderr[:200]!r}")
    if "segments" not in d:
        sys.exit(f"build_dettato: whisper error ({model}): {str(d)[:300]}")
    return d


def norm(s: str) -> list[str]:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.findall(r"[a-z0-9]+", s.replace("'", " ").replace("’", " "))


def lines_from_words(words: list[dict]) -> list[dict]:
    """Group words into short dictation lines: end at . ? ! once >= MIN_S, at , ; : once >= COMMA_S, force at MAX_S."""
    out, cur = [], []
    for w in words:
        cur.append(w)
        dur = cur[-1]["end"] - cur[0]["start"]
        t = w["word"].strip()
        if (t.endswith((".", "?", "!")) and dur >= MIN_S) or (t.endswith((",", ";", ":")) and dur >= COMMA_S) \
                or dur >= MAX_S:
            out.append(cur); cur = []
    if cur:
        if out and cur[-1]["end"] - cur[0]["start"] < MIN_S:
            out[-1] += cur
        else:
            out.append(cur)
    return [{"start": ws[0]["start"], "end": ws[-1]["end"], "it": "".join(w["word"] for w in ws).strip()} for ws in out]


def cut(src: Path, a: float, b: float, dest: Path, slow: bool):
    af = ["-af", "atempo=0.75"] if slow else []
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", str(src), *af,
                    "-ac", "1", "-ar", "44100", "-b:a", "96k", str(dest)], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("audio", type=Path)
    ap.add_argument("--title", required=True)
    ap.add_argument("--from", dest="speaker", default="")
    ap.add_argument("--context", default="", help="one line: who, when, why (shown on the page, given to the judge)")
    ap.add_argument("--slug")
    a = ap.parse_args()
    src = a.audio.expanduser().resolve()
    if not src.exists():
        sys.exit(f"build_dettato: no such file {src}")
    slug = a.slug or re.sub(r"[^a-z0-9]+", "-", a.title.lower()).strip("-")[:60]
    d = OUT / slug
    (d / "audio").mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, d / f"source{src.suffix}")

    big = whisper(src, "large", words=True)
    words = [w for s in big["segments"] for w in (s.get("words") or [])]
    if not words:
        sys.exit("build_dettato: whisper returned no word timestamps; cannot cut lines")
    lines = lines_from_words(words)
    turbo = whisper(src, "turbo", words=True)
    alt = [(w["start"], w["end"], w["word"]) for s in turbo["segments"] for w in (s.get("words") or [])]
    total = float(big.get("duration") or lines[-1]["end"])

    for i, ln in enumerate(lines, 1):
        a0, b0 = max(0.0, ln["start"] - PAD), min(total, ln["end"] + PAD)
        cut(src, a0, b0, d / "audio" / f"{i:02d}.mp3", slow=False)
        cut(src, a0, b0, d / "audio" / f"{i:02d}-slow.mp3", slow=True)
        other = "".join(t for s, e, t in alt if (s + e) / 2 >= ln["start"] - 0.05 and (s + e) / 2 <= ln["end"] + 0.05)
        ratio = difflib.SequenceMatcher(None, norm(ln["it"]), norm(other)).ratio()
        ln.update(n=i, clip=f"audio/{i:02d}.mp3", slow=f"audio/{i:02d}-slow.mp3", start=round(a0, 2),
                  end=round(b0, 2), agree=round(ratio, 2), uncertain=ratio < 0.85, alt=other.strip())

    lesson = {"slug": slug, "title": a.title, "from": a.speaker, "context": a.context,
              "source": f"source{src.suffix}", "seconds": round(total, 1), "lines": lines,
              "transcript": " ".join(ln["it"] for ln in lines),
              "built": datetime.now().isoformat(timespec="seconds"), "asr": {"main": "whisper large", "check": "whisper turbo"}}
    (d / "dettato.json").write_text(json.dumps(lesson, ensure_ascii=False, indent=1))
    unc = sum(ln["uncertain"] for ln in lines)
    print(f"{d}  {len(lines)} lines, {total:.0f}s, {unc} uncertain")
    for ln in lines:
        print(f"  {ln['n']:2d} {ln['end']-ln['start']:4.1f}s {'?' if ln['uncertain'] else ' '} {ln['it']}")
    print(f"open: http://localhost:8911/dettato?l={slug}")


if __name__ == "__main__":
    main()
