#!/usr/bin/env python3
"""Append the consolidated phrase index to a built lesson, and wire its audio.

    python3 add_index.py il-centro-day-2

Reads the phrase rows already present in lesson.html (single source — the index can
never drift from the sections), emits one compact table with its own anchors, and
extends audio/manifest.js so the chiron player injects ▶ on the index rows too.

The index anchors are idx-<pid>, NOT vocab-<pid>: an id must be unique, and the
section rows already own vocab-<pid>. Both point at the same clip.
"""
import json, os, re, sys

DIR = sys.argv[1] if len(sys.argv) > 1 else "il-centro-day-2"
LESSON = os.path.join(DIR, "lesson.html")
MAN = os.path.join(DIR, "audio", "manifest.json")

CSS = """
/* ── indice — the consolidated phrase list ─────────────────────────── */
#indice .idx-head{display:flex;align-items:baseline;gap:.9rem;flex-wrap:wrap}
#indice .idx-head button{background:transparent;border:1px solid var(--rule);border-radius:999px;
  color:var(--muted);font-family:var(--display);font-size:.7rem;letter-spacing:.08em;
  text-transform:uppercase;padding:3px 11px;cursor:pointer}
#indice .idx-head button:hover{background:var(--accent-soft);color:var(--accent)}
#indice .idx-head button[aria-pressed="true"]{background:var(--accent);color:var(--ground);
  border-color:var(--accent)}
.idx{border-top:1px solid var(--rule)}
.idx .r{display:grid;grid-template-columns:1fr;gap:.15rem;padding:.5rem .4rem;
  border-bottom:1px solid var(--rule);border-radius:6px;scroll-margin-top:80px}
.idx .it{font-family:var(--display);font-weight:600;font-size:1.0625rem;letter-spacing:-.008em}
.idx .en{color:var(--muted);font-size:.95rem}
.idx .sec{font-family:var(--mono);font-size:.68rem;color:var(--faint)}
@media(min-width:40rem){.idx .r{grid-template-columns:1fr 1fr auto;column-gap:1.5rem;align-items:baseline}}
#indice.hide-en .idx .en{visibility:hidden}
#indice.hide-en .idx .r:hover .en,#indice.hide-en .idx .r:focus-within .en{visibility:visible}
"""

JS = """
(function(){
  var wrap=document.getElementById('indice'); if(!wrap) return;
  var b=wrap.querySelector('[data-toggle-en]');
  b.addEventListener('click',function(){
    var on=wrap.classList.toggle('hide-en');
    b.setAttribute('aria-pressed', on?'true':'false');
    b.textContent = on ? 'Mostra inglese' : 'Nascondi inglese';
  });
})();
"""


def main():
    doc = open(LESSON, encoding="utf-8").read()
    if 'id="indice"' in doc:
        print("index already present — rebuild the page first"); return

    # section titles, in document order
    secs = {}
    for m in re.finditer(r'<section id="([^"]+)">.*?<h2>(.*?)</h2>', doc, re.S):
        secs[m.group(1)] = re.sub(r"<[^>]+>", "", m.group(2)).strip()

    rows, cur = [], None
    for m in re.finditer(r'<section id="([^"]+)">|<dt id="vocab-([a-z0-9-]+)"[^>]*>(.*?)</dt>\s*<dd>(.*?)</dd>',
                         doc, re.S):
        if m.group(1):
            cur = m.group(1); continue
        pid = m.group(2)
        it = re.sub(r"<[^>]+>", "", m.group(3)).strip()
        en = re.sub(r"<[^>]+>", "", m.group(4)).strip()
        rows.append((pid, it, en, secs.get(cur, "")))

    body = "\n      ".join(
        f'<div class="r" data-row="idx-{pid}">'
        f'<span class="it" id="idx-{pid}" class="chiron-has-audio">{it}</span>'
        f'<span class="en">{en}</span><span class="sec">{sec}</span></div>'
        for pid, it, en, sec in rows)

    section = f"""
  <section id="indice">
    <p class="eyebrow">Indice</p>
    <div class="idx-head">
      <h2>Tutte le frasi</h2>
      <button data-toggle-en aria-pressed="false">Nascondi inglese</button>
    </div>
    <p class="lede">Every phrase in one place — {len(rows)} of them. Hide the English to turn
      the list into a drill; each row still plays, and hovering a hidden row reveals it.</p>
    <div class="idx">
      {body}
    </div>
  </section>
"""
    doc = doc.replace("  <footer>", section + "\n  <footer>", 1)
    doc = doc.replace("</style>", CSS + "\n</style>", 1)
    doc = doc.replace("</body>", f"<script>{JS}</script>\n</body>", 1)
    open(LESSON, "w", encoding="utf-8").write(doc)

    man = json.load(open(MAN))
    by_anchor = {c["sectionId"]: c for c in man["clips"] if c["artifact"] == "phrase"}
    added = 0
    for pid, *_ in rows:
        src = by_anchor.get(f"vocab-{pid}")
        if src and not any(c["sectionId"] == f"idx-{pid}" for c in man["clips"]):
            man["clips"].append({"artifact": "phrase", "sectionId": f"idx-{pid}",
                                 "audioPath": src["audioPath"], "status": "done", "durationS": None})
            added += 1
    json.dump(man, open(MAN, "w"), ensure_ascii=False, indent=1)
    open(os.path.join(DIR, "audio", "manifest.js"), "w", encoding="utf-8").write(
        "window.__chironAudioManifest = " + json.dumps(man, ensure_ascii=False) + ";\n")

    print(f"{LESSON}\n  index rows {len(rows)} · audio anchors added {added} "
          f"· manifest clips now {len(man['clips'])}")


if __name__ == "__main__":
    main()
