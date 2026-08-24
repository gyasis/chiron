#!/usr/bin/env python3
"""Build the series table of contents — index.html across every il-centro-day-* folder.

Derived from what's on disk (cards.json + audio/manifest.json), so it can't drift:
add a day, re-run, it appears.
"""
import json, os, re, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DAYS = sorted(d for d in os.listdir(HERE)
              if re.fullmatch(r"il-centro-day-\d+", d) and os.path.isdir(os.path.join(HERE, d)))

META = {"1": ("3 agosto 2026", "Il turismo selvaggio e il cinema in bianco e nero"),
        "2": ("4 agosto 2026", "La dieta mediterranea e una società competitiva")}


def dur(p):
    if not os.path.exists(p):
        return None
    out = subprocess.run(["/opt/homebrew/bin/ffprobe", "-v", "error", "-show_entries",
                          "format=duration", "-of", "default=nw=1:nk=1", p],
                         capture_output=True, text=True).stdout.strip()
    try:
        s = int(float(out)); return f"{s//60}:{s%60:02d}"
    except ValueError:
        return None


rows = []
for d in DAYS:
    n = d.rsplit("-", 1)[1]
    date, title = META.get(n, ("", f"Day {n}"))
    cards = json.load(open(f"{HERE}/{d}/cards.json")) if os.path.exists(f"{HERE}/{d}/cards.json") else []
    man = json.load(open(f"{HERE}/{d}/audio/manifest.json"))
    phrases = sum(1 for c in man["clips"] if c["artifact"] == "phrase" and c["sectionId"].startswith("vocab-"))
    chapters = sum(1 for c in man["clips"] if c["artifact"] == "section")
    full = dur(f"{HERE}/{d}/audio/lecture/shortened.mp3") or dur(f"{HERE}/{d}/audio/shortened.mp3")
    summ = dur(f"{HERE}/{d}/audio/lecture/summary.mp3") or dur(f"{HERE}/{d}/audio/summary.mp3")
    portable = f"{d}-portable.html"
    rows.append(f"""      <a class="day" href="{d}/lesson.html">
        <span class="n">Day {n}</span>
        <span class="t">{title}</span>
        <span class="d">{date}</span>
        <span class="m">{phrases} frasi · {chapters} capitoli · {len(cards)} carte</span>
        <span class="a">Riassunto {summ or '—'} &nbsp;·&nbsp; Lezione completa {full or '—'}</span>
      </a>""" +
                (f'\n      <a class="port" href="{portable}" download>&#8681; one-file copy</a>'
                 if os.path.exists(f"{HERE}/{portable}") else ""))

CSS = """
.toc{display:flex;flex-direction:column;gap:.6rem}
a.day{display:grid;grid-template-columns:auto 1fr;gap:.15rem 1.1rem;padding:1rem 1.15rem;
  border:1px solid var(--rule);border-radius:6px;background:var(--raised);
  text-decoration:none;color:var(--ink);transition:border-color .14s ease,background .14s ease}
a.day:hover{border-color:var(--accent);background:var(--accent-soft)}
a.day .n{grid-row:1/span 4;font-family:var(--display);font-weight:700;font-size:1.5rem;
  letter-spacing:-.02em;color:var(--accent);align-self:start}
a.day .t{font-family:var(--display);font-weight:600;font-size:1.125rem;letter-spacing:-.008em}
a.day .d,a.day .m,a.day .a{font-family:var(--mono);font-size:.75rem;color:var(--faint)}
a.day .m{color:var(--muted)}
a.port{align-self:flex-start;font-family:var(--mono);font-size:.72rem;color:var(--muted);
  text-decoration:none;border:1px dashed var(--rule);border-radius:999px;padding:2px 10px;
  margin:-.3rem 0 .4rem 1.15rem}
a.port:hover{border-color:var(--accent);color:var(--accent)}

/* Ascolto sits above the lessons: the lessons are built once, the trainer is
   opened every day, so it gets the top slot and the accent fill. */
a.pin{display:grid;grid-template-columns:auto 1fr auto;gap:.15rem 1.1rem;align-items:center;
  padding:1.1rem 1.25rem;border:1px solid var(--accent);border-radius:6px;
  background:var(--accent-soft);text-decoration:none;color:var(--ink);
  transition:filter .14s ease}
a.pin:hover{filter:brightness(1.03)}
a.pin .ic{grid-row:1/span 2;font-size:1.6rem;line-height:1}
a.pin .t{font-family:var(--display);font-weight:700;font-size:1.25rem;letter-spacing:-.01em}
a.pin .s{font-family:var(--mono);font-size:.75rem;color:var(--muted)}
a.pin .go{grid-row:1/span 2;font-family:var(--display);font-size:.7rem;font-weight:600;
  letter-spacing:.13em;text-transform:uppercase;color:var(--accent);white-space:nowrap}
a.pin.down{border-color:var(--rule);background:var(--raised)}
a.pin.down .go,a.pin.down .ic{color:var(--faint);opacity:.6}
"""

doc = f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>il centro di italia</title>
<link rel="stylesheet" href="_assets/series.css">
<style>{CSS}</style></head><body>
<div class="wrap">
  <header class="board">
    <div class="board-meta"><span>il centro di italia</span><span>Barbara Cavallaro</span>
      <span>{len(DAYS)} lezioni</span></div>
    <h1>Indice</h1>
    <p class="lede">Every lesson in the series. Each page carries its own audio —
      the summary, the full lesson, the chapters, and every phrase.</p>
  </header>
  <section>
    <p class="eyebrow">Esercizio quotidiano</p>
    <a class="pin" id="ascolto" href="https://localhost:8777/pilot.html">
      <span class="ic">&#9835;</span>
      <span class="t">Ascolto &mdash; dettato</span>
      <span class="go" id="ascolto-go">apri &rarr;</span>
      <span class="s" id="ascolto-sub">listen, write it, get graded &middot; reads your Anki decks</span>
    </a>
  </section>
  <section>
    <p class="eyebrow">Le lezioni</p>
    <div class="toc">
{chr(10).join(rows)}
    </div>
  </section>
  <footer>il centro di italia · {len(DAYS)} lezioni</footer>
</div>
<script>
  // Ascolto is a separate app on :8777, over https because the microphone
  // needs a secure origin. Resolve the host at load time so the link works
  // both here and from the iPad over the LAN.
  //
  // Deliberately NOT probed: a fetch from this http page to a self-signed
  // https origin always fails, which would report "not running" even when it
  // is. Better an honest link than a confident wrong answer.
  (function(){{
    var a=document.getElementById('ascolto');
    a.href='https://'+location.hostname+':8777/pilot.html';
  }})();
</script>
</body></html>
"""
open(os.path.join(HERE, "index.html"), "w", encoding="utf-8").write(doc)
print(f"index.html · {len(DAYS)} days: {', '.join(DAYS)}")
