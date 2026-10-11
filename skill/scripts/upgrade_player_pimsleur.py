#!/usr/bin/env python3
"""upgrade_player_pimsleur — add the 'pimsleur' drill clip kind to an already-built lesson.html (or the skeleton).

Built lessons carry the player code INLINE, frozen at assembly time, so a player change in shell/ never reaches
them. An assembled lesson can hold SEVERAL copies (the donor lesson's player AND shell/main.js), so every <script>
block is patched on its own: a block that already knows 'pimsleur' is left alone, a block with player code that
does not is upgraded. Idempotent. Exits 1 if a player block matches none of the known shapes.
Usage: upgrade_player_pimsleur.py <lesson.html> [...]
"""
import json, os, re, sys

READALONG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shell", "pimsleur-readalong.js")
MARK = "artifact === 'pimsleur'"
MARK_MIN = "artifact==='pimsleur'"


class Unknown(Exception):
    pass


def _sub(pat, rep, s):
    s2, n = re.subn(pat, rep, s, count=1)
    if n != 1:
        raise Unknown(pat[:60])
    return s2


def _desktop(js: str) -> str:
    """The 🎧 Listen panel: PANEL_KIND, its labels, and the drill group shown first."""
    js = _sub(r"var PANEL_KIND = \{ summary: 0,", "var PANEL_KIND = { pimsleur: -1, summary: 0,", js)
    js = _sub(r"(\n(\s*)if \(c\.artifact === 'summary'\) return 'Summary';)",
              r"\n\2if (c.artifact === 'pimsleur') return c.label || 'Pimsleur drill';\1", js)
    i = js.index("function buildPanel")
    j = js.index("group('", js.index("function group", i) + 20)
    ls = js.rfind("\n", 0, j) + 1
    return js[:ls] + f"{js[ls:j]}group('🎧 Pimsleur drill', clips.filter(function (c) {{ return c.artifact === 'pimsleur'; }}));\n" + js[ls:]


def _mobile(js: str) -> str:
    """The mobile bottom bar + full-screen now-playing: clip order and labels."""
    if "var whole = rawClips.filter" in js:
        js = _sub(r"(\n(\s*)var whole = rawClips\.filter)",
                  r"\n\2var drill = rawClips.filter(function (c) { return c.artifact === 'pimsleur'; });\1", js)
        js = _sub(r"return whole\.concat\(sects\);", "return drill.concat(whole, sects);", js)
        return _sub(r"(\n(\s*)if \(c\.artifact === 'summary'\)\s+\{ c\._label = 'Summary'; return; \})",
                    r"\n\2if (c.artifact === 'pimsleur')  { c._label = c.label || 'Pimsleur drill'; return; }\1", js)
    # compact copies (scripts/inject-mobile-layer.js, older donor lessons): any param name, any spacing, maybe twice.
    # The drill is clip 0 of the manifest (pimsleur_drill.py and lib/audio-bake.ts both put it first), so letting it
    # through the "whole lesson" filter is enough to list it first — no rewriting of the return expression.
    js, n1 = re.subn(r"(function buildOrderedClips\(\w+\)\{\s*return \w+\.filter\(function\(c\)\{return )(c\.artifact==='summary')",
                     r"\1c.artifact==='pimsleur'||\2", js)
    js, n2 = re.subn(r"(function labelClips\(clips\)\{\s*clips\.forEach\(function\(c\)\{\s*)(if\s*\(c\.artifact==='summary'\))",
                     r"\1if(c.artifact==='pimsleur'){c._label=c.label||'Pimsleur drill';return;}\2", js)
    if not n1 or n1 != n2:
        raise Unknown(f"compact player: {n1} buildOrderedClips vs {n2} labelClips")
    return js

def upgrade_js(js: str) -> tuple[str, int]:
    """Patch every unpatched player part in one block of JS. Returns (js, parts patched)."""
    done = 0
    if "var PANEL_KIND" in js and "pimsleur: -1" not in js:
        js, done = _desktop(js), done + 1
    if "function buildOrderedClips" in js and not re.search(r"function buildOrderedClips[^}]*pimsleur", js):
        js, done = _mobile(js), done + 1
    return js, done


def ensure_timeline_js(lesson_dir: str) -> None:
    """Lessons baked before the read-along have only pimsleur.timeline.json: derive the .js twin (file:// pages)."""
    src = os.path.join(lesson_dir, "audio", "pimsleur.timeline.json")
    dst = src[:-2]   # .json -> .js
    if os.path.exists(src) and not os.path.exists(dst):
        tl = json.load(open(src))
        open(dst, "w").write("window.__chironPimsleurTimeline = "
                             + json.dumps({"durationS": tl.get("durationS"), "timeline": tl.get("timeline", [])},
                                          ensure_ascii=False) + ";\n")


def upgrade(path: str) -> int:
    h = open(path).read()
    out, last, total = [], 0, 0
    for m in re.finditer(r"(<script[^>]*>)(.*?)(</script>)", h, re.S):
        try:
            js, n = upgrade_js(m.group(2))
        except Unknown as e:
            sys.exit(f"{path}: unknown player shape near: {e}")
        out += [h[last:m.start(2)], js]
        last, total = m.end(2), total + n
    out.append(h[last:])
    h = "".join(out)
    # read-along: the drill's words in sync with the audio (inlined: lessons must work offline)
    js = open(READALONG).read().replace("</script", "<\\/script")
    block = f"<script>\n{js}\n</script>"
    old = re.search(r"<script>\n/\* ── Chiron Pimsleur read-along.*?</script>", h, re.S)
    if old and old.group(0) != block:                  # an older read-along: replace it, so fixes reach every lesson
        h = h[:old.start()] + block + h[old.end():]
        total += 1
    elif not old and "</body>" in h:
        h = h.replace("</body>", block + "\n</body>", 1)
        total += 1
    if total:
        open(path, "w").write(h)
    ensure_timeline_js(os.path.dirname(os.path.abspath(path)))
    print(f"{'patched' if total else 'already current'} ({total} player part(s)): {path}")
    return total


if __name__ == "__main__":
    for p in sys.argv[1:]:
        upgrade(p)
