#!/usr/bin/env python3
"""fsi-extract — sliced FSI lesson -> a structured skeleton for fsi.json.

    python3 fsi-extract.py --lesson 2 [--out <dir>]

Deterministic. Pulls out everything the BOOK already states — dialog turns with their
speakers, the numbered vocabulary, the fill-in-the-blank templates with answers, the
model drills, the variants, the multiple-choice options, the region prose. No LLM.

What it deliberately does NOT produce, because the book does not contain it:
    * English glosses for the dialog turns (FSI prints the Italian only)
    * grammar pearls
    * the authored situations and the live-conversation scene
    * the Listening Comprehension narrative (it was on the 1992 tape)
Those are the enrichment pass (fsi-enrich), and keeping the split honest is the point:
this file is transcription, that one is authorship.

Writes <out>/lesson-NN.skeleton.json  — same shape as fsi.json but with `_todo` markers
where enrichment is required.
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

SRC = Path.home() / "Documents/generated/fsi-course/source"

# The 1992 scan misreads l/I as / and u. These are safe, high-frequency repairs — only
# applied to ENGLISH text, never to the Italian (which must stay verbatim).
OCR = [
    (r"\bIta/y\b", "Italy"), (r"\btrave/er\b", "traveler"), (r"\bsi/ent/y\b", "silently"),
    (r"\bIistening\b", "listening"), (r"\bta the tape\b", "to the tape"),
    (r"\bindividual/y\b", "individually"), (r"\bse/ect\b", "select"),
    (r"\bfi/i in\b", "fill in"), (r"\bFili in\b", "Fill in"), (r"\bdia/og\b", "dialog"),
    (r"\bmode/o?\b", "model"), (r"\bwho/e\b", "whole"), (r"\btogo\b", "to go"),
    (r"\bc/osed\b", "closed"), (r"\bAli\b", "All"), (r"\ba/ways\b", "always"),
    # a closing paren scanned as J/j — only after a letter, so real words are untouched
    (r"([a-z])J\b", r"\1)"), (r"\bnameJ\b", "name)"),
]
# Applied to ITALIAN. Only unambiguous scanner damage — never a word choice.
OCR_IT = [
    (r"\{/ast name\}", "{last name}"), (r"\{/ast namej?\}?", "{last name}"),
    (r"\( \+ last nameJ\?", "(+ last name)?"), (r"signor\{in\}a", "signor(in)a"),
    (r"\barrivatola\b", "arrivato/a"), (r"\bamericanola\b", "americano/a"),
    (r"\bitalianola\b", "italiano/a"), (r"\bIa\b", "la"), (r"\bIe\b", "le"),
    (r"\bIi\b", "li"), (r"\bIo\b", "lo"), (r"\bde/\b", "del"),
]
def deocr_it(s: str) -> str:
    for pat, rep in OCR_IT:
        s = re.sub(pat, rep, s)
    return re.sub(r"[ \t]+", " ", s).strip()


def deocr(s: str) -> str:
    for pat, rep in OCR:
        s = re.sub(pat, rep, s)
    return re.sub(r"[ \t]+", " ", s).strip()


def blocks_of(lesson: int) -> dict:
    hits = sorted(SRC.glob(f"lesson-{lesson:02d}-*.json"))
    if not hits:
        sys.exit(f"no slice for lesson {lesson} — run fsi-slice.py")
    d = json.loads(hits[0].read_text())
    merged: dict = {}
    for b in d["block_texts"]:
        merged[b["block"]] = (merged.get(b["block"], "") + "\n" + b["text"]).strip()
    return d, merged


# ── dialog ────────────────────────────────────────────────────────────────────
# "Borghi:   3. Buongiorno, sono Luigi Borghi..."  + indented continuation lines.
# NOT anchored to line-start: the book stacks alternate forms above the first turn, so
# turn 1 reads "... la signora   {Borghi:  1. Scusi ...". Anchoring to ^ loses it entirely.
TURN = re.compile(r"[{\[(]?([A-Z][\w'’\. ]{1,18})[}\])]?:\s*(\d{1,2})\s*[\.\)]\s*(.*)$")

def parse_dialog(text: str) -> list:
    turns, cur = [], None
    for line in text.split("\n"):
        m = TURN.search(line)
        if m:
            if cur: turns.append(cur)
            spk = re.sub(r"[{}\[\]]", "", m.group(1)).strip()
            cur = {"n": int(m.group(2)), "label": spk, "it": m.group(3).strip()}
        elif cur and line.strip() and not re.match(r"^\s*(Fill|Fili|\(|_{3,})", line):
            # continuation of the previous turn (the book wraps long lines)
            if len(line) - len(line.lstrip()) > 6:
                cur["it"] = (cur["it"] + " " + line.strip()).strip()
        elif cur and not line.strip():
            turns.append(cur); cur = None
    if cur: turns.append(cur)
    for t in turns:
        t["it"] = deocr_it(t["it"])
        # "Lei" is the learner in every FSI dialog; everyone else is voiced.
        t["who"] = "learner" if t["label"].lower().startswith("lei") else "a"
    return [t for t in turns if t["it"]]


# ── vocabulary ────────────────────────────────────────────────────────────────
# "allora        1    in that case, then"  — italian, book index, english.
VOCAB = re.compile(r"^\s*(.{1,42}?)\s{2,}(\d{1,3})\s{2,}(.+?)\s*$")

def parse_vocab(text: str) -> list:
    out, lines = [], text.split("\n")
    for i, line in enumerate(lines):
        m = VOCAB.match(line)
        if not m: continue
        it, en = deocr_it(m.group(1)), deocr(m.group(3))
        if not it or not en or it.lower().startswith(("first", "the instructor")): continue
        # The gloss can wrap to the next line ("(connector between qualcosa" / "and dichiarare)").
        # Pull the continuation when the next line is indented prose with no vocab number.
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if (en.count("(") > en.count(")") or en.endswith((",", "and", "of", "to"))) \
           and nxt.strip() and not VOCAB.match(nxt) and len(nxt) - len(nxt.lstrip()) > 8:
            en = deocr(en + " " + nxt.strip())
        out.append({"it": it, "en": en})
    return out

# Additional Vocabulary has no numbers: "consolato        consulate"
VOCAB2 = re.compile(r"^\s*(.{1,42}?)\s{3,}(.+?)\s*$")

def parse_vocab_plain(text: str) -> list:
    out = []
    for line in text.split("\n"):
        m = VOCAB2.match(line)
        if not m: continue
        it, en = m.group(1).strip(), deocr(m.group(2))
        if not it or not en or len(it.split()) > 5: continue
        out.append({"it": it, "en": en})
    return out


# ── fill in the blanks ────────────────────────────────────────────────────────
def parse_fill(text: str, dialog: list) -> list:
    """The book prints the dialog with words removed. We rebuild the template from the
    REAL dialog line rather than trusting the blanked OCR, then mark which words were
    taken out — far more reliable than parsing rows of underscores."""
    items = []
    for t in dialog:
        words = t["it"].split()
        if len(words) < 3: continue
        # blank the content words (skip very short function words) — the book's own
        # progression: pass 1 removes some, pass 2 removes more.
        idx = [i for i, w in enumerate(words) if len(re.sub(r"\W", "", w)) > 3]
        if not idx: continue
        keep = idx[::2] or idx[:1]
        tpl, ans = [], []
        for i, w in enumerate(words):
            if i in keep:
                tpl.append("___"); ans.append(re.sub(r"[.,?!]$", "", w))
            else:
                tpl.append(w)
        items.append({"template": " ".join(tpl), "answers": ans})
    return items


# ── model drills ──────────────────────────────────────────────────────────────
MODEL = re.compile(r"Mode[l/]{1,2}\s*(\d+)", re.I)
QA = re.compile(r"^\s*([QA])\s*:\s*(.+?)\s*$")

def parse_drills(text: str) -> list:
    drills, cur = [], None
    for line in text.split("\n"):
        if MODEL.search(line):
            if cur and cur["items"]: drills.append(cur)
            cur = {"model": {"q": "", "a": ""}, "items": []}
            m = QA.search(line)
            if m and m.group(1) == "Q": cur["model"]["q"] = m.group(2).strip()
            continue
        if cur is None: continue
        m = QA.match(line)
        if m:
            cur["model"]["q" if m.group(1) == "Q" else "a"] = m.group(2).strip()
            continue
        # two-column drill row: prompt on the left, response on the right
        parts = re.split(r"\s{4,}", line.strip())
        if len(parts) == 2 and parts[0] and parts[1] and not parts[0].startswith("("):
            cur["items"].append({"q": parts[0].strip(), "a": parts[1].strip()})
    if cur and cur["items"]: drills.append(cur)
    for d in drills:
        if not d["model"]["q"] and d["items"]:
            d["model"] = {"q": d["items"][0]["q"], "a": d["items"][0]["a"]}
    return drills


# ── multiple choice ───────────────────────────────────────────────────────────
STEM = re.compile(r"^\s*(\d{1,2})\)\s*(.*)$")
OPT  = re.compile(r"^\s*([a-d])\)\s*(.+?)\s*$")

def parse_mcq(text: str) -> list:
    qs, cur = [], None
    for line in text.split("\n"):
        m = STEM.match(line)
        if m:
            if cur and cur["options"]: qs.append(cur)
            cur = {"n": int(m.group(1)), "options": [], "answer": None}
            rest = m.group(2).strip()
            o = OPT.match(rest)
            if o: cur["options"].append(deocr(o.group(2)))
            continue
        o = OPT.match(line)
        if o and cur is not None:
            cur["options"].append(deocr(o.group(2)))
    if cur and cur["options"]: qs.append(cur)
    return [q for q in qs if len(q["options"]) >= 2]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", type=int, required=True)
    ap.add_argument("--out", type=Path, default=SRC.parent / "skeletons")
    a = ap.parse_args()
    meta, B = blocks_of(a.lesson)
    a.out.mkdir(parents=True, exist_ok=True)

    dialog = parse_dialog(B.get("SEEING IT", ""))
    vocab  = parse_vocab(B.get("Vocabulary", ""))
    if not vocab:                       # L7: the book puts the word list under TAKING IT APART
        vocab = parse_vocab(B.get("TAKING IT APART", ""))
    vocab2 = parse_vocab_plain(B.get("Additional Vocabulary", ""))
    drills = parse_drills(B.get("GETTING THE FEEL OF IT", ""))
    mcq    = parse_mcq(B.get("Listening Comprehension", ""))
    fill   = parse_fill(B.get("SEEING IT", ""), dialog)

    sk = {
        "lesson": meta["lesson"], "title": meta["title"],
        "titleIt": "_todo: Italian title",
        "source": {"book": "FSI Italian FAST, Vol. I", "pages": meta["pages"]},
        "persona": "lucrezia",
        "_extracted": {
            "dialogTurns": len(dialog), "vocab": len(vocab), "additionalVocab": len(vocab2),
            "fillItems": len(fill), "drills": len(drills),
            "drillItems": sum(len(d["items"]) for d in drills), "mcq": len(mcq),
        },
        "_todo": ["titleIt", "dialog turn `en` glosses", "pearls", "situations",
                  "live conversation role/goal", "LC narrative", "cultural + region prose"],
        "blocks": {
            "cultural": deocr(B.get("CULTURAL NOTES", "")),
            "scene": deocr(B.get("SETTING THE SCENE", "")),
            "hearing": deocr(B.get("HEARING IT", "")),
            "usageNotes": deocr(B.get("Language - Usage Notes", "")),
            "region": deocr(B.get("REGIONE", "")),
            "usingIt": deocr(B.get("USING IT", "")),
        },
        "dialog": dialog, "vocab": vocab, "additionalVocab": vocab2,
        "fill": fill, "drills": drills, "mcq": mcq,
    }
    p = a.out / f"lesson-{a.lesson:02d}.skeleton.json"
    p.write_text(json.dumps(sk, ensure_ascii=False, indent=2), encoding="utf-8")
    e = sk["_extracted"]
    print(f"L{a.lesson:02d} {meta['title']}")
    print(f"   dialog {e['dialogTurns']:>3} turns  vocab {e['vocab']:>3} (+{e['additionalVocab']})  "
          f"fill {e['fillItems']:>3}  drills {e['drills']} ({e['drillItems']} items)  mcq {e['mcq']}")
    print(f"   -> {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
