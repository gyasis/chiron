<!--
SYNC IMPACT REPORT
==================
Version change: (uninitialized template) → 1.0.0
Bump rationale: Initial ratification — template populated with concrete principles for
  the first time. MAJOR baseline establishes governance from scratch.

Modified principles: N/A (initial ratification — all five principles new)
Added sections:
  - Core Principles (I–V)
  - Technical Constraints
  - Development Workflow
  - Governance
Removed sections: None

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — reviewed; "Constitution Check" gate aligns
     with Principles I–V (no edits required; gate is principle-agnostic by design).
  ✅ .specify/templates/spec-template.md — reviewed; scope/requirements compatible.
  ✅ .specify/templates/tasks-template.md — reviewed; task categorization compatible.
  ✅ .specify/templates/checklist-template.md — reviewed; compatible.
  ⚠ Agent guidance files (CLAUDE.md at project root) already encode these principles
     verbatim — no propagation required, but treat CLAUDE.md as the runtime mirror of
     this constitution. If this file changes, mirror to CLAUDE.md.

Follow-up TODOs: None.
-->

# Chiron Constitution

## Core Principles

### I. Three Co-Equal Domains (NON-NEGOTIABLE)

Code, medicine, and language are first-class, equally-weighted domains. Domain-specific
pedagogy and assessment formats MUST be preserved — never strip medical or language
affordances to "simplify" a code-centric default. Per-domain assessment formats are
locked: medicine uses USMLE/AMBOSS-style clinical-vignette MCQs; languages use
fill-blank/matching/cloze with native-speaker TTS personas; code uses MCQ + spot-the-bug
+ concept flashcards. Adding a fourth domain requires a constitutional amendment.

**Rationale:** Chiron's differentiator is that it generates rigorous lessons across
disciplines that conventional code-tutorial tools ignore. Defaulting to code erodes the
product.

### II. Solo Learner with Multi-Persona Content

The system serves exactly one human learner. There MUST NOT be authentication,
multi-tenant infrastructure, or shared state across users. Persistence MUST use SQLite
or JSON in the lesson output directory — never Postgres or a hosted DB. However, lesson
**content** MUST employ AI-generated personas (peer-learner, native-speaker tutor,
subject-expert) to simulate study-environment social discourse and combat solo-learner
isolation.

**Rationale:** Single-user scope keeps the surface area small and shippable; AI
personas deliver the engagement value of a study group without the infrastructure of
one.

### III. LLM as Advisor, Not Arbiter

Lesson progression MUST be deterministic — driven by an explicit concept DAG and
milestone finite-state machine. The LLM's role is restricted to (a) generating content
into typed schema slots and (b) grading learner attempts. The LLM MUST NOT decide which
lesson comes next, whether a learner has mastered a topic, or when to advance.

**Rationale:** LLM-controlled progression produces nondeterministic, ungradable
curricula. Deterministic scaffolding with LLM-filled content is the only design that
yields reproducible pedagogy.

### IV. Source-Grounded Generation

When a user supplies a source (textbook PDF, codebase, clinical reference, language
corpus), all generated lesson content MUST be grounded in that source. Web search and
model priors are SUPPLEMENTARY context only — never primary. Medical content without an
explicit source MUST refuse to generate rather than fabricate.

**Rationale:** Hallucinated medical content is a safety hazard; ungrounded code lessons
teach folklore. Source-grounding is the only defensible default.

### V. Self-Contained Local Output, Zero Telemetry

Lesson output MUST be a single self-contained HTML site that renders by opening
`index.html` in a browser — no build step, no server. Spaced-repetition state lives in
a local SQLite (or JSON) file alongside the HTML. The system MUST NOT phone home: no
third-party telemetry, no analytics, no remote logging. Generation runs locally with
the user's own API keys.

**Rationale:** The user owns their data and their study artifacts. Portability and
privacy are preconditions, not features.

## Technical Constraints

- **Stack:** Python or TypeScript for the generator; vanilla HTML/CSS/JS for output (no
  build step). SQLite for runtime SR state. SM-2 or FSRS scheduler implemented in-tree
  under `lib/`.
- **Heritage repos:** Architecture extensions MUST consult prior audits at
  `~/dev/audits/codebase-to-course/`, `~/dev/audits/classbuild/`, and
  `~/dev/audits/ai-course-generator/` before introducing new patterns.
- **Anki export:** Optional `.apkg` export is permitted as a secondary path. Anki MUST
  NOT be the primary spaced-repetition store.
- **Modes:** Mode A (course-style multi-chapter scroll-snap site) and Mode B
  (case-study 3-act lecture) are the only supported output modes. Mode is auto-detected
  from intent + source type; Mode A is the default.

## Development Workflow

- **PRD is source of truth.** Project-local PRDs live in `prd/` and travel with the
  repo (NOT in the global `~/dev/prd/scratch/` librarian). When a PRD conflicts with
  `memory-bank/`, the PRD wins; `memory-bank/` is a navigation index for future
  sessions.
- **Design decisions with intellectual tension** SHOULD use the `/paired-debate` skill
  (Claude × Gemini) before being committed to the PRD.
- **Every feature** MUST start from a spec (`/speckit-specify`) → plan
  (`/speckit-plan`) → tasks (`/speckit-tasks`) → implementation (`/speckit-implement`).
  The Constitution Check gate in the plan template MUST pass before tasks are
  generated.
- **Runtime learner state** (quiz attempts, mastery, weakness logs) MUST NEVER be
  written to `memory-bank/`, the PRD, or any file checked into git. It belongs in
  `<lesson-output-dir>/.chiron-state.{db,json}` only.

## Governance

This constitution supersedes informal conventions, ad-hoc CLAUDE.md edits, and prior
verbal agreements. The runtime mirror of these principles in `CLAUDE.md` MUST be kept
in sync — if this file changes, the project-root `CLAUDE.md` MUST be updated in the
same commit.

**Amendment procedure:** Amendments are proposed by editing this file via
`/speckit-constitution`. Each amendment MUST include a Sync Impact Report header,
bump the version per the policy below, and update `LAST_AMENDED_DATE`.

**Versioning policy (semantic):**
- **MAJOR** — backward-incompatible removal or redefinition of a principle, or removal
  of a governance rule.
- **MINOR** — addition of a new principle or section, or material expansion of an
  existing principle.
- **PATCH** — wording clarifications, typo fixes, non-semantic refinements.

**Compliance review:** Every plan generated by `/speckit-plan` MUST evaluate the
proposed approach against Principles I–V at the Constitution Check gate. Violations
require either (a) a revised plan or (b) a constitutional amendment justifying the
deviation. Complexity introduced in violation of Principle III (deterministic
progression) or Principle V (self-contained local output) MUST be explicitly justified
in the plan's Complexity Tracking section.

**Version**: 1.0.0 | **Ratified**: 2026-04-28 | **Last Amended**: 2026-04-28
