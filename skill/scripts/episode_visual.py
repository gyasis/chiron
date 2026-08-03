#!/usr/bin/env python3
"""Chiron VIDEO-EPISODE — Phase-2b VISUAL/SITUATION layer (the listen-only-podcast source).

Fills each scene's `visual_situation` — WHAT'S ON SCREEN (setting, action, who-does-what, gestures,
tone) so the Phase-3 Lucrezia bake works for a learner who is LISTENING ONLY (can't see the video),
per the dual-mode rule. Two sources, graceful fallback:

  PRIMARY — the AUDIO-DESCRIPTION track. Many releases ship a pro Italian AD track (a narrator
    describing the visuals in the dialogue gaps — Baby E01 = stream 5 "Audiodescrizione"). We extract
    it, transcribe it (whisper :8766), SUBTRACT the segments that overlap known dialogue (transcript.json
    line intervals) so only the gap-NARRATION remains, bin it per scene, and shape it into
    visual_situation. Authentic native Italian scene description, synced to time — a gift.
  FALLBACK — no AD track → describe the scene from a MODEL: the audio-llm sidecar `/describe`
    (qwen3-omni-captioner, :8768) on the scene's audio clip. (Gemini watch_video / local VLM keyframe
    is a further option, PRD §4b.) Never fails — always emits a visual_situation.

Writes `visual_situation = {it, en, source, raw:[{start,end,text}]}` per scene into transcript.json.
raw[] (timed AD narration) is kept for the Phase-3 INTERLEAVE (splice Lucrezia with real clips).

Runs under ~/miniconda3 (promptchain via episode_enrich); whisper/audio-llm via HTTP (no voxstruct venv).
Run:  ~/miniconda3/bin/python3 episode_visual.py <episode_dir_or_transcript.json>
        --video-src "<original .mkv>" [--force] [--audio-lang it] [--chunk 240]
Env:  CHIRON_WHISPER_URL (:8766) · CHIRON_AUDIO_LLM_URL (:8768) · CH_ENRICH_LADDER
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import episode_enrich as EN        # reuse the PromptChain ladder (model_for / json_with_repair / _ladder)
import asyncio
try:
    import requests
except Exception as e:
    sys.exit(f"[visual] requests not importable ({e}) — run me with ~/miniconda3/bin/python3")

WHISPER = os.environ.get("CHIRON_WHISPER_URL", "http://192.168.0.159:8766").rstrip("/")
AUDIO_LLM = os.environ.get("CHIRON_AUDIO_LLM_URL", "http://192.168.0.159:8768").rstrip("/")
_AD_RE = re.compile(r"audiodescr|descript|descriz|comment|narrat|visual|impaired", re.I)
_LANG3 = {"it": "ita", "en": "eng", "de": "ger", "es": "spa", "fr": "fre", "ru": "rus"}


# ── ffprobe / ffmpeg ──────────────────────────────────────────────────────────
def _streams(video: Path) -> list[dict]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_streams",
                          "-of", "json", str(video)], capture_output=True, text=True)
    try:
        return json.loads(out.stdout).get("streams", [])
    except Exception:
        return []


def ad_stream_index(video: Path, lang3: str) -> int | None:
    """The audio-DESCRIPTION stream (title matches _AD_RE / visual_impaired disposition), preferring lang."""
    streams = _streams(video)
    cands = []
    for s in streams:
        tags = s.get("tags") or {}
        title = tags.get("title", "")
        disp = s.get("disposition") or {}
        is_ad = bool(_AD_RE.search(title)) or disp.get("visual_impaired") or disp.get("comment")
        if is_ad:
            lang = (tags.get("language") or "").lower()
            cands.append((0 if lang == lang3 else 1, s["index"], title))
    if not cands:
        return None
    cands.sort()
    print(f"[visual] AD track = stream {cands[0][1]} ('{cands[0][2]}')", flush=True)
    return cands[0][1]


def extract_stream(video: Path, stream_index: int, wav: Path):
    subprocess.run(["ffmpeg", "-y", "-i", str(video), "-map", f"0:{stream_index}",
                    "-vn", "-ac", "1", "-ar", "16000", str(wav)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def cut_clip(video: Path, start: float, end: float, wav: Path, stream_index: int | None = None):
    m = ["-map", f"0:{stream_index}"] if stream_index is not None else []
    subprocess.run(["ffmpeg", "-y", "-ss", f"{max(0, start):.3f}", "-to", f"{end:.3f}", "-i", str(video)]
                   + m + ["-vn", "-ac", "1", "-ar", "16000", str(wav)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _dur(wav: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(wav)], capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except Exception:
        return 0.0


# ── whisper transcription (chunked; :8766) ────────────────────────────────────
def whisper_chunk(wav: Path, lang: str) -> list[dict]:
    with open(wav, "rb") as fh:
        r = requests.post(f"{WHISPER}/transcribe",
                          files={"file": ("a.wav", fh, "audio/wav")},
                          data={"language": lang, "response_format": "verbose_json", "model": "large-v3"},
                          timeout=1200)
    r.raise_for_status()
    j = r.json()
    segs = j.get("segments") if isinstance(j, dict) else j
    out = []
    for s in (segs or []):
        t = (s.get("text") or "").strip()
        if t:
            out.append({"start": float(s.get("start", 0.0)), "end": float(s.get("end", 0.0)), "text": t})
    return out


def transcribe_ad(video: Path, stream_index: int, lang: str, chunk_s: int) -> list[dict]:
    """Extract the AD stream, transcribe in chunk_s windows (offset-corrected), return timed segments."""
    with tempfile.TemporaryDirectory(prefix="advis_") as td:
        full = Path(td) / "ad.wav"
        print("[visual] extracting AD audio…", flush=True)
        extract_stream(video, stream_index, full)
        total = _dur(full)
        print(f"[visual] AD audio {total/60:.1f} min → transcribing in {chunk_s}s chunks…", flush=True)
        segs: list[dict] = []
        off = 0.0
        i = 0
        while off < total:
            i += 1
            piece = Path(td) / f"c{i}.wav"
            subprocess.run(["ffmpeg", "-y", "-ss", f"{off:.3f}", "-t", str(chunk_s), "-i", str(full),
                            "-ac", "1", "-ar", "16000", str(piece)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if _dur(piece) < 0.2:
                break
            try:
                cs = whisper_chunk(piece, lang)
            except Exception as e:
                print(f"[visual]   chunk {i} @ {off:.0f}s failed ({e}) — skipping", flush=True)
                cs = []
            for s in cs:
                segs.append({"start": round(s["start"] + off, 2), "end": round(s["end"] + off, 2), "text": s["text"]})
            print(f"[visual]   chunk {i} @ {off/60:.1f}m → {len(cs)} segs (total {len(segs)})", flush=True)
            off += chunk_s
        return segs


# ── subtract dialogue, bin to scenes ──────────────────────────────────────────
def dialogue_intervals(scenes: list[dict]) -> list[tuple[float, float]]:
    iv = []
    for s in scenes:
        for l in (s.get("lines") or []):
            try:
                iv.append((float(l["start"]), float(l["end"])))
            except Exception:
                pass
    iv.sort()
    return iv


def _overlap(s: float, e: float, iv: list[tuple[float, float]]) -> float:
    """Total overlap of [s,e] with the (sorted) dialogue intervals."""
    tot = 0.0
    for ds, de in iv:
        if de < s:
            continue
        if ds > e:
            break
        tot += max(0.0, min(e, de) - max(s, ds))
    return tot


def narration_only(ad_segs: list[dict], iv: list[tuple[float, float]], frac: float = 0.5) -> list[dict]:
    """Keep AD segments that are NOT mostly dialogue (i.e. the narrator speaking in the gaps)."""
    out = []
    for s in ad_segs:
        dur = max(0.01, s["end"] - s["start"])
        if _overlap(s["start"], s["end"], iv) / dur < frac:
            out.append(s)
    return out


def bin_scenes(narr: list[dict], scenes: list[dict]) -> dict[int, list[dict]]:
    by = {}
    for seg in narr:
        mid = (seg["start"] + seg["end"]) / 2
        for sc in scenes:
            if sc.get("start", 0) <= mid < sc.get("end", 1e9):
                by.setdefault(sc["scene"], []).append(seg)
                break
    return by


# ── shape into visual_situation (LLM, reuse the enrich ladder) ────────────────
def _vs_valid(obj):
    iss = []
    if not (obj.get("it") or "").strip():
        iss.append("`it` (Italian scene description) is required and non-empty")
    if not (obj.get("en") or "").strip():
        iss.append("`en` (English) is required and non-empty")
    return iss or None


async def shape_visual(scene: dict, raw_text: str, source: str) -> dict | None:
    ctx = {k: scene.get(k) for k in ("title", "location", "situation", "characters_present") if scene.get(k)}
    lang = EN.LANG_NAME
    if source == "ad-track":
        src_block = (f"## AUDIO-DESCRIPTION NARRATION (authentic {lang}, spoken in this scene's gaps — the "
                     "professional describer telling a blind listener what's on screen):\n" + raw_text)
        directive = ("Shape this into a clean visual_situation the tutor can NARRATE. Keep it grounded in the "
                     "AD narration above; tighten/merge fragments; drop timecodes and filler.")
    else:
        src_block = "## MODEL CAPTION of this scene's clip:\n" + raw_text
        # Radio-D constraint: describe what is SEEN, not just what is said — or it collapses without the video.
        directive = ("Shape this into a visual_situation that describes WHAT IS SEEN ON SCREEN — the setting, "
                     "who is present, their physical ACTIONS/gestures/expressions, and the mood — grounded in the "
                     "caption + scene context. It MUST stand alone for a learner who CANNOT see the video: never "
                     "merely summarize what was said. If the source is thin, describe the situation, not the words.")
    return await EN.json_with_repair(
        f"You are building the LISTEN-ONLY layer of a {lang} video lesson: a description of WHAT'S ON "
        "SCREEN so a learner who is NOT watching still knows the setting, the action, who does what, "
        "gestures and emotional tone.\n\n"
        "## SCENE CONTEXT\n" + json.dumps(ctx, ensure_ascii=False) + "\n\n"
        + src_block + "\n\n" + directive + "\n\n"
        "## OUTPUT — return ONLY this JSON:\n"
        '{"it": "<2-4 sentence ' + lang + ' description of the on-screen situation/action/gesture — natural, '
        'speakable, present tense>", "en": "<faithful English translation>"}\n'
        f"Real idiomatic {lang}. Return ONLY the JSON object.",
        f"scene{scene['scene']}-visual", validate_fn=_vs_valid)


# ── fallback: audio-llm captioner describe ────────────────────────────────────
def caption_clip(video: Path, scene: dict, clean_stream: int | None) -> str | None:
    """Fallback source: audio-llm sidecar /describe (qwen3-omni-captioner) on a ~30s clip of the scene."""
    st = float(scene.get("start", 0)); en = min(float(scene.get("end", st + 30)), st + 40)
    with tempfile.TemporaryDirectory(prefix="advcap_") as td:
        clip = Path(td) / "clip.wav"
        try:
            cut_clip(video, st, en, clip, stream_index=clean_stream)
            with open(clip, "rb") as fh:
                r = requests.post(f"{AUDIO_LLM}/describe",
                                  files={"file": ("clip.wav", fh, "audio/wav")},
                                  data={"model": "qwen3-omni-captioner",
                                        "prompt": ("Describe what is happening in this scene for a listener who "
                                                   "cannot see it: the setting, who is present, what they DO "
                                                   "(actions, movements, tone), and the mood — not just the words.")},
                                  timeout=600)
            r.raise_for_status()
            return (r.json().get("text") or "").strip() or None
        except Exception as e:
            print(f"[visual] caption fallback failed for scene {scene.get('scene')} ({e})", flush=True)
            return None


# ── main ──────────────────────────────────────────────────────────────────────
def resolve_transcript(arg: str) -> Path:
    p = Path(arg).expanduser()
    if p.is_dir():
        p = p / "transcript.json"
    if not p.is_file():
        sys.exit(f"[visual] no transcript.json at {p}")
    return p.resolve()


async def run(tpath: Path, video: Path, audio_lang: str, chunk_s: int, force: bool):
    data = json.loads(tpath.read_text(encoding="utf-8"))
    scenes = data.get("scenes") or []
    todo = [s for s in scenes if force or not (s.get("visual_situation"))]
    print(f"[visual] {tpath.name} · {len(scenes)} scenes · {len(todo)} to fill "
          f"({'--force' if force else 'resume'}) · ladder={'->'.join(EN._ladder())}", flush=True)
    if not todo:
        print("[visual] all scenes already have visual_situation.", flush=True)
        return data, 0

    bak = tpath.with_suffix(tpath.suffix + f".bak.{int(time.time())}")
    bak.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[visual] backup → {bak.name}", flush=True)

    lang3 = _LANG3.get(audio_lang, audio_lang)
    ad_idx = ad_stream_index(video, lang3)
    by_scene: dict[int, list[dict]] = {}
    source = "captioner"
    clean_idx = None
    if ad_idx is not None:
        source = "ad-track"
        ad_segs = transcribe_ad(video, ad_idx, audio_lang, chunk_s)
        iv = dialogue_intervals(scenes)
        narr = narration_only(ad_segs, iv)
        by_scene = bin_scenes(narr, scenes)
        print(f"[visual] AD: {len(ad_segs)} segs → {len(narr)} narration segs → "
              f"{len(by_scene)} scenes have narration", flush=True)
    else:
        print("[visual] NO AD track — falling back to the audio-llm captioner per scene.", flush=True)
        # pick the clean ita stream for the caption clips (skip AD; here there IS none)
        for s in _streams(video):
            if (s.get("tags") or {}).get("language", "").lower() == lang3:
                clean_idx = s["index"]; break

    done = 0
    for sc in todo:
        scn = sc["scene"]
        if source == "ad-track":
            segs = by_scene.get(scn) or []
            raw = " ".join(s["text"] for s in segs).strip()
            if not raw:
                # this scene had no gap-narration (dialogue-dense) → caption fallback
                cap = caption_clip(video, sc, clean_idx)
                if not cap:
                    print(f"[visual] scene {scn}: no AD narration + no caption — skipped", flush=True)
                    continue
                vs = await shape_visual(sc, cap, "captioner")
                if vs: vs["source"] = "captioner"
            else:
                vs = await shape_visual(sc, raw, "ad-track")
                if vs:
                    vs["source"] = "ad-track"
                    vs["raw"] = segs      # timed narration — Phase-3 interleave uses this
        else:
            cap = caption_clip(video, sc, clean_idx)
            if not cap:
                print(f"[visual] scene {scn}: caption failed — skipped", flush=True)
                continue
            vs = await shape_visual(sc, cap, "captioner")
            if vs: vs["source"] = "captioner"
        if not vs:
            print(f"[visual] scene {scn}: LLM shaping exhausted — skipped", flush=True)
            continue
        sc["visual_situation"] = vs
        done += 1
        tpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")  # resumable
        print(f"[visual] scene {scn} ✓ [{vs.get('source')}] {vs['it'][:70]}…", flush=True)
    return data, done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="episode dir OR transcript.json")
    ap.add_argument("--video-src", required=True, help="the ORIGINAL video (mkv) — has the AD + all audio tracks")
    ap.add_argument("--audio-lang", default="it")
    ap.add_argument("--chunk", type=int, default=240, help="AD transcription chunk seconds")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--ladder", default="")
    ap.add_argument("--persona", default="", help="tutor persona pack name; default lucrezia")
    args = ap.parse_args()
    if args.ladder:
        EN._DEFAULT_LADDER = args.ladder
    # the content language follows the audio track language (it/de/es…) — the multi-language seam
    EN.LANG_CODE = args.audio_lang
    EN.LANG_NAME = EN._LANG_NAMES.get(args.audio_lang, args.audio_lang)
    if args.persona:
        EN.PERSONA = args.persona
    tpath = resolve_transcript(args.target)
    video = Path(args.video_src).expanduser()
    if not video.is_file():
        sys.exit(f"[visual] video not found: {video}")
    data, done = asyncio.run(run(tpath, video, args.audio_lang, args.chunk, args.force))
    scenes = data.get("scenes") or []
    have = sum(1 for s in scenes if s.get("visual_situation"))
    ad = sum(1 for s in scenes if (s.get("visual_situation") or {}).get("source") == "ad-track")
    print(f"[visual] DONE. filled {done} this run · coverage: {have}/{len(scenes)} scenes "
          f"({ad} from AD track, {have-ad} from captioner)", flush=True)


if __name__ == "__main__":
    main()
