#!/usr/bin/env python3
"""build_dettato — turn one real Italian recording (a WhatsApp voice note, a clip) into a listen-and-type lesson.

    python3 build_dettato.py <audio> --title "..." [--from "Marti"] [--context "..."] [--slug S] [--en]

Steps: whisper (Mac sidecar, large, Italian, word timestamps) -> sentence lines of 2-12 s cut at punctuation
-> per line: the real clip (mp3) and a slowed copy (atempo 0.75, same voice) -> dettato.json.
A second whisper pass (turbo) is compared line by line; where the two disagree the line is marked
`uncertain`, so the judge treats a mismatch there as a possible transcription error, not the learner's.
Output: ~/Documents/generated/chiron-dettato/<slug>/ {dettato.json, source.<ext>, audio/NN.mp3, audio/NN-slow.mp3}
Played by the Chiron page /verbal-check?l=<slug>. Also importable: build() is what `verbal-check` and
POST /api/dettato/build call.
"""
import argparse, difflib, json, os, re, shutil, subprocess, sys, unicodedata
from datetime import datetime
from pathlib import Path

GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
OUT = GEN / "chiron-dettato"
ASR = os.environ.get("CHIRON_WHISPER_URL", "http://192.168.0.159:8766").rstrip("/") + "/transcribe"
MIN_S, COMMA_S, MAX_S, PAD = 1.5, 2.5, 7.0, 0.15


class BuildError(RuntimeError):
    pass


def whisper(path: Path, model: str, words: bool) -> dict:
    args = ["curl", "-s", "-m", "900", "-F", f"file=@{path}", "-F", f"model={model}", "-F", "language=it",
            "-F", "response_format=verbose_json", "-F", "save=false"]
    if words:
        args += ["-F", "word_timestamps=true"]
    r = subprocess.run(args + [ASR], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        raise BuildError(f"whisper at {ASR} gave no JSON ({model}): {r.stdout[:200]!r} {r.stderr[:200]!r}")
    if "segments" not in d:
        raise BuildError(f"whisper error ({model}): {str(d)[:300]}")
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
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", str(src), *af,
                        "-ac", "1", "-ar", "44100", "-b:a", "96k", str(dest)], capture_output=True, text=True)
    if r.returncode:
        raise BuildError(f"ffmpeg could not cut {dest.name} ({a:.2f}-{b:.2f}s): {r.stderr.strip()[:300]}")


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60]


def build(audio: Path, title: str, speaker: str = "", context: str = "", slug: str | None = None,
          origin: dict | None = None) -> dict:
    """Build one lesson and return its dettato.json. Raises BuildError with the reason on any failure.
    `origin` records where the recording came from (e.g. the WhatsApp voice-note index row)."""
    src = Path(audio).expanduser().resolve()
    if not src.exists():
        raise BuildError(f"no such file {src}")
    slug = slug or slugify(title)
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        raise BuildError(f"bad slug {slug!r}: use a-z, 0-9 and -")
    d = OUT / slug
    (d / "audio").mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, d / f"source{src.suffix}")

    big = whisper(src, "large", words=True)
    words = [w for s in big["segments"] for w in (s.get("words") or [])]
    if not words:
        raise BuildError("whisper returned no word timestamps; cannot cut lines")
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

    lesson = {"slug": slug, "title": title, "from": speaker, "context": context,
              "source": f"source{src.suffix}", "seconds": round(total, 1), "lines": lines,
              "transcript": " ".join(ln["it"] for ln in lines), "origin": origin or {"file": str(src)},
              "built": datetime.now().isoformat(timespec="seconds"), "asr": {"main": "whisper large", "check": "whisper turbo"}}
    (d / "dettato.json").write_text(json.dumps(lesson, ensure_ascii=False, indent=1))
    return lesson


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("audio", type=Path)
    ap.add_argument("--title", required=True)
    ap.add_argument("--from", dest="speaker", default="")
    ap.add_argument("--context", default="", help="one line: who, when, why (shown on the page, given to the judge)")
    ap.add_argument("--slug")
    a = ap.parse_args()
    try:
        lesson = build(a.audio, a.title, a.speaker, a.context, a.slug)
    except BuildError as e:
        sys.exit(f"build_dettato: {e}")
    lines = lesson["lines"]
    print(f"{OUT / lesson['slug']}  {len(lines)} lines, {lesson['seconds']:.0f}s, "
          f"{sum(ln['uncertain'] for ln in lines)} uncertain")
    for ln in lines:
        print(f"  {ln['n']:2d} {ln['end']-ln['start']:4.1f}s {'?' if ln['uncertain'] else ' '} {ln['it']}")
    print(f"open: http://localhost:8911/verbal-check?l={lesson['slug']}")


if __name__ == "__main__":
    main()
