# Universal Lesson Generator

**Ephemeral PRD** — delete when: delete after universal-lesson-generator skill ships and is validated against engineering / medical (MCQ) / language (DE-IT fill-blank) test cases

- **Status:** DRAFT — pre-debate, audits complete, AMBOSS/UpToDate research in flight
- **Created:** 2026-04-28
- **Trigger:** User wants to extend `codebase-to-course` (Claude Code skill) into a **universal Coursera-style lesson generator** that turns ANY subject (code repos, medical chapters, German/Italian language, etc.) into multi-chapter HTML lessons with quizzes, scoring, and Anki-backed spaced-repetition. Single learner = the user.
- **Related:** `~/.claude/skills/case-study.md` (Mode-B sibling skill), `~/dev/audits/{codebase-to-course,classbuild,ai-course-generator}/`, deep-research task `aa71eb17-abe6-4880-9593-a1447dd59789`

---

## 1. Context

The user is building a **universal lesson-authoring skill** for solo learning across heterogeneous subject matter — engineering / code repos, medical content (MCQ-format like USMLE/AMBOSS), German + Italian language (fill-blank + matching), and any future domain (law, music theory, history). Two reference skills already exist locally: `codebase-to-course` (4.1k★ Claude Code skill, single-page HTML output, scroll-based modules + embedded quizzes) provides the "Mode A" exposition pattern, and `case-study` (system-wide, just generalized from `hh-case-study` 2026-04-28) provides the "Mode B" 2-hunter + paired-debate + 3-act-lecture pattern for learning from a specific incident.

The user wants three explicit assessment formats per domain: (a) engineering/code → MCQ + true/false + spot-the-bug; (b) medicine → MCQ (USMLE/AMBOSS-style clinical vignettes); (c) language → fill-in-the-blank + matching pairs + cloze deletion for vocabulary. Spaced-repetition retention is mandatory across all domains — Anki via MCP server is the chosen backend (no SR engine to build). Persistence has two distinct layers: the PRD itself (this file) for design-persistence, and per-learner runtime state (quiz attempts, scores, mastery decay, SR schedule) which audits suggest should be SQLite or JSON, NOT Postgres.

Three audits are complete: `codebase-to-course` (the HTML rendering shell — keep ~85% as-is, engine is domain-agnostic), `jtangen/classbuild` (5-stage pipeline + cognitive-science scaffolding via typed schema + 7-question-type weekly challenge + answer-balancer post-pass), and `JulienAvezou/ai-course-generator` (concept DAG as build-time validator + LLM-as-advisor-not-arbiter + LLM gateway with secret-scan + retry-with-validator pattern). A deep-research call on AMBOSS + UpToDate medical formatting is running and will land before the paired debate. Anki MCP ecosystem (multiple servers: amidvidy/anki-mcp for language with TTS, nailuoGG/anki-mcp-server for bulk CRUD, samefarrar/mcp-ankiconnect for conversational quizzing) is the chosen SR backend. Final output: a comprehensive PRD generated post-debate that captures architecture, schemas, prompt templates, persistence model, and a buildout plan.

## 2. Current Tasks

- [x] Audit `codebase-to-course` — engine ~85% domain-agnostic, keep HTML shell
- [x] Audit `jtangen/classbuild` — extracted typed-schema scaffold + 7-question-type challenge + answer-balancer
- [x] Audit `JulienAvezou/ai-course-generator` — extracted concept-DAG-as-validator + LLM-as-advisor + gateway hardening
- [x] First deep-research call (broad market scan) — surfaced ClassBuild, ai-course-generator, Anki MCP ecosystem, Neeto-1.0-8b (medical), QUEST-AI (USMLE), ChalkAI (STEM), skill-creator validation
- [x] Generalize `hh-case-study` → `~/.claude/skills/case-study.md` (Mode B, system-wide, auto-detected stance + storage)
- [ ] **Wait for AMBOSS/UpToDate deep research** (task `aa71eb17`, started 2026-04-28 ~12:04, ETA 15-40 min) — this is the medical-formatting layer for Mode A medical content
- [ ] **Paired debate (Claude × Gemini, multi-round)** on universal-lesson-generator architecture — synthesize all inputs above into design decisions
- [ ] **Generate comprehensive PRD** as the persistent design artifact — architecture, schemas, prompt templates, runtime persistence model, buildout plan
- [ ] (Then) build the skill itself

## 3. Subagent Log

| Spawn | Name | Purpose | Result |
|---|---|---|---|
| 2026-04-28 ~10:35 | adversarial-bug-hunter (×2 parallel) | Audit `codebase-to-course` for safety + architecture | SAFE; engine ~85% domain-agnostic; HTML shell + main.js + styles.css are reusable; 4 phases (Codebase Analysis → Curriculum Design → Module Briefs → Build); single-file scroll-snap output with stateless quizzes |
| 2026-04-28 ~11:55 | adversarial-bug-hunter (×2 parallel) | Kill stale `hh-case-study` references after rename | 2 historical refs in case-studies/ kept as archival; 1 forward-ref in work-recap updated; 0 active refs remain |
| 2026-04-28 ~12:35 | general-purpose | Architectural audit of `jtangen/classbuild` | 5-stage pipeline (Setup→Syllabus→Research→Build→Export); typed-schema-as-pedagogy (`SciencePrinciple` union, `ScienceAnnotation`, `spacingConnections[]`); 7-question-type weekly challenge; `answerBalancer.ts` post-pass; iframe-srcdoc rendering; MIT licensed |
| 2026-04-28 ~12:35 | general-purpose | Architectural audit of `JulienAvezou/ai-course-generator` | Concept DAG as build-time validator (NOT runtime arbiter); milestone progression FSM is pure & LLM-free; LLM gateway with sha256 cache + secret-scan + token-gate; "LLM as advisor not arbiter" verified concretely; MIT licensed |

## 4. Decisions Log

| Time | Decision | Rationale |
|---|---|---|
| 2026-04-28 | Audience = single user (solo learner = user) | Simplifies persistence (SQLite/JSON, no auth, no multi-user features) |
| 2026-04-28 | Domains in scope: engineering/code, medicine (MCQ-style), language (DE/IT), repos | User's explicit list; medicine is study-aid NOT clinical decision support |
| 2026-04-28 | Per-domain assessment formats: code → MCQ + T/F + spot-the-bug; medicine → MCQ (USMLE-style vignettes); language → fill-blank + matching + cloze | User's domain-specific pedagogical convention |
| 2026-04-28 | Spaced-repetition backend = Anki via MCP (not custom) | Anki is gold-standard SR; SM-2/FSRS already implemented; multiple Anki MCP servers exist; offload SR scheduling entirely |
| 2026-04-28 | Two pedagogical modes: Mode A (codebase-to-course style — exposition + scroll-modules) and Mode B (case-study style — 2-hunter + paired-debate + 3-act-lecture) | Both modes valid, picked per source-material type; Mode A for "how X works", Mode B for "learning from a specific failure / case" |
| 2026-04-28 | Keep `codebase-to-course` HTML shell as the rendering layer | ~85% domain-agnostic per audit; main.js + styles.css are generic; only prose (SKILL.md, content-philosophy, interactive-elements, module-purpose menu) is code-specific |
| 2026-04-28 | LLM as advisor not arbiter — deterministic progression | Verified concretely in ai-course-generator audit; FSM/DAG decides progression; LLM only generates content + grades attempts |
| 2026-04-28 | Persistence: SQLite or JSON for learner state, NOT Postgres | Solo learner; ai-course-generator's Postgres + multi-user schema is overkill |

## 5. Open Items

### 5a. Pending inputs (gates the paired debate)
- ✅ **AMBOSS/UpToDate deep research** — task `aa71eb17`, COMPLETED 2026-04-28 ~12:45 (21 min). Both templates locked: AMBOSS = nested-bullets / buzzwords / Hammer-rated MCQs / Attending Tips / 1500-2000 words; UpToDate = academic prose / GRADE framework / Summary+Recommendations / 5000-10000 words. Both supported as parallel sub-modes within medicine domain via `audience_focus` parameter. Full templates in `~/dev/projects/chiron/memory-bank/{systemPatterns,productContext}.md`.

### 5b. Decisions to be locked in the paired debate
- [ ] **Single skill vs skill-bundle vs MCP server** — one Claude Code skill that does everything, OR a bundle of skills (per-domain), OR an MCP server with skill stubs?
- [ ] **Mode A vs Mode B selection** — heuristic? user-tagged? auto-detect from input type?
- [ ] **Source-ingestion adapters** — how to abstract code/PDF/transcript/syllabus into a unified intermediate "brief" format (codebase-to-course's brief-as-contract pattern)
- [ ] **Quiz primitives extension to main.js** — add `mcq-clinical-vignette`, `fill-blank` (with fuzzy umlaut/accent grading), `matching-pair` (N↔N), `cloze`, `true-false`. Estimate ~150 LOC additive.
- [ ] **Scoring + persistence schema** — what's tracked? `{moduleId, questionId, correct, ts, confidence}` per attempt? Mastery decay? SQLite schema TBD.
- [ ] **Anki integration** — which MCP server? Single per-domain decks or one mega-deck? Card export format? When are cards generated (per chapter? on demand?)
- [ ] **Curriculum templates per domain** — module-purpose menus (medicine: pathology→presentation→diagnostics→treatment→complications→edge-cases; language: vocab→grammar→reading→writing→listening; etc.)
- [ ] **Verifier loop** — copy QUEST-AI's 3-stage Generate → Verify → Refine for medical, optional elsewhere?
- [ ] **Skill validation rig** — adopt anthropics/skills/skill-creator's Executor → Grader → Comparator → Analyzer pattern?

### 5c. Build-time validation gates (lifted from ai-course-generator)
- [ ] Concept DAG as static JSON, validated at course-generation time (not runtime gating)
- [ ] LLM gateway: sha256 cache + secret regex scan + token pre-flight + per-call usage log
- [ ] LLM-with-validator retry loop (3 attempts max, structured issue list fed back)

## 6. Ephemeral Marker

**Delete when:** delete after universal-lesson-generator skill ships and is validated against engineering / medical (MCQ) / language (DE-IT fill-blank) test cases

## 7. Revision Log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-04-28 | Initial draft |
| 0.2 | 2026-05-12 | Added §8 PRD inventory pointing to design v1 + 3 new child PRDs (server CMS, generator enhancements umbrella, lesson expander) |

---

## 8. PRD Inventory (this is the project's tracking PRD — keep this list current)

The Chiron project's design now spans 4 PRDs in this folder. This tracker is the index.

| PRD | Status | Concern | Speckit-ready? |
|---|---|---|---|
| [`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md) | DRAFT (design complete) | Parent design — the Claude Code skill / generator core, locked 12 architectural decisions, 5-stage pipeline, WidgetSpec, SQLite schema, 10-phase buildout | No (design-level, not feature-level) |
| [`chiron_server_cms_2026-05-12.md`](./chiron_server_cms_2026-05-12.md) | DRAFT (design complete) | Server CMS — Hono+Bun, laptop→Pi→AWS, library + cross-lesson SR + phone review | Yes (FR/NFR/user-stories in §16.5-§16.8) |
| [`chiron_generator_cureiq_synthesis_2026-05-12.md`](./chiron_generator_cureiq_synthesis_2026-05-12.md) | DRAFT (umbrella roadmap) | Generator enhancements — image source, RAG source, multi-hop integration. Synthesizes prior art from `gyasis/CureIQ`. | Per sub-feature (one Speckit invocation per G1/G2/G4) |
| [`chiron_lesson_expander_2026-05-12.md`](./chiron_lesson_expander_2026-05-12.md) | DRAFT (focused feature) | First sub-feature of generator enhancements (Phase GP1). Append N more vignettes/MCQs to an existing lesson. CLI + CMS-driven modes. | Yes (sized for single `/speckit-specify` invocation) |

**Recommended speckit invocation order** (after TTS fix lands): server CMS P0.5 → lesson expander → image adapter (G1) → RAG adapter (G2) → multi-hop integration (G4).
