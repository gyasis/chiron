#!/usr/bin/env python3
"""fsi-lesson-prep — turn a sliced FSI lesson into a chiron-ready lesson plan.

The design decision this encodes: we do NOT change chiron's structure for FSI. The
pure-italian chain already builds a lesson from a `syllabus.json` (a list of sections)
plus per-section authoring. So instead of inventing a new lesson shape, we make
chiron's SECTIONS BE the FSI blocks, in the book's own order, under the book's own
names. The container is chiron; the pedagogy is FSI.

That matters because FSI is explicit (Lesson Introduction) that inverting or skipping
its steps "will seriously diminish the pay-off to the lesson." The step ORDER is the
method, so the syllabus is derived from the book, never planned by a model.

Writes into the chain's output dir (GEN/chiron-italian-fsi-NN-slug/):
    syllabus.json    the FSI blocks as chiron sections -> phase 1 RESUMES on this
                     instead of asking an LLM to invent a syllabus
    grounding/       one .md per block, verbatim from the slice
    grounding.md     the concatenated lesson (for CH_GROUNDING)
    fsi-plan.json    provenance: which block became which section

Usage:
    python3 fsi-lesson-prep.py --lesson 1
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

SRC = Path.home() / "Documents" / "generated" / "fsi-course" / "source"
GEN = Path.home() / "Documents" / "generated"

# What each FSI block is FOR — fed to the author as the section's teachingGoal so the
# generated section does the job the book intends, not a generic "teach some Italian".
BLOCK_INTENT = {
    "CULTURAL NOTES": ("Cultural Notes",
        "Understand the cultural background the lesson assumes, before any language."),
    "SETTING THE SCENE": ("Setting the Scene",
        "Picture where, when and with whom this language gets used."),
    "HEARING IT": ("Hearing It",
        "Hear the dialog once, for gist, without reading it."),
    "SEEING IT": ("Seeing It",
        "Read the dialog and connect the sounds to the words."),
    "TAKING IT APART": ("Taking It Apart",
        "Break the dialog into its parts and see what each piece is doing."),
    "GETTING THE FEEL OF IT": ("Getting the Feel of It",
        "Drill pronunciation and rehearse the lines until they are automatic."),
    "MAKING IT WORK": ("Making It Work",
        "Handle variants — responses the learner must adapt, not recite."),
    "PUTTING IT TOGETHER": ("Putting It Together",
        "Run the whole exchange end to end."),
    "USING IT": ("Using It",
        "Use the language in a live, unscripted enactment."),
    "Vocabulary": ("Vocabulary",
        "Own the lesson's core words with usage, not bare glosses."),
    "Additional Vocabulary": ("Additional Vocabulary",
        "Extend the core set with the lesson's supporting words."),
    "Language - Usage Notes": ("Usage Notes",
        "Understand the grammar the dialog quietly used."),
    "Listening Comprehension": ("Listening Comprehension",
        "Answer questions on a narrative heard once — comprehension under pressure."),
    "REGIONE": ("Regione",
        "Meet the Italian region featured in this lesson."),
}

# Blocks that carry graded exercises. Flagged so the author preserves prompt/answer
# pairing and never invents an answer the book already supplies.
GRADED = {"MAKING IT WORK", "GETTING THE FEEL OF IT", "Listening Comprehension",
          "PUTTING IT TOGETHER", "USING IT"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", type=int, required=True)
    ap.add_argument("--src", type=Path, default=SRC)
    ap.add_argument("--gen", type=Path, default=GEN)
    a = ap.parse_args()

    hits = sorted(a.src.glob(f"lesson-{a.lesson:02d}-*.json"))
    if not hits:
        sys.exit(f"no slice for lesson {a.lesson} in {a.src} — run fsi-slice.py first")
    sl = json.loads(hits[0].read_text())

    slug = f"chiron-italian-fsi-{a.lesson:02d}-" + re.sub(r"[^a-z0-9]+", "-", sl["title"].lower()).strip("-")
    out = a.gen / slug
    (out / "grounding").mkdir(parents=True, exist_ok=True)

    sections, plan, parts = [], [], []
    n = 0
    for b in sl["block_texts"]:
        name, text = b["block"], b["text"]
        if name in ("(preamble)", "(untagged)") or not text.strip():
            continue
        title, goal = BLOCK_INTENT.get(name, (name.title(), f"Work through the lesson's {name} step."))
        n += 1
        sid = f"chapter-{n}"
        (out / "grounding" / f"{n:02d}-{re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')}.md").write_text(
            f"# {name}\n\n{text}\n", encoding="utf-8")
        parts.append(f"## {name}\n\n{text}")

        sections.append({
            "id": sid,
            "title": f"{n} {title}",
            "titleEn": title,
            "teachingGoal": goal,
            "targetStructures": [],           # comes from the block text, not invented
            "arc": f"FSI step '{name}' — keep the book's order; do not merge or reorder.",
            # provenance the author prompt can lean on
            "fsiBlock": name,
            "fsiGraded": name in GRADED,
        })
        plan.append({"section": sid, "fsiBlock": name, "chars": len(text),
                     "graded": name in GRADED, "markers": b.get("markers", {})})

    (out / "syllabus.json").write_text(json.dumps(sections, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "grounding.md").write_text(
        f"# FSI Lesson {a.lesson} — {sl['title']}\n\n"
        f"Source: FSI Italian FAST Vol. I, pp. {sl['pages'][0]}-{sl['pages'][1]}. Verbatim.\n\n"
        + "\n\n".join(parts), encoding="utf-8")
    (out / "fsi-plan.json").write_text(json.dumps(
        {"lesson": a.lesson, "title": sl["title"], "slug": slug,
         "source_pages": sl["pages"], "sections": plan}, ensure_ascii=False, indent=2), encoding="utf-8")

    gsize = len((out / "grounding.md").read_text())
    print(f"lesson {a.lesson} — {sl['title']}")
    print(f"  {len(sections)} sections (FSI blocks, book order) -> {out}/syllabus.json")
    for p in plan:
        print(f"    {p['section']:<11} {p['fsiBlock']:<24} {p['chars']:>6} ch{'  [graded]' if p['graded'] else ''}")
    print(f"  grounding.md: {gsize} chars")
    if gsize > 4000:
        print(f"  !! CH_GROUNDING is truncated to 4000 chars by the chain "
              f"(_user_ctx in run.py) — {gsize-4000} chars ({100-4000*100//gsize}%) would be DROPPED.")
        print(f"     Use the per-block files in {out}/grounding/ instead of one blob.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
