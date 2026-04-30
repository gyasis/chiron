# Chiron — Universal Lesson Generator

![Branch](https://img.shields.io/badge/branch-001--chiron--v1-blue) ![Tasks](https://img.shields.io/badge/tasks-WIP-yellow)

> *"A centaur. A teacher. The tutor of Achilles, Asclepius, Jason, and Heracles."*

## TL;DR

Chiron is a universal LLM-powered lesson generator for solo learners across code, medicine, and language. Drop in any source — repo, PDF, vocab CSV, research paper — and get a self-contained interactive lesson HTML.

**Fresh clone? Read [`SETUP.md`](./SETUP.md) first.** It covers prerequisites, install, build, and verification — including how a brand-new Claude Code session bootstraps the skill.

## Foundational facts

- **Three co-equal domains: code, medicine, and language.** Not a code-tutorial tool with the others bolted on. Specialized paths per domain are encouraged where pedagogy demands it.
- **Single learner = Gyasi.** No multi-user features, no auth. SQLite per-lesson at `<lesson-output-dir>/.chiron-state.db`.
- **AI multi-persona content** (peer learners + tutor + native speaker) inside one solo-learner's lesson — content-layer feature, NOT a multi-user system.

## Documentation hierarchy

| Doc | Purpose |
|---|---|
| [skill/README.md](./skill/README.md) | Skill how-to — quick-start, supported domains, drop-in extension |
| [skill/SKILL.md](./skill/SKILL.md) | Skill descriptor — top-level skill manifest |
| [prd/chiron_design_v1_2026-04-28.md](./prd/chiron_design_v1_2026-04-28.md) | Comprehensive design PRD (post-debate) |
| [prd/universal_lesson_generator_2026-04-28.md](./prd/universal_lesson_generator_2026-04-28.md) | Original design PRD |
| [specs/001-chiron-v1/](./specs/001-chiron-v1/) | Spec + design artifacts: `spec.md`, `plan.md`, `data-model.md`, `tasks.md`, [contracts/](./specs/001-chiron-v1/contracts/) |
| [memory-bank/](./memory-bank/) | `projectbrief.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md` |
| [CLAUDE.md](./CLAUDE.md) | Project directives — Claude Code agent guardrails |

## Architecture summary

**Pipeline.** Five-stage `Ingest → Generate → Validate → Build → Assemble` flow. Each stage has typed inputs/outputs, validators, and retry semantics. See [specs/001-chiron-v1/contracts/pipeline-stages.md](./specs/001-chiron-v1/contracts/pipeline-stages.md).

**LLM architecture.** Per Q8 of the design PRD, the **parent Claude Code agent runs all text-LLM steps in its own context** — Chiron's skill structures prompts, validates outputs against Zod schemas, and orchestrates retries. There is no separate text-LLM gateway process. Vision (diagram OCR, figure description) routes through `mcp__gemini-mcp__interpret_image`.

**Output.** A single self-contained `lesson.html` per lesson — vendored libs (MathJax + mhchem, Mermaid, optional Pyodide, ChalkAI for `reactive-math`, an abstract `MoleculeRenderer`) are inlined per FR-037, so opening the HTML in a browser works with no build step. Runtime state — quiz attempts, mastery, SR scheduling, weakness log, bookmarks — lives in `.chiron-state.db` (SQLite, per-lesson, single learner).

## Heritage repos

Audited locally in `~/dev/audits/`:

- `~/dev/audits/codebase-to-course/` — HTML rendering shell (reused ~85% as-is)
- `~/dev/audits/classbuild/` — 5-stage pipeline + typed-schema pedagogy
- `~/dev/audits/ai-course-generator/` — concept DAG validator + LLM-as-advisor

## Per-domain assessment formats

| Domain | Primary | Secondary | SR card type |
|---|---|---|---|
| **Code** | MCQ + true/false + spot-the-bug | drag-and-drop matching | Concept flashcards |
| **Medicine** | MCQ paired with USMLE/AMBOSS-style clinical vignette | agreement-matrix (always/sometimes/never) | Disease/drug/mechanism cards |
| **Language (DE/IT)** | Fill-blank + matching | sentence reordering, dictation | Vocabulary + sentence cloze cards |

## Mode A vs Mode B

| Mode | Trigger | Output |
|---|---|---|
| **A — Course-style** | "turn this textbook chapter into a lesson" | Multi-chapter scroll-snap HTML site, Coursera-style |
| **B — Case-study-style** | "make this incident a teaching moment" | 3-act lecture (Evidence → 2 Lectures → Synthesis) — see `~/.claude/skills/case-study.md` |

## Open PRDs affecting Chiron

- `~/dev/prd/scratch/chiron_tts_provider_selection_2026-04-29.md` — TTS provider selection (Gemini API primary, ElevenLabs fallback) for the Italian native-speaker persona. Lives in the global PRD librarian, not the project tree.

## License

TBD — likely MIT. No `LICENSE` file committed yet.

## Status / next steps

WIP — see [specs/001-chiron-v1/tasks.md](./specs/001-chiron-v1/tasks.md) for current progress. **Wave 12 in flight.**

## Why "Chiron"?

Chiron was unique among centaurs: civilized, learned, and the prototype tutor. He taught medicine to Asclepius, strategy and music to Achilles, navigation to Jason, and astronomy to Heracles. One teacher, many subjects, deep mastery.
