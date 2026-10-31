#!/usr/bin/env python3
"""build_source_lesson — build a Chiron lesson whose audio IS a source recording (a video's own voice), cut into clips.

    build_source_lesson.py SPEC.json [--no-drill]

SPEC = { "out": dir, "slug", "titleIt", "titleEn", "subtitle"?, "labels": [str]?, "domain": "language-it",
         "source": {"audio": path to the original recording, "url"?, "title"?},
         "intro": {"it", "en"}?,                    # the narrator's spoken overview (the only synthesized speech)
         "entries": [{id, it, en, example_it?, example_en?, span: [s, e],
                      clips: {word, word_slow?, en, example_it?, example_en?}: [s, e] source seconds,
                      segments?: [{kind, s, e}] every spoken line of the entry, for the play-through highlight}],
         "anki": {"linked": {id: [note…]}, "new": [id…]}? }        # from anki_link.py

What it writes into SPEC.out (a normal Library-visible lesson dir):
  audio/clips/<id>-<kind>.wav        every clip, cut from the source, levelled (never re-synthesized)
  audio/phrase/vocab-<id>[-ex].mp3   the lesson player's inline ▶ on each word / example row
  audio/playthrough.mp3 + playthrough.timeline.js   the whole lesson in order, for the play-through pane
  audio/intro.mp3                    the narrator's overview (target voice, Italian)
  pimsleur.json + audio/pimsleur.mp3 a source-audio drill (pimsleur_drill.py, source_audio mode)
  content.json -> lesson.html        assemble-language.mjs, then the play-through pane and the drill player inlined
  cards.json                         Anki: notes that already teach a word (linked) and the words that need a card
"""
from __future__ import annotations

import argparse, datetime, importlib.util, json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
RATE = 44100
GAP = 1.0                     # silence between entries in the play-through
PAD = (0.12, 0.25)            # keep the onset and the decay of each span

_spec = importlib.util.spec_from_file_location("pimsleur_drill", os.path.join(HERE, "pimsleur_drill.py"))
pd = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(pd)


def run(*a):
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"command failed ({r.returncode}): {' '.join(map(str, a))[:200]}\n{r.stderr[-600:]}")
    return r.stdout


def dur(p):
    return float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p))


def cut(src, s, e, dst, pad=(0.05, 0.08), lufs="-20"):
    """Cut [s, e] from the source, mono, levelled to `lufs` with tts-normalize."""
    tmp = dst + ".raw.wav"
    run("ffmpeg", "-y", "-v", "error", "-ss", f"{max(0, s - pad[0]):.3f}", "-to", f"{e + pad[1]:.3f}", "-i", src,
        "-ac", "1", "-ar", str(RATE), "-af", "afade=t=in:d=0.02", tmp)
    run("tts-normalize", tmp, dst, lufs)
    os.remove(tmp)
    return dst


def to_mp3(wav, mp3):
    os.makedirs(os.path.dirname(mp3), exist_ok=True)
    run("ffmpeg", "-y", "-v", "error", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "4", mp3)


def build(spec_path, drill=True):
    S = json.load(open(spec_path))
    out, src = os.path.expanduser(S["out"]), os.path.expanduser(S["source"]["audio"])
    A = os.path.join(out, "audio")
    for d in ("clips", "phrase", "playthrough-parts"):
        os.makedirs(os.path.join(A, d), exist_ok=True)
    linked = (S.get("anki") or {}).get("linked") or {}
    newset = set((S.get("anki") or {}).get("new") or [])

    # 1. clips
    for e in S["entries"]:
        for kind, c in e["clips"].items():
            if c:
                cut(src, c[0], c[1], os.path.join(A, "clips", f"{e['id']}-{kind}.wav"), lufs="-18" if kind.endswith("en") else "-20")
        to_mp3(os.path.join(A, "clips", f"{e['id']}-word.wav"), os.path.join(A, "phrase", f"vocab-{e['id']}.mp3"))
        if e["clips"].get("example_it"):
            to_mp3(os.path.join(A, "clips", f"{e['id']}-example_it.wav"), os.path.join(A, "phrase", f"vocab-{e['id']}-ex.mp3"))
    print(f"[clips] {sum(1 for e in S['entries'] for c in e['clips'].values() if c)} cut from {os.path.basename(src)}")

    # 2. play-through: each entry's whole source span, in lesson order
    parts, tl, t = [], [], 0.0
    sil = os.path.join(A, "playthrough-parts", "gap.wav")
    run("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=mono", "-t", str(GAP), sil)
    for e in S["entries"]:
        s0, s1 = e["span"][0] - PAD[0], e["span"][1] + PAD[1]
        p = os.path.join(A, "playthrough-parts", f"{e['id']}.wav")
        run("ffmpeg", "-y", "-v", "error", "-ss", f"{max(0, s0):.3f}", "-to", f"{s1:.3f}", "-i", src, "-ac", "1", "-ar", str(RATE), p)
        d = dur(p)
        rel = lambda c: [round(t + c[0] - s0, 2), round(t + c[1] - s0, 2)]
        tl.append({"id": e["id"], "t0": round(t, 2), "t1": round(t + d, 2), "it": e["it"], "en": e["en"],
                   "exIt": e.get("example_it"), "exEn": e.get("example_en"),
                   "anki": "linked" if e["id"] in linked else "new" if e["id"] in newset else None,
                   # every spoken line of the entry when classified (entry.segments), else just the chosen clips
                   "parts": sorted([{"kind": g["kind"], "t0": rel([g["s"], g["e"]])[0], "t1": rel([g["s"], g["e"]])[1]}
                                    for g in e["segments"]] if e.get("segments") else
                                   [{"kind": k, "t0": rel(c)[0], "t1": rel(c)[1]} for k, c in e["clips"].items() if c],
                                   key=lambda x: x["t0"])})
        parts += [p, sil]; t += d + GAP
    lst = os.path.join(A, "playthrough-parts", "concat.txt")
    open(lst, "w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in parts))
    run("ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-af", "loudnorm=I=-18:TP=-1.5:LRA=11",
        "-ar", str(RATE), "-codec:a", "libmp3lame", "-q:a", "3", os.path.join(A, "playthrough.mp3"))
    shutil.rmtree(os.path.join(A, "playthrough-parts"))
    total = round(dur(os.path.join(A, "playthrough.mp3")), 2)

    # 3. the narrator's overview: the one synthesized line, in the target voice
    intro = None
    if S.get("intro"):
        baker = pd.Baker(os.path.join(A, "pimsleur-cache"), None)
        to_mp3(baker.clip("frame", S["intro"]["it"]), os.path.join(A, "intro.mp3"))
        intro = {"src": "audio/intro.mp3", **S["intro"]}
    data = {"mode": "entries", "src": "audio/playthrough.mp3", "durationS": total, "entries": tl, "intro": intro,
            "source": S["source"].get("url")}
    open(os.path.join(A, "playthrough.timeline.js"), "w").write(
        "window.__chironPlaythrough = " + json.dumps(data, ensure_ascii=False) + ";\n")
    print(f"[playthrough] {len(tl)} entries, {total/60:.1f} min")

    # 4. read card
    def card_note(e):
        return (f"{e.get('example_it') or ''}<br><span class=\"muted\">{e.get('example_en') or ''}</span>") if e.get("example_it") else ""
    def anki_cell(e):
        h = linked.get(e["id"])
        return f"già in Anki · {h[0]['decks'][0] if h and h[0].get('decks') else ''}" if h else "nuova carta"
    content = {
        "title": S["titleIt"], "subtitle": S.get("subtitle") or f"{S['titleEn']} — ascolta tutto ▶, poi le parole",
        "langName": "Italiano", "cefr": "A2", "domain": S.get("domain", "language-it"),
        "coldOpen": S.get("intro") or {"it": S["titleIt"], "en": S["titleEn"]},
        "sections": [
            {"id": "ascolta", "title": "Ascolta tutta la lezione",
             "introHtml": "<p>L’audio originale, dall’inizio alla fine. Le parole scorrono sopra mentre ascolti. "
                          "<em>Senza inglese</em> nasconde la traduzione per metterti alla prova.</p><div id=\"chiron-playthrough\"></div>"},
            {"id": "parole", "title": "Le parole",
             "vocab": [{"slug": e["id"], "it": e["it"], "en": e["en"], "note": anki_cell(e)} for e in S["entries"]]},
            {"id": "frasi", "title": "Le frasi",
             "vocab": [{"slug": f"{e['id']}-ex", "it": e["example_it"], "en": e.get("example_en") or "", "note": ""}
                       for e in S["entries"] if e.get("example_it")]},
        ],
        "matchMadness": {"pairs": [{"a": e["it"], "b": e["en"]} for e in S["entries"]]},
        "srCards": [{"front": e["en"], "back": e["it"], "tags": ["source-audio", S["slug"]]} for e in S["entries"] if e["id"] in newset],
    }
    json.dump(content, open(os.path.join(out, "content.json"), "w"), ensure_ascii=False, indent=1)
    json.dump({"format": "chiron/1", "title": f"Chiron · {S['titleIt']}", "entry": "lesson.html", "domain": content["domain"],
               "created": datetime.date.today().isoformat(), "generator": "chiron", "lessonFormat": "source-audio",
               "source": S["source"].get("url"), **({"labels": S["labels"]} if S.get("labels") else {})},
              open(os.path.join(out, "chiron.json"), "w"), indent=2)
    json.dump({"linked": linked, "new": sorted(newset)}, open(os.path.join(out, "cards.json"), "w"), ensure_ascii=False, indent=1)

    # manifest: inline ▶ on every word / example row (the player reads audio/manifest.json)
    clips = [{"artifact": "phrase", "sectionId": f"vocab-{os.path.splitext(f)[0][len('vocab-'):]}", "audioPath": f"audio/phrase/{f}",
              "status": "done", "durationS": round(dur(os.path.join(A, "phrase", f)), 2)} for f in sorted(os.listdir(os.path.join(A, "phrase")))]
    json.dump({"clips": clips}, open(os.path.join(A, "manifest.json"), "w"), ensure_ascii=False, indent=2)
    open(os.path.join(A, "manifest.js"), "w").write(f"window.__chironAudioManifest = {json.dumps({'clips': clips}, ensure_ascii=False)};\n")

    # 5. drill from the same clips
    if drill:
        bank = {"title": f"Pimsleur · {S['titleIt']}", "album": S.get("album") or S["titleIt"], "source_audio": True,
                "intro": [S["intro"]["it"]] if S.get("intro") else [],
                "items": [{"id": e["id"], "it": e["it"], "en": e["en"],
                           "audio": {"it": f"audio/clips/{e['id']}-word.wav", "en": f"audio/clips/{e['id']}-en.wav"}}
                          for e in S["entries"] if e["clips"].get("en")]}
        json.dump(bank, open(os.path.join(out, "pimsleur.json"), "w"), ensure_ascii=False, indent=1)
        rep = pd.build(out, qc=True)
        if rep["failed"]:
            print(f"[drill] QC still failing on generated lines: {rep['failed']}")

    # 6. assemble, then inline the play-through pane and the drill player
    run("node", os.path.join(HERE, "assemble-language.mjs"), out)
    html_p = os.path.join(out, "lesson.html")
    html = open(html_p).read()
    js = open(os.path.join(SKILL, "shell", "playthrough.js")).read()
    tag = '<script src="audio/playthrough.timeline.js"></script>\n<script>\n' + js + "\n</script>\n"
    html = html.replace("</body>", tag + "</body>", 1) if "</body>" in html else html + tag
    open(html_p, "w").write(html)
    if drill:
        run(sys.executable, os.path.join(HERE, "upgrade_player_pimsleur.py"), html_p)
    print(f"[done] {html_p}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("spec"); ap.add_argument("--no-drill", action="store_true")
    a = ap.parse_args()
    build(a.spec, drill=not a.no_drill)
