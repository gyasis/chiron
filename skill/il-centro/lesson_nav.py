#!/usr/bin/env python3
"""Navigation between lessons — a STANDARD part of building a day, not a later patch.

    from lesson_nav import inject
    inject("il-centro-day-6/lesson.html", 6)      # called by every day's builder

    python3 lesson_nav.py                          # backfill every day already on disk

Every lesson page must be able to reach the index and its neighbours. The series grew one
day at a time and each page ended up a dead end — Days 1-2 had a bare link back to the
index, Days 3, 4 and 6 had no way out at all. That is not a cosmetic gap: a lesson you can
only reach by keeping a tab open is a lesson you stop revisiting, and the whole point of the
index and the portables is that the series is a thing you come back to.

Three properties this has to hold, all of which a hand-written `<a>` would eventually break:

  DERIVED     the chain comes from the day folders actually present, so the missing Day 5
              is skipped rather than producing a link to nothing. Adding Day 7 later needs
              no edit here — the neighbours re-resolve on the next build.
  IDEMPOTENT  existing nav is stripped before new nav is written, so builders can call this
              on every run without stacking duplicate bars.
  PORTABLE-SAFE  a one-file portable has no siblings to navigate to, so `make_portable.py`
              strips these blocks. See STRIP_RE, which is shared for exactly that reason.
"""
from __future__ import annotations

import glob
import os
import re

# Both markers are matched by make_portable.py, which is why the comment fences are here.
# The second pattern retires `add_nav.py`'s older strip: that script predates this one and had
# stopped being run on Days 3+, so injecting here without removing it left Days 1-2 rendering
# TWO stacked nav bars. Its one good idea — the Ascolto link — is folded into _top() below.
STRIP_RE = re.compile(
    r"[ \t]*<!--nav-->.*?<!--/nav-->\n?"
    r"|[ \t]*<!-- ascolto-nav -->.*?<!-- /ascolto-nav -->\n?", re.S)

TITLES = {
    1: "Il primo giorno",
    2: "Medici, treni, abitudini",
    3: "La routine, e come si dice",
    4: "I verbi irregolari",
    6: "Il passato, e la regola del meteo",
}


def days_on_disk(root: str = ".") -> list[int]:
    """Which days exist, in order. Day 5 was never recorded, so the chain must skip it."""
    found = []
    for p in glob.glob(os.path.join(root, "il-centro-day-*/lesson.html")):
        m = re.search(r"il-centro-day-(\d+)", p)
        if m:
            found.append(int(m.group(1)))
    return sorted(found)


def _top() -> str:
    """Index on the left, Ascolto on the right.

    The Ascolto host is resolved at load time rather than hardcoded, so the same file works
    opened locally and served to the iPad over the LAN. It is https on purpose — the
    dictation trainer needs a microphone, and getUserMedia requires a secure origin.
    """
    return (
        '  <!--nav--><nav class="daynav top">\n'
        '    <a href="../index.html">← Tutte le lezioni</a>\n'
        '    <span class="sp"></span>\n'
        '    <a class="go" id="nav-ascolto" href="#">Ascolto &rarr;</a>\n'
        '  </nav>\n'
        '  <script>(function(){var a=document.getElementById("nav-ascolto");'
        'if(a)a.href="https://"+location.hostname+":8777/pilot.html";})();</script>'
        '<!--/nav-->\n')


def _bottom(day: int, days: list[int]) -> str:
    i = days.index(day)
    prev = days[i - 1] if i > 0 else None
    nxt = days[i + 1] if i + 1 < len(days) else None

    def side(d: int | None, cls: str, label: str) -> str:
        if d is None:
            return '    <span class="gap"></span>\n'
        t = TITLES.get(d, f"Day {d}")
        arrow = "←" if cls == "prev" else "→"
        inner = (f'<span class="lbl">{arrow} Day {d}</span>'
                 f'<span class="ttl">{t}</span>')
        return f'    <a class="{cls}" href="../il-centro-day-{d}/lesson.html">{inner}</a>\n'

    return ('  <!--nav--><nav class="daynav bottom">\n'
            + side(prev, "prev", "prev")
            + '    <a href="../index.html">Indice</a>\n'
            + side(nxt, "next", "next")
            + '  </nav><!--/nav-->\n')


def inject(path: str, day: int, days: list[int] | None = None) -> bool:
    """Put the top and bottom nav into a lesson page. Safe to call repeatedly."""
    if days is None:
        days = days_on_disk(os.path.dirname(os.path.dirname(os.path.abspath(path))) or ".")
    if day not in days:
        days = sorted(set(days) | {day})

    doc = open(path, encoding="utf-8").read()
    doc = STRIP_RE.sub("", doc)                       # idempotent: never stack bars

    # The top bar goes inside .wrap, above the masthead, so it shares the page's measure.
    m = re.search(r'(<div class="wrap">\n)', doc)
    if not m:
        print(f"  {path}: no .wrap — skipped")
        return False
    doc = doc[:m.end()] + _top() + doc[m.end():]

    # The bottom bar goes after the footer, the last thing before the wrap closes.
    m = re.search(r"(</footer>\n)", doc)
    if m:
        doc = doc[:m.end()] + _bottom(day, days) + doc[m.end():]
    else:
        doc = doc.replace("</div>\n<script", _bottom(day, days) + "</div>\n<script", 1)

    open(path, "w", encoding="utf-8").write(doc)
    return True


if __name__ == "__main__":
    days = days_on_disk()
    print(f"days on disk: {days}" + ("  (5 missing — chain skips it)" if 5 not in days else ""))
    for d in days:
        p = f"il-centro-day-{d}/lesson.html"
        if inject(p, d, days):
            i = days.index(d)
            prev = days[i - 1] if i else "—"
            nxt = days[i + 1] if i + 1 < len(days) else "—"
            print(f"  day {d}: prev {prev} · next {nxt}")
