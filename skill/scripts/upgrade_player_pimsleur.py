#!/usr/bin/env python3
"""upgrade_player_pimsleur — add the 'pimsleur' drill clip kind to an already-built lesson.html (or the skeleton).

Built lessons carry the player code INLINE, frozen at assembly time, so a player change in shell/ never reaches
them. This patches that inline copy in place. Idempotent; exits 1 if a pattern is missing (an unknown player variant).
Usage: upgrade_player_pimsleur.py <lesson.html> [...]
"""
import re, sys

def upgrade(p):
    h = open(p).read()
    if "artifact === 'pimsleur'" in h:
        print("already patched", p); return
    def sub1(pat, rep, s, flags=0):
        s2, n = re.subn(pat, rep, s, count=1, flags=flags)
        if n != 1: sys.exit(f"pattern not found in {p}: {pat[:60]}")
        return s2
    h = sub1(r"var PANEL_KIND = \{ summary: 0,", "var PANEL_KIND = { pimsleur: -1, summary: 0,", h)
    h = sub1(r"(\n(\s*)if \(c\.artifact === 'summary'\) return 'Summary';)",
             r"\n\2if (c.artifact === 'pimsleur') return c.label || 'Pimsleur drill';\1", h)
    i = h.index("function buildPanel"); j = h.index("group('", h.index("function group", i) + 20)
    ls = h.rfind("\n", 0, j) + 1; indent = h[ls:j]
    h = h[:ls] + f"{indent}group('🎧 Pimsleur drill', clips.filter(function (c) {{ return c.artifact === 'pimsleur'; }}));\n" + h[ls:]
    h = sub1(r"(\n(\s*)var whole = rawClips\.filter)",
             r"\n\2var drill = rawClips.filter(function (c) { return c.artifact === 'pimsleur'; });\1", h)
    h = sub1(r"return whole\.concat\(sects\);", "return drill.concat(whole, sects);", h)
    h = sub1(r"(\n(\s*)if \(c\.artifact === 'summary'\)\s+\{ c\._label = 'Summary'; return; \})",
             r"\n\2if (c.artifact === 'pimsleur')  { c._label = c.label || 'Pimsleur drill'; return; }\1", h)
    open(p, "w").write(h); print("patched", p)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        upgrade(path)
