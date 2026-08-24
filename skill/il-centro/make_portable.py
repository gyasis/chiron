#!/usr/bin/env python3
"""Build a ONE-FILE portable lesson: every mp3 inlined as a data: URI.

    python3 make_portable.py il-centro-day-2

Why: Chrome's "Save Page As" copies the HTML and the JS but NOT audio that is
referenced from JavaScript, so a saved copy loses every clip. Inlining makes the
page survive being saved, moved, emailed or AirDropped — one file, no folder.

Only the manifest is rewritten (audioPath -> data: URI) and the two scripts are
inlined. The lesson markup is untouched.
"""
import base64, json, mimetypes, os, re, sys

DIR = sys.argv[1] if len(sys.argv) > 1 else "il-centro-day-2"
SRC = os.path.join(DIR, "lesson.html")
OUT = f"{DIR}-portable.html"


# Clips too large to embed. The 45-minute lesson recording is ~16 MB; base64 would add a third
# and push the one-file build past 35 MB — past what mail and AirDrop handle comfortably, for a
# track you would rarely play away from the folder. It stays LINKED; everything else inlines.
SKIP_INLINE = ("audio/registrazione/",)


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "audio/mpeg"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def main():
    doc = open(SRC, encoding="utf-8").read()

    # A portable is ONE file, saved anywhere — ../index.html and its sibling lessons do not
    # travel with it, so inter-lesson nav would render as links that quietly 404. Strip it,
    # using the same regex the injector uses so the two can never drift apart.
    from lesson_nav import STRIP_RE
    doc, n_nav = STRIP_RE.subn("", doc)
    man = json.load(open(os.path.join(DIR, "audio", "manifest.json")))

    cache, inlined, missing, linked = {}, 0, [], []
    for c in man["clips"]:
        p = os.path.join(DIR, c["audioPath"])
        if not os.path.exists(p):
            missing.append(c["audioPath"]); continue
        if any(c["audioPath"].startswith(x) for x in SKIP_INLINE):
            linked.append(c["audioPath"]); continue
        if c["audioPath"] not in cache:          # dedupe: index + section share clips
            cache[c["audioPath"]] = data_uri(p)
            inlined += 1
        c["audioPath"] = cache[c["audioPath"]]

    doc = doc.replace('<script src="audio/manifest.js"></script>',
                      "<script>window.__chironAudioManifest = "
                      + json.dumps(man, ensure_ascii=False) + ";</script>", 1)
    # Every local <script src="…">, not a hardcoded pair. This used to name chiron-audio.js
    # explicitly, which silently stopped being complete the day lesson.js was split out into
    # _assets/ — the portable kept building and kept reporting one live external ref, so a
    # Save-As copy lost the pearl/cloze toggles while the audio still worked.
    for js in re.findall(r'<script src="((?!data:|https?:)[^"]+\.js)"></script>', doc):
        p = os.path.join(DIR, js)
        if not os.path.exists(p):
            missing.append(js)
            continue
        src = open(p, encoding="utf-8").read()
        doc = doc.replace(f'<script src="{js}"></script>',
                          "<script>\n" + src + "\n</script>", 1)

    open(OUT, "w", encoding="utf-8").write(doc)
    left = [x for x in re.findall(r'src="(?!data:)[^"]+"', doc)
            if not any(k in x for k in SKIP_INLINE)]
    mb = os.path.getsize(OUT) / 1024 / 1024
    print(f"{OUT}  ({mb:.1f} MB)")
    print(f"  unique clips inlined : {inlined}  (manifest entries {len(man['clips'])})")
    print(f"  missing on disk      : {missing or 'none'}")
    print(f"  left LINKED (too big): {linked or 'none'}")
    print(f"  inter-lesson nav     : {n_nav} block(s) stripped (portable has no siblings)")
    print(f"  remaining external refs: {left or 'none — fully self-contained'}")


if __name__ == "__main__":
    main()
