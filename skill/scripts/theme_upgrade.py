#!/usr/bin/env python3
"""theme_upgrade — add every shell/themes/ theme to the theme picker of built lessons (and of the builders that make them).

A lesson carries its own copy of the theme picker: a list of allowed theme ids in the early-apply script, one <link>
per theme stylesheet, and the picker markup (a <select> of <option>s or a .theme-bar of buttons). A theme in
shell/themes/ is selectable in a lesson only when all three name it and the lesson's themes/ folder holds its file.
The lesson's themes/ files are copies too: `fix` replaces a copy with the current master only when the copy matches a
committed version of that master, so a lesson whose theme was edited by hand keeps its edit.

    python3 scripts/theme_upgrade.py check <lesson-dir|lesson.html|builder.mjs>...   # list what each file lacks; exit 1 if any
    python3 scripts/theme_upgrade.py fix   <lesson-dir|lesson.html|builder.mjs>...   # add it; safe to run again

Each edit anchors on the 'ocean' entry, the last theme every picker lists, and inserts the missing themes after it in
the same quoting, spacing and label style. A file with no picker is reported as 'no picker' and left alone.
"""
import hashlib, json, re, shutil, subprocess, sys
from functools import lru_cache
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
THEMES_SRC = SKILL / "shell" / "themes"
NEW = ["centro", "centro-notte"]                       # themes inserted after 'ocean'
LABEL = {"centro": ("Centro", "centro"), "centro-notte": ("Centro Notte", "notte")}   # (<option> label, theme-bar label)

ARRAY = re.compile(r"""\[(\s*(['"])[a-z-]+\2\s*(?:,\s*\2[a-z-]+\2\s*)*)\]""")
LINK = re.compile(r'''^([ \t]*)<link rel="stylesheet" href="themes/ocean\.css"( ?/?)>[ \t]*$''', re.M)
OPTION = re.compile(r'<option value="ocean">(Ocean|ocean)</option>')
BUTTON = re.compile(r'^([ \t]*)<button data-set-theme="ocean">ocean</button>[ \t]*$', re.M)


def _ids(m):
    q = m.group(2)
    return q, [x.strip().strip(q) for x in m.group(1).split(",")]


def _is_theme_list(ids):
    return "ocean" in ids and {"clinical", "midnight"} <= set(ids)


def upgrade(s):
    """Return (new_text, names of the parts it extended). Idempotent."""
    added = []

    def arr(m):
        q, ids = _ids(m)
        miss = [t for t in NEW if t not in ids] if _is_theme_list(ids) else []
        if not miss:
            return m.group(0)
        added.append("list")
        sep = ", " if ", " in m.group(1) else ","
        return "[" + m.group(1).rstrip() + "".join(f"{sep}{q}{t}{q}" for t in miss) + "]"
    s = ARRAY.sub(arr, s)

    def link(m):
        miss = [t for t in NEW if f'href="themes/{t}.css"' not in s]
        if not miss:
            return m.group(0)
        added.append("links")
        return m.group(0) + "".join(f'\n{m.group(1)}<link rel="stylesheet" href="themes/{t}.css"{m.group(2)}>' for t in miss)
    s = LINK.sub(link, s, count=1)

    def opt(m):
        miss = [t for t in NEW if f'<option value="{t}">' not in s]
        if not miss:
            return m.group(0)
        added.append("options")
        cap = m.group(1) == "Ocean"
        return m.group(0) + "".join(f'<option value="{t}">{LABEL[t][0] if cap else t}</option>' for t in miss)
    s = OPTION.sub(opt, s, count=1)

    def btn(m):
        miss = [t for t in NEW if f'data-set-theme="{t}"' not in s]
        if not miss:
            return m.group(0)
        added.append("buttons")
        return m.group(0) + "".join(f'\n{m.group(1)}<button data-set-theme="{t}">{LABEL[t][1]}</button>' for t in miss)
    s = BUTTON.sub(btn, s, count=1)
    return s, added


def lacks(s):
    """What a file still lacks; [] when complete or when it has no picker."""
    out = []
    if any(_is_theme_list(ids) and any(t not in ids for t in NEW) for ids in (_ids(m)[1] for m in ARRAY.finditer(s))):
        out.append("list")
    if LINK.search(s) and any(f'href="themes/{t}.css"' not in s for t in NEW):
        out.append("links")
    if OPTION.search(s) and any(f'<option value="{t}">' not in s for t in NEW):
        out.append("options")
    if BUTTON.search(s) and any(f'data-set-theme="{t}"' not in s for t in NEW):
        out.append("buttons")
    return out


def has_picker(s):
    return bool(LINK.search(s) or OPTION.search(s) or BUTTON.search(s)
                or any(_is_theme_list(_ids(m)[1]) for m in ARRAY.finditer(s)))


def targets(args):
    for a in args:
        p = Path(a).expanduser()
        if p.is_dir():
            if (p / "lesson.html").exists():
                yield p / "lesson.html"
        elif p.exists():
            yield p


def missing_files(f):
    """Theme stylesheets missing from a lesson's themes/ folder (lessons only, not builders)."""
    d = f.parent / "themes"
    if f.suffix != ".html" or not d.is_dir():
        return []
    return [t for t in NEW if not (d / f"{t}.css").exists()]


def _md5(b):
    return hashlib.md5(b).hexdigest()


@lru_cache(maxsize=None)
def past_masters(name):
    """md5 of every committed version of shell/themes/<name>; a lesson copy matching one is an unedited master copy."""
    rel = f"shell/themes/{name}"
    try:
        revs = subprocess.run(["git", "-C", str(SKILL), "log", "--format=%H", "--", rel],
                              capture_output=True, text=True, check=True).stdout.split()
    except (OSError, subprocess.CalledProcessError):
        return frozenset()
    out = set()
    for r in revs:
        got = subprocess.run(["git", "-C", str(SKILL), "show", f"{r}:skill/{rel}"], capture_output=True)
        if got.returncode == 0:
            out.add(_md5(got.stdout))
    return frozenset(out)


def stale_files(f):
    """Theme files in a lesson's themes/ that are an older, unedited master copy. Edited copies are left alone."""
    d = f.parent / "themes"
    if f.suffix != ".html" or not d.is_dir():
        return []
    out = []
    for src in sorted(THEMES_SRC.glob("*.css")):
        dst = d / src.name
        if dst.exists():
            cur = _md5(dst.read_bytes())
            if cur != _md5(src.read_bytes()) and cur in past_masters(src.name):
                out.append(src.name)
    return out


def main(argv):
    if len(argv) < 3 or argv[1] not in ("check", "fix"):
        print(__doc__)
        return 2
    mode, rows, bad = argv[1], [], 0
    for f in targets(argv[2:]):
        s = f.read_text(encoding="utf-8")
        if not has_picker(s):
            rows.append({"file": str(f), "status": "no picker"})
            continue
        need, files, stale = lacks(s), missing_files(f), stale_files(f)
        if mode == "check":
            bad += bool(need or files or stale)
            rows.append({"file": str(f), "status": "lacks" if need or files or stale else "ok", "lacks": need,
                         "files": files, "stale": stale})
            continue
        new, added = upgrade(s)
        if new != s:
            f.write_text(new, encoding="utf-8")
        for t in files:
            shutil.copy(THEMES_SRC / f"{t}.css", f.parent / "themes" / f"{t}.css")
        for name in stale:
            shutil.copy(THEMES_SRC / name, f.parent / "themes" / name)
        left = lacks(new)
        bad += bool(left)
        rows.append({"file": str(f), "status": "incomplete" if left else ("fixed" if added or files or stale else "ok"),
                     "added": sorted(set(added)), "copied": files, "refreshed": stale, "still_lacks": left})
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    for r in rows:
        if r["status"] in ("incomplete",) or (mode == "check" and r["status"] == "lacks" and len(rows) <= 20):
            print(json.dumps(r))
    print(json.dumps({"mode": mode, "files": len(rows), **counts}))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
