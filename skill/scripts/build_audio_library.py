#!/usr/bin/env python3
"""Chiron AUDIO LIBRARY — pre-render short words a TTS can't voice in isolation (clitics / function words
like ti, ci, la, o, che…). A bare 2-letter word synthesizes to near-silence; inside a CARRIER sentence it
voices fine. So: synth "Ascolta bene: <word>.", whisper-align, cut JUST the word (last token, by position),
normalize to −16, and store keyed by (voice, word). The episode bake then SPLICES these in whenever a run
synthesizes near-silent (self-healing) — no more dropped clitics, and the library is reusable across lessons.

  build_audio_library.py --voice lucrezia_italian [--words "ti,ci,la,…"] [--force]
Library: ~/.chiron/audio-library/<voice>/<slug>.wav  (+ manifest.json {word: file, lufs})
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import episode_audio as A
import requests

HOME = Path(os.path.expanduser("~"))
LIB = HOME / ".chiron" / "audio-library"
WHISPER = os.environ.get("CHIRON_WHISPER_URL", "http://192.168.0.159:8766").rstrip("/")
CARRIER = "Ascolta bene: "     # 2 fixed words → the target is always the LAST aligned token

# Italian clitics + monosyllabic function words that fail to synth solo (the recurring offenders).
DEFAULT_WORDS = ("ti ci mi si vi lo la le li ne ce ve me te se gli ci' "
                 "che chi ho hai ha sto sta va fa so do sono ce n'è c'ho "
                 "o e a i di da in un il no sì ma tu io se ci vieni fare più già qui qua").split()


def _slug(w: str) -> str:
    return re.sub(r"[^a-z0-9']+", "", w.strip().lower()) or "x"


def _align_last(wav: Path):
    """Whisper word-align; return the LAST word's (start,end) — that's the target after the fixed carrier."""
    with open(wav, "rb") as f:
        r = requests.post(f"{WHISPER}/transcribe", files={"file": ("a.wav", f, "audio/wav")},
                          data={"language": "it", "response_format": "verbose_json",
                                "word_timestamps": "true", "model": "large-v3"}, timeout=200)
    r.raise_for_status()
    ws = [(x.get("word", "").strip(), float(x.get("start", 0)), float(x.get("end", 0)))
          for s in r.json().get("segments", []) for x in (s.get("words") or [])]
    return (ws[-1][1], ws[-1][2], ws[-1][0]) if ws else None


def build_words(voice: str, words, force: bool = False) -> int:
    """Build library clips for `words` in `voice` (carrier synth → align → cut → normalize → save). Reusable:
    the episode normalize stage calls this to AUTO-GROW the library when it hits a near-silent word not yet in
    it. Returns how many were built. Idempotent (skips words already present unless force)."""
    if voice not in A.VOICES:
        raise ValueError(f"unknown voice {voice}; known: {list(A.VOICES)}")
    outdir = LIB / voice; outdir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    mpath = outdir / "manifest.json"
    if mpath.exists():
        try: manifest = json.loads(mpath.read_text())
        except Exception: pass
    todo = [w for w in words if w and (force or _slug(w) not in manifest)]
    if not todo:
        return 0
    print(f"[lib] building {len(todo)} words for {voice} → {outdir}", flush=True)

    vr = A.VOICES[voice]
    refs = {voice: {"wav": os.path.basename(vr["refAudio"]), "txt": vr["refText"]}}
    sect = [{"voice": voice, "lang": "it", "text": f"{CARRIER}{w}."} for w in todo]
    with tempfile.TemporaryDirectory(prefix="lib-") as td:
        pref = Path(td) / "pref"
        job = {"slug": "audio-library", "num_step": 48, "bucket": 8, "refs": refs, "sections": {"s": sect}}
        jp = Path(td) / "job.json"; jp.write_text(json.dumps(job))
        r = subprocess.run(["python3", str(A.MODAL_SYNTH), str(jp), str(pref)],
                           capture_output=True, text=True, timeout=1800)
        res = json.loads((r.stdout.strip().splitlines() or ["{}"])[-1]) if r.stdout.strip() else {}
        if res.get("error") or not res.get("clips"):
            sys.exit(f"[lib] Modal failed: {res.get('error') or r.stderr[-200:]}")
        print(f"[lib] ⚡ synth {res['clips']} carriers · {res.get('synth_s')}s GPU", flush=True)
        ok = 0
        for i, w in enumerate(todo):
            raw = pref / "s" / f"{i}.wav"
            if not raw.is_file():
                print(f"[lib] {w}: no carrier wav — skip", flush=True); continue
            al = _align_last(raw)
            if not al:
                print(f"[lib] {w}: whisper found no words — skip", flush=True); continue
            st, en, heard = al
            cut = Path(td) / f"cut_{i}.wav"
            subprocess.run(["ffmpeg", "-y", "-ss", f"{max(0,st-0.06):.3f}", "-to", f"{en+0.10:.3f}", "-i", str(raw),
                            "-ac", "1", "-ar", "24000", str(cut)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            dst = outdir / f"{_slug(w)}.wav"
            A._norm(cut, dst)                       # → -16 LUFS
            lv = A._lufs(dst)
            flag = "" if (lv is not None and lv > -28) else "  ⚠ still quiet — check"
            manifest[_slug(w)] = {"word": w, "file": dst.name, "lufs": round(lv, 1) if lv else None, "heard": heard}
            print(f"[lib] {w:<6} → {dst.name:<12} heard='{heard}' LUFS={lv}{flag}", flush=True); ok += 1
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"[lib] built {ok}/{len(todo)} words · library now {len(manifest)} entries → {outdir}", flush=True)
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="lucrezia_italian")
    ap.add_argument("--words", default="", help="comma/space list; default = the built-in clitic set")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    words = [w for w in re.split(r"[,\s]+", args.words) if w] if args.words else DEFAULT_WORDS
    build_words(args.voice, words, args.force)


if __name__ == "__main__":
    main()
