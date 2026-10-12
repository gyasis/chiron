#!/usr/bin/env python3
"""sans_only — remove every SERIF font from Chiron (themes, shell, builders, generated lessons). Sans only.

A font stack keeps its sans families; serif families (Georgia, Lora, Times, Source Serif …) are dropped and
the generic `serif` becomes `sans-serif`. A stack left with no named family becomes the system sans stack
(on Linux system-ui resolves to DejaVu Sans). Serif families are also removed from Google Fonts URLs.

    sans_only.py fix   <file-or-dir>...      rewrite in place (prints what changed)
    sans_only.py check <file-or-dir>...      exit 1 if any serif font is still declared

Directories are walked for .css .html .mjs .js .py; node_modules / vendor are skipped.
"""
import os, re, sys

SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
SERIF_FAMILIES = ["Source Serif 4", "Source Serif Pro", "Times New Roman", "Libre Baskerville", "EB Garamond",
                  "Noto Serif", "PT Serif", "Georgia", "Lora", "Merriweather", "Playfair Display", "Playfair",
                  "Crimson Text", "Crimson Pro", "Garamond", "Fraunces", "Literata", "Cormorant", "Times", "Cambria",
                  "Bricolage Grotesque"]   # not a serif, but flared/high-contrast at title size: removed on request
_fam = "|".join(re.escape(f) for f in SERIF_FAMILIES)
# one serif family as a stack item, quoted or not, with its separating comma
ITEM = re.compile(rf"""\s*(?:\\?['"])?(?:{_fam})(?:\\?['"])?\s*(?=,|\)|$)\s*,?""", re.I)
GENERIC = re.compile(r"(?<![-\w])serif\b")
# the value of a font-family declaration or a font custom property (--chiron-font-body, --font-display, --serif)
DECL = re.compile(r"""((?:font-family|--[\w-]*font[\w-]*|--serif)\s*:\s*)([^;{}<>\n]+)""", re.I)
GFONT = re.compile(r"family=(?:Bricolage\+Grotesque|Source\+Serif\+4|Source\+Serif\+Pro|Lora|Merriweather|Playfair\+Display|"
                   r"Crimson\+Text|Crimson\+Pro|EB\+Garamond|Fraunces|Literata|Noto\+Serif|PT\+Serif)[^&\"')]*&?")
GURL = re.compile(r"https://fonts\.googleapis\.com/css2?\?[^\"'\s)<>]+")
EXTS = (".css", ".html", ".mjs", ".js", ".py")
SKIP = {"node_modules", "vendor", ".git", "__pycache__"}


def fix_value(v: str) -> str:
    if "mono" in v.lower():
        return v
    trail = v[len(v.rstrip()):]
    core = v.rstrip()
    end = ""
    sans = SANS
    if core.endswith('"') and core.count('"') % 2:      # a stack inside a JS/HTML string: keep the closing quote
        core, end = core[:-1], '"'
    elif core.endswith("'") and core.count("'") % 2:    # inside a single-quoted string: no quotes in the stack
        core, end, sans = core[:-1], "'", SANS.replace("'", "")
    new = ITEM.sub("", core)
    new = GENERIC.sub("sans-serif", new)
    new = re.sub(r",\s*,", ",", new)
    new = re.sub(r"\(\s*(--[\w-]+)\s*,\s*\)", r"(\1)", new)       # var(--x, ) -> var(--x)
    new = re.sub(r",\s*\)", ")", new).strip().strip(",").strip()
    if not new or new.lower() == "sans-serif":
        new = sans
    return new + end + trail


def fix_text(s: str) -> str:
    s = DECL.sub(lambda m: m.group(1) + (fix_value(m.group(2)) if (ITEM.search(m.group(2)) or GENERIC.search(m.group(2))) else m.group(2)), s)
    # serif families out of Google Fonts URLs — the "&"/"?" tidy-up stays INSIDE each URL (never touch JS "&&")
    def url(m):
        u = GFONT.sub("", m.group(0))
        return u.replace("&&", "&").replace("?&", "?").replace("&amp;&amp;", "&amp;").replace("?&amp;", "?")
    return GURL.sub(url, s)


def serif_left(s: str) -> list[str]:
    bad = [m.group(0)[:90] for m in DECL.finditer(s)
           if "mono" not in m.group(2).lower() and (ITEM.search(m.group(2)) or GENERIC.search(m.group(2)))]
    bad += [m.group(0)[:60] for m in GFONT.finditer(s)]
    return bad


def files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for root, dirs, fs in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP]
            for f in fs:
                if f.endswith(EXTS):
                    yield os.path.join(root, f)


def main(argv):
    if len(argv) < 2 or argv[0] not in ("fix", "check"):
        print(__doc__)
        return 2
    changed = found = 0
    for f in files(argv[1:]):
        try:
            s = open(f, encoding="utf-8", newline="").read()      # newline="": CRLF files stay byte-identical
        except (UnicodeDecodeError, OSError):
            continue
        if argv[0] == "check":
            for b in serif_left(s):
                print(f"{f}: {b}")
                found += 1
            continue
        new = fix_text(s)
        if new != s:
            open(f, "w", encoding="utf-8", newline="").write(new)
            changed += 1
    if argv[0] == "check":
        print(f"{found} serif declaration(s) left")
        return 1 if found else 0
    print(f"{changed} file(s) rewritten")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
