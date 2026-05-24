# Active Context — Chiron

**Where we are right now in the design process.**

**Last updated:** 2026-05-23

---

## 2026-05-23 — Concepts domain + per-domain build scripts (Option B)

**Major additions this session:**

- ✅ **5th domain added: `concepts`** (math primers, formal logic, signal processing, statistics, law, finance, music theory, quant trading). Schema enum updated in `lib/schemas/brief.ts`. Inherits all universal widgets; leans on mathjax + reactive-math + step-cards + pattern-cards.
- ✅ **Per-domain hand-rolled build scripts (Option B chosen):** each domain has its own build script that emits Svelte-styled HTML appropriate to that domain's pedagogy. AMBOSS layout ≠ FHE layout ≠ concepts layout — fragmentation is intentional. No shared renderer.
- ✅ **Packt-shape concepts template:** `skill/scripts/build-concepts-lesson.mjs` (canonical). Hands-on workshop pedagogy: learning objectives + Packt admonitions (Note/Tip/Warning/Best-Practice/Hands-on) + tree-view sidebar TOC + IntersectionObserver-based scroll-spy + real SVG box-and-arrow flowcharts (NOT ASCII) + comparison cards.
- ✅ **AMBOSS canonical 11-section medicine template:** per-level required-section table in `prompts/04a-chapter-write.md`. Validator enforces. Medical specialty + level + clinicalAtlasUnits schema fields drive chapter-count + section emphasis.
- ✅ **chapterCountTarget (soft ±1)** + **chapterCountExact (hard lock)** added to BriefSchema for universal use; clinicalAtlasUnits overrides both for medicine.
- ✅ **10 universal widgets + chart-xy** added to `lib/schemas/widget-spec.ts` + `lib/widget-renderer.ts`. NOTE: emit standalone HTML, not Svelte components — NOT consumed by canonical `runtime/scripts/build-lesson.mjs` Svelte path. Used directly by per-domain build scripts.
- ✅ **3 new lessons built this session:**
  - `lessons/medicine-cap-step2ck-2026-05-23/` — CAP (Community-Acquired Pneumonia) via Svelte runtime, AMBOSS canonical structure
  - `lessons/quant-trading-2026-05-23/` — first concepts lesson (math/finance), Packt-shape
  - `lessons/bill-becomes-law-2026-05-23/` — second concepts lesson (civics/law), proves the concepts template is portable to zero-math content

**Cross-references:**
- Memory: `~/.claude/projects/-home-gyasisutton-dev/memory/project_chiron_per_domain_build_scripts.md`
- Memory: `~/.claude/projects/-home-gyasisutton-dev/memory/project_chiron_concepts_domain_packt_shape.md`

---

## Current phase

🔵 **Pre-build / design phase** — gathering inputs for the architectural paired debate.

## What's done

- ✅ Identified reference repos: `codebase-to-course`, `classbuild`, `ai-course-generator`, Anki MCP ecosystem
- ✅ Audited 3 reference repos (results captured in PRD §3 and `systemPatterns.md`)
- ✅ Defined the three-domain scope (code / medicine / language)
- ✅ Locked per-domain assessment formats:
  - Code → MCQ + T/F + spot-the-bug
  - Medicine → MCQ paired with clinical vignette (AMBOSS / USMLE style)
  - Language → fill-blank + matching + cloze
- ✅ ~~Locked Anki via MCP as SR backend~~ → **PIVOTED 2026-04-28**: Chiron owns SR end-to-end via SQLite + SM-2/FSRS scheduler. Anki is optional `.apkg` export only. Reason: user wants resume + revisit inside the lesson HTML, not via app-switching to Anki.
- ✅ Locked AI multi-persona engagement (peer learners + domain expert + native speaker)
- ✅ Locked codebase-to-course HTML shell as rendering layer
- ✅ Identified `case-study` skill as Mode B sibling (system-wide, just generalized 2026-04-28)
- ✅ Created project: `~/dev/projects/chiron/` + `memory-bank/` (this folder)
- ✅ Created tracking PRD: `~/dev/projects/chiron/prd/universal_lesson_generator_2026-04-28.md` (moved into project-local `prd/` folder 2026-04-28; removed from global `~/dev/prd/scratch/` librarian)

## What's in flight

- ✅ ~~AMBOSS / UpToDate medical formatting deep research~~ — **COMPLETED 2026-04-28 ~12:45** (21 min). Both templates locked. AMBOSS = board-prep / nested-bullets / buzzwords / Hammer difficulty / Attending Tips. UpToDate = clinical-decision-support / academic prose / GRADE framework / Summary+Recommendations. Both supported as parallel medical modes (parameter `audience_focus`: `board_exam_pattern_recognition` vs `point_of_care_management`). Stored in deep-research SQLite cache; key findings reproduced in `productContext.md` + `systemPatterns.md`.

## What's next (in order)

1. ⏳ **Wait for `aa71eb17` to complete.** Pull medical formatting findings.
2. 🎯 **Run paired debate** (Claude × Gemini, multi-round) on the universal-lesson-generator architecture. Inputs:
   - All 3 audits
   - Both deep-research outputs (broad scan + AMBOSS/UpToDate)
   - This memory-bank
   - The PRD §5b open decisions list
3. 📋 **Generate comprehensive PRD design section** as the persistent design artifact. Update PRD's §6+ with the locked-in architecture.
4. 🧱 **Build phase** — scaffold `~/.claude/skills/chiron/SKILL.md` + supporting files. Build incrementally, validate with skill-creator-style eval rig.
5. 🧪 **Validation phase** — run on three test cases (German vocab, USMLE pneumonia, code repo lesson). Confirm Anki export works end-to-end.

## Open decisions (to be locked in paired debate)

(See PRD §5b for the full list. Highlights:)

- [ ] Single skill vs skill bundle vs MCP server
- [ ] Mode A vs Mode B selection heuristic
- [ ] Source-ingestion adapter design
- [ ] TypeScript vs Python
- [ ] Which Anki MCP server (or multiple)
- [ ] Verifier loop — adopt QUEST-AI's 3-stage Generate→Verify→Refine for medicine?
- [ ] Skill validation rig — adopt anthropics/skills/skill-creator pattern?
- [ ] Curriculum template format per domain (how flexible?)

## Current focus

**Waiting for AMBOSS/UpToDate research to complete, then paired debate.**

If user wants to start building speculatively before debate completes, possible parallel work:
- Set up the project's git repo (`git init`)
- Stub out `~/.claude/skills/chiron/SKILL.md` with the trigger phrases and the high-level workflow (no domain-specific logic yet)
- Fork `codebase-to-course`'s shell into `chiron/skill/shell/` so we have a known-good starting point for HTML rendering

## Sessions touching this work

| Date | Session UUID | Scope |
|---|---|---|
| 2026-04-28 | `b7eba9ee-9766-4eb3-98b3-5080a2351b8d` | Initial design phase: audited 3 reference repos, generalized hh-case-study, scaffolded chiron project + memory-bank, kicked off AMBOSS/UpToDate research |
