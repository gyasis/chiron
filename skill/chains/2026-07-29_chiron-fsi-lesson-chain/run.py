#!/usr/bin/env python3
"""chiron FSI lesson chain — build one FSI Italian FAST lesson, per-section, then combine.

WHY THIS IS ITS OWN CHAIN (not a flag on the pure-italian chain)
---------------------------------------------------------------
The pure-italian chain INVENTS a lesson: a model plans an 8-section syllabus for a topic
and authors rich content from its own knowledge. FSI is the opposite job. The lesson
already exists — 1992, Foreign Service Institute, field-tested — and our task is to
RENDER it faithfully, in the book's own order, with the book's own exercises and its own
answers. An authoring chain tuned to invent is the wrong tool for a chain that must not.

Two concrete consequences that forced the fork:
  1. NO PLANNING PHASE. The syllabus comes from the book (fsi-lesson-prep.py derives it
     from the PDF bookmarks + the FSI block headers). FSI states outright that inverting
     or skipping its steps "will seriously diminish the pay-off to the lesson", so the
     step order is not a model's decision to make.
  2. PER-SECTION GROUNDING. The shared chain injects one global CH_GROUNDING blob capped
     at 4000 chars; a sliced FSI lesson is 17k-43k. Feeding a fifth of the lesson would
     defeat the whole point of slicing whole lessons. Here each section is authored from
     ITS OWN FSI block, in full, untruncated — which is also the only arrangement where a
     graded drill keeps its answers attached to its prompts.

WHAT IT REUSES
--------------
Everything downstream is identical to a normal Italian lesson, so it is imported from the
pure-italian chain rather than copied: the repair/fallback ladder, extras, QC, the
assembler, audio scripts, and the Atelier bake. The lesson that comes out is a normal
chiron lesson — same shell, same widgets, same tutor, same audio pipeline. Only the
authoring is FSI-specific. If the two ever genuinely diverge, fork the plumbing too.

PIPELINE
--------
    fsi-slice.py        PDF -> 18 whole lessons (deterministic, no LLM)
    fsi-lesson-prep.py  one lesson -> syllabus.json + grounding/<block>.md
    THIS CHAIN          per-section author -> combine -> assemble -> bake (Lucrezia)

USAGE
-----
    CH_LESSON=1 CH_STAGE=all python3 run.py        # author -> assemble -> audio -> bake
    CH_LESSON=1 CH_STAGE=author python3 run.py     # author only
    CH_LESSON=1 CH_STAGE=assemble python3 run.py   # rebuild lesson.html from content.json
    CH_FORCE=1                                     # re-author instead of resuming
"""
from __future__ import annotations
import asyncio, importlib.util, json, os, re, sys
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)

HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
GEN = HOME / "Documents/generated"
LESSON = int(os.environ.get("CH_LESSON", "1"))

# ── locate the prepped lesson (written by fsi-lesson-prep.py) ─────────────────────
cands = sorted(GEN.glob(f"chiron-italian-fsi-{LESSON:02d}-*"))
if not cands:
    sys.exit(f"[fsi] no prepped lesson {LESSON}. Run:\n"
             f"  python3 {SKILL}/scripts/fsi-slice.py\n"
             f"  python3 {SKILL}/scripts/fsi-lesson-prep.py --lesson {LESSON}")
OUT = cands[0]
PLAN = json.loads((OUT / "fsi-plan.json").read_text())
TITLE = f"FSI Lesson {LESSON} — {PLAN['title']}"

# The pure-italian chain computes SLUG/OUT from CH_TOPIC at import time. Give it a topic
# that resolves to our directory, then correct TOPIC to the human title afterwards.
os.environ.setdefault("CH_TOPIC", OUT.name.replace("chiron-italian-", "").replace("-", " "))

_src = SKILL / "chains" / "2026-06-30_chiron-pure-italian-lesson-chain" / "run.py"
_spec = importlib.util.spec_from_file_location("pure_italian_chain", _src)
pi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pi)

# Point the borrowed plumbing at OUR lesson.
pi.OUT = OUT
pi.TOPIC = TITLE
pi.USER_CTX = ""                     # replaced by per-section grounding (see below)
pi.obs.set_out(OUT)

FSI_METHOD = (GEN / "fsi-course" / "source" / "fsi-method.md")
METHOD = FSI_METHOD.read_text()[:6000] if FSI_METHOD.exists() else ""


# ── the FSI fidelity contract — the heart of this chain ───────────────────────────
FSI_RULES = """
## FIDELITY CONTRACT — you are RENDERING a real lesson, not writing one

The SOURCE BLOCK below is the actual text of this step from FSI Italian FAST (Foreign
Service Institute, 1992). It is authoritative. Your job is to present it as Lucrezia
would teach it — warm, clear, in her voice — WITHOUT changing what is being taught.

HARD RULES:
1. USE THE BOOK'S CONTENT. Every Italian line, drill prompt, variant and vocabulary item
   in this section must come from the source block. Do NOT substitute your own examples
   for the book's. You may ADD explanation; you may not REPLACE content.
2. NEVER INVENT AN ANSWER THE BOOK SUPPLIES. Where the source gives a response, a model
   answer, or a correct option, carry it through EXACTLY. A wrong answer key is worse
   than no lesson.
3. PRESERVE WHO SUPPLIES WHAT. In the source, the Italian speaker's lines and the
   American/learner's lines are distinct (the learner's are indented in the original
   two-column layout). Keep that split: the other speaker is `who:"a"` (voiced), the
   learner is `who:"learner"` (NEVER voiced). If the book leaves a blank for the learner
   to fill, it must STAY a blank — do not answer it for him.
4. KEEP EXERCISES WHOLE. A drill keeps its prompts with its responses; a multiple-choice
   item keeps its stem with all of its options. Never split a pair across fields.
5. STAY IN THIS STEP. Author only this FSI step. Do not pull in material from another
   step or run ahead of the book's sequence — the order IS the method.
6. TRANSLATE THE OCR, DON'T PROPAGATE IT. The 1992 scan misreads l/I as / and u
   ("Ita/y", "trave/er", "ITAUAN"). Silently correct these to proper English/Italian.
   Correct obvious scanning damage; never "correct" the book's actual teaching.
"""


def _section_grounding(sec: dict) -> str:
    """The FSI block this section renders — IN FULL. No truncation, ever."""
    fname = re.sub(r"[^a-z0-9]+", "-", (sec.get("fsiBlock") or "").lower()).strip("-")
    for f in sorted((OUT / "grounding").glob("*.md")):
        if f.stem.split("-", 1)[-1] == fname:
            return f.read_text()
    return ""


async def author_fsi_section(plan_sec: dict, avoid: dict, idx: int,
                             extra_directive: str = "", force: bool = False):
    """Phase 2, FSI variant: author ONE section from ITS OWN block of the book."""
    n = idx + 1
    sid = plan_sec.get("id") or f"chapter-{n}"
    fpath = OUT / f"chapter{n}.json"
    if fpath.exists() and not force and os.environ.get("CH_FORCE") != "1":
        print(f"[phase 2] section {n} ({sid}) — RESUME (already authored)", flush=True)
        return n

    block = plan_sec.get("fsiBlock", "?")
    src = _section_grounding(plan_sec)
    if not src.strip():
        print(f"[phase 2] section {n} ({block}) — NO GROUNDING, skipped", flush=True)
        return None

    graded = plan_sec.get("fsiGraded")
    is_first = (idx == 0)
    p = (
        f"You are Lucrezia, a warm Italian tutor, teaching {pi.LEARNER} from a real course: "
        f"**{TITLE}**.\n"
        f"This is FSI step **{block}** — section {n} of {len(PLAN['sections'])}.\n\n"
        + FSI_RULES + "\n"
        + (f"## HOW FSI INTENDS ITS STEPS TO BE TAUGHT (the book's own method)\n{METHOD}\n\n"
           if is_first and METHOD else "")
        + pi.FORMATTING_RULES + "\n"
        + "## PERSONA (Lucrezia — her voice):\n" + pi.PERSONA_BLOCK + "\n\n"
        + (("## THIS STEP IS GRADED — it carries drills whose answers the book already "
            "provides. Carry every prompt AND its response through intact.\n\n") if graded else "")
        + f"## SOURCE BLOCK — FSI '{block}' (verbatim, authoritative)\n"
        + "```\n" + src + "\n```\n\n"
        + f"## THIS SECTION'S PLAN\n{json.dumps(plan_sec, ensure_ascii=False)}\n"
        + "\n" + pi._section_schema(is_first)
        + (f"\n\n## QC FIXES REQUIRED\n{extra_directive}" if extra_directive else "")
        + "\nReturn ONLY the JSON object for THIS section."
    )
    print(f"[phase 2] AUTHOR section {n} ({block}{', graded' if graded else ''}) "
          f"— {len(src)} ch grounding …", flush=True)
    sec = await pi.json_with_repair(p, f"chapter{n}", pi.model_for(pi.MODEL_STRUCT),
                                    validate_fn=pi.sec_valid, via_engine=True)
    if sec is None:
        (OUT / f"chapter{n}.NEEDS_REVIEW").write_text(
            f"section {n} ({sid}, FSI block '{block}') failed validation after all repairs")
        print(f"[phase 2] section {n} — NEEDS_REVIEW (lesson continues)", flush=True)
        return None
    sec.setdefault("id", sid)
    sec["fsiBlock"] = block                       # provenance survives into content.json
    if is_first and isinstance(sec.get("coldOpen"), dict):
        (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
        (OUT / ".scratch" / "coldOpen.json").write_text(
            json.dumps(sec.pop("coldOpen"), ensure_ascii=False, indent=2))
    fpath.write_text(json.dumps(sec, ensure_ascii=False, indent=2))
    print(f"[phase 2] section {n}: {len(sec.get('vocab', []))} vocab, "
          f"{len(sec.get('pearls', []))} pearls", flush=True)
    return n


# The borrowed phase-2 loop calls author_section by name — point it at ours.
pi.author_section = author_fsi_section


def fsi_syllabus() -> list:
    """Phase 1, FSI variant: the syllabus is the BOOK's, never a model's."""
    f = OUT / "syllabus.json"
    if not f.exists():
        sys.exit(f"[fsi] missing {f} — run fsi-lesson-prep.py --lesson {LESSON}")
    secs = json.loads(f.read_text())
    print(f"[phase 1] FSI syllabus (from the book, not planned): {len(secs)} steps → "
          f"{[s.get('fsiBlock') for s in secs]}", flush=True)
    return secs


async def main():
    stage = os.environ.get("CH_STAGE", "author")
    print(f"=== chiron FSI chain | {TITLE} | stage={stage} "
          f"| author-ladder={'->'.join(pi.AUTHOR_LADDER)} -> {OUT}")

    if (OUT / "content.json").exists() and os.environ.get("CH_FORCE") != "1" and stage != "author":
        print("[phase 2] RESUME — reusing content.json", flush=True)
    else:
        syllabus = fsi_syllabus()                       # Phase 1 — the book's own order
        avoid = pi.library_dedup()
        pi.obs.phase("Writing the lesson content", "start")
        await pi.phase2_sections(syllabus, avoid)       # Phase 2 — per-section, per-block
        await pi.phase2b_extras(syllabus, avoid)        # Phase 2b — extras
        pi.obs.phase("Writing the lesson content", "end")
        pi.obs.phase("Reviewing the lesson", "start")
        content = await pi.phase25_qc(syllabus, avoid)  # Phase 2.5 — QC (fail-open)
        pi.phase27_balance(content)                     # Phase 2.7 — balance
        pi.obs.phase("Reviewing the lesson", "end")

    if stage in ("assemble", "audio", "all"):
        pi.obs.phase("Assembling the page", "start")
        ok = pi.assemble()                              # Phase 3 — COMBINE the sections
        pi.assemble_gate()
        pi.obs.phase("Assembling the page", "end")
        if not ok:
            print("=== assemble failed"); return
    if stage in ("audio", "all"):
        pi.obs.phase("Writing narration scripts", "start")
        await pi.phase4_audio_scripts()                 # Phase 4 — narration scripts
        pi.obs.phase("Writing narration scripts", "end")
        if stage == "all" or os.environ.get("CH_BAKE") == "1":
            pi.obs.phase("Baking audio", "start")
            pi.bake()                                   # Phase 5 — Atelier bake (Lucrezia)
            pi.obs.phase("Baking audio", "end")
        else:
            print("[phase 5] BAKE skipped — CH_STAGE=all or CH_BAKE=1 to bake.", flush=True)

    print(f"=== done → {OUT}/lesson.html" if (OUT / "lesson.html").exists()
          else f"=== authored → {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
