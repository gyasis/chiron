#!/usr/bin/env python3
"""lesson_status — read-only table of every Italian lesson's Anki / Pimsleur / Match Madness state.

    lesson_status.py --all          table: slug, anki, pimsleur, mm
    lesson_status.py --all --json   the same as JSON
    lesson_status.py --slug SLUG    one lesson

Reads Anki (findNotes) and the local state files; it changes nothing. Pimsleur jobs are read from this checkout's state/jobs.json (set CHIRON_JOBS_FILE to read another).
"""
import argparse, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER))
for line in (Path.home() / ".chiron" / "anki.env").read_text().splitlines() if (Path.home() / ".chiron" / "anki.env").is_file() else []:
    k, _, v = line.partition("=")
    if k.startswith("CHIRON_ANKI") and k not in os.environ:
        os.environ[k] = v.strip()
import lesson_links as L  # noqa: E402


def load_jobs() -> dict:
    try:
        d = json.loads((Path(os.environ.get("CHIRON_JOBS_FILE") or SERVER / "state" / "jobs.json")).read_text())
    except (OSError, ValueError):
        return {}
    rows = d if isinstance(d, list) else list(d.values()) if isinstance(d, dict) else []
    return {j["id"]: j for j in rows if isinstance(j, dict) and j.get("id")}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--slug")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not (a.all or a.slug):
        ap.error("give --all or --slug")
    L.RECORD = False
    L.JOBS = load_jobs()
    rows = list(L.italian_lessons().values())
    if a.slug:
        r = L.resolve(a.slug)
        if r is None:
            print(f"no Italian lesson {a.slug!r}", file=sys.stderr)
            return 2
        rows = [r]
    with ThreadPoolExecutor(max_workers=L.ANKI_WORKERS) as ex:
        out = list(ex.map(lambda r: L.lesson_status(r, cached=True), rows))
    if a.json:
        print(json.dumps({"count": len(out), "lessons": out}, ensure_ascii=False, indent=1))
        return 0
    print(f"{'slug':64} {'anki':16} {'pimsleur':12} mm")
    for s in out:
        an = s["anki"]
        ak = f"{an['count']} cards" if an["status"] == "cards" else an["status"]
        print(f"{s['slug'][:64]:64} {ak:16} {s['pimsleur']['state']:12} {s['mm']['collection_id'] or '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
