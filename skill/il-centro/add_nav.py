#!/usr/bin/env python3
"""SUPERSEDED — use `lesson_nav.py`.

This script put an `<!-- ascolto-nav -->` strip at the top of every lesson: Indice, the
current lesson, and a link to Ascolto on :8777. It worked, but it stopped being run as the
series grew, so Days 3, 4 and 6 were built without it and ended up with no way out at all.

`lesson_nav.py` replaces it and does strictly more:

  * the Indice link and the Ascolto link (host resolved at load time, https for the mic)
  * PREVIOUS / NEXT lesson, derived from the day folders on disk, so the missing Day 5 is
    skipped rather than linked to nothing
  * injected by `build_day<N>.py` as part of BUILDING the day, so a rebuild cannot drop it
  * stripped from one-file portables, which have no siblings to navigate to

Its `STRIP_RE` also removes this script's old marker, so any page still carrying the strip is
cleaned on the next build. That mattered: running both left Days 1-2 with two stacked bars.

Kept as a signpost rather than deleted, because the file is referenced in older notes.
"""
import sys

print(__doc__.strip())
print("\n    python3 lesson_nav.py            # backfill every day on disk")
print("    from lesson_nav import inject     # what build_day<N>.py calls\n")
sys.exit(1)
