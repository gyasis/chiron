# CLAUDE.md — Chiron Project Directives

**Project:** chiron — universal LLM-powered lesson generator for solo learners across code, medicine, and language.

## ⚠️ FOUNDATIONAL FACT — Three Co-Equal Domains

Chiron is **NOT** a code-tutorial tool with medicine/language bolted on. It is a domain-agnostic lesson generator where **code, medicine, and language are equally weighted**. Specialized paths per domain are encouraged where pedagogy demands it. Never strip medical or language affordances to "simplify" — they are first-class.

## ⚠️ FOUNDATIONAL FACT — Single Learner = Gyasi

The user IS the audience. No multi-user features, no auth, no multi-tenant infra. SQLite or JSON for persistence (NOT Postgres). One learner state. But the lesson **content** itself uses **AI multi-persona personas** (peer learners + native-speaker tutor) to fight solo-learner isolation — that's a content design choice, not a multi-user system.

## Authoritative documents

```
prd/universal_lesson_generator_2026-04-28.md  ← THE design PRD (project-local)
prd/<comprehensive-prd-post-debate>.md        ← FINAL comprehensive PRD (generated after paired debate)
memory-bank/projectbrief.md                    ← project's why + audience
memory-bank/systemPatterns.md                  ← architecture + key patterns
memory-bank/techContext.md                     ← stack + dependencies
memory-bank/activeContext.md                   ← current focus
~/.claude/skills/case-study.md                 ← Mode B sibling skill (system-wide)
```

When the design PRD conflicts with a memory-bank file, the **PRD wins** (PRD is the source of truth; memory-bank is a navigation index for future sessions).

PRDs for Chiron live in `~/dev/projects/chiron/prd/`, NOT in the global `~/dev/prd/scratch/` librarian. This is intentional — Chiron's design docs travel with the project.

## Heritage repos (audited locally)

```
~/dev/audits/codebase-to-course/        ← HTML rendering shell — keep ~85% as-is
~/dev/audits/classbuild/                ← 5-stage pipeline + typed-schema pedagogy
~/dev/audits/ai-course-generator/       ← concept DAG validator + LLM-as-advisor
```

Read these before extending Chiron's architecture.

## Per-domain assessment formats (LOCKED)

| Domain | Primary | Secondary | SR card type |
|---|---|---|---|
| **Code** | MCQ + true/false + spot-the-bug | drag-and-drop matching | Concept flashcards (term ↔ definition) |
| **Medicine** | **MCQ paired with clinical vignette** (USMLE/AMBOSS-style: vignette stem + lab values + leading question + 5 options + per-distractor explanation) | agreement-matrix (always/sometimes/never for clinical reasoning) | Disease/drug/mechanism cards |
| **Language (DE/IT)** | Fill-blank + matching | sentence-reordering, dictation | Vocabulary cards + sentence cards (cloze deletion) |

## AI multi-persona engagement (KEY DIFFERENTIATOR)

Solo learners isolate. Chiron simulates a study environment:

- **Peer-learner personas** — Alice, Bob, etc. — fellow students who ask questions, propose theories, get things wrong, learn alongside the user. Creates social discourse → drives explanation-based retrieval (Feynman technique). Repurposed from ClassBuild's `discussion.ts` and `activities.ts`.
- **Native-speaker persona** — for language only — German/Italian speaker the user practices dialog with. TTS-voiced via Gemini. Repurposed from ClassBuild's audio transcript pipeline.
- **Subject-expert persona** — for medicine — attending physician / clinical educator who walks the user through cases. Mode-B case-study sibling.

These are content-layer features. NOT a multi-user system. They're LLM-generated personas inside one solo-learner's lesson.

## Core architectural rules

1. **LLM is advisor, not arbiter.** Deterministic progression (concept DAG + milestone FSM); LLM only generates content + grades attempts. (Per `ai-course-generator` audit.)
2. **Typed schema as pedagogy scaffold.** Force the LLM to fill schema slots — cognitive science emerges from structure, not hopeful prose. (Per ClassBuild audit.)
3. **HTML output is single self-contained site.** Build on `codebase-to-course`'s shell. No build step required. Open `index.html` in browser → it works.
4. **Chiron owns SR end-to-end via SQLite.** SM-2/FSRS scheduler in `lib/`. Resume + revisit happen inside the lesson HTML, not by switching to Anki. Anki is an OPTIONAL `.apkg` export for users who want mobile review. (PIVOTED 2026-04-28 — earlier "Anki via MCP as primary SR" decision is reversed.)
5. **No third-party telemetry.** All gen runs locally with user's API keys. No phone-home.
6. **Source-grounded, not hallucinated.** When a user supplies a textbook PDF or codebase, the lesson is grounded in that source. Web search is supplementary, never primary.

## Two persistence layers

| Layer | What it stores | Where |
|---|---|---|
| **Design** | PRD + memory-bank — this project's architecture, decisions, prompts | `~/dev/prd/scratch/universal_lesson_generator_*.md` + `memory-bank/` |
| **Runtime** (when learner uses Chiron) | Quiz attempts, scores, mastery, completed chapters, weakness log | SQLite or JSON in `<lesson-output-dir>/.chiron-state.{db,json}` |

NEVER save runtime learner state to memory-bank or PRD.

## Mode A vs Mode B

| Mode | Trigger | Output |
|---|---|---|
| **A — Course-style** | "turn this textbook chapter into a lesson" / "generate a course on X" | Multi-chapter scroll-snap HTML site, Coursera-style — exposition + quizzes + flashcards |
| **B — Case-study-style** | "make this incident a teaching moment" / "explain the pattern, not just the fix" | 3-act lecture (Evidence → 2 Lectures → Synthesis) — see `~/.claude/skills/case-study.md` |

Mode is auto-detected from user intent + source type. Default is Mode A.

## When you spawn agents during build/use

- Use `paired-debate` (Claude × Gemini) for design decisions where intellectual tension is needed
- Use `case-study` skill for explaining incidents
- Use `gemini_brainstorm` for divergent options (lesson plan alternatives)
- Use `gemini_research` for external grounding (medical evidence, language usage examples)
- Use `start_deep_research` for deep multi-source synthesis (e.g., AMBOSS-style template extraction)

## Anti-patterns to avoid

- Don't strip ClassBuild's depth to "simplify for solo." Repurpose, don't delete.
- Don't let LLM decide which lesson is next. Always deterministic progression.
- Don't write group-class facilitator notes ("guide the discussion"). Either drop or convert to AI peer-learner dialogue.
- Don't reinvent SM-2/FSRS. Use Anki via MCP.
- Don't fabricate medical content without source grounding. (Q27 from HH constitution applies here too.)

---

*Generated 2026-04-28 during Chiron design phase. See `memory-bank/` for evolving project state.*

## Active Technologies
- TypeScript 5.x (strict mode) + `@anthropic-ai/sdk`, `zod` (runtime schema validation), `better-sqlite3` (synchronous SQLite), `crypto` (sha256 cache key for LLM gateway). Browser runtime: MathJax + mhchem (chemistry), Mermaid (diagrams), Pyodide (optional, code domain), ChalkAI (on-demand for `reactive-math` widgets), an abstract `MoleculeRenderer` (Kekule.js or RDKit-JS — concrete library deferred to Phase 4 prototype per FR-031). TTS via Gemini API (Italian native-speaker persona); ElevenLabs as fallback if Gemini quality insufficient. (001-chiron-v1)
- SQLite at `<lesson-output-dir>/.chiron-state.db` (per-lesson, single learner). Schema in PRD §8 covers `quiz_attempts`, `mastery`, `chapter_completion`, `weakness_log`, `llm_usage`, `llm_cache`, `sr_cards`, `sr_review_log`, `bookmarks`, plus `_chiron_meta` (schema_version) for migrations. Source PDFs copied into `<lesson-output-dir>/source/` (FR-030). (001-chiron-v1)

## Recent Changes
- 001-chiron-v1: Added TypeScript 5.x (strict mode) + `@anthropic-ai/sdk`, `zod` (runtime schema validation), `better-sqlite3` (synchronous SQLite), `crypto` (sha256 cache key for LLM gateway). Browser runtime: MathJax + mhchem (chemistry), Mermaid (diagrams), Pyodide (optional, code domain), ChalkAI (on-demand for `reactive-math` widgets), an abstract `MoleculeRenderer` (Kekule.js or RDKit-JS — concrete library deferred to Phase 4 prototype per FR-031). TTS via Gemini API (Italian native-speaker persona); ElevenLabs as fallback if Gemini quality insufficient.
