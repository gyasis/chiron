#!/usr/bin/env python3
"""lesson_tags — add, remove or list Library tags on generated lessons (chiron.json "labels").

A lesson can carry any number of tags ("Ordine exam", …). The Library shows them on the card, filters by
them (Tags pills), and highlights the ones library.yaml marks `highlight: true`. "Pimsleur" needs no tag:
the builder adds it from the lesson's audio. The Library is rebuilt after a change unless --no-rebuild.

    lesson_tags.py add "Ordine exam" <lesson-dir-or-glob>...
    lesson_tags.py rm  "Ordine exam" <lesson-dir-or-glob>...
    lesson_tags.py ls  [<lesson-dir-or-glob>...]        # default: every lesson that has a tag
    lesson_tags.py pack "Ordine exam" [<out-dir>]        # offline pack: every bundled lesson with the tag

A pack is a folder of .chiron files (named by lesson title) + the same as one .zip, under
~/Documents/generated/chiron-packs/<tag>/. Copy the zip to the phone any way (USB, Dropbox, …), extract it,
then Chiron app → Import → select all the files. No computer needed after that. The zip is also served
at <server>/library/packs/<tag>.zip for downloading straight from the phone's browser.
"""
import glob, json, os, re, shutil, subprocess, sys, zipfile
from pathlib import Path

GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
SKILL = Path(__file__).resolve().parent.parent


def lesson_dirs(args: list[str]) -> list[Path]:
    out = []
    for a in args:
        hits = glob.glob(a) or glob.glob(str(GEN / a))
        if not hits:
            sys.exit(f"no lesson matches {a!r} (relative paths resolve under {GEN})")
        for h in sorted(hits):
            p = Path(h)
            if not (p / "lesson.html").exists():
                sys.exit(f"{p} is not a lesson (no lesson.html)")
            out.append(p)
    return out


def labels_of(d: Path) -> list[str]:
    try:
        return json.loads((d / "chiron.json").read_text()).get("labels", [])
    except FileNotFoundError:
        return []


def set_labels(d: Path, labels: list[str]) -> None:
    f = d / "chiron.json"
    cj = json.loads(f.read_text()) if f.exists() else {"format": "chiron/1", "entry": "lesson.html"}
    if labels:
        cj["labels"] = labels
    else:
        cj.pop("labels", None)
    f.write_text(json.dumps(cj, ensure_ascii=False, indent=2))


def pack(tag: str, out: Path | None = None) -> Path:
    """Copy every bundled lesson carrying `tag` into one folder + one zip. Returns the zip path."""
    lib = GEN / "chiron-library"
    lessons = json.loads((lib / "library.index.json").read_text())["lessons"]
    hits = [l for l in lessons if tag in (l.get("labels") or [])]
    if not hits:
        sys.exit(f"no lesson in the Library index has the tag {tag!r}")
    name = re.sub(r"[^a-z0-9]+", "-", tag.lower()).strip("-")
    out = out or GEN / "chiron-packs" / name
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.chiron"):
        old.unlink()
    missing, n = [], 0
    for i, l in enumerate(sorted(hits, key=lambda l: l["title"]), 1):
        src = lib / "lessons" / (l["id"].replace("/", "-") + ".chiron")
        if not src.exists():
            missing.append(l["id"])
            continue
        title = re.sub(r"[^\w\s-]", "", l["title"]).strip()[:70].strip()
        shutil.copy2(src, out / f"{i:02d} {title}.chiron")
        n += 1
    zp = out.parent / f"{name}.zip"
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_STORED) as z:      # .chiron files are zips already: store, don't recompress
        for f in sorted(out.glob("*.chiron")):
            z.write(f, f"{name}/{f.name}")
    served = lib / "packs" / zp.name          # also downloadable from the phone: <server>/library/packs/<tag>.zip
    served.parent.mkdir(exist_ok=True)
    shutil.copy2(zp, served)
    print(f"{n} lesson(s) -> {out}/  and  {zp}  ({zp.stat().st_size / 1e6:.0f} MB)")
    print(f"  phone download: http://<computer>:8911/library/packs/{zp.name}")
    for m in missing:
        print(f"  not bundled, skipped: {m}  (bundle: node scripts/build-hub-catalog.mjs --only {m.replace('/', '-')})")
    return zp


def main(argv: list[str]) -> int:
    rebuild = "--no-rebuild" not in argv
    argv = [a for a in argv if a != "--no-rebuild"]
    if argv and argv[0] == "pack" and len(argv) >= 2:
        pack(argv[1], Path(argv[2]) if len(argv) > 2 else None)
        return 0
    if not argv or argv[0] not in ("add", "rm", "ls"):
        print(__doc__)
        return 2
    cmd = argv[0]
    if cmd == "ls":
        dirs = lesson_dirs(argv[1:]) if argv[1:] else [p.parent for p in sorted(GEN.rglob("chiron.json"))]
        for d in dirs:
            if labels_of(d) or argv[1:]:
                print(f"{', '.join(labels_of(d)) or '-':24}  {d.relative_to(GEN) if d.is_relative_to(GEN) else d}")
        return 0
    if len(argv) < 3:
        sys.exit(f"usage: lesson_tags.py {cmd} <tag> <lesson>...")
    tag, changed = argv[1].strip(), 0
    for d in lesson_dirs(argv[2:]):
        cur = labels_of(d)
        new = (cur + [tag]) if cmd == "add" and tag not in cur else [t for t in cur if t != tag] if cmd == "rm" else cur
        if new != cur:
            set_labels(d, new)
            changed += 1
        print(f"{'changed' if new != cur else 'same   '}  {', '.join(new) or '-':24}  {d.name}")
    print(f"{changed} lesson(s) changed")
    if changed and rebuild:
        subprocess.run(["node", str(SKILL / "scripts" / "build-library-index.mjs")], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
