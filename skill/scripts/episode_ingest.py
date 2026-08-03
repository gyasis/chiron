#!/usr/bin/env python3
"""
Chiron VIDEO-EPISODE lesson — voice-first INGEST (Phase 1).

Video file -> character-attributed, scene-segmented transcript JSON that the
Chiron Player renders and the (future) `("italian","episode")` chain enriches.

    scene -> line -> {start, end, character, italian_text, en_gloss?, teaching_note?}

PIPELINE (voice-first — stages marked [ok] run today; [stub] needs the Mac sidecar):
  1. [ok]   extract audio          ffmpeg -> 16k mono wav
  2. [ok]   probe embedded subs    ffprobe; if an italian sub stream exists, extract it (fast path, has text+timing, NO speaker)
  3. [ok]   ASR (word timestamps)  VoxStruct remote backend -> Atelier whisper :8766  (segments + words)
  4. [stub] diarize                pyannote -> [{start,end,speaker}]   <-- THE GAP: needs a Mac pyannote sidecar (HF token)
  5. [ok]   merge speakers->lines  assign each ASR segment the max-overlap diarization speaker
  6. [ok]   scene segmentation     split on inter-line silence gaps (heuristic v1; ffmpeg scene-detect / chapters later)
  7. [ok]   map speaker->character  cast registry (per-series) else SPEAKER_xx  (screenplay parse / LLM-infer = later phase)
  8. [ok]   emit transcript.json

RUN (inside VoxStruct's venv so `voxstruct` + deps import):
    ~/Documents/code/VoxStruct/.venv/bin/python episode_ingest.py EP.mkv --out ./out --lang it \
        [--speaker-map SPEAKER_00=Lucia,SPEAKER_01=Marco] [--no-asr-if-subs]

Until stage 4 (pyannote) lands, every line gets speaker SPEAKER_?? (or your --speaker-map),
so the rest of the pipeline + the Player are exercisable end-to-end now.
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys, tempfile
from pathlib import Path

_LANG3 = {"it": "ita", "en": "eng", "de": "deu", "fr": "fra", "es": "spa"}

# ---------- 1. audio ----------
_AD_RE = re.compile(r"audiodescr|descript|descriz|comment|narrat|visual|impaired", re.I)

def audio_stream_index(video: Path, lang3: str) -> int | None:
    """Index of the CLEAN dialogue audio stream for lang3 — skipping AUDIO-DESCRIPTION
    tracks (e.g. 'Italiano - Audiodescrizione', which some releases even mark default=1),
    preferring the 'originale' track. Detected by title + disposition (the visual_impaired
    flag is often unset, so title is the reliable signal)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=index:stream_tags=language,title:stream_disposition=visual_impaired,comment",
         "-of", "json", str(video)], capture_output=True, text=True).stdout
    try:
        streams = [s for s in json.loads(out).get("streams", [])
                   if (s.get("tags", {}).get("language", "") or "").lower().startswith(lang3[:3])]
    except Exception:
        streams = []
    if not streams:
        return None
    def is_ad(s):
        t = (s.get("tags", {}).get("title") or "")
        d = s.get("disposition", {})
        return bool(_AD_RE.search(t)) or d.get("visual_impaired") or d.get("comment")
    pool = [s for s in streams if not is_ad(s)] or streams
    orig = [s for s in pool if "original" in (s.get("tags", {}).get("title") or "").lower()]
    return (orig or pool)[0]["index"]

def extract_audio(video: Path, wav: Path, lang: str = "it") -> int | None:
    """Extract the target-language audio track (NOT blindly stream 0) → 16k mono wav."""
    idx = audio_stream_index(video, _LANG3.get(lang, lang))
    mapping = ["-map", f"0:{idx}"] if idx is not None else ["-map", "0:a:0"]
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video), *mapping, "-vn", "-ac", "1", "-ar", "16000", str(wav)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return idx

# ---------- 2. embedded subtitles (fast path; text+timing, no speaker) ----------
def probe_sub_streams(video: Path) -> list[dict]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "s",
         "-show_entries", "stream=index:stream_tags=language", "-of", "json", str(video)],
        capture_output=True, text=True,
    ).stdout
    try:
        return json.loads(out).get("streams", [])
    except Exception:
        return []

def extract_subs(video: Path, stream_index: int, srt: Path) -> bool:
    r = subprocess.run(["ffmpeg", "-y", "-i", str(video), "-map", f"0:{stream_index}", str(srt)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return r.returncode == 0 and srt.exists() and srt.stat().st_size > 0

_BRACKET = re.compile(r'^\[([^\]]+)\]\s*')
_TAGS = re.compile(r'<[^>]+>')  # strip <i> etc.

def _split_speaker(text: str):
    """A leading [X]: capitalized X + dialogue after → (character, dialogue, is_annotation=False);
    lowercase X (sound/action: ridacchia, sospira) or X-only line → sound cue, no character."""
    m = _BRACKET.match(text)
    if not m:
        return None, text, False
    tag = m.group(1).strip()
    rest = text[m.end():].strip()
    # Proper character name: starts uppercase, ≤3 words, and there IS dialogue after it.
    is_name = tag[:1].isupper() and len(tag.split()) <= 3 and bool(rest)
    if is_name:
        return tag, rest, False
    return None, rest, (rest == "")  # sound cue; annotation-only if nothing remains

def parse_srt(srt: Path) -> list[dict]:
    """SRT -> [{start,end,text,sub_speaker?}] (seconds). Speaker names from [Name] brackets;
    pure sound-cue lines (no dialogue) are dropped."""
    def ts(t): h, m, rest = t.split(":"); s, ms = rest.split(","); return int(h)*3600+int(m)*60+int(s)+int(ms)/1000
    raws, cur = [], None
    for raw in srt.read_text(encoding="utf-8", errors="ignore").splitlines():
        raw = raw.strip()
        if "-->" in raw:
            a, b = [x.strip() for x in raw.split("-->")]; cur = {"start": ts(a), "end": ts(b), "text": ""}
        elif raw and cur is not None and not raw.isdigit():
            cur["text"] = (cur["text"] + " " + _TAGS.sub("", raw)).strip()
        elif not raw and cur is not None:
            if cur["text"]: raws.append(cur)
            cur = None
    if cur and cur["text"]: raws.append(cur)
    out = []
    for c in raws:
        spk, dialogue, is_ann = _split_speaker(c["text"])
        if is_ann or not dialogue:   # pure sound cue → not dialogue, skip
            continue
        row = {"start": c["start"], "end": c["end"], "text": dialogue}
        if spk:
            row["sub_speaker"] = spk
        out.append(row)
    return out

# ---------- 3. ASR via VoxStruct remote backend (Atelier whisper :8766) ----------
def asr_voxstruct(wav: Path, lang: str) -> list[dict]:
    try:
        from voxstruct.asr import get_asr_backend, RemoteHTTPBackend  # reads VOXSTRUCT_ASR_* env
    except Exception as e:
        sys.exit(f"[asr] VoxStruct not importable ({e}). Run me with VoxStruct's venv python.")
    # Load VoxStruct's .env (holds VOXSTRUCT_ASR_BACKEND=remote + URL) if present.
    vox_env = Path.home() / "Documents/code/VoxStruct/.env"
    if vox_env.is_file():
        try:
            from dotenv import load_dotenv; load_dotenv(vox_env, override=False)
        except Exception:
            pass
    be = get_asr_backend()
    if be is None:  # builtin (needs torch on-box) — force remote to the Atelier whisper sidecar instead
        url = os.getenv("VOXSTRUCT_ASR_URL") or os.getenv("CHIRON_WHISPER_URL") or "http://192.168.0.159:8766"
        be = RemoteHTTPBackend(base_url=url, token=os.getenv("VOXSTRUCT_ASR_TOKEN"),
                               model=os.getenv("VOXSTRUCT_ASR_MODEL") or os.getenv("CHIRON_WHISPER_MODEL") or "large-v3")
    res = be.transcribe(str(wav), language=lang, word_timestamps=True)
    segs = res.segments or []
    if not segs:  # fall back: one line from full text (no timing)
        return [{"start": 0.0, "end": 0.0, "text": res.text or ""}]
    return [{"start": float(s["start"]), "end": float(s["end"]), "text": s["text"].strip()} for s in segs if s.get("text")]

# ---------- 4. diarization via the Mac pyannote sidecar (:8767) ----------
def diarize(wav: Path, num_speakers: int | None = None) -> list[dict]:
    """
    POST the wav to the Atelier pyannote sidecar -> [{start,end,speaker}] speaker turns.
    Sidecar: pyannote/speaker-diarization-3.1 on the Mac (:8767), sibling of whisper (:8766).
    Graceful: returns [] if the sidecar is unreachable (every line becomes SPEAKER_??).
    """
    url = os.getenv("CHIRON_DIARIZE_URL", "http://192.168.0.159:8767") + "/diarize"
    import requests, time
    for attempt in range(3):  # survive a mid-run sidecar restart (RSS self-heal)
        try:
            with open(wav, "rb") as fh:
                data = {"num_speakers": str(num_speakers)} if num_speakers else {}
                r = requests.post(url, files={"file": ("audio.wav", fh, "audio/wav")},
                                  data=data, timeout=1800)
            r.raise_for_status()
            return r.json()          # {segments, embeddings, ...}
        except Exception as e:
            if attempt < 2:
                time.sleep(4 * (attempt + 1)); continue
            print(f"    [diarize] failed after retries ({e}) — speakers will be SPEAKER_??")
            return {"segments": [], "embeddings": {}}

# ---------- 5. merge speaker turns onto lines (max-overlap) ----------
def assign_speaker(line: dict, turns: list[dict]) -> str:
    if not turns:
        return "SPEAKER_??"
    best, best_ov = "SPEAKER_??", 0.0
    for t in turns:
        ov = max(0.0, min(line["end"], t["end"]) - max(line["start"], t["start"]))
        if ov > best_ov:
            best_ov, best = ov, t["speaker"]
    return best

# ---------- 5b. PER-SCENE attribution (the accurate path) ----------
def slice_wav(full_wav: Path, start: float, end: float, dst: Path) -> None:
    subprocess.run(["ffmpeg", "-y", "-ss", f"{start}", "-to", f"{end}", "-i", str(full_wav),
                    "-ac", "1", "-ar", "16000", str(dst)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def _cos(a, b):
    import math
    s = sum(x*y for x, y in zip(a, b))
    na = math.sqrt(sum(x*x for x in a)); nb = math.sqrt(sum(y*y for y in b))
    return s/(na*nb) if na and nb else 0.0

class VoiceRegistry:
    """Cross-scene + cross-EPISODE voice identity. Each per-scene local voice gets a global
    key gv + a 256-d embedding; anchored names (brackets / 1↔1 fill) are ground truth.
    `seed` = the PERSISTENT per-series cast (name→embeddings) loaded from disk, so a voice
    known from a prior episode is named even with no bracket this episode. `propagate` names
    un-anchored voices by matching to the nearest anchored/seed voice above a cosine thresh —
    one [Name] anywhere (this episode OR a saved one) names that voice everywhere."""
    def __init__(self, seed: list | None = None):
        self.emb: dict[str, list] = {}
        self.name: dict[str, str] = {}
        self.propagated: set[str] = set()
        self.seed = seed or []            # [(embedding, name)] from the saved series registry
    def add(self, gv: str, embedding, name: str | None):
        if embedding: self.emb[gv] = embedding
        if name: self.name[gv] = name
    def propagate(self, thresh: float = 0.5) -> int:
        """Name un-anchored voices by matching to anchored/seed references, with a WITHIN-SCENE
        distinctness constraint: the diarizer already separated a scene's voices, so two distinct
        voices in one scene must get two DIFFERENT names (never both 'Chiara'). Greedy 1:1 by sim."""
        import collections
        # references: name -> [exemplar embeddings]  (this-episode true anchors + persistent seed)
        refs: dict[str, list] = {}
        for g in list(self.name):
            if g in self.emb and g not in self.propagated:
                refs.setdefault(self.name[g], []).append(self.emb[g])
        for e, nm in self.seed:
            refs.setdefault(nm, []).append(e)
        if not refs:
            return 0
        def sim(e, name): return max((_cos(e, x) for x in refs[name]), default=-1.0)
        scene_unnamed = collections.defaultdict(list)
        for gv in self.emb:
            if gv not in self.name:
                scene_unnamed[gv.split(":", 1)[0]].append(gv)
        n = 0
        for scene, gvs in scene_unnamed.items():
            used = {self.name[g] for g in self.name           # names already taken in THIS scene
                    if g.split(":", 1)[0] == scene and g not in self.propagated}
            cands = sorted(((sim(self.emb[gv], nm), gv, nm) for gv in gvs for nm in refs),
                           reverse=True)
            done = set()
            for s, gv, nm in cands:
                if s < thresh or gv in done or nm in used:
                    continue
                self.name[gv] = nm; self.propagated.add(gv); used.add(nm); done.add(gv); n += 1
        return n
    def named_embeddings(self) -> dict:
        """{name: [embeddings]} for every named voice this episode — to persist to the series registry."""
        out: dict[str, list] = {}
        for gv, nm in self.name.items():
            if gv in self.emb:
                out.setdefault(nm, []).append(self.emb[gv])
        return out

def fill_from_present(scene_groups: list[dict], reg: "VoiceRegistry") -> int:
    """After voice-propagation, close each scene's last unknown by DEDUCTION (not a guess):
    if a scene has exactly ONE still-unnamed voice and exactly ONE of its Gemini
    characters_present is still unused → assign it. (e.g. bathroom: Chiara taken ⇒ the
    other voice must be Ludovica.)"""
    n = 0
    for i, g in enumerate(scene_groups, 1):
        chars = list(g.get("characters_present") or [])
        gvs = {ln.get("_gv") for ln in g["lines"] if ln.get("_gv")}
        named = {reg.name[gv] for gv in gvs if gv in reg.name}
        unnamed = [gv for gv in gvs if gv not in reg.name]
        unused = [c for c in chars if c not in named]
        if len(unnamed) == 1 and len(unused) == 1:
            reg.name[unnamed[0]] = unused[0]; reg.propagated.add(unnamed[0]); n += 1
    return n

# ---------- persistent per-series cast registry (name → voice embeddings) ----------
def series_registry_path(series: str) -> Path:
    return Path.home() / ".chiron" / "voice-registry" / f"{series}.json"

def load_series_registry(path: Path):
    """→ (seed:[(embedding,name)], existing:dict). Empty if none yet."""
    if path.is_file():
        d = json.loads(path.read_text(encoding="utf-8"))
        seed = [(e, name) for name, embs in d.get("voices", {}).items() for e in embs]
        return seed, d
    return [], {"voices": {}}

def save_series_registry(path: Path, existing: dict, new_named: dict, cap: int = 8) -> None:
    voices = existing.get("voices", {})
    for name, embs in new_named.items():
        voices.setdefault(name, []).extend(embs)
        voices[name] = voices[name][-cap:]      # keep the most recent N exemplars per character
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"voices": voices}, ensure_ascii=False), encoding="utf-8")

def attribute_scene(group: dict, full_wav: Path, td: Path, idx: int, reg: "VoiceRegistry") -> None:
    """Diarize ONLY this scene's clip (2-4 local voices) + get their embeddings; name locally
    from (a) [Name] brackets, (b) Gemini characters_present (1↔1). Registers each local voice
    (embedding + tentative name) for cross-scene propagation. Final char names set later."""
    lines = group["lines"]
    st, en = group.get("start"), group.get("end")
    if not lines or st is None or en is None:
        for ln in lines: ln["_gv"] = None; ln["_voce"] = None
        return
    clip = td / f"scene_{idx:03d}.wav"
    turns, embs = [], {}
    try:
        slice_wav(full_wav, float(st), float(en), clip)
        res = diarize(clip)                       # local speakers, clip-relative
        turns, embs = res.get("segments", []), res.get("embeddings", {})
    except Exception:
        pass
    for ln in lines:
        loc = {"start": ln["start"] - st, "end": ln["end"] - st}
        ln["_spk"] = assign_speaker(loc, turns)

    # (a) local anchor names from [Name] brackets
    votes: dict[str, dict[str, int]] = {}
    for ln in lines:
        if ln.get("sub_speaker") and ln["_spk"] != "SPEAKER_??":
            votes.setdefault(ln["_spk"], {}).setdefault(ln["sub_speaker"], 0)
            votes[ln["_spk"]][ln["sub_speaker"]] += 1
    name_map = {spk: max(v.items(), key=lambda kv: kv[1])[0] for spk, v in votes.items()}
    # (b) 1↔1 fill from Gemini characters_present (no risky guessing)
    chars = list(group.get("characters_present") or [])
    local = [s for s in {ln["_spk"] for ln in lines} if s != "SPEAKER_??"]
    unpinned = [s for s in local if s not in name_map]
    unused = [c for c in chars if c not in set(name_map.values())]
    if len(unpinned) == 1 and len(unused) == 1:
        name_map[unpinned[0]] = unused[0]

    # register each local voice globally (embedding + tentative name) for propagation
    voce, k = {}, 0
    for s in local:
        gv = f"{idx}:{s}"
        reg.add(gv, embs.get(s), name_map.get(s))
        if s not in name_map:
            k += 1; voce[s] = f"Voce {k}"
    for ln in lines:
        s = ln["_spk"]
        ln["_gv"] = f"{idx}:{s}" if s != "SPEAKER_??" else None
        ln["_voce"] = voce.get(s)
        ln.pop("_spk", None)

# ---------- 6. scene segmentation (silence-gap heuristic v1) ----------
def segment_scenes(lines: list[dict], gap_s: float = 4.0) -> list[list[dict]]:
    scenes, cur = [], []
    for i, ln in enumerate(lines):
        if cur and ln["start"] - cur[-1]["end"] > gap_s:
            scenes.append(cur); cur = []
        cur.append(ln)
    if cur: scenes.append(cur)
    return scenes

# ---------- 7. name the diarized voices from the subtitle [Name] labels ----------
def label_speakers(lines: list[dict], user_map: dict,
                   dominant_frac: float = 0.30, dominant_min_votes: int = 4) -> dict:
    """Vote a character name per diarized speaker from lines carrying BOTH a diarized
    speaker and a subtitle [Name], propagating across the voice cluster.

    GUARD (fixes the E01 'Camilla=50%' mislabel): if a cluster is implausibly DOMINANT
    (>dominant_frac of all lines) it's likely an over-merged/uncertain cluster — only
    trust its name if it has strong vote support (>=dominant_min_votes); else leave it
    SPEAKER_xx rather than bleed one stray name across half the episode."""
    total = len(lines) or 1
    size: dict[str, int] = {}
    votes: dict[str, dict[str, int]] = {}
    for ln in lines:
        spk, name = ln.get("speaker"), ln.get("sub_speaker")
        if not spk or spk == "SPEAKER_??":
            continue
        size[spk] = size.get(spk, 0) + 1
        if name:
            votes.setdefault(spk, {}).setdefault(name, 0)
            votes[spk][name] += 1
    name_map = {}
    for spk, v in votes.items():
        name, count = max(v.items(), key=lambda kv: kv[1])
        if size.get(spk, 0) > dominant_frac * total and count < dominant_min_votes:
            continue  # dominant cluster + weak evidence → don't name it
        name_map[spk] = name
    name_map.update(user_map)  # explicit --speaker-map wins
    return name_map

def group_by_brackets(lines: list[dict], brackets: list[dict]) -> list[dict]:
    """Assign each dialogue line to a scene bracket (by line midpoint); returns
    [{...bracket meta, lines:[...]}] dropping empties."""
    groups = [{**b, "lines": []} for b in brackets]
    if not groups:
        return [{"lines": lines}]
    for ln in lines:
        mid = (ln["start"] + ln["end"]) / 2
        g = next((g for g in groups if g["start"] <= mid < g["end"]), None)
        if g is None:  # before first / after last → nearest edge bucket
            g = groups[0] if mid < groups[0]["start"] else groups[-1]
        g["lines"].append(ln)
    return [g for g in groups if g["lines"]]

# ---------- 8. emit ----------
def build_transcript(scene_groups, name_map, lang, video_summary=None) -> dict:
    out_scenes = []
    for si, g in enumerate(scene_groups, 1):
        sc = g["lines"]
        if not sc:
            continue
        out_lines = []
        for ln in sc:
            spk = ln.get("speaker", "SPEAKER_??")
            # per-scene attribution sets ln['character'] directly; else global name_map.
            character = ln.get("character") or name_map.get(spk) or ln.get("sub_speaker") or spk
            out_lines.append({
                "start": round(ln["start"], 2), "end": round(ln["end"], 2),
                "character": character,
                "italian_text": ln["text"],
                "en_gloss": None,        # filled by the enrichment chain (Phase 2)
                "teaching_note": None,   # filled by the enrichment chain (Phase 2)
            })
        out_scenes.append({
            "scene": si,
            "start": round(g.get("start", sc[0]["start"]), 2),
            "end": round(g.get("end", sc[-1]["end"]), 2),
            "title": g.get("name"),                 # from Gemini scene brackets
            "situation": g.get("summary"),          # Gemini scene summary
            "location": g.get("location"),
            "visual_situation": None,               # Phase 2 (per-scene VLM/gesture pass)
            "characters_present": g.get("characters_present", []),
            "target_structures": [], "prebrief_audio": None, "debrief_audio": None,
            "lines": out_lines,
        })
    return {"language": lang, "source_kind": "video-episode",
            "video_summary": video_summary, "scenes": out_scenes}


def main():
    ap = argparse.ArgumentParser(description="Chiron video-episode voice-first ingest")
    ap.add_argument("video")
    ap.add_argument("--out", default="./episode-out")
    ap.add_argument("--lang", default="it")
    ap.add_argument("--speaker-map", default="", help="SPEAKER_00=Lucia,SPEAKER_01=Marco")
    ap.add_argument("--srt", default="", help="use this .srt directly (e.g. the sibling .it.srt) for text+timing+[Name]s")
    ap.add_argument("--no-asr-if-subs", action="store_true", help="use embedded subs when present, skip ASR")
    ap.add_argument("--audio-lang", default="", help="audio track language to diarize (default = --lang)")
    ap.add_argument("--scenes", default="", help="scenes.json from scene_brackets.py (PySceneDetect+Gemini); overrides --gap")
    ap.add_argument("--gap", type=float, default=8.0, help="fallback scene-break silence gap (s) when no --scenes")
    ap.add_argument("--series", default="", help="series name for the PERSISTENT cast voice registry (default: derived from filename)")
    ap.add_argument("--registry", default="", help="override path to the series voice-registry json")
    ap.add_argument("--voice-thresh", type=float, default=0.5, help="cosine threshold for cross-scene/episode voice match")
    args = ap.parse_args()

    video = Path(args.video).expanduser().resolve()
    if not video.is_file(): sys.exit(f"no such video: {video}")
    outdir = Path(args.out).expanduser().resolve(); outdir.mkdir(parents=True, exist_ok=True)
    smap = dict(kv.split("=", 1) for kv in args.speaker_map.split(",") if "=" in kv)
    audio_lang = args.audio_lang or args.lang

    with tempfile.TemporaryDirectory(prefix="chiron_ep_") as td:
        td = Path(td)
        print(f"[1] extracting {audio_lang} audio track…"); wav = td / "audio.wav"
        idx = extract_audio(video, wav, lang=audio_lang)
        print(f"    -> audio stream {idx if idx is not None else '0:a:0 (fallback)'}")

        lines = None
        if args.srt:
            srtpath = Path(args.srt).expanduser().resolve()
            if not srtpath.is_file(): sys.exit(f"no such srt: {srtpath}")
            print(f"[2] using provided subtitles: {srtpath.name}")
            lines = parse_srt(srtpath)
        else:
            subs = probe_sub_streams(video)
            it_sub = next((s for s in subs if (s.get("tags", {}).get("language", "") or "").startswith(args.lang)), None)
            if args.no_asr_if_subs and it_sub is not None:
                srt = td / "subs.srt"
                if extract_subs(video, it_sub["index"], srt):
                    print(f"[2] using embedded '{args.lang}' subtitles (stream {it_sub['index']})")
                    lines = parse_srt(srt)
        if lines is None:
            print("[3] ASR via VoxStruct remote (Atelier whisper :8766)…")
            lines = asr_voxstruct(wav, args.lang)
        named = sum(1 for l in lines if l.get("sub_speaker"))
        print(f"    -> {len(lines)} dialogue lines ({named} carry a [Name] speaker)")

        vsum = None
        if args.scenes:
            # PER-SCENE path: group into scenes first, then diarize+name each scene clip.
            sj = json.loads(Path(args.scenes).expanduser().read_text(encoding="utf-8"))
            vsum = sj.get("video_summary")
            scene_groups = group_by_brackets(lines, sj.get("scenes", []))
            # PERSISTENT per-series cast registry — build once, reuse across episodes.
            series = args.series or re.split(r"\s*-\s*S\d", video.name)[0].strip() or "unknown"
            regpath = Path(args.registry).expanduser() if args.registry else series_registry_path(series)
            seed, existing = load_series_registry(regpath)
            print(f"[4] per-scene diarization + attribution over {len(scene_groups)} scenes "
                  f"(series='{series}', {len(existing.get('voices',{}))} known voices)…")
            reg = VoiceRegistry(seed=seed)
            for i, g in enumerate(scene_groups, 1):
                attribute_scene(g, wav, td, i, reg)
            print("[5] cross-scene + cross-episode voice matching…")
            prop = reg.propagate(thresh=args.voice_thresh)
            deduced = fill_from_present(scene_groups, reg)   # close each scene's last 1↔1 by deduction
            save_series_registry(regpath, existing, reg.named_embeddings())
            print(f"    -> {len(reg.name)} voices named ({prop} by voice, {deduced} by scene-deduction) · registry saved: {regpath}")
            for g in scene_groups:            # final per-line character
                for ln in g["lines"]:
                    ln["character"] = (ln.get("sub_speaker") or reg.name.get(ln.get("_gv"))
                                       or ln.get("_voce") or "?")
                    ln.pop("_gv", None); ln.pop("_voce", None)
            allln = [ln for g in scene_groups for ln in g["lines"]]
            def _isname(c): return c[:1].isupper() and not c.startswith("Voce") and c != "?"
            named = sum(1 for ln in allln if _isname(ln["character"]))
            print(f"    -> {named}/{len(allln)} lines have a real name ({100*named//max(1,len(allln))}%)")
            transcript = build_transcript(scene_groups, {}, args.lang, video_summary=vsum)
        else:
            # LEGACY path: whole-episode diarization + global naming + silence-gap scenes.
            print("[4] whole-episode diarization (pyannote community-1, MPS)…")
            turns = diarize(wav).get("segments", [])
            print(f"    -> {len(turns)} speaker turns" + ("  [no pyannote — SPEAKER_??]" if not turns else ""))
            for ln in lines: ln["speaker"] = assign_speaker(ln, turns)
            smap = label_speakers(lines, smap)
            if smap: print(f"    -> named voices: {smap}")
            scene_groups = [{"lines": g} for g in segment_scenes(lines, gap_s=args.gap)]
            print(f"[6] {len(scene_groups)} scenes (silence-gap {args.gap}s)")
            transcript = build_transcript(scene_groups, smap, args.lang)

    out = outdir / "transcript.json"
    out.write_text(json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8")
    n_lines = sum(len(s["lines"]) for s in transcript["scenes"])
    speakers = sorted({l["character"] for s in transcript["scenes"] for l in s["lines"]})
    print(f"\n[8] wrote {out}")
    print(f"    scenes={len(transcript['scenes'])} lines={n_lines} speakers={speakers}")
    if any(sp == "SPEAKER_??" for sp in speakers):
        print("    NOTE: speakers unresolved — wire pyannote (stage 4) or pass --speaker-map.")


if __name__ == "__main__":
    main()
