#!/usr/bin/env python3
"""lesson_manifest — the one writer of a lesson's metadata file (<lesson-dir>/chiron.json): title, domain, body system, labels, status.

Every lesson chain calls `stamp()` when it builds lesson.html, so the Library never has to guess a lesson's
domain or system from its title. Stamping merges: no key is ever deleted, and a value the caller passes
(not None) replaces the stored one.

    lesson_manifest.py stamp <dir> [--title T --domain D --system S --subject S --depth D --scope S
                                    --label L ... --status S --generator G]
    lesson_manifest.py check <root> [--json]          # lessons with missing fields; exit 1 if any
    lesson_manifest.py repair <root> --dry-run|--apply --report <file.md>

Domains: medicine, medical-italian, language-it, video-it, code. `medicine` and `medical-italian`
lessons also need a body system (tags.sys).
"""
import argparse, datetime, fcntl, json, os, re, sys, tempfile
from pathlib import Path

DOMAINS = ("medicine", "medical-italian", "language-it", "video-it", "code")
NEEDS_SYSTEM = ("medicine", "medical-italian")
_DOMAIN_ALIASES = {
    "medicine": "medicine",
    "italian": "language-it", "language": "language-it", "language-it": "language-it", "it": "language-it",
    "medical-italian": "medical-italian", "med-italian": "medical-italian", "medicina-italiana": "medical-italian",
    "video-it": "video-it",
    "code": "code",
}
_ANESTHESIA = re.compile(r"an(a)?est|sala operatoria", re.I)
_TITLE = re.compile(r"<title>([^<]*)</title>", re.I)
_BASE = {"format": "chiron/1", "entry": "lesson.html"}


def normalize_domain(d):
    """Canonical domain for a request token or stored value, or None when it is not a known domain."""
    if not isinstance(d, str):
        return None
    return _DOMAIN_ALIASES.get(d.strip().lower())


def infer_system(*texts):
    """'Anesthesia' when any text names anesthesia (English or Italian); otherwise None."""
    for t in texts:
        if t and _ANESTHESIA.search(str(t)):
            return "Anesthesia"
    return None


def page_title(lesson_dir):
    """The <title> of the lesson's entry page, or None."""
    d = Path(lesson_dir)
    try:
        entry = json.loads((d / "chiron.json").read_text()).get("entry") or "lesson.html"
    except (OSError, ValueError):
        entry = "lesson.html"
    try:
        m = _TITLE.search((d / entry).read_text(errors="replace")[:20000])
    except OSError:
        return None
    t = m.group(1).strip() if m else ""
    return t if t and t != "COURSE_TITLE" else None


def read(lesson_dir):
    """The stored manifest as a dict ({} when absent or unreadable)."""
    try:
        cj = json.loads((Path(lesson_dir) / "chiron.json").read_text())
        return cj if isinstance(cj, dict) else {}
    except (OSError, ValueError):
        return {}


def stamp(lesson_dir, *, title=None, domain=None, system=None, subject=None, depth=None, scope=None,
          labels=None, status=None, generator=None, extra=None, tags=None):
    """Merge metadata into <lesson_dir>/chiron.json and return the merged dict.

    A non-None argument replaces the stored value; None leaves it. `labels` is unioned in order. `tags` keys
    are merged one by one: domain sets tags.dom, system tags.sys, depth tags.depth, scope tags.scope, and
    `tags` adds any other key (e.g. subj). `extra` keys are set at the top level. Raises ValueError for an
    unknown domain."""
    d = Path(lesson_dir)
    dom = None
    if domain is not None:
        dom = normalize_domain(domain)
        if dom is None:
            raise ValueError(f"unknown domain {domain!r}; allowed: {', '.join(DOMAINS)}")
    d.mkdir(parents=True, exist_ok=True)
    with open(d / ".chiron.json.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cj = read(d) or dict(_BASE)
        for k, v in _BASE.items():
            cj.setdefault(k, v)
        if title is not None:
            cj["title"] = title
        elif not cj.get("title"):
            t = page_title(d)
            if t:
                cj["title"] = t
        for k, v in (("domain", dom), ("subject", subject), ("depth", depth), ("status", status),
                     ("generator", generator)):
            if v is not None:
                cj[k] = v
        if labels:
            cur = cj.get("labels") if isinstance(cj.get("labels"), list) else []
            cj["labels"] = cur + [x for x in dict.fromkeys(labels) if x not in cur]
        tg = cj.get("tags") if isinstance(cj.get("tags"), dict) else {}
        for k, v in (("dom", dom), ("sys", system), ("depth", depth), ("scope", scope)):
            if v is not None:
                tg[k] = v
        for k, v in (tags or {}).items():
            if v is not None:
                tg[k] = v
        if tg:
            if cj.get("domain"):
                tg.setdefault("dom", cj["domain"])
            cj["tags"] = tg
        for k, v in (extra or {}).items():
            if v is not None:
                cj[k] = v
        fd, tmp = tempfile.mkstemp(prefix=".chiron.json.", dir=str(d))
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(cj, f, ensure_ascii=False, indent=2)
            os.replace(tmp, d / "chiron.json")
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    return cj


def missing(lesson_dir):
    """Required fields the lesson's manifest lacks: title, domain, tags.sys (system only for medicine and medical-italian)."""
    cj = read(lesson_dir)
    out = []
    if not cj.get("title"):
        out.append("title")
    dom = cj.get("domain")
    if dom not in DOMAINS:
        out.append("domain")
    tg = cj.get("tags") if isinstance(cj.get("tags"), dict) else {}
    if (dom in NEEDS_SYSTEM or (dom not in DOMAINS and tg.get("dom") in NEEDS_SYSTEM)) and not tg.get("sys"):
        out.append("tags.sys")
    return out


def lesson_dirs(root, max_depth=4):
    """Lesson directories under root (a directory holding lesson.html), walked like build-library-index.mjs."""
    root = Path(root)
    acc = []

    def walk(p, depth):
        if depth > max_depth:
            return
        try:
            subs = sorted(x for x in p.iterdir() if x.is_dir())
        except OSError:
            return
        for s in subs:
            if s.name == "chiron-library":
                continue
            if (s / "lesson.html").exists():
                acc.append(s)
            else:
                walk(s, depth + 1)

    walk(root, 0)
    return acc


# ---- repair: propose metadata for lessons that lack it, from evidence on disk ----

def _json(p):
    try:
        v = json.loads(Path(p).read_text())
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def _domain_evidence(d, rel):
    """(domain, evidence) for a lesson from its own files and name, or (None, reason)."""
    cj = read(d)
    if normalize_domain(cj.get("domain")) and cj.get("domain") in DOMAINS:
        return cj["domain"], "chiron.json domain"
    if cj.get("domain"):
        n = normalize_domain(cj["domain"])
        if n:
            return n, f"chiron.json domain {cj['domain']!r} normalized"
    ct = _json(d / "content.json")
    n = normalize_domain(ct.get("domain"))
    if n:
        return n, f"content.json domain {ct.get('domain')!r}"
    br = _json(d / "brief.json")
    for k in ("domain", "subMode", "submode"):
        n = normalize_domain(br.get(k))
        if n:
            return n, f"brief.json {k} {br.get(k)!r}"
    name = d.name
    if name.startswith(("chiron-ward-", "chiron-ssm-")):
        return "medical-italian", f"slug prefix {name.split('-')[1]}"
    if name.startswith("chiron-italian-") or name.startswith("chiron-pimsleur-"):
        return "language-it", "slug prefix " + "-".join(name.split("-")[:2])
    if rel.startswith("chiron-medicina-italiana/") or "/chiron-medicina-italiana/" in rel:
        return "medical-italian", "path chiron-medicina-italiana/"
    return None, "no evidence (no chiron.json/content.json/brief.json domain, no slug rule)"


def _slug_rule_domain(d, rel):
    name = d.name
    if name.startswith(("chiron-ward-", "chiron-ssm-")) or re.search(r"chiron-medicina-italiana/(wards|situazioni|patologie)/", rel):
        return "medical-italian"
    if name.startswith("chiron-italian-"):
        return "language-it"
    return None


def propose(d, root):
    """List of changes {dir, field, current, proposed, evidence} for one lesson, plus undecided reasons."""
    d = Path(d)
    rel = str(d.relative_to(root))
    cj = read(d)
    changes, undecided = [], []
    dom, ev = _domain_evidence(d, rel)
    cur_dom = cj.get("domain")
    if dom is None:
        undecided.append(("domain", ev))
    elif cur_dom != dom:
        changes.append(("domain", cur_dom, dom, ev))
    rule = _slug_rule_domain(d, rel)
    if dom and rule and dom != rule and not (rule == "language-it" and dom == "video-it"):
        undecided.append(("domain", f"stored/declared domain {dom!r} contradicts the slug rule ({rule!r}); left for a human"))
    final_dom = dom or (cur_dom if cur_dom in DOMAINS else None)
    tg = cj.get("tags") if isinstance(cj.get("tags"), dict) else {}
    if final_dom and tg.get("dom") != final_dom and (tg or cur_dom != final_dom):
        changes.append(("tags.dom", tg.get("dom"), final_dom, ev))
    if final_dom in NEEDS_SYSTEM and not tg.get("sys"):
        title = cj.get("title") or page_title(d)
        sysname = infer_system(title, cj.get("subject"), d.name)
        if sysname:
            changes.append(("tags.sys", None, sysname, "anesthesia pattern in title/subject/slug"))
        else:
            undecided.append(("tags.sys", "no anesthesia match; the Library keeps its display fallback"))
    if not cj.get("title"):
        t = page_title(d)
        if t:
            changes.append(("title", None, t, "lesson.html <title>"))
        else:
            undecided.append(("title", "no <title> in lesson.html"))
    return changes, undecided


def repair(root, apply, report):
    root = Path(root).expanduser()
    rows, und, counts, total = [], [], {}, 0
    for d in lesson_dirs(root):
        total += 1
        changes, undecided = propose(d, root)
        rel = str(d.relative_to(root))
        for f, cur, new, ev in changes:
            rows.append((rel, f, cur, new, ev))
            counts[f] = counts.get(f, 0) + 1
        for f, why in undecided:
            und.append((rel, f, why))
        if apply and changes:
            kw = {}
            for f, _c, new, _e in changes:
                if f == "domain":
                    kw["domain"] = new
                elif f == "tags.sys":
                    kw["system"] = new
                elif f == "title":
                    kw["title"] = new
            if kw:
                stamp(d, **kw)
            elif any(f == "tags.dom" for f, *_ in changes):
                dm = next(n for f, _c, n, _e in changes if f == "tags.dom")
                stamp(d, domain=dm)
    cell = lambda v: "-" if v is None else str(v).replace("|", "\\|").replace("\n", " ")
    lines = [f"# Chiron lesson manifest repair ({'APPLIED' if apply else 'dry run'})", "",
             f"Root: `{root}`  ·  generated {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}  ·  lessons scanned: {total}",
             "", "## Counts per change type", "", "| change | lessons |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in sorted(counts.items())] or ["| (none) | 0 |"]
    ucount = {}
    for _r, f, _w in und:
        ucount[f] = ucount.get(f, 0) + 1
    lines += ["", "## Cannot decide (never guessed)", "", "| field | lessons |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in sorted(ucount.items())] or ["| (none) | 0 |"]
    lines += ["", "## Proposed changes", "", "| dir | field | current | proposed | evidence |", "|---|---|---|---|---|"]
    lines += [f"| {cell(r)} | {cell(f)} | {cell(c)} | {cell(n)} | {cell(e)} |" for r, f, c, n, e in rows]
    lines += ["", "## Undecided lessons", "", "| dir | field | why |", "|---|---|---|"]
    lines += [f"| {cell(r)} | {cell(f)} | {cell(w)} |" for r, f, w in und]
    Path(report).expanduser().write_text("\n".join(lines) + "\n")
    print(f"{total} lesson(s) scanned; {len(rows)} change(s) {'applied' if apply else 'proposed'}; "
          f"{len(und)} undecided -> {report}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lesson_manifest", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("stamp")
    s.add_argument("dir")
    for a in ("title", "domain", "system", "subject", "depth", "scope", "status", "generator"):
        s.add_argument("--" + a)
    s.add_argument("--label", action="append", default=[])
    c = sub.add_parser("check")
    c.add_argument("root")
    c.add_argument("--json", action="store_true")
    r = sub.add_parser("repair")
    r.add_argument("root")
    g = r.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    r.add_argument("--report", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "stamp":
        try:
            cj = stamp(a.dir, title=a.title, domain=a.domain, system=a.system, subject=a.subject, depth=a.depth,
                       scope=a.scope, labels=a.label, status=a.status, generator=a.generator)
        except ValueError as e:
            print(f"lesson_manifest: {e}", file=sys.stderr)
            return 2
        print(json.dumps(cj, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "check":
        root = Path(a.root).expanduser()
        bad = {str(d.relative_to(root)): m for d in lesson_dirs(root) if (m := missing(d))}
        if a.json:
            print(json.dumps(bad, ensure_ascii=False, indent=2))
        else:
            for k, m in bad.items():
                print(f"{k}: missing {', '.join(m)}")
            print(f"{len(bad)} lesson(s) with missing fields")
        return 1 if bad else 0
    return repair(a.root, a.apply, a.report)


if __name__ == "__main__":
    sys.exit(main())
