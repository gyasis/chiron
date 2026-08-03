#!/usr/bin/env python3
"""
Chiron video-episode SCENE BRACKETS — the merged scene layer.

Two signals fused (per the design + OmAgent Video2RAG):
  A. PySceneDetect  -> frame-accurate SHOT cuts (camera changes). Precise, but a
     narrative scene = MANY shots (shot/reverse-shot), so shots ≠ scenes.
  B. Gemini video   -> SEMANTIC narrative scenes (location/activity/speaker shifts)
     with names + summaries, but timestamps only ~1s-accurate (1fps sampling).
  MERGE: snap each Gemini scene boundary to the nearest real shot cut -> named,
     frame-accurate narrative scene brackets.

Output: scenes.json = {video, scenes:[{scene,start,end,name,location,summary,characters_present}]}

RUN (VoxStruct venv):
  .../python scene_brackets.py EP.mkv --out ./out [--model gemini-flash-latest] [--no-gemini]
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys, tempfile, time
from pathlib import Path

# ---------- A. shot cuts via PySceneDetect ----------
def detect_shots(video: Path) -> list[float]:
    """Return sorted shot-boundary times (seconds), incl. 0.0 and the final end."""
    from scenedetect import detect, AdaptiveDetector
    scenes = detect(str(video), AdaptiveDetector(), show_progress=False)
    cuts = [0.0]
    for start, end in scenes:
        cuts.append(round(end.get_seconds(), 3))
    return sorted(set(cuts))

# ---------- B. semantic scenes via Gemini video ----------
SCENE_PROMPT = """You are an expert film editor and AI video analyst. Perform narrative SCENE segmentation on this video (a TV episode).

A SCENE is a continuous dramatic unit in ONE location/time — it usually spans MANY camera shots (e.g. a back-and-forth dialogue is ONE scene, not one scene per camera angle). Start a NEW scene only on a real narrative shift: change of location/setting, a clear time jump, or a distinct new dramatic beat. Aim for whole narrative scenes, NOT individual shots — a ~25 min episode typically has ~12-25 scenes.

The video is sampled at ~1 fps, so align every timestamp to whole seconds. Cover the video continuously from 0 with no gaps or overlaps.

Output STRICT JSON only, matching:
{
  "video_summary": "2-3 sentence overview",
  "scenes": [
    {"scene": 1, "start_seconds": 0, "end_seconds": 84,
     "name": "short scene title", "location": "where",
     "summary": "1-2 sentences: what happens", "characters_present": ["Name", ...]}
  ]
}"""

def _proxy(video: Path, dst: Path) -> None:
    """Small 360p video-only proxy — tiny upload; Gemini segments on visuals."""
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video), "-map", "0:v:0", "-an",
         "-vf", "scale=-2:360", "-r", "2", "-c:v", "libx264", "-crf", "30",
         "-preset", "veryfast", str(dst)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def gemini_scenes(video: Path, model: str) -> dict:
    import google.genai as genai
    from google.genai import types
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        # try ~/dev/.env
        try:
            from dotenv import load_dotenv; load_dotenv(Path.home() / "dev" / ".env", override=False)
            key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        except Exception:
            pass
    if not key:
        raise RuntimeError("no GEMINI_API_KEY / GOOGLE_API_KEY")
    client = genai.Client(api_key=key)
    with tempfile.TemporaryDirectory(prefix="chiron_proxy_") as td:
        proxy = Path(td) / "proxy.mp4"
        print("    building 360p proxy…"); _proxy(video, proxy)
        print(f"    proxy {proxy.stat().st_size/1e6:.1f} MB — uploading to Gemini…")
        f = client.files.upload(file=str(proxy))
        # wait until ACTIVE
        for _ in range(120):
            f = client.files.get(name=f.name)
            if str(f.state).endswith("ACTIVE"): break
            if str(f.state).endswith("FAILED"): raise RuntimeError("Gemini file processing FAILED")
            time.sleep(2)
        print(f"    file {f.name} active — generating scene list ({model})…")
        last_err = None
        for attempt in range(1, 4):     # Gemini occasionally returns an empty/None body — retry the same upload
            try:
                resp = client.models.generate_content(
                    model=model, contents=[f, SCENE_PROMPT],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json", temperature=0.2,
                        # relax safety — mature-drama footage (violence/sexual themes) otherwise returns an
                        # EMPTY body (candidate blocked). We only want scene BOUNDARIES, not to generate the content.
                        safety_settings=[types.SafetySetting(category=c, threshold="BLOCK_NONE") for c in (
                            "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
                            "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT")]))
                txt = (getattr(resp, "text", None) or "").strip()
                if not txt:
                    raise ValueError("empty response text from Gemini")
                return json.loads(txt)
            except Exception as e:
                last_err = e
                print(f"    [gemini] scene-gen attempt {attempt}/3 failed ({str(e)[:80]}) — retrying…", flush=True)
                time.sleep(3 * attempt)
    raise RuntimeError(f"Gemini scene-gen failed after 3 attempts: {last_err}")

# ---------- MERGE: snap Gemini boundaries to real shot cuts ----------
def _nearest(t: float, cuts: list[float], tol: float) -> float:
    if not cuts: return t
    c = min(cuts, key=lambda x: abs(x - t))
    return c if abs(c - t) <= tol else t

def snap_merge(gem: dict, cuts: list[float], tol: float = 3.0, video_end: float | None = None) -> dict:
    scenes = sorted(gem.get("scenes", []), key=lambda s: s.get("start_seconds", 0))
    out = []
    for i, s in enumerate(scenes):
        st = _nearest(float(s.get("start_seconds", 0)), cuts, tol)
        en = _nearest(float(s.get("end_seconds", st)), cuts, tol)
        if out:  # keep contiguous — start = previous end
            st = out[-1]["end"]
        if en <= st:  # guard
            en = st + max(1.0, float(s.get("end_seconds", st)) - float(s.get("start_seconds", st)))
        out.append({
            "scene": i + 1, "start": round(st, 2), "end": round(en, 2),
            "name": s.get("name"), "location": s.get("location"),
            "summary": s.get("summary"), "characters_present": s.get("characters_present", []),
        })
    if out and video_end:
        out[-1]["end"] = round(max(out[-1]["end"], video_end), 2)
    return {"video_summary": gem.get("video_summary"), "scenes": out}


def video_duration(video: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(video)], capture_output=True, text=True).stdout.strip()
    try: return float(out)
    except Exception: return 0.0


def main():
    ap = argparse.ArgumentParser(description="Chiron scene brackets (PySceneDetect + Gemini, snap-merged)")
    ap.add_argument("video")
    ap.add_argument("--out", default="./episode-out")
    ap.add_argument("--model", default=os.getenv("CHIRON_SCENE_MODEL", "gemini-flash-latest"))
    ap.add_argument("--no-gemini", action="store_true", help="shots only (no semantic grouping/names)")
    ap.add_argument("--snap-tol", type=float, default=3.0)
    args = ap.parse_args()

    video = Path(args.video).expanduser().resolve()
    if not video.is_file(): sys.exit(f"no such video: {video}")
    outdir = Path(args.out).expanduser().resolve(); outdir.mkdir(parents=True, exist_ok=True)

    print("[A] PySceneDetect shot cuts…")
    cuts = detect_shots(video)
    print(f"    -> {len(cuts)} shot boundaries")
    dur = video_duration(video)

    def _shot_only(min_sec=90.0):   # Gemini unavailable → MERGE shot cuts into ~scene-length units (NOT 1/shot:
        # a 45-min episode has ~500 shots; grouping to ~min_sec gives a usable ~25-35 scenes, unnamed).
        pts = sorted(set([0.0] + [c for c in cuts if 0 < c < dur] + [dur]))
        starts = [pts[0]]
        for t in pts[1:]:
            if t - starts[-1] >= min_sec:
                starts.append(t)
        scenes = []
        for i, st in enumerate(starts):
            en = starts[i + 1] if i + 1 < len(starts) else dur
            if en - st < 1:
                continue
            scenes.append({"scene": len(scenes) + 1, "start": round(st, 2), "end": round(en, 2),
                           "name": None, "location": None, "summary": None, "characters_present": []})
        return {"video_summary": None, "scenes": scenes}

    if args.no_gemini:
        merged = _shot_only()
    else:
        print("[B] Gemini semantic scenes…")
        try:
            gem = gemini_scenes(video, args.model)
            print(f"    -> {len(gem.get('scenes', []))} semantic scenes")
            print("[merge] snapping Gemini boundaries to nearest shot cut…")
            merged = snap_merge(gem, cuts, tol=args.snap_tol, video_end=dur)
        except Exception as e:   # DON'T crash the pipeline on a Gemini flake — degrade to shot-only, keep going
            print(f"    ⚠ Gemini scene detection FAILED ({str(e)[:120]}) — FALLING BACK to shot-only scenes "
                  "(coarser cuts, no names). Re-run this episode later to get semantic scenes.", flush=True)
            merged = _shot_only()

    out = outdir / "scenes.json"
    out.write_text(json.dumps({"video": video.name, **merged}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out}  ({len(merged['scenes'])} scenes)")
    for s in merged["scenes"][:6]:
        nm = s.get("name") or "(shot)"
        print(f"  scene {s['scene']:>2}  {s['start']:>7.1f}-{s['end']:>7.1f}s  {nm}")


if __name__ == "__main__":
    main()
