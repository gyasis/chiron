#!/usr/bin/env python3
"""Chiron VIDEO-EPISODE PIPELINE — one command turns an owned episode file into a registered Chiron lesson.

Chains every stage generically (NOTHING hardcoded — series/title/slug/streams derived from the file):
  0 transcode  episode.mp4 (720p h264 + the CLEAN italian audio, AD track skipped)        [ffmpeg]
  1 scenes     scene_brackets.py  → scenes.json  (PySceneDetect shots + Gemini scenes)    [VoxStruct venv]
  2 ingest     episode_ingest.py  → transcript.json (subs/ASR + pyannote + attribution)   [VoxStruct venv]
  3 enrich     episode_enrich.py  (en_gloss, teaching_note, target_structures)             [conda]
  4 tags       episode_tags.py    (difficulty, speech_acts)                                [conda]
  5 visual     episode_visual.py  (visual_situation from the AD track)                     [conda]
  6 audio      episode_audio.py --stage all (author→bake→normalize→splice, Lucrezia)       [conda]
  7 render     render_episode_viewer.py → lesson.html (the player)                         [conda]
  8 register   write chiron.json {video-it, subject=series, B1, staged} + rebuild library  [node]

Resumable: each stage skips if its output exists (unless --force / --from <stage>).
Run:  ~/miniconda3/bin/python3 episode_pipeline.py "<episode.mkv>" [--series X] [--level B1]
        [--from scenes] [--only audio] [--force] [--lang it]
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
SCRIPTS = SKILL / "scripts"
GEN = HOME / "Documents/generated"
CONDA = os.environ.get("CHIRON_PY", str(HOME / "miniconda3/bin/python3"))
VOX = os.environ.get("VOXSTRUCT_PY", str(HOME / "Documents/code/VoxStruct/.venv/bin/python"))
_AD_RE = re.compile(r"audiodescr|descript|descriz|comment|narrat|visual|impaired", re.I)
STAGES = ["transcode", "scenes", "ingest", "enrich", "tags", "visual", "audio", "render", "register"]


def sh(cmd, **kw):
    print(f"    $ {' '.join(str(c) for c in cmd)[:160]}", flush=True)
    return subprocess.run([str(c) for c in cmd], **kw)


def parse_episode(video: Path):
    """Derive series / episode-code / title / slug from the filename — no hardcoding."""
    stem = video.stem
    parts = [p.strip() for p in stem.split(" - ")]
    series = parts[0] if parts else stem
    epcode = ""
    for p in parts[1:]:
        m = re.search(r"S\d{1,2}E\d{1,2}", p, re.I)
        if m:
            epcode = m.group(0).upper(); break
    # episode title = the segment after the epcode, up to any bracket
    ep_title = ""
    for p in parts:
        if p and not re.search(r"S\d{1,2}E\d{1,2}", p, re.I) and p != series:
            ep_title = re.split(r"[\[\(]", p)[0].strip();
            if ep_title:
                break
    sslug = re.sub(r"[^a-z0-9]+", "-", series.lower()).strip("-")
    slug = f"chiron-{sslug}-{epcode.lower()}" if epcode else f"chiron-{sslug}"
    title = f"{series} {epcode} — {ep_title}".strip(" —") if epcode else (f"{series} — {ep_title}".strip(" —") or series)
    return {"series": series, "epcode": epcode, "ep_title": ep_title, "slug": slug, "title": title}


def clean_audio_index(video: Path, lang3="ita") -> int | None:
    """The CLEAN dialogue stream: prefer the lang track that is NOT audio-description; prefer 'originale'."""
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_streams", "-of", "json", str(video)],
                         capture_output=True, text=True)
    streams = json.loads(out.stdout).get("streams", []) if out.stdout else []
    cands = []
    for s in streams:
        tags = s.get("tags") or {}; title = tags.get("title", ""); lang = (tags.get("language") or "").lower()
        if lang != lang3:
            continue
        is_ad = bool(_AD_RE.search(title)) or (s.get("disposition") or {}).get("visual_impaired")
        if is_ad:
            continue
        cands.append((0 if "original" in title.lower() else 1, s["index"], title))
    cands.sort()
    return cands[0][1] if cands else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", help="the episode file (.mkv/.mp4)")
    ap.add_argument("--series", default="", help="override the derived series name")
    ap.add_argument("--title", default="", help="override the derived lesson title")
    ap.add_argument("--lang", default="it")
    ap.add_argument("--level", default="B1")
    ap.add_argument("--from", dest="from_stage", default="", choices=[""] + STAGES)
    ap.add_argument("--only", default="", choices=[""] + STAGES)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--engine", default="modal", choices=["modal", "mac"])
    args = ap.parse_args()

    video = Path(args.video).expanduser().resolve()
    if not video.is_file():
        sys.exit(f"[pipe] video not found: {video}")
    meta = parse_episode(video)
    if args.series:
        meta["series"] = args.series
    if args.title:
        meta["title"] = args.title
    out = GEN / meta["slug"]; out.mkdir(parents=True, exist_ok=True)
    mp4 = out / "episode.mp4"
    scenes = out / "scenes.json"
    transcript = out / "transcript.json"
    srt = video.with_suffix("").with_suffix(f".{args.lang}.srt")
    if not srt.is_file():
        srt = Path(str(video).rsplit(".", 1)[0] + f".{args.lang}.srt")

    def want(stage):
        if args.only:
            return stage == args.only
        if args.from_stage:
            return STAGES.index(stage) >= STAGES.index(args.from_stage)
        return True

    def have(p):
        return p.exists() and not args.force

    print(f"=== chiron episode pipeline · {meta['title']} ===", flush=True)
    print(f"    series={meta['series']} slug={meta['slug']} → {out}", flush=True)
    print(f"    srt={'✓ '+srt.name if srt.is_file() else 'none (will ASR)'}", flush=True)

    # 0 — transcode the player video (720p + CLEAN italian audio)
    if want("transcode"):
        if have(mp4):
            print("[0/transcode] episode.mp4 exists — skip", flush=True)
        else:
            ci = clean_audio_index(video, {"it": "ita", "de": "ger", "es": "spa", "fr": "fre"}.get(args.lang, "ita"))
            if ci is None:
                sys.exit("[0/transcode] no clean italian audio stream found")
            print(f"[0/transcode] clean audio = stream {ci} → episode.mp4 (720p)…", flush=True)
            sh(["ffmpeg", "-y", "-i", video, "-map", "0:v:0", "-map", f"0:{ci}", "-vf", "scale=-2:720",
                "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "160k", mp4],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

    # 1 — scenes (VoxStruct venv: PySceneDetect + google-genai)
    if want("scenes"):
        if have(scenes):
            print("[1/scenes] scenes.json exists — skip", flush=True)
        else:
            print("[1/scenes] scene_brackets…", flush=True)
            sh([VOX, SCRIPTS / "scene_brackets.py", video, "--out", out], check=True)

    # 2 — ingest → transcript.json (VoxStruct venv: ASR + pyannote + attribution)
    if want("ingest"):
        if have(transcript):
            print("[2/ingest] transcript.json exists — skip", flush=True)
        else:
            cmd = [VOX, SCRIPTS / "episode_ingest.py", video, "--out", out, "--scenes", scenes,
                   "--series", meta["series"], "--audio-lang", args.lang, "--lang", args.lang]
            if srt.is_file():
                cmd += ["--srt", str(srt)]
            print("[2/ingest] episode_ingest…", flush=True)
            sh(cmd, check=True)

    # 3-6 — conda stages (promptchain + requests). Each is internally resumable.
    if want("enrich"):
        print("[3/enrich] episode_enrich…", flush=True)
        sh([CONDA, SCRIPTS / "episode_enrich.py", out, "--concurrent"] + (["--force"] if args.force else []), check=True)
    if want("tags"):
        print("[4/tags] episode_tags…", flush=True)
        sh([CONDA, SCRIPTS / "episode_tags.py", out, "--lang", args.lang] + (["--force"] if args.force else []), check=True)
    if want("visual"):
        print("[5/visual] episode_visual…", flush=True)
        sh([CONDA, SCRIPTS / "episode_visual.py", out, "--video-src", video, "--audio-lang", args.lang]
           + (["--force"] if args.force else []), check=True)
    if want("audio"):
        print("[6/audio] episode_audio (author→bake→normalize→splice)…", flush=True)
        sh([CONDA, SCRIPTS / "episode_audio.py", out, "--stage", "all", "--engine", args.engine]
           + (["--force"] if args.force else []), check=True)

    # 7 — render the player as lesson.html (library scans for lesson.html)
    if want("render"):
        print("[7/render] render lesson.html…", flush=True)
        # no --video: let the renderer auto-pick the lightest streamable sibling (stream → mobile → original)
        sh([CONDA, SCRIPTS / "render_episode_viewer.py", transcript, "--out", out / "lesson.html",
            "--title", meta["title"]], check=True)

    # 8 — register in the Chiron library (chiron.json + rebuild)
    if want("register"):
        clips = len(list((out / "audio/seg").glob("*.mp3"))) if (out / "audio/seg").exists() else 0
        cj = {"title": meta["title"], "domain": "video-it", "status": "staged", "entry": "lesson.html",
              "generator": "chiron-video-episode",
              "tags": {"dom": "video-it", "subj": meta["series"], "level": args.level, "scope": "episode"},
              "audioClips": clips}
        (out / "chiron.json").write_text(json.dumps(cj, ensure_ascii=False, indent=2))
        print(f"[8/register] chiron.json (video-it · {meta['series']} · {args.level} · {clips} clips) → rebuild library", flush=True)
        sh(["node", SKILL / "scripts" / "build-library-index.mjs"], check=True)

    print(f"=== DONE · {meta['title']} → {out}/lesson.html · registered under Italian·Video / {meta['series']} ===", flush=True)


if __name__ == "__main__":
    main()
