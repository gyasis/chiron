#!/usr/bin/env python3
"""fsi-compose — skeleton + enrichment -> the lesson's fsi.json, in FSI's own order.

    python3 fsi-compose.py --lesson 2

The last deterministic step. It owns ONE decision: what a lesson is made of and in what
sequence. FSI is explicit that inverting or skipping its steps "will seriously diminish
the pay-off," so the order here is the book's, not ours:

    Cultural Notes -> Setting the Scene -> Hearing It -> Seeing It -> Fill 1 -> Fill 2
    -> Vocabolario -> Usage Notes -> Pearls -> Additional Vocab -> Pronunciation
    -> Rehearsal -> drills -> Putting It Together -> Interpreter -> narrative -> MCQ
    -> Role Play -> Situations -> Live conversation -> Match Madness -> Regione

A section whose source material is empty is DROPPED, never padded. A lesson with no new
vocabulary simply has no vocabulary step; an invented section is worse than an absent one.
"""
from __future__ import annotations
import argparse, datetime, json, re, sys
from pathlib import Path

GEN = Path.home() / "Documents/generated"
SK  = GEN / "fsi-course/skeletons"


# Canonical Italian titles. These live HERE, not in the enricher, because the enricher
# titles each lesson in ISOLATION — which is how the hotel run came out as All'Albergo I /
# All'hotel II / All'Hotel III / All'albergo IV: four consecutive lessons, two nouns, two
# capitalisations. A series has to be named as a series. Italian capitalisation throughout:
# first word and proper nouns only.
TITLES_IT = {
     1: "All'aeroporto I",       2: "All'aeroporto II",      3: "All'ufficio di cambio",
     4: "Chiedere l'ora",        5: "All'albergo I",         6: "All'albergo II",
     7: "All'albergo III",       8: "All'albergo IV",        9: "Andare in taxi",
    10: "Spostarsi in città",   11: "All'ambasciata I",     12: "All'ambasciata II",
    13: "Comprare vestiti",     14: "Al negozio di scarpe", 15: "Mangiare fuori I",
    16: "Mangiare fuori II",    17: "La telefonata",
}


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def build(n: int) -> dict:
    sk_p, en_p = SK / f"lesson-{n:02d}.skeleton.json", SK / f"lesson-{n:02d}.enrich.json"
    if not sk_p.exists(): sys.exit(f"no skeleton for lesson {n}")
    sk = json.loads(sk_p.read_text())
    E  = json.loads(en_p.read_text()) if en_p.exists() else {}
    prose = E.get("prose", {}) or {}
    steps = []

    def add(**kw): steps.append(kw)

    # dialog turns carry their authored English gloss
    glosses = (E.get("glosses") or {}).get("en") or []
    turns = []
    for i, t in enumerate(sk["dialog"]):
        turns.append({"n": t["n"], "who": t["who"], "label": t["label"], "it": t["it"],
                      **({"en": glosses[i]} if i < len(glosses) else {})})

    if prose.get("cultural"):
        add(step="CULTURAL NOTES", title=prose.get("culturalTitle") or "Cultural Notes",
            kind="prose", body=prose["cultural"])
    if sk["blocks"].get("scene"):
        add(step="SETTING THE SCENE", title="Setting the Scene", kind="scene",
            text=re.sub(r"\s+", " ", sk["blocks"]["scene"]).strip())
    if turns:
        add(step="HEARING IT", title="Hearing It", kind="listen", dialogRef="main",
            instruction="With books closed, listen to the dialog. Try to guess what is going on.")
        add(step="SEEING IT", title="Seeing It — il dialogo", kind="dialog",
            note="Look at the dialog silently while listening.",
            dialog={"id": "main", "turns": turns})

    # FSI removes support progressively: pass 1 blanks every other content word, pass 2 more.
    fill = sk.get("fill") or []
    if fill:
        add(step="SEEING IT", title="Fill in the Blanks — 1", kind="fill", level=1,
            dialogRef="main",
            instruction="Listen to the dialog once more and fill in the blanks with the missing words.",
            items=fill)
        harder = []
        for it in fill:
            words, ans = it["template"].split(), list(it["answers"])
            out, extra = [], []
            k = 0
            for w in words:
                if w == "___":
                    out.append("___"); extra.append(ans[k]); k += 1
                elif len(re.sub(r"\W", "", w)) > 4 and len(extra) < len(ans) + 2:
                    out.append("___"); extra.append(re.sub(r"[.,?!]$", "", w))
                else:
                    out.append(w)
            harder.append({"template": " ".join(out), "answers": extra})
        add(step="SEEING IT", title="Fill in the Blanks — 2", kind="fill", level=2,
            dialogRef="main",
            instruction="Again — but more is taken away this time. FSI removes support progressively, on purpose.",
            items=harder)

    notes = {x["it"]: x["note"] for x in (E.get("vocabNotes") or {}).get("notes", [])}
    if sk.get("vocab"):
        add(step="Vocabulary", title="Vocabolario", kind="vocab",
            note="First as a group, then individually — repeat each item aloud, always checking the English.",
            items=[{"it": v["it"], "en": v["en"], **({"note": notes[v["it"]]} if v["it"] in notes else {})}
                   for v in sk["vocab"]])
    if sk["blocks"].get("usageNotes"):
        body = [re.sub(r"\s+", " ", l).strip() for l in sk["blocks"]["usageNotes"].split("\n")
                if len(l.strip()) > 25][:6]
        if body:
            add(step="Language - Usage Notes", title="Language–Usage Notes", kind="notes", items=body)
    if (E.get("pearls") or {}).get("pearls"):
        add(step="Language - Usage Notes", title="Perle di grammatica", kind="pearls",
            items=E["pearls"]["pearls"])
    if sk.get("additionalVocab"):
        add(step="Additional Vocabulary", title="Vocabolario supplementare", kind="vocab",
            items=sk["additionalVocab"])

    learner_lines = [t for t in turns if t["who"] == "learner"]
    if learner_lines:
        add(step="GETTING THE FEEL OF IT", title="Pronunciation Practice", kind="repeat", id="pron",
            instruction="Lucrezia says each of your lines. Hear it, then say it back — you are scored on what actually came out.",
            lines=[{"label": "Lucrezia", "it": t["it"], **({"en": t["en"]} if t.get("en") else {})}
                   for t in learner_lines])
        add(step="GETTING THE FEEL OF IT", title="Restricted Rehearsal — con Lucrezia", kind="roleplay",
            id="rehearsal",
            instruction="Lucrezia takes the Italian part. Play the whole scene through with her.",
            setup="The same scene as the dialog — but this time nothing is on the page for you.",
            turns=[{**t, "cue": "Your line."} if t["who"] == "learner" else t for t in turns])

    for i, d in enumerate(sk.get("drills") or [], 1):
        if not d["items"]: continue
        add(step="GETTING THE FEEL OF IT", title=f"Working with the Language — Modello {i}",
            kind="drill", id=f"drill{i}",
            instruction="Lucrezia asks; you answer aloud according to the model, before revealing.",
            model=d["model"], items=d["items"])

    lc = E.get("lc") or {}
    if lc.get("text"):
        add(step="Listening Comprehension", title="Il racconto — listen once", kind="narrative",
            id="lcnarr", text=lc["text"], en=lc.get("en", ""),
            note=("⚠ The original FSI narrative was on the 1992 tape, which is not digitized. "
                  "<strong>This narrative is authored for this course</strong>, built to fit the book's own questions."),
            instruction="Listen to the short narrative once. Do not open the transcript until you have answered.")
        qs = []
        if sk.get("mcq"):                       # book's options + authored answer key
            ans = lc.get("answers") or []
            for j, q in enumerate(sk["mcq"]):
                qs.append({"n": q["n"], "stem": f"{q['n']}.", "options": q["options"],
                           "answer": ans[j] if j < len(ans) else None})
        else:                                    # authored outright (the book has none)
            for j, q in enumerate(lc.get("questions") or [], 1):
                qs.append({"n": j, "stem": q.get("stem", f"{j}."), "options": q["options"],
                           "answer": q.get("answer"), "why": q.get("why")})
        if qs:
            add(step="Listening Comprehension", title="Listening Comprehension", kind="mcq",
                instruction="Based on what you heard, select the one letter that best reflects the narrative.",
                questions=qs)

    live = E.get("live") or {}
    sits = (E.get("situations") or {}).get("situations") or []
    if sits:
        add(step="USING IT", title="Using It — le situazioni", kind="situations",
            note="FSI says \"create your own situation\" — which assumes a classroom partner. These three scenes are authored for a solo learner.",
            instruction="Three situations, each a little further from the script. Take the initiative.",
            items=[{**s, "id": s.get("id") or f"sit{i}"} for i, s in enumerate(sits, 1)])
    if live.get("role"):
        add(step="USING IT", title="Conversazione dal vivo — con l'agente", kind="conversation",
            id="live", role=live["role"], goal=live.get("goal", ""),
            setup=live.get("setup", ""),
            instruction="No script. Answer in Italian, by voice or by typing — then get a review of how it went.")

    mm = mk_match(sk)
    if mm: add(**mm)
    if prose.get("region"):
        add(step="REGIONE", title=prose.get("regionTitle") or "Regione", kind="prose", body=prose["region"])

    return {"lesson": sk["lesson"], "title": sk["title"],
            "titleIt": TITLES_IT.get(sk["lesson"]) or prose.get("titleIt") or sk["title"],
            "source": sk["source"], "persona": "lucrezia", "steps": steps}


def mk_match(sk) -> dict | None:
    """Match Madness sets drawn from THIS lesson only. A set needs >= 5 pairs, so a thin
    lesson simply gets fewer sets rather than padded ones."""
    sets = []
    core = [v for v in sk.get("vocab", []) if len(v["it"]) < 34][:10]
    if len(core) >= 5:
        sets.append({"id": "set-1", "title": "Vocabolario", "mode": "vocab-pair",
                     "pairs": [{"id": f"v{i}", "left": v["it"], "right": v["en"][:38]}
                               for i, v in enumerate(core, 1)]})
    extra = [v for v in sk.get("additionalVocab", []) if len(v["it"]) < 34][:10]
    if len(extra) >= 5:
        sets.append({"id": "set-2", "title": "Vocabolario supplementare", "mode": "vocab-pair",
                     "pairs": [{"id": f"a{i}", "left": v["it"], "right": v["en"][:38]}
                               for i, v in enumerate(extra, 1)]})
    if not sets: return None
    return {"step": "MATCH MADNESS", "title": "Match Madness", "kind": "matchmadness",
            "id": "mm", "timerSec": 120, "sets": sets,
            "note": "Drawn from this lesson only. The clock is the opponent — a correct match buys a second, a wrong one costs three.",
            "instruction": "Pick a set and go. Speed matters more than caution."}


def write_chiron_json(out: Path, L: dict) -> int:
    """Register the lesson with the chiron library.

    build-library-index.mjs reads `chiron.json` and NOTHING else — it never inspects the
    audio directory. A lesson missing this file therefore shows its raw directory slug as
    the title (`chiron-italian-fsi-02-at-the-airport-ii`) and reports 0 clips no matter
    how much audio is on disk, so a fully-baked lesson looks unbaked. Every normal chiron
    lesson gets this written by the accept/bundle step; the FSI pipeline must do it itself
    — omitting it was exactly this bug.
    """
    audio = out / "audio"
    clips = sum(len(list(p.glob("*.mp3"))) for p in audio.iterdir() if p.is_dir()) if audio.is_dir() else 0
    n = L["lesson"]
    cj = {"format": "chiron/1",
          "title": f"Chiron \u00b7 FSI {n:02d} \u00b7 {L['titleIt']} \u2014 {L['title']}",
          "entry": "lesson.html", "domain": "language-it",
          "created": datetime.date.today().isoformat(), "audioClips": clips,
          "generator": "chiron", "subject": "FSI Italian FAST", "level": "A1-A2"}
    (out / "chiron.json").write_text(json.dumps(cj, ensure_ascii=False, indent=2), encoding="utf-8")
    return clips


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", type=int, required=True)
    a = ap.parse_args()
    L = build(a.lesson)
    title_slug = slug(L["title"])
    out = GEN / f"chiron-italian-fsi-{a.lesson:02d}-{title_slug}"
    out.mkdir(parents=True, exist_ok=True)
    (out / "fsi.json").write_text(json.dumps(L, ensure_ascii=False, indent=2), encoding="utf-8")
    clips = write_chiron_json(out, L)
    kinds = {}
    for s in L["steps"]: kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    print(f"L{a.lesson:02d} {L['titleIt']:<26} {len(L['steps']):>2} steps {clips:>4} clips  "
          + " ".join(f"{k}:{v}" for k, v in sorted(kinds.items())))
    print(f"     -> {out}/fsi.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
