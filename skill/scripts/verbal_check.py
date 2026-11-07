#!/usr/bin/env python3
"""verbal-check — build and list Verbal Check lessons (listen, write, say it back) from real Italian recordings.

    verbal-check sync     [--no-chat] [--no-build] [--include-unpaired] [--min-seconds 3] [--json]
    verbal-check pending  [--include-unpaired] [--min-seconds 3] [--json]
    verbal-check build    <audio> --title "..." [--from NAME] [--context "..."] [--slug S] [--json]
    verbal-check list     [--json]

sync: pull the class chat's new messages (wa-group-pull, needs the group open on the Pixel; a failure there is
reported and sync carries on), pull + pair + transcribe new voice notes (wa-voice-sync), then build one lesson
per paired voice note that has none yet. Already-built notes are skipped, so it is safe to run any time.
pending: the voice notes that have no lesson yet. build: one lesson from any recording. list: built lessons
with attempts and best score. Every command takes --json for agents.

The same functions back the Chiron app: GET /api/dettato/pending and POST /api/dettato/build.
Lessons land in ~/Documents/generated/chiron-dettato/<slug>/ and play at
http://localhost:8911/verbal-check?l=<slug>.
"""
import argparse, json, os, re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_dettato as bd  # noqa: E402

WA_DIR = Path(os.environ.get("CHIRON_WA_DIR", Path.home() / "Documents/generated/ssm-salerno-2026/whatsapp"))
APP = os.environ.get("CHIRON_URL", "http://localhost:8911").rstrip("/")
MIN_S = 3.0


def voice_slug(row: dict) -> str:
    return "wa-" + bd.slugify(Path(row["file"]).stem)


def _built_origins() -> set[str]:
    out = set()
    for p in bd.OUT.glob("*/dettato.json"):
        try:
            o = json.loads(p.read_text()).get("origin") or {}
        except (OSError, json.JSONDecodeError):
            continue
        if o.get("phone_file"):
            out.add(o["phone_file"])
    return out


def voice_notes(wa_dir: Path = None) -> list[dict]:
    p = (wa_dir or WA_DIR) / "voice.jsonl"
    return [json.loads(l) for l in p.open() if l.strip()] if p.exists() else []


def pending(include_unpaired: bool = False, min_seconds: float = MIN_S, wa_dir: Path = None) -> list[dict]:
    """Voice notes with an audio file on disk and no lesson yet, oldest first."""
    wa_dir = wa_dir or WA_DIR
    done = _built_origins()
    out = []
    for row in voice_notes(wa_dir):
        if not row.get("file") or not (wa_dir / row["file"]).exists():
            continue
        if not row.get("paired") and not include_unpaired:
            continue
        if row.get("seconds", 0) < min_seconds:
            continue
        slug = voice_slug(row)
        if row["phone_file"] in done or (bd.OUT / slug / "dettato.json").exists():
            continue
        out.append({**{k: row.get(k) for k in ("phone_file", "seconds", "day", "time", "from", "paired", "file")},
                    "slug": slug, "path": str(wa_dir / row["file"]), "preview": (row.get("text") or "")[:120]})
    return out


def build_voice(note: dict) -> dict:
    """Build the lesson for one pending() entry."""
    note = {**note, "from": (note.get("from") or "").strip()}
    if note.get("paired"):
        title = f"{note['from']}, {note['day']} {note['time'].strip()}"
        context = f"Nota vocale di {note['from']} nel gruppo WhatsApp della classe SSM, {note['day']} {note['time'].strip()}."
    else:
        title = f"Nota vocale {note['phone_file']}"
        context = "Nota vocale WhatsApp (chat non identificata)."
    origin = {"kind": "whatsapp-voice", **{k: note.get(k) for k in ("phone_file", "day", "time", "from", "file")}}
    return bd.build(Path(note["path"]), title, note["from"], context, note["slug"], origin=origin)


def lessons() -> list[dict]:
    out = []
    for p in sorted(bd.OUT.glob("*/dettato.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            d = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError) as e:
            out.append({"slug": p.parent.name, "error": f"unreadable dettato.json: {e}"})
            continue
        att = sorted((p.parent / "attempts").glob("*.json"))
        scores = []
        for a in att:
            try:
                scores.append(json.loads(a.read_text()).get("score", 0))
            except (OSError, json.JSONDecodeError):
                pass
        out.append({"slug": d["slug"], "title": d["title"], "from": d.get("from", ""), "lines": len(d["lines"]),
                    "seconds": d.get("seconds"), "uncertain": sum(1 for l in d["lines"] if l.get("uncertain")),
                    "attempts": len(att), "best": max(scores, default=None), "built": d.get("built"),
                    "url": f"{APP}/verbal-check?l={d['slug']}"})
    return out


def _run(cmd: list[str]) -> dict:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    except FileNotFoundError:
        return {"ok": False, "cmd": cmd[0], "error": f"{cmd[0]} not on PATH"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "cmd": cmd[0], "error": "timed out after 30 min"}
    tail = (r.stdout + r.stderr).strip().splitlines()[-12:]
    return {"ok": r.returncode == 0, "cmd": cmd[0], "exit": r.returncode, "tail": tail}


def _summary(lesson: dict) -> dict:
    return {"slug": lesson["slug"], "title": lesson["title"], "lines": len(lesson["lines"]),
            "seconds": lesson["seconds"], "uncertain": sum(1 for l in lesson["lines"] if l["uncertain"]),
            "url": f"{APP}/verbal-check?l={lesson['slug']}"}


def cmd_sync(a) -> dict:
    steps = []
    if not a.no_chat:
        steps.append(_run(["wa-group-pull"]))
        if not a.json:
            s = steps[-1]
            print(f"chat pull: {'ok' if s['ok'] else 'FAILED (carrying on with the saved history)'}")
            for l in s.get("tail") or [s.get("error", "")]:
                print(f"  {l}")
    steps.append(_run(["wa-voice-sync"] + (["--transcribe-unpaired"] if a.include_unpaired else [])))
    if not a.json:
        s = steps[-1]
        print(f"voice notes: {'ok' if s['ok'] else 'FAILED'}")
        for l in s.get("tail") or [s.get("error", "")]:
            print(f"  {l}")
    todo = pending(a.include_unpaired, a.min_seconds)
    built, failed = [], []
    if not a.no_build:
        for note in todo:
            if not a.json:
                print(f"building {note['slug']} ({note['seconds']:.0f}s, {note.get('from') or 'unpaired'}) ...", flush=True)
            try:
                built.append(_summary(build_voice(note)))
                if not a.json:
                    b = built[-1]
                    print(f"  {b['lines']} lines, {b['uncertain']} uncertain  {b['url']}")
            except bd.BuildError as e:
                failed.append({"slug": note["slug"], "error": str(e)})
                if not a.json:
                    print(f"  FAILED: {e}")
    res = {"steps": steps, "pending": [] if not a.no_build else todo, "built": built, "failed": failed}
    if not a.json:
        print(f"{len(built)} built, {len(failed)} failed" + (f", {len(todo)} pending (--no-build)" if a.no_build else ""))
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="verbal-check", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync", help="pull chat + voice notes, build lessons for new voice notes")
    s.add_argument("--no-chat", action="store_true", help="skip wa-group-pull (use the saved chat history)")
    s.add_argument("--no-build", action="store_true", help="pull and pair only; list what would be built")
    p = sub.add_parser("pending", help="voice notes with no lesson yet")
    for x in (s, p):
        x.add_argument("--include-unpaired", action="store_true", help="also notes not matched to the class chat")
        x.add_argument("--min-seconds", type=float, default=MIN_S)
    b = sub.add_parser("build", help="build one lesson from any recording")
    b.add_argument("audio", type=Path)
    b.add_argument("--title", required=True)
    b.add_argument("--from", dest="speaker", default="")
    b.add_argument("--context", default="")
    b.add_argument("--slug")
    l = sub.add_parser("list", help="built lessons")
    for x in (s, p, b, l):
        x.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    if a.cmd == "sync":
        res = cmd_sync(a)
        code = 1 if res["failed"] or not res["steps"][-1]["ok"] else 0
    elif a.cmd == "pending":
        res = pending(a.include_unpaired, a.min_seconds)
        code = 0
        if not a.json:
            for n in res:
                print(f"{n['slug']:44s} {n['seconds']:5.0f}s  {n.get('from') or 'unpaired'}  {n['preview'][:60]}")
            print(f"{len(res)} pending")
    elif a.cmd == "build":
        try:
            res, code = _summary(bd.build(a.audio, a.title, a.speaker, a.context, a.slug)), 0
        except bd.BuildError as e:
            res, code = {"error": str(e)}, 1
        if not a.json:
            print(res.get("error") and f"verbal-check build: {res['error']}" or
                  f"{res['slug']}: {res['lines']} lines, {res['uncertain']} uncertain  {res['url']}")
    else:
        res, code = lessons(), 0
        if not a.json:
            for x in res:
                if "error" in x:
                    print(f"{x['slug']:44s} {x['error']}")
                    continue
                best = "-" if x["best"] is None else f"{x['best']}%"
                print(f"{x['slug']:44s} {x['lines']:3d} lines {x['seconds'] or 0:5.0f}s  tries {x['attempts']:2d}  best {best:>4s}  {x['title']}")
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=1))
    return code


if __name__ == "__main__":
    sys.exit(main())
