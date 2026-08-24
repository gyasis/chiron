#!/usr/bin/env python3
"""Regenerate `day6_page.html` entirely from `day6_data.py`.

    python3 build_day6.py

Day 6's page had drifted into being hand-maintained: the chapter bodies were generated once,
then `sec-cesono` was rewritten in the DATA (8 -> 10 phrases, new pearl, weather framing) while
the rendered page kept the old eight, and the errori/chieste sections were appended straight
into the HTML. Two sources of truth for the same page, silently disagreeing.

R-IC1 means don't hand-assemble the machinery — the editorial voice is still hand-written, but
it lives HERE, next to the data it describes, so a change to `day6_data.py` can never again
leave the page saying something else. Everything below the header is derived.
"""
from __future__ import annotations

import html
import day6_data as D

esc = lambda s: html.escape(s, quote=True)
mmss = lambda t: f"{int(t)//60}:{int(t) % 60:02d}"

# Editorial framing, one entry per chapter. English h2 over the Italian eyebrow, as in Days 1-5.
H2 = {
    "sec-imperfetto": "How things were, and what happened",
    "sec-santhia": "Ottomila abitanti, vicino alla collina",
    "sec-vita": "Novantatré anni",
    "sec-cesono": "C'è means it exists. È means it's like that.",
    "sec-avverbi": "One rule: adjective + -mente",
    "sec-extra": "Two words from outside the lesson",
    "sec-medicina": "Le erbe, il profitto, il glifosato",
}
LEDE = {
    "sec-imperfetto": "Everything so far has been the present. Here the past arrives — and it "
                      "arrives as <em>two</em> tenses that answer different questions.",
    "sec-santhia": "A small town in Piedmont, and the prepositions that come with describing one.",
    "sec-vita": "Ages, marriages and a long life — most of it built on <em>avere</em>.",
    "sec-cesono": "She taught this one through the <b>weather</b>, and gave an outright rule for "
                  "it at 7:57. Every phrase below is hers, with the timestamp it came from — the "
                  "earlier version of this chapter was guessed from the chat log and had the "
                  "grammar right with none of her examples.",
    "sec-avverbi": "The adjective agrees with its noun. The adverb never agrees with anything. "
                   "Same root, two jobs.",
    "sec-extra": "Asked about after the lesson, so they carry no timestamp — every other phrase on this page can be checked against the recording and these two "
                 "cannot. They are here because you wanted them, not because she said them.",
    "sec-medicina": "The argument itself: what grows, what is sprayed on it, and who profits.",
}


def chapters() -> str:
    out = []
    for sid, title, rows in D.CHAPTERS:
        out.append(f'  <section id="{sid}">\n    <p class="eyebrow">{esc(title)}</p>')
        out.append(f'    <h2>{esc(H2[sid])}</h2>\n    <p>{LEDE[sid]}</p>')
        out.append('    <dl class="phrases">')
        for pid, disp, _speak, en, note in rows:
            out.append(f'      <div><dt id="vocab-{pid}" class="chiron-has-audio">{esc(disp)}</dt>')
            out.append(f'        <dd>{esc(en)}</dd>'
                       + (f'\n        <span class="why">{note}</span>' if note else ''))
            out.append('      </div>')
        out.append('    </dl>')
        if sid in D.PEARLS:
            _p, it_, en_ = D.PEARLS[sid]
            out.append(f'''    <div class="pearl">
      <span class="tag">Perla di grammatica</span>
      <p>{it_}</p>
      <button>🇬🇧 English</button>
      <p class="en">{esc(en_)}</p>
    </div>''')
        if sid == "sec-imperfetto":
            t_it, t_body, t_en = D.TRAP
            out.append(f'''    <div class="trap">
      <span class="tag">Quale dei due?</span>
      <p><strong>{t_it}</strong></p>
      <p>{t_body}</p>
      <p class="why">{esc(t_en)}</p>
    </div>''')
        out.append('  </section>\n')
    return "\n".join(out)


def errori() -> str:
    items = "\n".join(f'''      <div class="err">
        <span class="t">{mmss(t)}</span>
        <p class="att"><s>{esc(att)}</s></p>
        <p class="cor">{esc(cor)}</p>
        <p class="rule"><b>{esc(chg)}.</b> {rule}</p>
      </div>''' for t, att, cor, chg, rule in D.ERRORI)
    return f'''  <section id="sec-errori">
    <p class="eyebrow">I miei errori</p>
    <h2>What you reached for, and what it should have been</h2>
    <p>Lifted straight off the recording — the moments you tried something and she came back with
      the right form. <b>Only her form is spoken.</b> Hearing your own mistake read back in a
      confident voice is how it sticks instead of going away.</p>
    <p class="why">Fourteen candidates were flagged automatically; nine were thrown out after
      listening to the context — she was correcting a fact, finishing your sentence, or simply
      agreeing. One was dropped because <i>corso</i> and <i>Covid</i> sound alike and the
      transcriber may have misheard <em>you</em>: teaching a mistake you might not have made is
      worse than missing one you did.</p>

    <div class="errori">
{items}
    </div>
  </section>
'''


def chieste() -> str:
    rows = "\n".join(f'''      <div><dt id="vocab-{pid}" class="chiron-has-audio">{esc(it_)}</dt>
        <dd>{esc(en)}</dd>
        <span class="why">{note}</span>
      </div>''' for pid, it_, en, note in D.CHIESTE)
    return f'''  <section id="sec-chieste">
    <p class="eyebrow">Le parole che ho chiesto</p>
    <h2>Words you asked for out loud</h2>
    <p>Thirty-nine times on this tape you stopped and said <em>come si dice</em>. That is not a
      failure — it is a gap you already know about, which makes it the cheapest kind to close.</p>
    <p class="why">Worth noticing before the list: five more words you asked for out loud —
      <em>la sirena</em>, <em>divertente</em>, <em>scoprire</em>, <em>quando era più giovane</em>
      and <em>ero sorpreso</em> — are phrases <b>this lesson already teaches</b>, so they appear
      once, in their own chapters. You stopped to ask for exactly what the lesson covers. The
      five below are the genuinely new ones.</p>
    <dl class="phrases">
{rows}
    </dl>
    <p class="why"><em>camionista</em> arrived inside an imperfetto — <em>era un camionista</em>,
      a job he had for years, not one he took once. The tense you were being taught kept turning up
      in the answers to questions about something else.</p>
  </section>
'''


def compiti() -> str:
    rows = "\n".join(
        f'      <div class="row"><span>{esc(t)}</span><input type="text" placeholder="?">'
        f'<span class="hint">({esc(h)})</span><button>Mostra</button>'
        f'<span class="ans">{esc(a)}</span></div>' for a, t, h in D.CLOZE)
    return f'''  <section id="sec-compiti">
    <p class="eyebrow">I compiti</p>
    <h2>Racconta com'era</h2>
    <p>Write about someone when they were younger. Stay in the <em>imperfetto</em> for how things
      were, drop into the <em>passato prossimo</em> only for what happened — and use
      <em>c'è / ci sono</em> when you introduce something for the first time.</p>

    <div class="scaffold">
<pre>Quando ___ più giovane, viveva a ___ .          <span class="cue">← imperfetto: era</span>
___ ___ anni e lavorava come ___ .              <span class="cue">← aveva</span>
___ un giardino e ___ molti vicini.             <span class="cue">← c'è / ci sono</span>
Oggi ___ il sole, ma ieri ___ la pioggia.       <span class="cue">← c'è / c'era (meteo)</span>
Poi un giorno ___ ___ che ___ .                 <span class="cue">← passato prossimo</span>
___ sorpreso, perché ___ .                      <span class="cue">← ero</span></pre>
    </div>

    <h3 class="eyebrow">Esercizi</h3>
    <div class="cloze">
{rows}
    </div>

    <h3 class="eyebrow">Check before you send it</h3>
    <ol class="check">
      <li>A state that lasted → <strong>imperfetto</strong> (<code>era</code>, <code>aveva</code>, <code>ero</code>).</li>
      <li>One thing that happened → <strong>passato prossimo</strong> (<code>ho sentito</code>).</li>
      <li>Weather always takes <code>c'è</code> — <em>c'è il vento</em>, <em>c'è la pioggia</em>.</li>
      <li>Introducing something → <code>c'è</code> / <code>ci sono</code>. Describing it → <code>è</code>.</li>
      <li>Age takes <code>avere</code>: <code>aveva 60 anni</code>.</li>
      <li>Adverbs in <code>-mente</code> <strong>never</strong> agree — and adjectives never take it
        (<code>divertente</code>, not <s>divertamente</s>).</li>
    </ol>
  </section>'''


HEADER = f'''  <header class="board">
    <div class="board-meta">
      <span>il centro di italia</span><span>Day 6</span>
      <span>11 agosto 2026</span><span>Barbara Cavallaro</span>
    </div>
    <h1>Quando era più giovane<br>e <em>c'è il vento</em></h1>
    <p class="lede">The past tense, finally — in two pieces that do different work. Plus the
      <em>c'è / ci sono</em> rule she gave outright, and the five things you reached for on tape
      and didn't quite land.</p>
    <p class="next"><span>Prossima lezione</span> <b>9.55</b> <span>stessa ora</span></p>
  </header>

  <div class="recap">
    <span class="tag">Dalla lezione scorsa</span>
    <ul>
{chr(10).join(f'      <li><b>{esc(a)}</b> — {esc(b)}</li>' for a, b in D.RECAP)}
    </ul>
    <p class="why">Day 5 slipped past, so this picks up from Day 4. <i>era</i>, <i>aveva</i> and
      <i>ero</i> are just <i>essere</i> and <i>avere</i> moved into the past.</p>
  </div>

'''


def build_folder(body: str) -> None:
    """Assemble il-centro-day-6/ — the four shared assets, the shell, and cards.json.

    An EMPTY manifest is written when none exists yet, never a stale one: `bake_day.py`
    rewrites it from whatever is in `.audio-src/day-6`, and clobbering a good manifest here
    would silently drop every play button.
    """
    import json, os, shutil
    out = "il-centro-day-6"
    os.makedirs(f"{out}/audio", exist_ok=True)
    for f in ("series.css", "audio.css", "lesson.js", "chiron-audio.js"):
        shutil.copy(f"_assets/{f}", out)
    if not os.path.exists(f"{out}/audio/manifest.json"):
        man = {"clips": []}
        json.dump(man, open(f"{out}/audio/manifest.json", "w"), ensure_ascii=False, indent=1)
        open(f"{out}/audio/manifest.js", "w", encoding="utf-8").write(
            "window.__chironAudioManifest = " + json.dumps(man) + ";\n")

    open(f"{out}/lesson.html", "w", encoding="utf-8").write(f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>il centro di italia — Day 6</title>
<link rel="stylesheet" href="series.css">
<link rel="stylesheet" href="audio.css">
</head><body>
<div class="wrap">
{body}
</div>
<script src="audio/manifest.js"></script>
<script src="chiron-audio.js"></script>
<script src="lesson.js"></script>
</body></html>
""")

    # Navigation is part of BUILDING a lesson, not something applied to it afterwards —
    # otherwise a rebuild silently drops it and the page goes back to being a dead end.
    from lesson_nav import inject
    inject(f"{out}/lesson.html", 6)

    cards = [{"clip": p, "chapter": t, "sectionId": sid, "it": d, "en": e, "note": n}
             for sid, t, rows in D.CHAPTERS for p, d, _s, e, n in rows]
    cards += [{"clip": p, "chapter": "Le parole che ho chiesto", "sectionId": "sec-chieste",
               "it": i, "en": e, "note": n} for p, i, e, n in D.CHIESTE]
    json.dump(cards, open(f"{out}/cards.json", "w"), ensure_ascii=False, indent=1)
    print(f"{out}/ · {len(cards)} cards")


if __name__ == "__main__":
    doc = HEADER + chapters() + "\n" + errori() + "\n" + chieste() + "\n" + compiti()
    n = sum(len(r) for _s, _t, r in D.CHAPTERS)
    doc += (f'\n\n  <footer>il centro di italia · Day 6 · 11 agosto 2026 · '
            f'{n + len(D.CHIESTE)} frasi · dalla registrazione</footer>')
    open("day6_page.html", "w", encoding="utf-8").write(doc)
    print(f"day6_page.html · {len(D.CHAPTERS)} chapters · {n} phrases · "
          f"{len(D.ERRORI)} errori · {len(D.CHIESTE)} chieste · {len(D.CLOZE)} cloze")
    build_folder(doc)
