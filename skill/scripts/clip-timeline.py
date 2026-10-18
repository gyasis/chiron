#!/usr/bin/env python3
"""clip-timeline.py — derive summary/shortened subtitle timelines from audio-scripts.json + the baked mp3"""
# Usage: clip-timeline.py [--root ~/Documents/generated] [--only SUBSTR] [--dry]
# Writes audio/{summary,shortened}.timeline.json next to each mp3 (and in chiron-library/lessons/<id>/audio/ if present).
# Method: silencedetect gives speech starts; DP snaps the N-1 segment boundaries to silence ends nearest
# the text-length-proportional expectation (gaps weighted by gapAfter class). Boundaries with no silence
# within reach fall back to the proportional position. If too few snap, the file is "approx": true.
import json, os, re, subprocess, sys, glob, shutil
GAPMS = {"word": 60, "clause": 400, "sentence": 900, "paragraph": 1800}
GAP_SCALE = 0.4  # observed baked silences are ~0.3-0.5 s, well under nominal ms; weight gaps down

def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode())

def silences(p, noise, d):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", p, "-af", f"silencedetect=noise={noise}dB:d={d}", "-f", "null", "-"], capture_output=True, text=True).stderr
    s = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r)]
    e = [(float(a), float(b)) for a, b in re.findall(r"silence_end: ([\d.]+) \| silence_duration: ([\d.]+)", r)]
    return [(en - du, en) for en, du in e]  # (silence_start, speech_start)

def align(segs, D, sil):
    n = len(segs)
    w = [max(len(s["text"]), 1) for s in segs]
    g = [GAPMS.get(s.get("gapAfter", "sentence"), 900) / 1000 * GAP_SCALE * 15 for s in segs]  # gap in char-equivalents (15 ch/s)
    tot = sum(w) + sum(g[:-1])
    exp, c = [0.0], 0.0
    for i in range(n - 1):
        c += w[i] + g[i]
        exp.append(D * c / tot)  # expected start of segment i+1
    # candidates: speech start after each silence; DP monotone assignment of boundaries 1..n-1
    cand = [b for _, b in sil if 0.2 < b < D - 0.2]
    reach = max(2.0, D / n * 0.6)
    INF = 1e18
    # state: boundary i assigned to cand j or None (proportional). cost: snapped = (cand-exp)^2 ; None = reach^2 *1.0
    best = [{} for _ in range(n)]  # best[i][j] = (cost, prev_j) ; j=-1 means none
    prevpos = lambda j: cand[j] if j >= 0 else None
    best[0] = {-2: (0.0, None)}
    for i in range(1, n):
        cur = {}
        for pj, (pc, _) in best[i - 1].items():
            # none
            k = (pj if pj != -2 else -2)
            cost = pc + reach ** 2
            if -1 not in cur or cost < cur[-1][0]:
                cur[-1] = (cost, pj)
            lo = pj if pj >= 0 else (max([x for x in best[i - 1] if x >= 0], default=-1))
            for j, cv in enumerate(cand):
                if pj >= 0 and j <= pj: continue
                if abs(cv - exp[i]) > reach: continue
                cost = pc + (cv - exp[i]) ** 2
                if j not in cur or cost < cur[j][0]:
                    cur[j] = (cost, pj)
        best[i] = cur
    # backtrack (track "last real candidate" is approximated: none-state carries pj of predecessor)
    j = min(best[n - 1], key=lambda x: best[n - 1][x][0]) if n > 1 else -2
    assign = [None] * n
    for i in range(n - 1, 0, -1):
        cost, pj = best[i][j]
        assign[i] = cand[j] if j >= 0 else None
        j = pj
    return exp, assign

def build(segs, D, sil):
    n = len(segs)
    exp, assign = align(segs, D, sil)
    starts, snapped, drift = [0.0], 0, 0.0
    for i in range(1, n):
        a = assign[i]
        if a is not None and a > starts[-1]:
            starts.append(a); snapped += 1; drift = max(drift, abs(a - exp[i]))
        else:
            starts.append(max(exp[i], starts[-1] + 0.05))
    approx = n > 1 and snapped / (n - 1) < 0.5
    if approx:
        starts = [max(e, 0.0) for e in exp]
    return starts, snapped, drift, approx

def process(audio_dir, scripts, lessonid, kind, extra_dirs, dry):
    mp3 = os.path.join(audio_dir, f"{kind}.mp3")
    segs = scripts.get(kind)
    if not os.path.exists(mp3) or not segs:
        return None
    D = dur(mp3)
    sil = silences(mp3, -35, 0.12)
    starts, snapped, drift, approx = build(segs, D, sil)
    out = {"durationS": round(D, 2)}
    if approx: out["approx"] = True
    out["timeline"] = [{"t": round(t, 1), "who": "target" if s["lang"] == "it" else "cue", "text": s["text"]} for t, s in zip(starts, segs)]
    if not dry:
        for d in [audio_dir] + extra_dirs:
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, f"{kind}.timeline.json"), "w") as f:
                json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{lessonid[:60]} {kind} segs={len(segs)} intervals={len(sil)} snapped={snapped}/{max(len(segs)-1,0)} method={'approx' if approx else 'aligned'} maxdrift={drift:.1f}s", flush=True)
    return "approx" if approx else "aligned"

def main():
    a = sys.argv[1:]
    root = os.path.expanduser("~/Documents/generated")
    only = a[a.index("--only") + 1] if "--only" in a else None
    dry = "--dry" in a
    lib = os.path.join(root, "chiron-library", "lessons")
    counts = {"aligned": 0, "approx": 0}; skipped = []
    for ld in sorted(glob.glob(os.path.join(root, "*/"))):
        lid = os.path.basename(ld.rstrip("/"))
        if lid == "chiron-library" or (only and only not in lid): continue
        ad = os.path.join(ld, "audio")
        if not (os.path.exists(os.path.join(ad, "summary.mp3")) or os.path.exists(os.path.join(ad, "shortened.mp3"))): continue
        sp = next((p for p in (os.path.join(ad, "audio-scripts.json"), os.path.join(ld, "audio-scripts.json")) if os.path.exists(p)), None)
        if not sp: skipped.append(lid + " (no audio-scripts.json)"); continue
        try: scripts = json.load(open(sp))
        except Exception as e: skipped.append(f"{lid} (bad json {e})"); continue
        if not (scripts.get("summary") or scripts.get("shortened")): skipped.append(lid + " (no summary/shortened keys)"); continue
        extra = [os.path.join(lib, lid, "audio")] if os.path.isdir(os.path.join(lib, lid, "audio")) else []
        for kind in ("summary", "shortened"):
            r = process(ad, scripts, lid, kind, extra, dry)
            if r: counts[r] += 1
    print("TOTAL", counts, "skipped", len(skipped))
    for s in skipped: print("SKIP", s)

main()
