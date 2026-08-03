#!/usr/bin/env python3
"""fsi-slice — cut FSI Italian FAST into whole, ordered lessons for the chiron FSI course.

Deterministic. No LLM, no chunking, no embeddings. The book's 83 PDF bookmarks already
mark the lesson boundaries exactly, so slicing is a lookup, not an inference.

Why whole lessons: a chiron FSI lesson is built from ONE lesson at a time, in order.
The largest lesson is ~6.9k tokens, so it fits in context whole — which means we never
split a Q:/A: drill pair, an a)-d) multiple-choice set, or a ___ blank from the cue that
fills it. Exercise atomicity is free as long as nothing ever cuts.

Output per lesson (to --out, default ~/Documents/generated/fsi-course/source/):
    lesson-00-preliminary.md ... lesson-17-phone-call.md   whole lesson text, block-tagged
    lesson-NN-*.json                                       same + machine-readable blocks
    fsi-method.md                                          the book's own statement of
                                                           its method (Lesson Introduction
                                                           + Before We Begin) — the style
                                                           guide for every generated lesson
    manifest.json                                          index of all slices

Usage:
    python3 fsi-slice.py [--pdf PATH] [--out DIR] [--lesson N]
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF required:  pip install pymupdf")

DEFAULT_PDF = Path.home() / "Downloads" / "FSI - Italian Familiarization and Short term Training - Volume 1.pdf"
DEFAULT_OUT = Path.home() / "Documents" / "generated" / "fsi-course" / "source"

# The FSI pedagogical cycle. Whitespace-insensitive: the scan stripped spaces from the
# all-caps headers ("HEARINGIT", "SEEINGIT", "USINGIT", "PUTTINGITTOGETHER").
BLOCKS = [
    ("SETTING THE SCENE",      r"SETTING\s*THE\s*SCENE"),
    ("HEARING IT",             r"HEARING\s*IT"),
    ("SEEING IT",              r"SEEING\s*IT"),
    ("TAKING IT APART",        r"TAKING\s*IT\s*APART"),
    ("GETTING THE FEEL OF IT", r"GETTING\s*THE\s*FEEL\s*OF\s*IT"),
    ("MAKING IT WORK",         r"MAKING\s*IT\s*WORK"),
    ("PUTTING IT TOGETHER",    r"PUTTING\s*IT\s*TOGETHER"),
    ("USING IT",               r"USING\s*IT"),
    ("CULTURAL NOTES",         r"CULTURAL\s*NOTES"),
    ("REGIONE",                r"REGIONE"),
    ("Language - Usage Notes", r"Language\s*[-–]\s*Usage\s*Notes"),
    ("Additional Vocabulary",  r"Additional\s*Vocabulary"),
    ("Vocabulary",             r"Vocabulary"),
    ("Listening Comprehension", r"Listening\s*Comprehension"),
]
# The 1992 scan sprays spaces INSIDE words ("CUL TURA L NOTES", "IT ALiAN FAST") and
# confuses l/I/i/u. So all header + noise matching runs on a SQUEEZED form of the line
# (whitespace removed, lowercased) rather than on the raw text.
def squeeze(s: str) -> str:
    return re.sub(r"\s+", "", s).lower()


CANON = {re.compile(r"^" + squeeze(p).replace("\\s*", "") + r"$", re.I): name
         for name, p in BLOCKS}

# Page furniture to drop, matched on the squeezed line:
#   running header  ITALIAN FAST / ITAlIAN FAST / ITAUAN FAST / IT ALiAN FAST
#   page footer     "I - 5", "XVII - 431", "p - 11", "1- 26"
NOISE_SQ = [
    re.compile(r"^it[a-z]{4,6}fast$"),
    re.compile(r"^(?:[ivxlc]+|p|\d{1,2})[-–]\d{1,3}$"),
    re.compile(r"^\d{1,3}$"),
]

# Exercise markers — counted per block so the transform step knows what it is holding.
MARKERS = {
    "blanks":   re.compile(r"_{3,}"),
    "qa_pairs": re.compile(r"^\s*Q:\s", re.M),
    "mcq":      re.compile(r"^\s*[a-d]\)\s", re.M),
    "models":   re.compile(r"Mode[l/]{1,2}\s*\d"),
    "cues":     re.compile(r"\([a-z][a-z /']{2,25}\)"),
}


def slugify(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower())
    return re.sub(r"[\s_]+", "-", s).strip("-")


def clean(page_text: str) -> str:
    out = []
    for line in page_text.split("\n"):
        sq = squeeze(line)
        if sq and any(n.match(sq) for n in NOISE_SQ):
            continue
        # rstrip only — LEADING whitespace is meaningful (see extract_page)
        out.append(line.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip("\n")


# The 1992 scan mangles whole header WORDS, not just spacing: "GETTING" came out as
# "GErr/NG" (L12) and "GEITING" (L17), and in L10 the header fused with page furniture
# ("~ L!!J BOLLATIPronunciation Practice"). Exact matching silently swallowed those
# lessons' drills into the previous block. So: anchor on the fragment that SURVIVES.
ANCHORS = [
    ("thefeelofit", "GETTING THE FEEL OF IT"),
    ("pronunciationpractice", "GETTING THE FEEL OF IT"),
    ("takingitapart", "TAKING IT APART"),
    ("puttingittogether", "PUTTING IT TOGETHER"),
    ("makingitwork", "MAKING IT WORK"),
    ("listeningcomprehension", "Listening Comprehension"),
    ("culturalnotes", "CULTURAL NOTES"),
]

def canonical_block(line: str) -> str | None:
    sq = squeeze(line)
    if not sq:
        return None
    for rx, name in CANON.items():
        if rx.match(sq):
            return name
    if len(sq) <= 40:                      # a header line, not a paragraph
        for frag, name in ANCHORS:
            if frag in sq:
                return name
    return None


def split_blocks(text: str) -> list[dict]:
    """Tag the FSI cycle blocks WITHOUT cutting anything — boundaries only."""
    lines = text.split("\n")
    marks = [(i, canonical_block(l)) for i, l in enumerate(lines)]
    marks = [(i, n) for i, n in marks if n]
    if not marks:
        return [{"block": "(untagged)", "text": text}]
    blocks = []
    if marks[0][0] > 0:
        pre = "\n".join(lines[: marks[0][0]]).strip()
        if pre:
            blocks.append({"block": "(preamble)", "text": pre})
    for (start, name), nxt in zip(marks, marks[1:] + [(len(lines), None)]):
        body = "\n".join(lines[start + 1 : nxt[0]]).strip()
        if body:
            blocks.append({"block": name, "text": body})
    return blocks


def count_markers(text: str) -> dict:
    return {k: len(rx.findall(text)) for k, rx in MARKERS.items() if rx.findall(text)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--lesson", type=int, help="slice only this lesson number (0 = Preliminary)")
    a = ap.parse_args()

    if not a.pdf.exists():
        sys.exit(f"PDF not found: {a.pdf}")
    a.out.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(a.pdf)
    toc = doc.get_toc()

    def page_text(lo: int, hi: int) -> str:
        # sort=True is NOT cosmetic — it is correctness. Two findings forced it:
        #  1. MCQ association. Default extraction emits the stems (1..5) in one run and
        #     the a-d options in another, so question 2's options land next to question
        #     4. sort=True restores "2) a) b) c) d)" per stem. Without it the answer key
        #     is silently scrambled.
        #  2. Speaker roles. The Interpreter Situation and the dialogs are two-column:
        #     the Italian prompt on the left, the American's English response indented
        #     right. That INDENTATION is the only marker of who says what — and of what
        #     the learner is expected to supply vs. what the book supplies. Default
        #     extraction flattens it and the distinction is lost.
        return "\n".join(clean(doc[i].get_text(sort=True)) for i in range(lo, hi)).strip("\n")

    # --- the method spec: Lesson Introduction (p10) .. end of Before We Begin (p21) ---
    method = page_text(9, 21)
    (a.out / "fsi-method.md").write_text(
        "# FSI Italian FAST — the book's own method\n\n"
        "> Verbatim from *Lesson Introduction* and *Before We Begin*. This is the style "
        "guide for every generated lesson: FSI is explicit that inverting or skipping "
        "steps 'will seriously diminish the pay-off to the lesson.'\n\n" + method,
        encoding="utf-8")

    # --- lesson boundaries from the bookmarks ---
    units = []
    prelim = next((t for t in toc if t[0] == 1 and t[1].strip() == "Preliminary Lesson"), None)
    if prelim:
        units.append((0, "Preliminary Lesson", prelim[2]))
    for lvl, title, pg in toc:
        if lvl == 1 and title.startswith("Lesson ") and " - " in title:
            roman, name = title[len("Lesson "):].split(" - ", 1)
            n = {"I":1,"II":2,"III":3,"IV":4,"V":5,"VI":6,"VII":7,"VIII":8,"IX":9,
                 "X":10,"XI":11,"XII":12,"XIII":13,"XIV":14,"XV":15,"XVI":16,"XVII":17}.get(roman.strip())
            if n:
                units.append((n, name.strip(), pg))
    units.sort(key=lambda u: u[0])

    manifest = []
    for (num, title, pg), nxt in zip(units, units[1:] + [(None, None, doc.page_count + 1)]):
        if a.lesson is not None and num != a.lesson:
            continue
        lo, hi = pg - 1, nxt[2] - 1
        text = page_text(lo, hi)
        blocks = split_blocks(text)
        slug = f"lesson-{num:02d}-{slugify(title)}"

        md = [f"# FSI Lesson {num or 'Preliminary'} — {title}", "",
              f"> Source: FSI Italian FAST Vol. I, pp. {pg}-{nxt[2]-1} "
              f"({hi-lo} pages, ~{len(text)//4} tokens). Sliced whole — no chunking.", ""]
        for b in blocks:
            md += [f"## {b['block']}", "", b["text"], ""]
        (a.out / f"{slug}.md").write_text("\n".join(md), encoding="utf-8")

        rec = {
            "lesson": num, "title": title, "slug": slug,
            "pages": [pg, nxt[2] - 1], "chars": len(text), "approx_tokens": len(text) // 4,
            "blocks": [{"block": b["block"], "chars": len(b["text"]),
                        "markers": count_markers(b["text"])} for b in blocks],
        }
        (a.out / f"{slug}.json").write_text(
            json.dumps({**rec, "text": text, "block_texts": blocks}, ensure_ascii=False, indent=2),
            encoding="utf-8")
        manifest.append(rec)
        print(f"  [{num:02d}] {title:<32} pp.{pg}-{nxt[2]-1:<4} "
              f"{len(text):>6} chars  ~{len(text)//4:>5} tok  {len(blocks)} blocks")

    (a.out / "manifest.json").write_text(
        json.dumps({"source": str(a.pdf), "lessons": manifest}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(f"\n→ {len(manifest)} lesson(s) + fsi-method.md → {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
