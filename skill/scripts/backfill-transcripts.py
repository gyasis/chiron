#!/usr/bin/env python3
"""Backfill audio-scripts.json (narration TRANSCRIPTS) for lessons that are missing them — WITHOUT
re-authoring. Runs each affected lesson's chain at CH_STAGE=scripts (transcript-only): it reuses the
existing chapters/breakdown and writes ONLY audio-scripts.json — lesson.html is NEVER rewritten
(verified: scripts stage skips chapter-authoring, scenario, and assemble).

Lessons that already have transcripts are SKIPPED (never re-run). Idempotent + resumable.

Usage:
  backfill-transcripts.py --dry-run            # list what WOULD be done, touch nothing
  backfill-transcripts.py [--limit N] [--conc 3] [--only medicine|passage]
"""
import os, sys, json, subprocess, glob, time, argparse, re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

SKILL = Path(__file__).resolve().parent.parent               # .../chiron/skill
CHAINS = SKILL / "chains"
GEN = Path(os.path.expanduser("~/Documents/generated"))
PASSAGE_CHAIN = CHAINS / "2026-06-30_chiron-medical-italian-passage-chain" / "run.py"
sys.path.insert(0, str(CHAINS))
import dispatch  # noqa: E402


def _load_env_files():
    """Pull the model keys the chains need (OLLAMA_API_KEY, GEMINI/OPENAI) into os.environ."""
    for f in ("~/.config/environment.d/ollama-cloud.conf", "~/dev/.env"):
        p = os.path.expanduser(f)
        if not os.path.exists(p):
            continue
        for line in open(p):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = re.sub(r"^export\s+", "", line).split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def has_transcripts(d: Path) -> bool:
    p = d / "audio-scripts.json"
    if not p.exists():
        return False
    try:
        j = json.load(open(p))
        return bool(j.get("summary") or j.get("sections"))     # non-empty manifest
    except Exception:
        return False


def lesson_type(d: Path) -> str | None:
    if (d / "breakdown.json").exists() and (d / "source" / "passage.json").exists():
        return "passage"
    if (d / "syllabus.json").exists() or list(d.glob("chapter*.json")):
        return "medicine"
    return None


def backfill_one(slug: str, dry: bool):
    d = GEN / slug
    if has_transcripts(d):
        return (slug, "skip", "already has transcripts")
    typ = lesson_type(d)
    if typ is None:
        return (slug, "skip", "unknown type (no chapters/breakdown)")
    env = {**os.environ, "CH_STAGE": "scripts",
           "CH_MODEL_REASON": os.environ.get("CH_MODEL_REASON", "glm-5.1"),
           "CH_MODEL_STRUCT": os.environ.get("CH_MODEL_STRUCT", "glm-5.1")}
    if typ == "passage":
        try:
            qid = json.load(open(d / "source" / "passage.json"))["qid"]
        except Exception as e:
            return (slug, "fail", f"no qid ({e})")
        runpy, env["SSM_QID"] = PASSAGE_CHAIN, qid
    else:  # medicine
        try:
            cj = json.load(open(d / "chiron.json"))
        except Exception as e:
            return (slug, "fail", f"no chiron.json ({e})")
        subj = cj.get("subject")
        if not subj:
            return (slug, "fail", "no subject in chiron.json")
        res = dispatch.resolve(cj.get("domain", "medicine"), cj.get("depth"), subj, None, {})
        runpy = Path(res["runpy"]); env.update(res["env"]); env["CH_SLUG"] = slug
    if dry:
        return (slug, "would-run", f"{typ} · {Path(runpy).parent.name}")
    t0 = time.time()
    try:
        r = subprocess.run(["python3", str(runpy)], env=env, cwd=str(Path(runpy).parent),
                           capture_output=True, text=True, timeout=1200)
    except subprocess.TimeoutExpired:
        return (slug, "fail", "timeout(1200s)")
    ok = has_transcripts(d)
    return (slug, "ok" if ok else "fail",
            f"{typ} {int(time.time()-t0)}s rc={r.returncode}" + ("" if ok else " | " + (r.stderr or "")[-160:]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--conc", type=int, default=3, help="parallel lessons (default 3)")
    ap.add_argument("--only", choices=["medicine", "passage"], default=None)
    a = ap.parse_args()
    _load_env_files()

    dirs = [d for d in GEN.glob("chiron-*") if (d / "lesson.html").is_file()]
    todo = []
    skip_have = 0
    for d in sorted(dirs):
        if has_transcripts(d):
            skip_have += 1
            continue
        typ = lesson_type(d)
        if typ is None:
            continue
        if a.only and typ != a.only:
            continue
        todo.append(d.name)
    if a.limit:
        todo = todo[:a.limit]

    print(f"lessons with lesson.html: {len(dirs)}  |  already have transcripts (SKIP): {skip_have}")
    print(f"NEED backfill: {len(todo)}" + (f"  (limited to {a.limit})" if a.limit else "")
          + (f"  [only {a.only}]" if a.only else ""))
    if a.dry_run:
        for slug in todo:
            print("  would-run:", slug)
        print("\n(dry-run — nothing was touched)")
        return

    ok = fail = skip = 0
    with ThreadPoolExecutor(max_workers=a.conc) as ex:
        futs = {ex.submit(backfill_one, s, False): s for s in todo}
        for i, f in enumerate(as_completed(futs), 1):
            slug, st, msg = f.result()
            ok += st == "ok"; fail += st == "fail"; skip += st == "skip"
            print(f"  [{i}/{len(todo)}] {st:9} {slug}  · {msg}", flush=True)
    print(f"\nDONE — ok={ok} fail={fail} skip={skip}")


if __name__ == "__main__":
    main()
