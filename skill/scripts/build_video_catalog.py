#!/usr/bin/env python3
"""build_video_catalog — merge the anesthesia video catalog sources into one videos.json.

Reads priority.json, rest-keep.json, gallagher.tsv and stonybrook-extra-urls.txt from the catalog directory,
drops ids that the download logs report as members-only, strips hashtag suffixes from titles, assigns subject,
format and tags, dedupes by id and writes videos.json (same input -> same output).

    python3 build_video_catalog.py [--catalog DIR] [--logs DIR] [--out FILE]
"""
import argparse, csv, glob, json, os, re, sys
from collections import Counter

BASE = os.path.expanduser("~/Documents/generated/chiron-anesthesia-videos")
SUBJECTS = ["Induction & general anaesthesia", "Spinal & epidural", "Regional & ultrasound", "Airway",
            "Vascular access & lines", "Monitoring & equipment", "Pharmacology", "Cardiac & TEE",
            "Physiology & organ systems", "Critical care & emergencies", "Pediatrics", "Obstetrics",
            "Perioperative & pain", "Exam & board review"]
GALLAGHER = "Dr. Gallagher (Stony Brook)"
STONY = "Stony Brook"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
MEMBERS_RE = re.compile(r"ERROR: \[youtube\] ([A-Za-z0-9_-]{11}): .*members-only", re.I)
TECHNIQUE_RE = re.compile(
    r"\b(block|technique|how to|how-to|insertion|insert|placement|place|catheter|guide|approach|performing|perform|"
    r"step[- ]by[- ]step|tutorial|demonstration|demo|scanning|spinal|epidural|intubation|laryngoscop\w*|cannulat\w*)\b", re.I)
TAIL_TAGS_RE = re.compile(r"(?:\s*\|\s*)?(?:\s+#[^\s#|]+)+\s*$")
BAR_TAGS_RE = re.compile(r"\s*\|\s*#.*$")


def clean_title(t):
    t = (t or "").strip()
    t = BAR_TAGS_RE.sub("", t)
    t = TAIL_TAGS_RE.sub("", t)
    return t.strip(" |")


def length_bucket(kind, dur):
    if kind == "Short" or not dur or dur < 60:
        return "Short"
    if dur < 600:
        return "Under 10 min"
    if dur < 1800:
        return "10–30 min"
    return "30+ min"


def priority_format(row):
    if row.get("kind") == "Short":
        return "Procedure"
    return "Procedure" if TECHNIQUE_RE.search(row.get("title", "")) else "Teaching"


def gallagher_subject(title):
    t = title.lower()
    if "swan ganz numbers" in t:
        return "Cardiac & TEE"
    if "swan" in t or "art line" in t or "venous line" in t or "subclavian" in t or "iv placement" in t or "gloving" in t:
        return "Vascular access & lines"
    if "micu" in t or "lung isolation" in t:
        return "Airway"
    if "epidural" in t:
        return "Spinal & epidural"
    if "cheetah" in t:
        return "Monitoring & equipment"
    return "Critical care & emergencies"   # ACLS, crisis resource management, simulations, epinephrine


def gallagher_format(title):
    t = title.lower()
    keys = ("acls", "crisis resource", "simulation", "epinephrine", "swan ganz numbers")
    return "Teaching" if any(k in t for k in keys) else "Procedure"


def members_only(log_dir):
    ids = set()
    for p in glob.glob(os.path.join(log_dir, "download-*.log")):
        with open(p, errors="replace") as f:
            for line in f:
                m = MEMBERS_RE.search(line)
                if m:
                    ids.add(m.group(1))
    return ids


VIDEO_DIR = os.environ.get("CHIRON_VIDEO_DIR", "/media/gyasis/Drive 2/chiron-videos/anesthesia")


def info_duration(vid):
    """Length in seconds from the downloaded video's info.json, or 0 when it is not downloaded."""
    try:
        with open(os.path.join(VIDEO_DIR, vid, vid + ".info.json")) as f:
            return int(json.load(f).get("duration") or 0)
    except (OSError, ValueError):
        return 0


def entry(vid, title, source, kind, dur, views, subject, fmt):
    title = clean_title(title)
    dur = int(dur) if str(dur or "").isdigit() else info_duration(vid)
    bucket = length_bucket(kind, dur)
    return {"id": vid, "title": title, "source": source, "kind": kind, "duration": dur, "views": int(views or 0),
            "subject": subject, "format": fmt, "tags": [subject, fmt, source, bucket],
            "length": bucket, "url": f"https://www.youtube.com/watch?v={vid}"}


def build(catalog_dir, log_dir):
    """Return the merged, deduped video list in a stable order."""
    blocked = members_only(log_dir)
    out = {}

    def add(e):
        if not ID_RE.match(e["id"]) or e["id"] in blocked or e["id"] in out:
            return
        out[e["id"]] = e

    def load(name):
        p = os.path.join(catalog_dir, name)
        if not os.path.exists(p):
            print(f"build_video_catalog: missing {p}", file=sys.stderr)
            return []
        with open(p) as f:
            return json.load(f)

    for r in load("priority.json"):
        add(entry(r["id"], r["title"], r["source"], r.get("kind", "Video"), r.get("dur"), r.get("views"),
                  r.get("priority") or r.get("subject"), priority_format(r)))
    p = os.path.join(catalog_dir, "gallagher.tsv")
    if os.path.exists(p):
        with open(p, newline="") as f:
            for row in csv.reader(f, delimiter="\t"):
                if len(row) < 5:
                    continue
                _, vid, dur, views, title = row[:5]
                add(entry(vid, title, GALLAGHER, "Video", dur, views, gallagher_subject(title), gallagher_format(title)))
    extras = {"cr7IlA3zgFQ": ("Labor epidural", "Spinal & epidural", "Procedure"),
              "RYLE2be3JLs": ("Cheetah NICOM monitor in-service", "Monitoring & equipment", "Teaching")}
    p = os.path.join(catalog_dir, "stonybrook-extra-urls.txt")
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                m = re.search(r"v=([A-Za-z0-9_-]{11})", line)
                if m and m.group(1) in extras:
                    t, s, fm = extras[m.group(1)]
                    add(entry(m.group(1), t, STONY, "Video", 0, 0, s, fm))
    for r in load("rest-keep.json"):
        add(entry(r["id"], r["title"], r["source"], r.get("kind", "Video"), r.get("dur"), r.get("views"),
                  r.get("subject"), r.get("format") or "Teaching"))
    order = {s: i for i, s in enumerate(SUBJECTS)}
    return sorted(out.values(), key=lambda e: (order.get(e["subject"], 99), -e["views"], e["id"])), blocked


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default=os.path.join(BASE, "catalog"))
    ap.add_argument("--logs", default=BASE)
    ap.add_argument("--out", default=os.path.join(BASE, "videos.json"))
    a = ap.parse_args(argv)
    vids, blocked = build(a.catalog, a.logs)
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(vids, f, ensure_ascii=False, indent=1)
    os.replace(tmp, a.out)
    c = Counter(v["subject"] for v in vids)
    for s in SUBJECTS:
        print(f"{c.get(s, 0):5d}  {s}")
    for s in c:
        if s not in SUBJECTS:
            print(f"{c[s]:5d}  {s}  (not in canonical list)", file=sys.stderr)
    print(f"{len(vids):5d}  total  ({len(blocked)} members-only ids excluded) -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
