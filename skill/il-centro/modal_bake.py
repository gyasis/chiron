#!/usr/bin/env python3
"""Bake a day's audio with NO Mac Studio — Modal's cloud L4 does the synthesis.

    python3 modal_bake.py 6
    python3 modal_bake.py 6 --dry-run        # build + report the job, ship nothing

Why this exists: `bake_day.py` preflights the Studio sidecars (omnivoice :8770) and refuses
to start without them. But omnivoice was never the only lane — chiron also deploys the SAME
OmniVoice weights and the SAME Lucrezia refs to Modal (`chiron-bake` / `bake_lesson`, L4).
So when the Studio is unreachable — a different network, a reboot, travel — the audio is not
actually blocked. This is that fallback, wired end to end.

    Mac (here)                     razer                          Modal (cloud L4)
    build job.json  ──scp──>  modal_synth.py  ──remote()──>  bake_lesson
                              tts-normalize -16   <──wavs──
                              tts-splice
    .audio-src/day-N  <──scp──  mp3s

razer is the driver because it holds the Modal auth (`~/.modal.toml`) and the refs directory
that the deployed image was built from. This Mac never needs either.

BOUNDARY (standing instruction): nothing here touches chiron. `modal_synth.py` and
`chiron_bake.py` are called as they are and are never edited — this is a new caller of a
working lane, not a change to it.

Output is byte-identical in shape to a Studio bake: `.audio-src/day-<N>/` with
`lecture/{podcast,summary,shortened}.mp3`, `lecture/<sec-id>.mp3` and `<pid>.mp3`, which is
exactly what `bake_day.py` steps 5–6 expect. Run this, then `python3 bake_day.py <N>`.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAZER = "razer"
REMOTE = "/tmp/il-centro-bake"
# Filenames inside the deployed image (chiron_bake.py mounts refs/ at /root/refs) plus the
# reference transcript OmniVoice conditions on. Both taken from the refs dir on razer.
REFS = {
    "it": {"wav": "lucrezia_italian_ref.wav",
           "txt": "Ciao a tutti e bentornati sul mio canale, oppure benvenuti se questo è "
                  "il primo video che guardate qui sul mio canale."},
    "en": {"wav": "lucrezia_english_ref.wav",
           "txt": "Hi everyone, and welcome back to my channel!"},
}


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kw)


def ssh(script: str) -> str:
    """Run a shell snippet on razer, and on failure SHOW the remote stderr.

    check=True with capture_output discards the remote traceback and reports only
    'returned non-zero exit status 1', which has to be reproduced by hand to be read at all.
    """
    p = subprocess.run(["ssh", "-o", "ConnectTimeout=15", RAZER, script],
                       text=True, capture_output=True)
    if p.returncode:
        print(f"\n  remote command failed (exit {p.returncode}):\n{script}\n")
        print((p.stderr or p.stdout or "").strip()[-2000:])
        raise SystemExit(1)
    return p.stdout


def build_job(day: str) -> tuple[dict, list[str], dict]:
    """Assemble the Modal job from the day's two data modules.

    Sections map 1:1 to what the page needs: `summary`, `shortened`, one per `sec-*`, and a
    flat `phrase` list. Segment order inside a section is preserved by the Modal side, so the
    index is the join key on the way back.
    """
    sys.path.insert(0, HERE)
    data = importlib.import_module(f"day{day}_data")
    scripts = importlib.import_module(f"audio_scripts_day{day}")

    sections: dict[str, list[dict]] = {
        "summary": [{"lang": s["lang"], "text": s["text"]} for s in scripts.SUMMARY],
        "shortened": [{"lang": s["lang"], "text": s["text"]} for s in scripts.SHORTENED],
    }
    gaps: dict[str, list[str]] = {
        "summary": [s.get("gapAfter", "clause") for s in scripts.SUMMARY],
        "shortened": [s.get("gapAfter", "clause") for s in scripts.SHORTENED],
    }
    for sid, segs in scripts.SECTIONS.items():
        sections[sid] = [{"lang": s["lang"], "text": s["text"]} for s in segs]
        gaps[sid] = [s.get("gapAfter", "clause") for s in segs]

    # The errori track is a top-level list rather than a SECTIONS entry (it is built from the
    # recording, not from a chapter), so it has to be picked up explicitly or it silently
    # never gets baked.
    if getattr(scripts, "ERRORI", None):
        sections["sec-errori"] = [{"lang": s["lang"], "text": s["text"]} for s in scripts.ERRORI]
        gaps["sec-errori"] = [s.get("gapAfter", "clause") for s in scripts.ERRORI]

    # Phrase clips: the spoken form, Italian, one file each. `speak` (not `display`) is what
    # gets voiced — display carries the article/markup the page wants and the voice doesn't.
    pids: list[str] = []
    phrase: list[dict] = []
    for _sid, _title, rows in data.CHAPTERS:
        for pid, _disp, speak, _en, _note in rows:
            pids.append(pid)
            phrase.append({"lang": "it", "text": speak})

    # CHIESTE render with `chiron-has-audio` exactly like chapter phrases, so they need clips
    # too — otherwise the page shows play buttons that resolve to nothing. Their tuple is
    # (pid, italian, english, note): there is no separate `speak` form, the Italian IS spoken.
    for pid, it_text, _en, _note in getattr(data, "CHIESTE", []):
        pids.append(pid)
        phrase.append({"lang": "it", "text": it_text})

    sections["phrase"] = phrase

    job = {"slug": f"il-centro-day-{day}", "num_step": 48, "bucket": 8,
           "refs": REFS, "sections": sections}
    return job, pids, gaps


REMOTE_POST = r'''#!/usr/bin/env python3
"""Runs ON razer: normalize every synthesized wav, splice sections, encode mp3.

R-IC7 — tts-normalize -16 (BS.1770-4 / RMS fallback under 0.4s) then tts-splice.
Never ffmpeg loudnorm: single-pass loudnorm is unstable on the 1-2s clips this
series is full of, which is what produced the 37 dB spread that had to be redone.
"""
import json, os, subprocess, sys

PRE, OUT = sys.argv[1], sys.argv[2]
meta = json.load(open(sys.argv[3]))
GAP = meta["gap_ms"]; GAPS = meta["gaps"]; PIDS = meta["pids"]; ORDER = meta["order"]

os.makedirs(f"{OUT}/lecture", exist_ok=True)
norm_dir = f"{PRE}/_norm"; os.makedirs(norm_dir, exist_ok=True)


def norm(src, dst):
    """Normalize to -16 LUFS, or report False so the caller skips this segment.

    Single bare words ("vivere", "money", "vado") intermittently come back as a 44-byte
    header-only wav. The size check has to happen BEFORE tts-normalize, not after: given an
    empty file pyloudnorm dies with `zero-size array to reduction operation maximum`, and
    with check=True that aborted the whole post-processing run AFTER a paid synth had
    already completed. One missing word must never cost the other 262 clips.
    """
    if os.path.getsize(src) <= 1000:
        return False
    try:
        subprocess.run(["tts-normalize", src, dst, "-16"], check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        print(f"    normalize failed on {src}: {(e.stderr or b'').decode()[-120:].strip()}")
        return False
    return os.path.exists(dst) and os.path.getsize(dst) > 1000


def splice(sid, dst_wav):
    d = f"{PRE}/{sid}"
    if not os.path.isdir(d):
        return False
    idx = sorted(int(f[:-4]) for f in os.listdir(d) if f.endswith(".wav"))
    lines = []
    for i in idx:
        s, n = f"{d}/{i}.wav", f"{norm_dir}/{sid}-{i}.wav"
        if not norm(s, n):
            print(f"    skip empty {sid}[{i}]")
            continue
        g = GAP.get(GAPS.get(sid, [])[i] if i < len(GAPS.get(sid, [])) else "clause", 400)
        lines.append(f"{n}|{g}")
    if not lines:
        return False
    man = f"{norm_dir}/{sid}.manifest"
    open(man, "w").write("\n".join(lines) + "\n")
    subprocess.run(["tts-splice", dst_wav, "--manifest", man], check=True, capture_output=True)
    return True


def mp3(wav, dst):
    subprocess.run(["ffmpeg", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "96k",
                    "-ac", "1", dst], check=True, capture_output=True)


made = []
for sid in ORDER:
    w = f"{norm_dir}/{sid}.spliced.wav"
    if splice(sid, w):
        mp3(w, f"{OUT}/lecture/{sid}.mp3")
        made.append(sid)
        print(f"  lecture/{sid}.mp3")

# Phrase clips stay individual — no splice, just normalize + encode.
pd = f"{PRE}/phrase"
n_ph = 0
if os.path.isdir(pd):
    for i, pid in enumerate(PIDS):
        src = f"{pd}/{i}.wav"
        if not os.path.exists(src):
            continue
        n = f"{norm_dir}/ph-{i}.wav"
        if not norm(src, n):
            print(f"    skip empty phrase {pid}")
            continue
        mp3(n, f"{OUT}/{pid}.mp3")
        n_ph += 1
print(f"  {n_ph}/{len(PIDS)} phrase clips")

# Podcast: summary then every section in page order, one continuous file. A single track is
# what makes screen-off playback work — swapping audio.src is blocked once backgrounded.
parts = [f"{norm_dir}/{s}.spliced.wav" for s in ORDER
         if s != "shortened" and os.path.exists(f"{norm_dir}/{s}.spliced.wav")]
if parts:
    subprocess.run(["tts-splice", f"{norm_dir}/podcast.wav", "1800"] + parts,
                   check=True, capture_output=True)
    mp3(f"{norm_dir}/podcast.wav", f"{OUT}/lecture/podcast.mp3")
    print(f"  lecture/podcast.mp3 ({len(parts)} parts)")
print(json.dumps({"sections": made, "phrases": n_ph}))
'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("day", nargs="?", default="6")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    day = a.day

    job, pids, gaps = build_job(day)
    scripts = importlib.import_module(f"audio_scripts_day{day}")
    order = ["summary", "shortened"] + [s for s in scripts.SECTIONS]
    if getattr(scripts, "ERRORI", None):
        order.append("sec-errori")
    n = sum(len(v) for v in job["sections"].values())
    print(f"il centro — Day {day} bake via Modal (no Studio needed)\n")
    for sid in order + ["phrase"]:
        print(f"  {sid:22} {len(job['sections'][sid]):4} segments")
    print(f"  {'TOTAL':22} {n:4}\n")
    if a.dry_run:
        print("  --dry-run: nothing shipped")
        return 0

    meta = {"gap_ms": scripts.GAP_MS, "gaps": gaps, "pids": pids, "order": order}
    jd = f"{HERE}/.bake"
    os.makedirs(jd, exist_ok=True)
    json.dump(job, open(f"{jd}/job.json", "w"), ensure_ascii=False)
    json.dump(meta, open(f"{jd}/meta.json", "w"), ensure_ascii=False)
    open(f"{jd}/post.py", "w").write(REMOTE_POST)

    print("1/4 ship to razer")
    ssh(f"mkdir -p {REMOTE}/day-{day}")
    sh(["scp", "-q", f"{jd}/job.json", f"{jd}/meta.json", f"{jd}/post.py",
        f"{RAZER}:{REMOTE}/day-{day}/"])

    print(f"2/4 synth on Modal L4 ({n} segments) — this is the slow step")
    out = ssh(f"cd {REMOTE}/day-{day} && python3 "
              f"$HOME/Documents/code/chiron/skill/modal/modal_synth.py job.json prefetch")
    print("  " + out.strip().splitlines()[-1] if out.strip() else "  (no output)")
    if '"error"' in out:
        print("\n  Modal returned an error — nothing was written."); return 1

    print("3/4 normalize -16 + splice on razer")
    print(ssh(f"cd {REMOTE}/day-{day} && python3 post.py prefetch out meta.json"))

    print("4/4 pull the mp3s back")
    dst = f"{HERE}/.audio-src/day-{day}"
    os.makedirs(dst, exist_ok=True)
    sh(["scp", "-q", "-r", f"{RAZER}:{REMOTE}/day-{day}/out/.", dst])
    got = sum(len(f) for _r, _d, f in os.walk(dst))
    print(f"  {got} files → .audio-src/day-{day}\n")
    print(f"  next:  python3 bake_day.py {day}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
