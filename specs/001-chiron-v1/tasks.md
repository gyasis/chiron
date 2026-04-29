---
description: "Task list for Chiron v1 — Universal Lesson Generator"
---

# Tasks: Chiron v1 — Universal Lesson Generator

**Input**: Design documents from `specs/001-chiron-v1/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/skill-triggers.md`, `contracts/widget-spec.ts`, `contracts/pipeline-stages.md`, `contracts/sqlite-schema.sql`, `quickstart.md`

**Tests**: The spec explicitly requires an eval rig with 4 golden inputs (FR-026). Test tasks are included for each user story phase as the golden-input regression rather than traditional unit tests. Per-spec, the "test" is "open the generated `lesson.html` in a headless browser and confirm snapshot key fields match." No traditional pytest/jest unit tests — Constitution III says LLM is advisor, not arbiter; deterministic scaffolding is validated by golden-input regression.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependencies on incomplete tasks — can run in parallel
- **[Story]**: Maps to user stories from `spec.md` — `[US1]` Code, `[US2]` Italian, `[US3]` Medicine, `[US4]` Research-paper, `[US5]` Mode B case-study, `[US6]` New-domain extensibility
- All paths are relative to the repo root (`~/dev/projects/chiron/`)

## Path Conventions

- **Skill bundle**: `skill/` — the deployable Claude Code skill, mirroring PRD §10 and `plan.md` structure
- **Specs**: `specs/001-chiron-v1/` — design docs (already populated, not modified by tasks)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory layout, and tooling.

- [x] T001 Create the `skill/` directory tree per `plan.md`: `skill/{prompts/{00-ingest/,medicine-only/},ingest-adapters/,concepts/,curricula/,personas/,shell/{themes/,vendor/},lib/,tests/{golden-inputs/,snapshots/}}`
- [x] T002 [P] Initialize TypeScript scaffolding at `skill/` — `package.json` (no `@anthropic-ai/sdk`, no `@google/generative-ai`; deps are `zod`, `better-sqlite3`, `pdfjs-dist`, plus `pdf-to-img` or equivalent for scanned-PDF rasterization), `tsconfig.json` (strict mode), `.gitignore`
- [x] T003 [P] Symlink the in-repo skill into Claude Code's skill directory: `ln -s ~/dev/projects/chiron/skill ~/.claude/skills/chiron` (idempotent — script in `skill/scripts/install.sh`)
- [x] T004 [P] Fork codebase-to-course shell verbatim into `skill/shell/` — copy `_base.html`, `_footer.html`, `styles.css` (1195 LOC), `main.js`, `build.sh` from `~/dev/audits/codebase-to-course/`
- [x] T005 [P] Port ClassBuild theme tokens from `~/dev/audits/classbuild/` into `skill/shell/themes/_tokens.css`, `warm-paper.css`, `midnight.css`, `ocean.css` (FR-024)
- [x] T006 [P] Author new theme files `skill/shell/themes/clinical.css` (medicine default — white/blue/teal) and `skill/shell/themes/linguistic.css` (language default — warm earth tones)
- [x] T007 [P] Author `skill/shell/_science-overlay.css` with the 5 cog-sci pillar colors (spacing/interleaving/retrieval/examples/dual-coding) per PRD §7.4

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure all user stories depend on. Vendored libraries, SQLite schema, validators, the pipeline shell, the SKILL.md entry point, and the universal widget primitives. **No user-story work begins until this phase is complete.**

**⚠️ CRITICAL**: Story phases (3+) cannot start until every task here is done.

### Vendored runtime libraries (FR-037 / Q9)

- [x] T008 [P] Vendor MathJax + mhchem extension into `skill/shell/vendor/mathjax/` — pin a specific version, document in `skill/shell/vendor/README.md`
- [x] T009 [P] Vendor Mermaid into `skill/shell/vendor/mermaid/` — pin a specific version, document in vendor README
- [x] T010 [P] Author `skill/shell/vendor/forest-plot/` — small custom forest-plot mini-lib (vanilla JS / SVG); supports `studies: Array<{label, effect, ci: [low, high]}>` shape per `contracts/widget-spec.ts`
- [x] T011 Author `skill/shell/vendor/molecule-renderer/README.md` and stub directory — concrete library (Kekule.js or RDKit-JS) is selected during US3 Phase 4 per FR-031; this task only places the directory + version-pinning template
- [x] T012 [P] Update `skill/shell/build.sh` to inline every file under `skill/shell/vendor/*` as `<script>` / `<style>` blocks into the single output `lesson.html` (FR-037, Stage 5 of `contracts/pipeline-stages.md`)

### SQLite + persistence

- [x] T013 [P] Author `skill/lib/sqlite-init.ts` — opens (or creates) `<lesson-output-dir>/.chiron-state.db`, applies schema from `contracts/sqlite-schema.sql` verbatim (8 tables: `_chiron_meta`, `quiz_attempts`, `mastery`, `chapter_completion`, `weakness_log`, `sr_cards`, `sr_review_log`, `bookmarks` — explicitly NO `llm_usage` / `llm_cache`), seeds `_chiron_meta.schema_version='1'`, applies forward-only idempotent migrations (R-08)
- [x] T014 [P] Author `skill/lib/sr-scheduler.ts` — SM-2 algorithm (~50 LOC per R-07): `nextDue(card, rating: 1|2|3|4)` returns updated `{ease_factor, interval_days, repetitions, next_due_at}`; writes to `sr_cards` and appends to `sr_review_log`

### Schemas and validators (FR-006, FR-008)

- [x] T015 [P] Author `skill/lib/schemas/widget-spec.ts` — Zod schema mirroring `contracts/widget-spec.ts` (21 variants); export `WidgetSpec` discriminated union and `WidgetSpecSchema` Zod parser
- [x] T016 [P] Author `skill/lib/schemas/chapter-syllabus.ts` — Zod schema for `ChapterSyllabus` per `data-model.md` §1.2, with refinements: `scienceAnnotations.length >= 3` (FR-022), conditional `spacingConnections.length` 2-4 for chapter ≥ 8 (FR-022), every quiz-type widget has `variants: Variant[]` non-empty (FR-021)
- [ ] T017 [P] Author `skill/lib/schemas/brief.ts` — Zod schema for `Brief` per `data-model.md` §1.1 with all 12 `sourceType` values from FR-032, plus `SourceFileEntry` for `sourceManifest[]`
- [ ] T018 Author `skill/lib/validator.ts` — runs Zod validation, then concept-DAG validation (no cycles; every prereq exists; every `keyConcepts` entry exists in the domain's DAG), then rubric check; returns structured issue list on failure for retry (FR-006); depends on T015, T016, T017

### Theme registry (FR-024)

- [x] T019 Author `skill/lib/theme.ts` — exports `Theme` interface, theme registry mapping `id → tokens`, `pickThemeForDomain(domain) → themeId`, and `buildThemePromptBlock(theme) → string` (the system-prompt token injector ported from ClassBuild)

### Widget rendering — universal primitives only

- [x] T020 Author `skill/lib/widget-renderer.ts` — dispatch table from `WidgetSpec.type` to renderer function. Phase 2 implements only universal primitives (`mcq`, `true-false`, `mathjax`, `mermaid`); domain-specific widgets (vignette, fill-blank, molecule, forest-plot) come in their respective story phases.
- [ ] T021 [P] Author `skill/lib/chemistry-renderer.ts` — abstract `MoleculeRenderer` interface per FR-031 + `data-model.md` §1.4; provides `renderChemicalReaction(equation, container)` (uses vendored MathJax+mhchem). Concrete `MoleculeRenderer` impl is deferred to US3 (Phase 5).

### Pipeline stage skeleton (FR-005, contracts/pipeline-stages.md)

- [x] T022 [P] Author `skill/lib/progress.ts` — stderr progress emitter per R-05 / FR-028: `progress.stage(N, total, label)`, `progress.chapter(stageN, chapN, chapTotal, label)`. Used by every pipeline stage.
- [x] T023 [P] Author `skill/lib/source-copy.ts` — copies any local-file source into `<lesson-output-dir>/source/` preserving structure (FR-030). Used by ingest adapters.
- [ ] T024 Author `skill/lib/pipeline.ts` — orchestrates the 5 stages per `contracts/pipeline-stages.md`. For text-LLM stages (1-4), it loads the right prompt template and **hands control to the parent Claude Code agent** (Q8 — no SDK call). It enforces validator retry up to 3 attempts (FR-006) and the FR-029 deep-research opt-in cap. Depends on T013, T018, T019, T020, T022, T023.

### SKILL.md entry-point + trigger contract (FR-001, contracts/skill-triggers.md)

- [ ] T025 Author `skill/SKILL.md` — top-level skill descriptor with both entry-point styles per `contracts/skill-triggers.md`: (a) natural-language trigger phrases (`teach me`, `make a course on`, `lesson from this PDF`, `case-study this`, `chiron`); (b) slash-commands (`/chiron`, `/chiron-code`, `/chiron-medicine`, `/chiron-language`, `/chiron-research-paper`, `/chiron-case-study`). Includes the FR-036 Gemini MCP toolset table verbatim. Refuses German with the clear "deferred to post-v1" message per skill-triggers.md validation #2.
- [ ] T026 [P] Author `skill/lib/trigger-context.ts` — parses raw user input into the `TriggerContext` struct from `contracts/skill-triggers.md` (resolves domain, mode, sourceArg, flags); exposes `parseTrigger(raw, source: 'natural-language' | 'slash-command') → TriggerContext`
- [ ] T027 [P] Author `skill/lib/mode-heuristic.ts` — `detectMode(extractedText) → {mode: 'A'|'B', reason: string}` per FR-003; `<2000 words → B candidate`, `≥2000 → A candidate`. Honors user override.

### Per-stage prompt templates — universal only

- [ ] T028 [P] Author `skill/prompts/01-brief.md` — Stage 1 prompt template with `{{domain}}` / `{{sourceType}}` / `{{extractedText}}` slots; output schema documented inline
- [ ] T029 [P] Author `skill/prompts/02-syllabus.md` — Stage 2 prompt template that fills the `ChapterSyllabus[]` schema slots, includes `{{themeBlock}}` injection (FR-024) and the FR-022 mandate (≥3 scienceAnnotations, spacingConnections from chapter 8+)
- [ ] T030 [P] Author `skill/prompts/03-validate-rubric.md` — Stage 3 rubric prompt for the validator's structured-issue retry loop
- [ ] T031 [P] Author `skill/prompts/04a-chapter-write.md` — Stage 4 chapter narrative prompt (~150-400 words) referencing `{{chapterSyllabus}}` and `{{priorChapterStruggleSummary}}` (FR-023 pseudo-state)
- [ ] T032 [P] Author `skill/prompts/05-answer-balancer.md` — post-pass prompt that re-balances correct-answer length + position across MCQ options without changing semantics (FR-006 utility)

### Stage 5 assembly (orchestrates all the above)

- [ ] T033 Author `skill/lib/assemble.ts` — Stage 5: invokes `shell/build.sh`, calls `sqlite-init.ts` to initialize the DB, seeds `sr_cards` chapter-1 due-now, seeds `bookmarks` chapter-1 entry, opens `lesson.html` via `xdg-open`/`open`. Depends on T012, T013

**Checkpoint**: Foundation complete — vendored libs in place, SQLite schema applied at any new lesson dir, validators ready, pipeline stages 1-5 callable end-to-end with universal widgets only. User stories can now begin.

---

## Phase 3: User Story 1 — Code-domain lesson from a small repo (Priority: P1) 🎯 MVP

**Goal**: Point Chiron at a small TypeScript repository and get a multi-chapter scroll-snap HTML lesson with side-by-side code+English, MCQ + true/false + spot-the-bug quizzes, AI peer-learner dialogue, and SR cards. Re-open restores scroll position and surfaces due cards.

**Independent Test**: Run Chiron against `skill/tests/golden-inputs/code-small-repo/` → expect a generated `lesson.html` with ≥3 chapters, ≥8 quiz items per chapter, AI peer dialogue present, and `.chiron-state.db` initialized. Re-open the HTML; confirm scroll-position restore + due-card surfacing.

### Static catalogs

- [ ] T034 [P] [US1] Author `skill/concepts/code.json` — small concept DAG (~15 concepts is fine for v1) with prereq edges; passes the validator (no cycles, every prereq exists)
- [ ] T035 [P] [US1] Author `skill/curricula/code.json` — `templateStyle: scroll-modules`, `chapterCountTarget: 8`, `perChapterQuizTarget: 10`, `perChapterSrCardTarget: 7`, `modeAOnly: true`
- [ ] T036 [P] [US1] Author `skill/personas/code.json` — Chiron-mentor (subject expert) + Alice (peer, eager) + Bob (peer, confused), all in the JSON shape from `data-model.md` §3.3

### Ingest adapter

- [ ] T037 [US1] Author `skill/ingest-adapters/code-repo.ts` — handles git repo / local dir / single source file (FR-032 f). Walks the repo respecting `.gitignore`, extracts file list + key file contents into a `Brief` with `sourceType: 'code-repo'` and metadata `{repoSha, fileCount, primaryLanguage}`. Source NOT copied (referenced by path per FR-030 carve-out for repos).

### Code-specific widget renderers

- [ ] T038 [P] [US1] Extend `skill/lib/widget-renderer.ts` to render `spot-the-bug` widgets — code block with line numbering, click-to-mark-bug interaction, reveal explanation
- [ ] T039 [P] [US1] Implement `skill/lib/chalkai-loader.ts` lazy-loader stub (PRD §3 #11) — loads ChalkAI runtime ONLY when a chapter's WidgetSpec includes `type: 'reactive-math'`. v1 may stub if no code-domain lessons exercise it.
- [ ] T040 [P] [US1] Extend `skill/lib/widget-renderer.ts` to render `code-runner` widgets per R-03 — lazy-loads Pyodide from CDN if `runtime: 'pyodide'`; falls back to "Pyodide unavailable" message when offline; native JS runtime always works inline

### Code-specific prompts

- [ ] T041 [P] [US1] Author `skill/prompts/00-ingest/code-repo.md` — guides the agent on what to extract from a repo
- [ ] T042 [P] [US1] Author `skill/prompts/04b-quiz-mcq.md` — universal MCQ generation prompt (used by US1 + others)
- [ ] T043 [P] [US1] Author `skill/prompts/04f-quiz-spot-the-bug.md` — code-domain-specific quiz primitive
- [ ] T044 [P] [US1] Author `skill/prompts/04l-peer-dialogue.md` — Alice/Bob/Mike/Priya/Luca/Sofia dialogue generator referencing `{{personaRoster}}` and `{{priorChapterStruggleSummary}}`
- [ ] T045 [P] [US1] Author `skill/prompts/04m-domain-expert.md` — Chiron-mentor / Dr. Reyes / Klaus / Dr. Hofmann expert dialogue
- [ ] T046 [P] [US1] Author `skill/prompts/04n-sr-card-gen.md` — generates SR cards (`card_type`, `front`, `back`) per chapter, scoped to the chapter's `keyConcepts`

### Golden input + snapshot

- [ ] T047 [US1] Create `skill/tests/golden-inputs/code-small-repo/` — a tiny, real, MIT-licensed TypeScript repo (e.g. a 200-line utility lib) committed verbatim into the dir
- [ ] T048 [US1] Author `skill/tests/snapshots/code-small-repo.json` — expected key fields: `{chapterCount, totalQuizCount, srCardCount, peerDialogueLineCount, hasSpotTheBug: true}`
- [ ] T049 [US1] Author `skill/tests/test.sh` — driver that runs all golden inputs, generates `lesson.html` in a temp dir, opens in headless browser, diffs against snapshots, exits non-zero on any mismatch (FR-026)

**Checkpoint US1**: Code lesson works end-to-end. The MVP can ship here.

---

## Phase 4: User Story 2 — Italian language lesson (Priority: P2)

**Goal**: Generate an Italian vocab + grammar lesson from a CSV (or grammar concept), with fill-blank that accepts `caffe`/`caffè` interchangeably, cloze cards, and Maria native-speaker TTS dialogue via Gemini MCP.

**Independent Test**: Run Chiron against `skill/tests/golden-inputs/language-it-passato-prossimo/` → expect `lesson.html` with `caffe`-tolerant fill-blank, ≥30 cloze cards, ≥1 Maria TTS clip; re-open shows due vocabulary cards.

### Static catalogs

- [ ] T050 [P] [US2] Author `skill/concepts/language-it.json` — vocab + grammar concept DAG for Italian
- [ ] T051 [P] [US2] Author `skill/curricula/language-vocab.json` — vocab-list-style curriculum (`chapterCountTarget: 5-10`, `perChapterSrCardTarget: 30-50`)
- [ ] T052 [P] [US2] Author `skill/curricula/language-grammar.json` — grammar-arc curriculum (`templateStyle: scroll-modules`)
- [ ] T053 [P] [US2] Author `skill/personas/language-it.json` — Maria (native speaker, `ttsVoice: 'it-female-1'`) + Luca (peer, eager) + Sofia (peer, confused)

### Ingest adapter

- [ ] T054 [P] [US2] Author `skill/ingest-adapters/vocab-list.ts` — parses a CSV vocab list (FR-032 g); produces `Brief` with `sourceType: 'vocab-list'`. Source CSV copied into `<lesson-output-dir>/source/` per FR-030.

### Language widget renderers

- [ ] T055 [P] [US2] Extend `skill/lib/widget-renderer.ts` to render `fill-blank` widgets with FR-020 fuzzy accent matching: `caffe ≡ caffè`, `e ≡ è`, `niño ≡ nino` (Spanish-style accents tolerated for cross-language consistency)
- [ ] T056 [P] [US2] Extend `skill/lib/widget-renderer.ts` to render `matching-pair` widgets — `1to1` and `NtoN` drag-drop modes per `contracts/widget-spec.ts`
- [ ] T057 [P] [US2] Extend `skill/lib/widget-renderer.ts` to render `cloze` widgets with `ankiCompatible: true` (so the optional `.apkg` export later can pick them up unchanged)
- [ ] T058 [P] [US2] Extend `skill/lib/widget-renderer.ts` to render `audio-tts` widgets — produces `<audio>` tag pointing at the per-clip MP3 in `<lesson-output-dir>/audio/`

### TTS via Gemini MCP

- [ ] T059 [US2] Author `skill/lib/tts-gemini.ts` — invokes the Gemini TTS path (per FR-036 / R-01) for each `audio-tts` widget transcript; saves audio files to `<lesson-output-dir>/audio/<chapter-id>/<line-id>.mp3`. ElevenLabs fallback path documented but not wired in v1 unless Gemini fails Phase 4 ear-test.

### Italian-specific prompts

- [ ] T060 [P] [US2] Author `skill/prompts/00-ingest/vocab-list.md`
- [ ] T061 [P] [US2] Author `skill/prompts/04d-quiz-fill-blank.md` — fill-blank generation with explicit FR-020 fuzzy-accent rule for Italian
- [ ] T062 [P] [US2] Author `skill/prompts/04e-quiz-cloze.md` — Anki-compatible cloze generation

### Golden input + snapshot

- [ ] T063 [US2] Create `skill/tests/golden-inputs/language-it-passato-prossimo/` — a vocab CSV + grammar concept hint for the Italian past tense (passato prossimo)
- [ ] T064 [US2] Author `skill/tests/snapshots/language-it-passato-prossimo.json` — expected: `{chapterCount, fillBlankCount: ≥10, clozeCount: ≥30, mariaAudioClipCount: ≥1, fuzzyAccentCheck: passed}`
- [ ] T065 [US2] Extend `skill/tests/test.sh` to include language-it-passato-prossimo run + snapshot diff

**Checkpoint US2**: US1 + US2 work independently. Two golden inputs pass.

---

## Phase 5: User Story 3 — Medicine AMBOSS-style lesson (Priority: P3)

**Goal**: Generate a USMLE/AMBOSS-style lesson from a textbook PDF (text or scanned), with 15-20+ clinical-vignette MCQs, chemistry rendering, pathway diagrams, agreement-matrix and assertion-reason quizzes, and the QUEST-AI verifier loop. **This is the longest phase — also the one where ALL the new ingest adapters land.**

**Independent Test**: Run Chiron against `skill/tests/golden-inputs/medicine-pneumonia/` → expect ≥15 vignette MCQs (full structure: vignette / labs / Q / 5 options / per-distractor / Hammer / Attending Tip / keyInfo), chemistry equations rendering, ≥1 molecule rendering, ≥1 verifier-loop cycle in the run log.

### Static catalogs

- [ ] T066 [P] [US3] Author `skill/concepts/medicine.json` — medicine concept DAG (~30 concepts spanning conditions / drugs / mechanisms)
- [ ] T067 [P] [US3] Author `skill/curricula/medicine-amboss.json` — AMBOSS sub-mode: `format_style: bulleted_nested`, `audience_focus: board-exam pattern recognition`, `recommendation_framework: consensus only`, `word_count: 1500-2000`, `vignetteTaxonomy: ['classic','atypical','pediatric','elderly','immunocompromised','pregnancy','comorbidity','mimicker']`
- [ ] T068 [P] [US3] Author `skill/curricula/medicine-uptodate.json` — UpToDate sub-mode: `format_style: academic_prose`, `audience_focus: point-of-care management`, `recommendation_framework: GRADE enforced`, `word_count: 5000-10000`
- [ ] T069 [P] [US3] Author `skill/personas/medicine.json` — Dr. Reyes (attending) + Mike (med student, peer) + Priya (resident, peer)

### Ingest adapters — all 6 new adapters land here (FR-032 b/c/d/e/i/j/k/l)

- [ ] T070 [US3] Author `skill/ingest-adapters/pdf.ts` — text-PDF via `pdfjs-dist`; if no usable text layer (>50 chars on first non-cover page), rasterize via `pdf-to-img` and fall through to Gemini `mcp__gemini-mcp__interpret_image` per page (R-04 revised). Source PDF copied to `<lesson-output-dir>/source/` (FR-030). Emits per-page progress (Stage 0 announces page count up front per R-10 replacement).
- [ ] T071 [P] [US3] Author `skill/ingest-adapters/image.ts` — handles single image file AND folder of page images (FR-032 c/d). Sends each image to `mcp__gemini-mcp__interpret_image`; preserves alphabetic order; populates `Brief.sourceManifest[]` (FR-034)
- [ ] T072 [P] [US3] Author `skill/ingest-adapters/multi-pdf.ts` — accepts an ordered list or directory of PDFs (FR-032 e); delegates each file to `pdf.ts`; concatenates extracted text in supplied order; per-file provenance in `Brief.sourceManifest[]`
- [ ] T073 [P] [US3] Author `skill/ingest-adapters/url.ts` — fetches a URL (FR-032 i) OR reads a local `.html` file (FR-032 j); sanitizes HTML; extracts text
- [ ] T074 [P] [US3] Author `skill/ingest-adapters/transcript.ts` — handles plain text / markdown chat-meeting-lecture transcripts (FR-032 h)
- [ ] T075 [P] [US3] Author `skill/ingest-adapters/agent-report.ts` — accepts markdown / JSON output from another agent (FR-032 k); marks the entry `secondary` in `Brief.sourceManifest[]`; sets `Brief.agentSourceProvenance`; refuses if it would be the SOLE source for a medicine lesson (FR-035)
- [ ] T076 [US3] Author `skill/ingest-adapters/bundle.ts` — walks a directory (FR-032 l); honors optional `chiron.manifest.json` if present (declares per-file `role`); else dispatches each recognized file by extension. Emits warnings for unknown extensions (skipped, not failed). Aggregates ordered concatenation across all files. Depends on T070, T071, T072, T073, T074, T075.

### Medicine widget renderers

- [ ] T077 [P] [US3] Extend `skill/lib/widget-renderer.ts` to render `mcq-clinical-vignette` widgets — vignette block + `<keyinfo>` chip rendering + 5-option layout + per-distractor explanation reveal + Hammer rating chip + Attending Tip callout
- [ ] T078 [P] [US3] Extend `skill/lib/widget-renderer.ts` to render `agreement-matrix` widgets — N statements × {always / sometimes / never} grid
- [ ] T079 [P] [US3] Extend `skill/lib/widget-renderer.ts` to render `assertion-reason` widgets — 5-relationship picker per `contracts/widget-spec.ts`
- [ ] T080 [US3] Extend `skill/lib/chemistry-renderer.ts` — concrete `MoleculeRenderer` impl. **Phase 5 prototype rubric** per R-02: prototype both Kekule.js and RDKit-JS against the metformin SMILES, pick the smaller / faster one, drop the loser. Vendor the winning library into `skill/shell/vendor/molecule-renderer/`. Ships a single dep at runtime per FR-031.
- [ ] T081 [P] [US3] Extend `skill/lib/widget-renderer.ts` to render `pathway-diagram` widgets — supports `renderer: 'mermaid'` (uses vendored Mermaid) and `renderer: 'd3-custom'` (vanilla JS / SVG)

### QUEST-AI medicine verifier loop (FR-007, SC-011)

- [ ] T082 [P] [US3] Author `skill/prompts/medicine-only/verifier-stage1-generate.md`
- [ ] T083 [P] [US3] Author `skill/prompts/medicine-only/verifier-stage2-verify.md`
- [ ] T084 [P] [US3] Author `skill/prompts/medicine-only/verifier-stage3-refine.md`
- [ ] T085 [US3] Wire the verifier loop into `skill/lib/pipeline.ts` Stage 3 — runs ONLY for medicine domain; up to 3 attempts; if all fail, abort the chapter with structured issue report (SC-011). Depends on T024, T082, T083, T084.

### Medicine prompts + ingest

- [ ] T086 [P] [US3] Author `skill/prompts/00-ingest/pdf.md` — guides agent on text-PDF and scanned-PDF extraction handoffs
- [ ] T087 [P] [US3] Author `skill/prompts/00-ingest/image.md` — guides on image-folder + single-image bundles + figure interpretation
- [ ] T088 [P] [US3] Author `skill/prompts/00-ingest/agent-report.md` — guides on treating agent reports as `secondary`
- [ ] T089 [P] [US3] Author `skill/prompts/00-ingest/bundle.md` — guides on multi-source bundles + manifest interpretation
- [ ] T090 [P] [US3] Author `skill/prompts/04c-quiz-clinical-vignette.md` — vignette MCQ generator with vignette taxonomy enforcement (15-20+, 8 categories), `keyInfo[]` extraction, Hammer rating, Attending Tip, per-distractor explanations (FR-019)
- [ ] T091 [P] [US3] Author `skill/prompts/04g-quiz-agreement-matrix.md`
- [ ] T092 [P] [US3] Author `skill/prompts/04j-quiz-assertion-reason.md`
- [ ] T093 [P] [US3] Author `skill/prompts/04p-chemical-rendering.md` — chemical-equation generation (MathJax+mhchem `\ce{}` syntax) and molecule-2d SMILES generation

### Refusal logic (medicine-specific guardrails)

- [ ] T094 [US3] Add medicine-source refusal logic in `skill/lib/pipeline.ts` Stage 0: refuse generation when the only source is `agent-report` (FR-035, SC-016) AND when there is no source-grounding at all (FR-016). Depends on T024.

### Golden input + snapshot

- [ ] T095 [US3] Create `skill/tests/golden-inputs/medicine-pneumonia/` — a community-acquired pneumonia textbook chapter (mix of text-PDF + 1 image figure to exercise vision path AND text-extract path)
- [ ] T096 [US3] Author `skill/tests/snapshots/medicine-pneumonia.json` — expected: `{chapterCount, vignetteCount: ≥15, vignetteTaxonomyCoverage: ['classic','atypical', ...], hammerRangePresent: true, keyInfoTagsPerVignette: ≥3, attendingTipPerVignette: true, chemicalReactionCount: ≥1, moleculeCount: ≥1, verifierCycleCount: ≥1}`
- [ ] T097 [US3] Extend `skill/tests/test.sh` to include medicine-pneumonia run + snapshot diff

**Checkpoint US3**: Medicine works end-to-end. All 6 new ingest adapters now exist. Three golden inputs pass.

---

## Phase 6: User Story 4 — Research-paper lesson (Priority: P3)

**Goal**: Generate a 6-section lesson from any research-paper PDF (motivation / methods / results / discussion / appraisal / connections) with study-design MCQs, slider-estimation widgets, and forest-plot rendering of the primary effect size.

**Independent Test**: Run Chiron against `skill/tests/golden-inputs/research-paper-jones2025/` → expect 6 sections, ≥5 MCQs, ≥1 forest-plot widget, Dr. Hofmann + Bob dialogue.

### Static catalogs

- [ ] T098 [P] [US4] Author `skill/concepts/research-paper.json` — IMRAD-aware concept DAG (study-design / methods / statistics / interpretation)
- [ ] T099 [P] [US4] Author `skill/curricula/research-paper.json` — `chapterCountTarget: 6` (fixed: motivation / methods / results / discussion / appraisal / connections); `perChapterQuizTarget: 5-10`
- [ ] T100 [P] [US4] Author `skill/personas/research-paper.json` — Dr. Hofmann (senior PI, expert) + Bob (skeptical peer)

### Research widget renderers

- [ ] T101 [P] [US4] Extend `skill/lib/widget-renderer.ts` to render `slider-estimation` widgets — value picker with `acceptableRange` band, reveals correct value + unit
- [ ] T102 [P] [US4] Extend `skill/lib/widget-renderer.ts` to render `forest-plot` widgets — uses the vendored `skill/shell/vendor/forest-plot/` mini-lib from T010

### Research prompts

- [ ] T103 [P] [US4] Author `skill/prompts/04i-quiz-slider-estimation.md`
- [ ] T104 [P] [US4] Author `skill/prompts/04o-infographic.md` — for forest-plot data extraction from the source paper

### Golden input + snapshot

- [ ] T105 [US4] Create `skill/tests/golden-inputs/research-paper-jones2025/` — a real (or realistic) research paper PDF
- [ ] T106 [US4] Author `skill/tests/snapshots/research-paper-jones2025.json` — expected: `{sectionCount: 6, mcqCount: ≥5, forestPlotCount: ≥1, drHofmannDialoguePresent: true}`
- [ ] T107 [US4] Extend `skill/tests/test.sh` to include research-paper-jones2025 run + snapshot diff

**Checkpoint US4**: Four golden inputs pass — full v1 domain coverage achieved.

---

## Phase 7: User Story 5 — Mode B case-study delegation (Priority: P3)

**Goal**: Auto-detect Mode B for short incident inputs (`<2000 words`) and delegate to the existing system-wide skill at `~/.claude/skills/case-study.md`.

**Independent Test**: Pass a 1500-word incident write-up → Mode B inferred (heuristic) → `case-study.md` skill invoked. Pass same input with `mode a` → Mode A scroll-modules used instead. Pass `/chiron-case-study` slash → Mode B forced regardless of length.

- [ ] T108 [US5] Add Mode-B delegation logic in `skill/lib/pipeline.ts` Stage 0: when `TriggerContext.mode === 'B'` (either inferred via heuristic or forced via `/chiron-case-study`), invoke `~/.claude/skills/case-study.md` with the source and exit early — Chiron's own pipeline does not run for Mode B. Depends on T024, T026, T027.
- [ ] T109 [P] [US5] Add the `mode b` / `mode a` user-override handler in `skill/lib/trigger-context.ts` per FR-003 — listens for these phrases mid-conversation and updates `TriggerContext.mode`
- [ ] T110 [P] [US5] (Optional) Create `skill/tests/golden-inputs/case-study-incident/` with a 1500-word incident write-up; snapshot only checks "Mode B inferred + case-study.md invoked" — actual case-study output is the sibling skill's responsibility

**Checkpoint US5**: Both modes route correctly; sibling skill is invoked for Mode B.

---

## Phase 8: User Story 6 — Add a new domain via 3 JSON files (Priority: P3)

**Goal**: Validate the per-domain JSON-drop extensibility (FR-025, SC-007). Author 3 JSON files for a trivial new domain (e.g. music-theory minimal) — confirm a working lesson is produced without modifying any TS source under `lib/`, `ingest-adapters/`, or `shell/`.

**Independent Test**: Drop `concepts/music-theory.json` + `curricula/music-theory.json` + `personas/music-theory.json`. Invoke Chiron. Lesson generates. No TS file diffs.

- [ ] T111 [P] [US6] Author `skill/concepts/music-theory.json` — a 10-concept DAG (intervals → scales → triads → chord progressions → cadences)
- [ ] T112 [P] [US6] Author `skill/curricula/music-theory.json` — minimal scroll-modules curriculum
- [ ] T113 [P] [US6] Author `skill/personas/music-theory.json` — a music-mentor expert + 2 peer learners
- [ ] T114 [US6] Add a new-domain regression check in `skill/tests/test.sh`: run Chiron against the music-theory drop with a 1-paragraph music-theory text input, confirm `lesson.html` generates, confirm `git diff` shows zero changes under `skill/lib/`, `skill/ingest-adapters/`, `skill/shell/` (SC-007). Depends on T049 (test.sh exists).
- [ ] T115 [P] [US6] Document the per-domain drop process in `skill/README.md` — name the 3 files, the optional prompt-template variant slot, and the validation steps

**Checkpoint US6**: Extensibility proven. Anyone can add a new domain without TS work.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Quality-of-life features, in-lesson runtime polish, the optional Anki export, and final validation.

### In-lesson runtime polish (FR-011, FR-013, SC-006)

- [ ] T116 [P] Implement scroll-position restore in `skill/shell/main.js` — on lesson re-open, read `bookmarks.scroll_position` for the most-recent-`last_visited_at` row and `window.scrollTo()` once content is laid out
- [ ] T117 [P] Implement chapter-completion marking in `skill/shell/main.js` — chapters listed in `chapter_completion` get a visual checkmark in the TOC
- [ ] T118 Implement in-lesson SR review surface in `skill/shell/main.js` — query `sr_cards WHERE next_due_at <= NOW() AND suspended = 0`; render a "Due cards" panel pinned at the top of the page; on rating click, write to `sr_review_log`, update `sr_cards` SM-2 state via the bundled `lib/sr-scheduler.ts` (compiled to JS for the browser). Depends on T014, T116.
- [ ] T119 [P] Implement bookmark write in `skill/shell/main.js` — debounced scroll-position writer; updates `bookmarks` row on scroll-pause + on chapter switch

### Optional Anki export (SC-009)

- [ ] T120 [P] Author `skill/lib/apkg-export.ts` — one-way export of `sr_cards` to a standard `.apkg` file; preserves cloze / term-def / vignette card types. Stretch goal per spec assumptions; v1 may stub if time-pressed.

### Italian-only refusals + Stage 0 progress

- [ ] T121 Add German-deferred refusal in `skill/lib/trigger-context.ts` — when input contains "german", "deutsch", "language-de", or `/chiron-language-de`, return a clear "deferred to post-v1" error and exit. Depends on T026.
- [ ] T122 Add image-count-up-front announcement in `skill/lib/pipeline.ts` Stage 0 — for any source containing images (scanned-PDF, image, image-folder, multi-pdf with images, bundle), emit `[stage 0/5] ingest: <type> (<N> pages/images — <N> interpret_image calls follow)` BEFORE the first MCP call (R-10 replacement, FR-028). Depends on T024.

### Documentation

- [ ] T123 [P] Update `skill/README.md` with the canonical "how to use Chiron" content from `quickstart.md`
- [ ] T124 [P] Update repo-root `README.md` with project overview, link to `prd/chiron_design_v1_2026-04-28.md` and to this spec
- [ ] T125 [P] Update repo-root `CLAUDE.md` with skill location pointer + symlink instruction

### Final validation

- [ ] T126 Run `skill/tests/test.sh` against all 5 golden inputs (code, language-it, medicine, research-paper, music-theory extensibility check) — all snapshots match, all `lesson.html` files render in headless browser without console errors
- [ ] T127 Run `quickstart.md` validation manually — go through every "Generate a lesson" example (both natural-language and slash-command styles) for all 4 domains; confirm re-open behavior, due-card surfacing, scroll-restore
- [ ] T128 Confirm `git diff` and `git ls-files` show zero `@anthropic-ai/sdk` / `@google/generative-ai` references anywhere under `skill/` (Q8 invariant)
- [ ] T129 Confirm vendored libraries are checked in under `skill/shell/vendor/` and the assembled `lesson.html` from any golden input contains the libraries inline (no `<script src="https://cdn...">` references — Pyodide CDN reference exempted only when a `code-runner` widget is present per R-03)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user stories**
- **Phase 3 (US1 Code)**: Depends on Phase 2 — MVP target
- **Phase 4 (US2 Italian)**: Depends on Phase 2 — independent of US1
- **Phase 5 (US3 Medicine)**: Depends on Phase 2 — introduces all 6 new ingest adapters; **US4/US6 depend on these adapters**
- **Phase 6 (US4 Research)**: Depends on Phase 2 + Phase 5 (`pdf.ts` from T070, `image.ts` from T071 reused for paper figures)
- **Phase 7 (US5 Mode B)**: Depends on Phase 2 — light, mostly delegation logic
- **Phase 8 (US6 Extensibility)**: Depends on at least one prior story phase being complete (so there's something to validate "no TS diff" against)
- **Phase 9 (Polish)**: Depends on all desired user stories being complete

### Within-Phase Dependencies

- Phase 2: T015/T016/T017 (Zod schemas) → T018 (validator) → T024 (pipeline.ts orchestrator)
- Phase 2: T013 (sqlite-init) → T024
- Phase 2: T012 (build.sh inlines vendor) → T033 (assemble.ts)
- Phase 5: T070 (pdf.ts) + T071 (image.ts) + T072–T075 (other adapters) → T076 (bundle.ts dispatcher)
- Phase 5: T080 (MoleculeRenderer concrete impl + Phase 4 prototype rubric) — single library winner vendored before US3 ships
- Phase 5: T082/T083/T084 (verifier prompts) → T085 (verifier wired into pipeline)

### Parallel Opportunities

Within Phase 2, the following can run in parallel as they are different files:
- T002, T003, T004, T005, T006, T007 (Phase 1 setup tasks already mostly [P])
- T008, T009, T010, T011, T012 (vendor library prep — different vendor subdirs)
- T013, T014 (sqlite-init + sr-scheduler)
- T015, T016, T017 (three Zod schemas) → then T018 sequentially
- T019 (theme.ts), T020 (widget-renderer skeleton), T021 (chemistry-renderer interface)
- T022, T023 (progress + source-copy)
- T026, T027 (trigger-context + mode-heuristic)
- T028, T029, T030, T031, T032 (5 prompt templates)

Within US3, all 6 ingest adapters except `bundle.ts` (T076) can run in parallel:
- T070, T071, T072, T073, T074, T075 — all [P], different files. Then T076 sequential.
- All medicine widget renderers (T077, T078, T079, T081) are [P] — different `widget-renderer.ts` cases. T080 (MoleculeRenderer) is the cross-cutting one.
- Verifier prompts T082/T083/T084 [P]; pipeline integration T085 sequential.

User-story phases 3–7 can run in parallel by different developers (or different focused sessions) once Phase 2 is complete.

---

## Parallel Execution Examples

### Phase 2 Foundational (early)

```bash
# Vendor library prep — 5 different vendor subdirs
Task: "T008 Vendor MathJax + mhchem into skill/shell/vendor/mathjax/"
Task: "T009 Vendor Mermaid into skill/shell/vendor/mermaid/"
Task: "T010 Author skill/shell/vendor/forest-plot/ mini-lib"
Task: "T011 Author skill/shell/vendor/molecule-renderer/README.md"
Task: "T012 Update skill/shell/build.sh to inline vendor/"

# Foundational TS scaffolding — all different files
Task: "T013 Author skill/lib/sqlite-init.ts"
Task: "T014 Author skill/lib/sr-scheduler.ts (SM-2)"
Task: "T015 Author skill/lib/schemas/widget-spec.ts (Zod)"
Task: "T016 Author skill/lib/schemas/chapter-syllabus.ts (Zod)"
Task: "T017 Author skill/lib/schemas/brief.ts (Zod)"
```

### Phase 5 US3 Medicine (ingest adapters)

```bash
# All 6 leaf adapters in parallel (T076 bundle.ts depends on these)
Task: "T070 Author skill/ingest-adapters/pdf.ts (text + vision fallback)"
Task: "T071 Author skill/ingest-adapters/image.ts (single + folder)"
Task: "T072 Author skill/ingest-adapters/multi-pdf.ts"
Task: "T073 Author skill/ingest-adapters/url.ts (URL + .html file)"
Task: "T074 Author skill/ingest-adapters/transcript.ts"
Task: "T075 Author skill/ingest-adapters/agent-report.ts (FR-035 refusal)"
```

---

## Implementation Strategy

### MVP First (US1 Code only)

1. **Phase 1 Setup** — repo + symlink + shell fork
2. **Phase 2 Foundational** — vendor libs, SQLite, validators, pipeline skeleton, SKILL.md (CRITICAL — blocks everything)
3. **Phase 3 US1** — code domain end-to-end with golden input
4. **STOP and validate** — run `skill/tests/test.sh` against `code-small-repo`. Open the generated `lesson.html`. Re-open. Confirm SR cards work. **MVP shipped.**

### Incremental delivery after MVP

1. MVP (Phase 1+2+3) — code lessons work
2. **+ Phase 4 US2** — Italian lessons work; Maria TTS via Gemini MCP validated
3. **+ Phase 5 US3** — Medicine lessons + all 6 new ingest adapters + QUEST-AI verifier; **vision path validated**
4. **+ Phase 6 US4** — Research papers (largely reuses Phase 5 adapters)
5. **+ Phase 7 US5** — Mode B delegation
6. **+ Phase 8 US6** — Extensibility validated with music-theory drop
7. **+ Phase 9 Polish** — in-lesson SR review surface, Anki export, final docs

### Parallel team strategy (if multiple sessions)

After Phase 2 completes:
- Session A: Phase 3 US1 (code) + Phase 4 US2 (Italian)
- Session B: Phase 5 US3 (medicine + all ingest adapters)
- Session C: Phase 7 US5 (Mode B)
- Reconvene for Phase 6 US4 (depends on B's `pdf.ts` + `image.ts`) and Phase 8 US6 (depends on at least one A or B story complete)
- Phase 9 polish: split among any session

---

## Notes

- `[P]` tasks operate on different files with no incomplete dependencies; safe to parallelize.
- `[Story]` label maps each task to its user story for traceability and per-story checkpointing.
- **No traditional unit tests** — the spec validates via golden-input regression (FR-026). Add unit tests selectively only when a specific deterministic helper (e.g. SM-2 math, Zod refinements) shows a bug worth pinning.
- Commit after each task or logical task group. The git history should read as a sequence of small, reversible increments.
- Per-stage progress reporting (FR-028) is the user's main visibility lever; if you can't see what stage you're in during a generation, that's a bug.
- The **Phase 4 prototype rubric for `MoleculeRenderer`** (T080) is the only place where a deferred decision is forced; everything else either has a concrete answer or is explicitly post-v1.
- **No in-tree LLM gateway, no `llm_usage` / `llm_cache` tables, no `@anthropic-ai/sdk` dep, no $25 cost guard** — all reversed by Clarification Q8. Tasks below intentionally omit any work that would have created them.
- **Vendored libraries** (T008–T012, FR-037) actually deliver Constitution V's "self-contained local output, zero telemetry" promise. T129 enforces this in regression.
