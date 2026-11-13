#!/usr/bin/env python3
"""lesson_manifest — the one writer of a lesson's metadata file (<lesson-dir>/chiron.json): title, domain, body system, labels, status.

Every lesson chain calls `stamp()` when it builds lesson.html, so the Library never has to guess a lesson's
domain or system from its title. Stamping merges: no key is ever deleted, and a value the caller passes
(not None) replaces the stored one.

    lesson_manifest.py stamp <dir> [--title T --domain D --system S --subject S --depth D --scope S
                                    --label L ... --status S --generator G]
    lesson_manifest.py check <root> [--json]          # lessons with missing fields; exit 1 if any
    lesson_manifest.py repair <root> --dry-run|--apply --report <file.md>
    lesson_manifest.py normalize-titles <root> --dry-run|--apply --report <file.md> [--subjects-json map.json]

Domains: medicine, medical-italian, language-it, video-it, code. `medicine` and `medical-italian`
lessons also need a body system (tags.sys).
"""
import argparse, datetime, fcntl, html, json, os, re, sys, tempfile
from pathlib import Path

DOMAINS = ("medicine", "medical-italian", "language-it", "video-it", "code")
NEEDS_SYSTEM = ("medicine",)   # a Medical-Italian lesson may carry a system (e.g. Anesthesia) but does not need one
_DOMAIN_ALIASES = {
    "medicine": "medicine",
    "italian": "language-it", "language": "language-it", "language-it": "language-it", "it": "language-it",
    "medical-italian": "medical-italian", "med-italian": "medical-italian", "medicina-italiana": "medical-italian",
    "video-it": "video-it",
    "code": "code",
}
_ANESTHESIA = re.compile(r"an(a)?est", re.I)   # the same test the chains use to pick the anesthesia books
_TITLE = re.compile(r"<title>([^<]*)</title>", re.I)
_TITLE_PREFIX = re.compile(r"^\s*(?:chiron\s*[·\-–—:]\s*|ssm\s*·\s*)+", re.I)
_TITLE_SUFFIX = re.compile(
    r"\s+[—–-]\s+(?:systematic(?:\s*\(deep-dive\))?|atlas|primer)\s*$", re.I)
_BASE = {"format": "chiron/1", "entry": "lesson.html"}


def clean_title(t):
    """One short plain-text name: HTML entities decoded, no "Chiron ·" / "SSM ·" prefix, no depth suffix,
    whitespace collapsed. None and "" come back unchanged."""
    if not isinstance(t, str) or not t:
        return t
    prev = None
    while prev != t:
        prev = t
        t = html.unescape(t)
        t = _TITLE_PREFIX.sub("", t)
        t = _TITLE_SUFFIX.sub("", t)
        t = re.sub(r"\s+", " ", t).strip()
    return t


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
    t = clean_title(t)
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
            cj["title"] = clean_title(title)
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


def unclean_title(lesson_dir):
    """The stored title when clean_title would change it, else None."""
    t = read(lesson_dir).get("title")
    return t if isinstance(t, str) and t and clean_title(t) != t else None


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


def propose(d, root, slug_domain_wins=False, index_systems=None):
    """List of changes {dir, field, current, proposed, evidence} for one lesson, plus undecided reasons.
    slug_domain_wins: the folder rule (chiron-ward-, chiron-ssm-, chiron-medicina-italiana/…, chiron-italian-) replaces
    a stored domain that contradicts it. index_systems: {lesson id: system the Library shows}, stored for a medicine
    lesson that has no system and no anesthesia match."""
    d = Path(d)
    rel = str(d.relative_to(root))
    cj = read(d)
    changes, undecided = [], []
    dom, ev = _domain_evidence(d, rel)
    rule = _slug_rule_domain(d, rel)
    if slug_domain_wins and dom and rule and dom != rule and not (rule == "language-it" and dom == "video-it"):
        dom, ev = rule, f"folder rule (replaces {dom!r})"
    cur_dom = cj.get("domain")
    if dom is None:
        undecided.append(("domain", ev))
    elif cur_dom != dom:
        changes.append(("domain", cur_dom, dom, ev))
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
        elif index_systems and index_systems.get(rel):
            changes.append(("tags.sys", None, index_systems[rel], "the system the Library shows today"))
        else:
            undecided.append(("tags.sys", "no anesthesia match; the Library keeps its display fallback"))
    elif final_dom == "medical-italian" and not tg.get("sys"):
        sysname = infer_system(cj.get("title") or page_title(d), cj.get("subject"), d.name)
        if sysname:
            changes.append(("tags.sys", None, sysname, "anesthesia pattern in title/subject/slug"))
    if not cj.get("title"):
        t = page_title(d)
        if t:
            changes.append(("title", None, t, "lesson.html <title>"))
        else:
            undecided.append(("title", "no <title> in lesson.html"))
    return changes, undecided


def _index_systems(path):
    """{lesson id: system} from a library.index.json, for medicine lessons only. Emergency / General is the
    Library's no-match fallback, not a system, so it is left out."""
    data = _json(path) if path else {}
    items = data.get("lessons") if isinstance(data.get("lessons"), list) else next(
        (v for v in data.values() if isinstance(v, list)), [])
    return {i["id"]: i["system"] for i in items
            if isinstance(i, dict) and i.get("id") and i.get("system") and i.get("domain") == "medicine"
            and not (i["system"] == "Emergency" and i.get("subject") in (None, "", "General"))}


def repair(root, apply, report, slug_domain_wins=False, index=None):
    root = Path(root).expanduser()
    index_systems = _index_systems(Path(index).expanduser()) if index else None
    rows, und, counts, total = [], [], {}, 0
    for d in lesson_dirs(root):
        total += 1
        changes, undecided = propose(d, root, slug_domain_wins, index_systems)
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


_SLUG_DEPTH = re.compile(r"^chiron-.+-(amboss|systematic|drug|atlas|primer)$")   # medicine slug = chiron-<base>-<depth>


def _is_slug_subject(subject, slug):
    return isinstance(subject, str) and (subject == slug or subject.startswith("chiron-"))


def normalize_titles(root, apply, report, subjects=None):
    """Clean every lesson's stored title and drop a subject that is the folder slug or a chiron- name (or
    replace it with the real subject from `subjects` {slug: subject}). Writes under the manifest lock."""
    root = Path(root).expanduser()
    subjects = subjects or {}
    rows, total, n_title, n_subj, n_depth, empties = [], 0, 0, 0, 0, []
    seen = {}
    for d in lesson_dirs(root):
        total += 1
        cj = read(d)
        if not cj:
            continue
        rel = str(d.relative_to(root))
        old = cj.get("title")
        new = clean_title(old)
        subj = cj.get("subject")
        drop = _is_slug_subject(subj, d.name)
        real = subjects.get(d.name)
        t_changed = new != old
        cur_depth = cj.get("depth") or (cj.get("tags") or {}).get("depth")
        m = _SLUG_DEPTH.match(d.name)
        add_depth = m.group(1) if m and not cur_depth else None
        if add_depth:
            n_depth += 1
        if not t_changed and not drop and not add_depth:
            if isinstance(new, str) and new:
                seen.setdefault(new, []).append((rel, cur_depth))
            continue
        if isinstance(old, str) and old and not new:
            empties.append(rel)
            t_changed = False
            new = old
        n_title += t_changed
        n_subj += drop
        rows.append((rel, old, new if t_changed else old, subj if drop else None,
                     real if drop and real else None))
        if isinstance(new, str) and new:
            seen.setdefault(new, []).append((rel, cur_depth or add_depth))
        if apply:
            with open(d / ".chiron.json.lock", "w") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                cur = read(d)
                if t_changed:
                    cur["title"] = new
                if drop:
                    if real:
                        cur["subject"] = real
                    else:
                        cur.pop("subject", None)
                if add_depth:
                    cur["depth"] = add_depth
                    tg = cur.get("tags") if isinstance(cur.get("tags"), dict) else {}
                    tg["depth"] = add_depth
                    cur["tags"] = tg
                fd, tmp = tempfile.mkstemp(prefix=".chiron.json.", dir=str(d))
                try:
                    with os.fdopen(fd, "w") as f:
                        json.dump(cur, f, ensure_ascii=False, indent=2)
                    os.replace(tmp, d / "chiron.json")
                except BaseException:
                    try:
                        os.unlink(tmp)
                    except OSError:
                        pass
                    raise
    collisions = {t: v for t, v in seen.items() if len(v) > 1}
    cell = lambda v: "-" if v is None else str(v).replace("|", "\\|").replace("\n", " ")
    lines = [f"# Chiron title normalization ({'APPLIED' if apply else 'dry run'})", "",
             f"Root: `{root}`  ·  lessons scanned: {total}  ·  titles changed: {n_title}  ·  subjects removed or replaced: {n_subj}"
             f"  ·  titles that would become empty (left as is): {len(empties)}  ·  colliding titles: {len(collisions)}",
             "", "## Changes", "", "| dir | old title | new title | old subject | new subject |", "|---|---|---|---|---|"]
    lines += [f"| {cell(r)} | {cell(o)} | {cell(n)} | {cell(s)} | {cell(x)} |" for r, o, n, s, x in rows]
    lines += ["", "## Empty after cleaning", ""] + [f"- {e}" for e in empties]
    lines += ["", "## Collisions (same clean title)", "", "| title | lessons (depth) |", "|---|---|"]
    lines += [f"| {cell(t)} | {cell('; '.join(f'{r} ({dp})' for r, dp in v))} |" for t, v in sorted(collisions.items())]
    Path(report).expanduser().write_text("\n".join(lines) + "\n")
    print(f"{total} lesson(s) scanned; {n_title} title(s) changed; {n_subj} subject(s) removed; {n_depth} depth(s) added; "
          f"{len(empties)} empty; {len(collisions)} collision(s) -> {report}")
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
    r.add_argument("--slug-domain-wins", action="store_true",
                   help="the folder rule replaces a stored domain that contradicts it")
    r.add_argument("--system-from-index", metavar="LIBRARY_INDEX_JSON",
                   help="store the system the Library shows today for medicine lessons that have none")
    nt = sub.add_parser("normalize-titles")
    nt.add_argument("root")
    g2 = nt.add_mutually_exclusive_group(required=True)
    g2.add_argument("--dry-run", action="store_true")
    g2.add_argument("--apply", action="store_true")
    nt.add_argument("--report", required=True)
    nt.add_argument("--subjects-json", metavar="MAP_JSON", help="{slug: real subject} used instead of dropping a slug subject")
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
            for d in lesson_dirs(root):
                if (t := unclean_title(d)):
                    print(f"{d.relative_to(root)}: title not clean: {t!r}")
        return 1 if bad else 0
    if a.cmd == "normalize-titles":
        subj = _json(Path(a.subjects_json).expanduser()) if a.subjects_json else None
        return normalize_titles(a.root, a.apply, a.report, subj)
    return repair(a.root, a.apply, a.report, a.slug_domain_wins, a.system_from_index)


if __name__ == "__main__":
    sys.exit(main())
