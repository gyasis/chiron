#!/usr/bin/env python3
"""Ingest a lesson recording through the Modal ASR lane — no Mac Studio required.

    python3 modal_ingest.py ~/Downloads/Day_6.m4a --day 6
    python3 modal_ingest.py ~/Downloads/Day_6.m4a --day 6 --num-speakers 2

Drop-in alternative to `ingest_recording.py` for the case where whisper :8766 and
pyannote :8767 are unreachable. It emits the SAME three artifacts, so `ingest-review.html`,
`serve.py`'s /ingest-confirm and `pain_points.py` all work unchanged:

    day<N>/ingest.json        speaker clusters, proposed names + confidence, language split
    day<N>/transcript.json    every turn: start, end, speaker, lang, text
    day<N>/snippets/*.mp3     2-3 clean exemplars per cluster for the review form

razer drives, because it holds the Modal auth. This Mac only ships the file and reads results.

The review form is still the gate (R-IC4b). Nothing here decides who is who — it PROPOSES
names by cosine against the series voice registry and reports the confidence. An inverted map
teaches your own mistakes back to you as correct Italian, so a human confirms it, once.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAZER = "razer"
REMOTE = "/tmp/il-centro-asr"
REGISTRY = "~/.chiron/voice-registry/il-centro.json"
THRESH = 0.5                      # cosine floor for auto-naming; below this the form asks


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kw)


def ssh(script: str) -> str:
    """Run on razer, and on failure SHOW the remote stderr.

    A bare check=True raises CalledProcessError carrying only the command line, so a real
    remote traceback (a bad kwarg, a missing model, an auth error) surfaces as an opaque
    'returned non-zero exit status 1' and has to be reproduced by hand to be read at all.
    """
    p = subprocess.run(["ssh", "-o", "ConnectTimeout=20", RAZER, script],
                       text=True, capture_output=True)
    if p.returncode:
        print(f"\n  remote command failed (exit {p.returncode}):\n{script}\n")
        print((p.stderr or p.stdout or "").strip()[-2000:])
        raise SystemExit(1)
    return p.stdout


# Runs on razer: call the deployed Modal function, cut snippets, match the registry.
DRIVER = r'''#!/usr/bin/env python3
import json, os, subprocess, sys

src, out, n_spk = sys.argv[1], sys.argv[2], int(sys.argv[3])
os.makedirs(f"{out}/snippets", exist_ok=True)

import modal
fn = modal.Function.from_name("il-centro-asr", "transcribe_diarize")
r = fn.remote(open(src, "rb").read(), n_spk, src.rsplit(".", 1)[-1])
segs = r["segments"]
json.dump(r, open(f"{out}/raw.json", "w"), ensure_ascii=False)

# --- propose names from the series registry (same cosine rule as episode_ingest) ---
reg_path = os.path.expanduser("~/.chiron/voice-registry/il-centro.json")
reg = json.load(open(reg_path))["voices"] if os.path.exists(reg_path) else {}


def cos(a, b):
    s = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return s / (na * nb) if na and nb else 0.0


def best_name(e):
    hit, sc = None, 0.0
    for name, exemplars in reg.items():
        ex = exemplars if exemplars and isinstance(exemplars[0], list) else [exemplars]
        for v in ex:
            c = cos(e, v)
            if c > sc:
                hit, sc = name, c
    return hit, round(sc, 3)


clusters = []
for spk in sorted({s["speaker"] for s in segs}):
    mine = [s for s in segs if s["speaker"] == spk]
    talk = sum(s["end"] - s["start"] for s in mine)
    it = sum(1 for s in mine if s["lang"] == "it")
    emb = r["embeddings"].get(spk)
    name, conf = best_name(emb) if emb else (None, 0.0)
    # Clean exemplars only: 3-6s, and no neighbouring turn from the other speaker within
    # 0.3s, so the reviewer hears one voice rather than crosstalk.
    cand = []
    for i, s in enumerate(mine):
        d = s["end"] - s["start"]
        if not (3.0 <= d <= 6.0):
            continue
        j = segs.index(s)
        prv = segs[j - 1] if j else None
        nxt = segs[j + 1] if j + 1 < len(segs) else None
        if prv and prv["speaker"] != spk and s["start"] - prv["end"] < 0.3:
            continue
        if nxt and nxt["speaker"] != spk and nxt["start"] - s["end"] < 0.3:
            continue
        cand.append(s)
        if len(cand) == 3:
            break
    snips = []
    for k, s in enumerate(cand):
        f = f"snippets/{spk}-{k}.mp3"
        subprocess.run(["ffmpeg", "-y", "-ss", str(s["start"]), "-t",
                        str(round(s["end"] - s["start"], 2)), "-i", src,
                        "-ac", "1", "-b:a", "96k", f"{out}/{f}"],
                       check=True, capture_output=True)
        snips.append({"file": f, "t": round(s["start"], 1), "text": s["text"][:120]})
    clusters.append({"speaker": spk, "turns": len(mine), "talk_s": round(talk, 1),
                     "italian_pct": round(100 * it / max(len(mine), 1)),
                     "proposed": name, "confidence": conf, "snippets": snips})

m = r["meta"]
ingest = {"recording": src, "series": "il-centro", "expected_speakers": n_spk,
          "found_speakers": len(clusters), "model": m["model"], "turns": m["n_turns"],
          "speech_s": round(sum(s["end"] - s["start"] for s in segs), 1),
          "lang_split": m["lang_split"], "clusters": clusters,
          "confirmed": False, "speaker_names": {},
          "engine": "modal", "asr_s": m["asr_s"]}
json.dump(ingest, open(f"{out}/ingest.json", "w"), ensure_ascii=False, indent=1)
json.dump(segs, open(f"{out}/transcript.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({"turns": m["n_turns"], "speakers": len(clusters),
                  "lang": m["lang_split"], "asr_s": m["asr_s"],
                  "proposed": {c["speaker"]: [c["proposed"], c["confidence"]]
                               for c in clusters}}))
'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--day", required=True)
    ap.add_argument("--num-speakers", type=int, default=2)
    a = ap.parse_args()

    src = os.path.expanduser(a.audio)
    if not os.path.exists(src):
        print(f"  {src} not found"); return 1
    mb = os.path.getsize(src) / 1e6
    base = os.path.basename(src)
    rd = f"{REMOTE}/day-{a.day}"
    print(f"il centro — ingest Day {a.day} via Modal  ({base}, {mb:.0f} MB, "
          f"{a.num_speakers} speakers)\n")

    print("1/4 ship the recording to razer")
    ssh(f"mkdir -p {rd}")
    sh(["scp", "-q", src, f"{RAZER}:{rd}/{base}"])
    os.makedirs(f"{HERE}/.bake", exist_ok=True)
    open(f"{HERE}/.bake/asr_driver.py", "w").write(DRIVER)
    sh(["scp", "-q", f"{HERE}/.bake/asr_driver.py", f"{RAZER}:{rd}/driver.py"])

    print("2/4 diarize + per-turn transcribe on an L4 (slow step)")
    out = ssh(f"cd {rd} && python3 driver.py {rd}/{base} {rd}/out {a.num_speakers}")
    line = [l for l in out.strip().splitlines() if l.startswith("{")]
    if not line:
        print("  no result:\n" + out[-800:]); return 1
    r = json.loads(line[-1])
    print(f"  {r['turns']} turns · {r['speakers']} speakers · {r['asr_s']}s compute")
    print(f"  language split: {r['lang']}")
    for spk, (name, conf) in r["proposed"].items():
        tag = f"{name} {conf}" if name and conf >= THRESH else f"UNKNOWN ({name} {conf})"
        print(f"    {spk:12} → {tag}")

    print("\n3/4 pull results back")
    dst = f"{HERE}/day{a.day}"
    os.makedirs(dst, exist_ok=True)
    sh(["scp", "-q", "-r", f"{RAZER}:{rd}/out/.", dst])

    # A collapsed split is the failure mode per-turn decoding exists to prevent — say so
    # loudly rather than letting a mangled transcript reach the lesson.
    tot = sum(r["lang"].values()) or 1
    if max(r["lang"].values()) / tot > 0.95:
        print("\n  WARNING: >95% of turns landed in one language — detection likely collapsed.")

    print(f"\n4/4 review the mapping before anything is built on it")
    print(f"  http://localhost:8010/ingest-review.html?day={a.day}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
