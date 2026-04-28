# Progress — Chiron

**What's been built, what's pending, what's broken.**

**Last updated:** 2026-04-28

---

## Roadmap

```
PHASE 0: DESIGN  ←  WE ARE HERE
PHASE 1: SCAFFOLD
PHASE 2: BUILD MODE A (CODE)
PHASE 3: BUILD MODE A (LANGUAGE — DE)
PHASE 4: BUILD MODE A (MEDICINE — AMBOSS)
PHASE 5: BUILD MODE B INTEGRATION
PHASE 6: BUILD ANKI EXPORT
PHASE 7: BUILD MULTI-PERSONA ENGAGEMENT
PHASE 8: VALIDATION / EVAL RIG
PHASE 9: SHIP V1
PHASE 10: V2 — Italian, more domains, voice input, image input
```

---

## Phase 0 — Design

### Completed
- ✅ Reference repos identified (`codebase-to-course`, `classbuild`, `ai-course-generator`, Anki MCP ecosystem)
- ✅ Reference repos audited (security + architectural)
- ✅ 3-domain scope locked (code / medicine / language)
- ✅ Per-domain assessment formats locked
- ✅ Pedagogical modes locked (A: course / B: case-study via existing skill)
- ✅ HTML rendering shell choice (codebase-to-course)
- ✅ SR backend choice (Anki via MCP)
- ✅ Multi-persona engagement model defined
- ✅ Project scaffolded (`~/dev/projects/chiron/`, memory-bank, README, CLAUDE.md)
- ✅ Tracking PRD created (`~/dev/prd/scratch/universal_lesson_generator_2026-04-28.md`)

### In flight
- 🟡 AMBOSS / UpToDate medical formatting deep research (task `aa71eb17`)

### Pending
- ⏳ Paired debate on architecture (Claude × Gemini, multi-round)
- ⏳ PRD design section synthesized from debate output
- ⏳ Phase 0 sign-off

---

## Phase 1 — Scaffold (NOT STARTED)

- [ ] `git init` chiron project
- [ ] Create `~/.claude/skills/chiron/` symlink target
- [ ] Stub `SKILL.md` with trigger phrases + workflow shell
- [ ] Fork `codebase-to-course` shell into `chiron/skill/shell/`
- [ ] Empty `prompts/`, `concepts/`, `curricula/`, `personas/`, `lib/` dirs
- [ ] First skill validation test (does Claude Code load it?)

---

## Phase 2 — Mode A: Code domain (NOT STARTED)

- [ ] Source-ingestion adapter for code repos
- [ ] Concept DAG for code domain (`concepts/code.json`)
- [ ] Curriculum template (`curricula/code.json`)
- [ ] Code persona (`personas/code.json` — Chiron-the-mentor)
- [ ] Per-stage prompt templates
- [ ] Quiz generation (MCQ + T/F + spot-the-bug)
- [ ] LLM gateway with caching
- [ ] Concept DAG validator
- [ ] Answer-balancer post-pass
- [ ] First end-to-end test: generate course from a small repo

---

## Phase 3 — Mode A: Language (German) (NOT STARTED)

- [ ] Source-ingestion adapter for grammar concepts / vocab lists / readings
- [ ] Concept DAG for German (`concepts/language-de.json`)
- [ ] Curriculum templates (vocab, grammar) — `curricula/language-vocab.json`, `language-grammar.json`
- [ ] Language personas (Klaus / Maria native speakers)
- [ ] New quiz primitives in `main.js`:
  - [ ] `fill-blank` with fuzzy umlaut/accent grading
  - [ ] `matching-pair` (N↔N drag-drop)
  - [ ] `cloze` (Anki-compatible)
- [ ] German TTS integration via Gemini (Klaus voice)
- [ ] First end-to-end test: dative case lesson with audio dialogue

---

## Phase 4 — Mode A: Medicine (AMBOSS-style) (NOT STARTED)

- [ ] Source-ingestion adapter for clinical guidelines / textbook PDFs
- [ ] Concept DAG for medicine (`concepts/medicine.json`)
- [ ] Curriculum templates (`curricula/medicine-amboss.json`, `medicine-uptodate.json`)
- [ ] Medical personas (Dr. Reyes attending, Mike student, Priya resident)
- [ ] New quiz primitive in `main.js`:
  - [ ] `mcq-clinical-vignette` (vignette stem + labs + leading Q + 5 options + per-distractor explanation)
- [ ] Optional QUEST-AI-style 3-stage verifier loop
- [ ] First end-to-end test: community-acquired pneumonia lesson

---

## Phase 5 — Mode B Integration (NOT STARTED)

- [ ] Detection heuristic: when does Chiron route to `case-study` skill instead of generating Mode A?
- [ ] Wire SKILL.md to delegate to `~/.claude/skills/case-study.md` for Mode B inputs

---

## Phase 6 — Built-in SR + Anki Export (NOT STARTED) — PIVOTED 2026-04-28

**Renamed from "Anki Export" to "Built-in SR".** Chiron owns SR end-to-end via SQLite + SM-2/FSRS scheduler. Anki export is a secondary feature.

- [ ] Implement SM-2 scheduler in `lib/sr-scheduler.{ts,py}` (~50 LOC)
- [ ] Card-shape generation per domain (cloze for language, term/def for code, vignette-card for medicine)
- [ ] `sr_cards` + `sr_review_log` SQLite tables
- [ ] In-lesson review UI in `main.js` (due cards appear at top of lesson on load)
- [ ] Resume bookmark — `bookmarks` table + auto-scroll on lesson reopen
- [ ] Card review writes back to `sr_cards` + `sr_review_log`
- [ ] (Optional, post-v1) `.apkg` export button → user can sync to mobile Anki if desired
- [ ] (Optional, post-v1) Anki MCP integration for two-way sync

---

## Phase 7 — Multi-Persona Engagement (NOT STARTED)

- [ ] Persona dialogue prompt templates (peer learners + domain expert)
- [ ] In-chapter "Alice asks Bob" rendered HTML blocks
- [ ] User-response capture (text input → grade vs. expected explanation)

---

## Phase 8 — Validation / Eval Rig (NOT STARTED)

- [ ] Adopt `anthropics/skills/skill-creator` pattern: Executor → Grader → Comparator → Analyzer
- [ ] Define 3-9 test cases per domain (gold input → gold output rubric)
- [ ] Automated regression test: re-run on test cases when SKILL.md changes
- [ ] Cost budget enforcement

---

## Phase 9 — Ship v1 (NOT STARTED)

Per `projectbrief.md` § "Success criteria (v1 ships when…)":

- [ ] German vocab lesson with fill-blank + cloze + native-speaker TTS + Anki deck
- [ ] USMLE-style hypertension lesson with 5+ clinical-vignette MCQs + AMBOSS structure
- [ ] Code-repo lesson with side-by-side code-English + spot-the-bug + AI peer-learner discussion
- [ ] All three lessons render in browser without build step
- [ ] Anki deck export works end-to-end via MCP
- [ ] Learner state persists across sessions

---

## Phase 10 — v2 (FUTURE)

- [ ] Italian language support
- [ ] Voice input (user speaking back to language persona)
- [ ] Image input (X-rays, equations)
- [ ] More domains (law, music theory, history)
- [ ] Mobile-friendly HTML output
- [ ] Multi-user / sharing (if ever)

---

## Known issues / debt

(none yet — pre-build)

---

## Last 5 milestones

| Date | Milestone |
|---|---|
| 2026-04-28 | Project scaffolded — `~/dev/projects/chiron/` + memory-bank + README + CLAUDE.md |
| 2026-04-28 | Tracking PRD created |
| 2026-04-28 | 3 reference repos audited |
| 2026-04-28 | `hh-case-study` generalized to `~/.claude/skills/case-study.md` (Mode B sibling) |
| 2026-04-28 | First deep research (broad market scan) completed |
