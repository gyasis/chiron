# Chiron — Comprehensive Design PRD v1

**Date:** 2026-04-28
**Status:** DRAFT — design phase complete, buildout pending
**Owner:** Gyasi Sutton (solo)
**Audience:** future-Gyasi + any AI agent doing the buildout

**Delete when:** v1 ships and validates against all 6 success criteria (§12). Then graduate to `library/L00X_chiron_design.md`.

---

## 1. Executive Summary

**Chiron is a Claude Code agent skill that turns any subject — code repos, medical chapters, German/Italian language, research-paper PDFs — into a structured interactive HTML lesson with quizzes, chemical/math/physics rendering, AI peer-learner engagement, and built-in spaced-repetition retention.**

| Property | Value |
|---|---|
| **Audience** | Single solo learner (Gyasi). No multi-user. |
| **Domains in v1** | code · medicine · language (DE+IT) · research-paper |
| **Domain extensibility** | First-class — drop 3 JSON files (concepts/curricula/personas) per new domain |
| **Output format** | Single self-contained HTML file (no build step to consume) |
| **Persistence** | SQLite at `<lesson-dir>/.chiron-state.db` (resume + revisit + SR scheduling) |
| **Two pedagogical modes** | A: Coursera-style scroll-modules · B: case-study 3-act lecture (delegates to `~/.claude/skills/case-study.md`) |
| **AI engagement layer** | Multi-persona: peer-learners (Alice/Bob/etc.) + domain expert + native-speaker (language) |
| **Spaced repetition** | Chiron-owned SM-2 in SQLite; Anki = optional `.apkg` export |
| **Language** | TypeScript |
| **Heritage** | Forks codebase-to-course's HTML shell, adopts ClassBuild's typed-pedagogy + 7-question challenge + theme parameterization, adopts ai-course-generator's concept-DAG-as-validator + LLM-as-advisor pattern |

---

## 2. Context & Motivation

Solo learners face three unsolved problems:

1. **Subject-matter isolation.** Existing tools are domain-locked.
2. **Pedagogy gaps.** Most tools either dump exposition or quiz brutally — neither models the *retrieval-practice + spaced-repetition + dialogic explanation* loop that drives long-term retention.
3. **Social vacuum.** Solo learners lack peers. Studies show explaining-to-a-peer outperforms re-reading by ~2× for retention (Roediger & Karpicke; Bjork).

Chiron addresses all three: **one tool, four (initial) co-equal domains, AI-simulated peer learners + native-speaker for engagement, integrated spaced-repetition for retention.**

Full context lives in [`memory-bank/projectbrief.md`](../memory-bank/projectbrief.md).

---

## 3. Final Architecture — 12 Locked Decisions

Synthesized from the [paired debate](../research/06_paired_debate_2026-04-28.md). Each decision has a one-line "why."

| # | Axis | Locked Decision | Why |
|---|---|---|---|
| 1 | **Packaging** | Single Claude Code skill with sub-prompt routing per domain | MCP overkill (no third party consumes Chiron); CLI loses skill UX. The skill IS the right abstraction. |
| 2 | **Mode A vs B selection** | Heuristic with override (input <2000 words → Mode B candidate, ≥2000 → Mode A; user can flip with `mode b` command) | Auto-detect with PEP ceremony is over-engineered; explicit flag is high-friction. |
| 3 | **Source ingestion** | Unified Brief schema, but per-domain adapters (no shared base class until v2) | Long-term IR is correct (cross-domain courses); short-term shared base is premature. |
| 4 | **Language** | TypeScript strict, Zod runtime validation | Heritage compatibility; isomorphic stack; no serialization tax. |
| 5 | **Curriculum templates** | Strict TS discriminated unions, NOT a DSL | DSL is a trap; f-strings are too loose; discriminated unions give validation without a parser. |
| 6 | **QUEST-AI verifier loop** | **Conditional** — mandatory for medicine, opt-in elsewhere | Medical hallucinations have asymmetric cost (drug doses memorized into Anki); language verb errors self-correct. |
| 7 | **Eval rig** | 4 golden inputs + scripted regression diff, NOT full skill-creator pipeline | Full Executor→Grader→Comparator→Analyzer is procrastination; manual eyeball is too loose. |
| 8 | **LLM gateway** | 50-line `llm.ts` with sha256 cache + cost log; no secret scan, no telemetry | Solo dev with one set of API keys doesn't need a "proxy for yourself." |
| 9 | **HTML output** | Multi-file authoring, single-file delivery | Best of both — modular templates author-side, one self-contained `lesson.html` consumer-side. |
| 10 | **Peer personas** | Pseudo-stateful — Chapter N writes 3-bullet "what user struggled with" → fed into Chapter N+1 prompt | Stateful misconception retrieval is over-engineered; stateless is "chatbot goldfish." |
| 11 | **ChalkAI** | On-demand only — load runtime when chapter has `WidgetSpec.type = 'reactive-math'`. Mermaid + MathJax for everything else | 80% of widgets (medicine ECG, code dependency graphs, research forest plots) need only Mermaid + MathJax. |
| 12 | **Cost guard** | Single-course estimate + `[y/N]` prompt + hard-fail at $25 | Per-stage budgets are too granular; single budget is too blunt; combo is right. |

**The pedagogical core (3 generalizing lessons from the debate):**

1. For an audience of one, "expensive only where the marginal user benefits."
2. Unified IR is right long-term; the abstraction grows from concrete cases. Build the second domain by copy-paste, abstract on the third.
3. Verification is domain-specific, not universal. Verifier loops belong where the cost of wrong is asymmetric.

---

## 4. Domain Catalog (v1)

| Domain | Source types | Mode A template | Quiz primitives | Personas | Special widgets |
|---|---|---|---|---|---|
| **code** | git repo, local dir, single file | scroll-modules with code-vs-English split | `mcq`, `true-false`, `spot-the-bug`, `matching-pair` | Chiron-mentor (subject expert) + Alice + Bob (peers) | Code-execution sandbox (Pyodide), AST viz, dependency graph (Mermaid) |
| **medicine** | textbook PDF, clinical guideline PDF, paper PDF | **AMBOSS-style** (default — bullets, buzzwords, tables, Hammer MCQs, Attending Tips) **OR UpToDate-style** (prose, GRADE, Summary+Recommendations) | `mcq-clinical-vignette` (5-7 sentence stem + 5 options + per-distractor explanation + `<keyinfo>` tags + Hammer 1-5), `agreement-matrix`, `assertion-reason` | Dr. Reyes (attending) + Mike (med student) + Priya (resident) | **`chemical-reaction` (MathJax+mhchem)**, **`molecule-2d` (Kekule.js or RDKit-JS)**, **`pathway-diagram` (D3.js+custom or Mermaid)**, ECG strip with annotations, calculator (CHADS2-VASc, MELD) |
| **language-de / language-it** | grammar concepts, vocab list (CSV), reading passage | scroll-modules with chapter-by-chapter grammar/vocab arc | `fill-blank` (with fuzzy umlaut/accent grading), `matching-pair` (N↔N), `cloze` (Anki-compatible), `mcq` | Klaus (DE native speaker) / Maria (IT) + study-group peers | TTS audio (Gemini), pronunciation player |
| **research-paper** | PDF (any field) | scroll-modules: Why this matters → Methods → Results → Discussion → Critical appraisal → Connections | `mcq` (study design, primary outcome), `true-false` (common misinterpretations), `slider-estimation` (effect-size confidence) | Dr. Hofmann (senior PI) + Bob (skeptical peer) | Forest-plot interpreter, p-value visualizer, sample-size calculator |

**Per-domain assessment volume targets:**

| Domain | Vignettes/quizzes per topic | SR cards per chapter |
|---|---|---|
| code | 8-12 | 5-10 |
| medicine | **15-20+** (varied taxonomy: classic / atypical / pediatric / elderly / immunocompromised / pregnancy / comorbidity / mimicker) | 10-20 |
| language | 30-50 (vocab is high-volume) | 30-50 |
| research-paper | 5-10 | 8-12 |

**Domain extensibility path:** any future domain (music-theory, law, history, finance, physics, etc.) joins by dropping `concepts/<domain>.json` + `curricula/<domain>.json` + `personas/<domain>.json`. Optional: one prompt-template variant if domain has unusual content shape (notation, case-citation, equation rendering).

---

## 5. Pedagogical Patterns

### 5.1 Two pedagogical modes

| Mode | Trigger | Source character | Output shape |
|---|---|---|---|
| **A — Course / scroll-modules** | "course on X", "make a lesson out of Y", "teach me Z" | Multi-concept body of knowledge (textbook chapter, codebase, vocab set, paper) | Multi-chapter scroll-snap HTML site |
| **B — Case-study / Socratic** | "case study this", "explain the pattern", "what's actually going on here, professor-style" | Specific single incident with evidence + competing interpretations | 3-act lecture: Evidence → Two Lectures (Hawk vs Pragmatist) → Synthesis (delegates to `~/.claude/skills/case-study.md`) |

**Selection heuristic:** `<2000 words → Mode B candidate; ≥2000 → Mode A candidate`. User overrides with `mode b` / `mode a` command. Show inferred mode + 1-line reason.

### 5.2 Medical sub-modes (Mode A only)

User picks at lesson generation, OR generate both as parallel views.

| Parameter | AMBOSS | UpToDate |
|---|---|---|
| `format_style` | `bulleted_nested` | `academic_prose` |
| `audience_focus` | board-exam pattern recognition | point-of-care management |
| `recommendation_framework` | consensus only | GRADE enforced |
| `differential_format` | tabular comparison | narrative rule-out |
| `ui_elements` | Attending Tips, buzzwords (bolded), `<mark>` for high-yield | Society guideline links, citations |
| `word_count` | 1500-2000 | 5000-10000 |
| `quiz_primitive` | `mcq-clinical-vignette` (Hammer, vignette, per-distractor explanations) | none (calculators / decision algorithms instead) |

Sample AMBOSS vignette structure:

```
A 67-year-old male presents with 3 days of productive cough, fever to 38.9°C,
and SpO2 of 91% on room air. Chest X-ray shows right lower lobe consolidation.
WBC 15.2 with left shift.

What is the most likely organism?

a) Streptococcus pneumoniae          ← correct (CAP in older adult, lobar consolidation)
b) Mycoplasma pneumoniae             ← tempting (CAP overlap), but typically dry cough + younger + patchy interstitial
c) Legionella pneumophila            ← tempting (CAP + fever), but typically GI symptoms + hyponatremia
d) Haemophilus influenzae            ← would be correct in COPD patient
e) Pseudomonas aeruginosa            ← would be correct in CF / VAP / immunocompromised

Hammer: 2/5
Attending Tip: Lobar consolidation + acute presentation in older adult = pneumococcus until proven otherwise.
Key info: 67-year-old · lobar consolidation · left shift
```

### 5.3 AI multi-persona engagement

Solo learners isolate. Chiron simulates a study environment via LLM personas inside one solo-learner's lesson.

| Persona role | Implementation | Domains |
|---|---|---|
| **Peer learner** (Alice, Bob, Mike, Priya, etc. — names per domain) | Asks questions user might fear to ask · proposes plausible-but-wrong reasoning · expresses confusion / hypothesis · user must explain back | All |
| **Domain expert** | Socratically asks deeper questions · references guidelines / canonical refs | All (Chiron-mentor / Dr. Reyes / Klaus / Dr. Hofmann) |
| **Native speaker** (TTS-voiced) | Conversational dialogue practice · pronunciation modeling | Language only |

**Pseudo-state:** at end of Chapter N, an LLM call summarizes "what user struggled with" into 3 bullets. These pass into Chapter N+1's persona prompt. ~10 LOC. No SQLite "misconception retrieval engine" until v2.

### 5.4 Cognitive science scaffolding (typed schema)

Forced via TypeScript discriminated unions. The LLM has to fill the slots.

```typescript
type SciencePrinciple = 'spacing' | 'interleaving' | 'retrieval' | 'examples' | 'dual-coding';

interface ScienceAnnotation {
  principle: SciencePrinciple;
  description: string;
  relatedChapters: number[];
}

interface ChapterSyllabus {
  narrative: string;
  keyConcepts: string[];
  widgets: WidgetSpec[];
  scienceAnnotations: ScienceAnnotation[];   // ≥3 per chapter
  spacingConnections: number[];              // chapter numbers this revisits (≥2 by chapter 8+)
}
```

Per-chapter syllabus prompt enforces: *"MINIMUM 3 annotations per chapter, covering different principles. Chapter 1 has none; by Chapter 8+, 2-4 spacing connections."*

### 5.5 Spaced-repetition (Chiron-owned, SQLite-backed)

SM-2 algorithm in `lib/sr-scheduler.ts` (~50 LOC). Cards stored in `sr_cards` table with `ease_factor`, `interval_days`, `repetitions`, `next_due_at`. Review writes to `sr_review_log` and updates state.

**Critical:** review experience is **integrated into the lesson HTML**. When user re-opens a Chiron lesson, due cards appear at the top of the page, inline with reading. No app-switching to Anki.

Optional: `.apkg` export button for users who want mobile review. One-way; Chiron remains canonical.

---

## 6. WidgetSpec Schema (Interactive Primitives)

Every chapter declares its widgets in the syllabus phase. The LLM must populate the schema; the renderer enforces it.

```typescript
type WidgetSpec =
  | { type: 'mcq'; stem: string; options: Array<{label: string; correct?: boolean; explanation: string}>; difficulty?: 1|2|3|4|5 }
  | { type: 'mcq-clinical-vignette'; vignette: string; keyInfo: string[]; stem: string; options: [...]; hammer: 1|2|3|4|5; attendingTip: string }
  | { type: 'true-false'; statement: string; correct: boolean; explanation: string }
  | { type: 'fill-blank'; sentence: string; blanks: Array<{answer: string; alternates?: string[]; fuzzyMatch?: 'umlaut'|'accent'|'none'}> }
  | { type: 'matching-pair'; pairs: Array<{left: string; right: string}>; mode: '1to1' | 'NtoN' }
  | { type: 'cloze'; sentence: string; blanks: number[]; ankiCompatible: true }
  | { type: 'spot-the-bug'; codeBlock: string; bugLine: number; explanation: string }
  | { type: 'agreement-matrix'; statements: string[]; classifications: Array<'always'|'sometimes'|'never'> }
  | { type: 'assertion-reason'; assertion: string; reason: string; correctRelationship: 'both-true-reason-explains' | 'both-true-reason-doesnt-explain' | 'assertion-true-reason-false' | 'assertion-false-reason-true' | 'both-false' }
  | { type: 'confidence-weighted'; mcq: McqSpec; askConfidence: true }
  | { type: 'slider-estimation'; question: string; correctValue: number; acceptableRange: number; unit: string }
  | { type: 'boss'; question: string; requiredConcepts: string[]; rubric: string }
  // Renderable widgets (not quizzes — exposition / dynamic content)
  | { type: 'chemical-reaction'; equation: string }                            // \ce{...} via MathJax+mhchem
  | { type: 'molecule-2d'; smiles: string; library: 'kekule' | 'rdkit-js' }
  | { type: 'pathway-diagram'; nodes: Node[]; edges: Edge[]; renderer: 'mermaid' | 'd3-custom' }
  | { type: 'mermaid'; source: string }
  | { type: 'mathjax'; source: string }
  | { type: 'reactive-math'; chalkDsl: string }                                // ChalkAI runtime loaded on-demand
  | { type: 'code-runner'; language: 'python' | 'javascript'; initialCode: string; runtime: 'pyodide' | 'native' }
  | { type: 'forest-plot'; studies: Array<{label: string; effect: number; ci: [number, number]}> }
  | { type: 'audio-tts'; transcript: string; voice: string };

interface Variant {
  // Each quiz-type widget has variants[] for anti-memorization
  // At runtime, one variant is randomly merged over base
  [key: string]: unknown;
}
```

**Anti-gaming:** every quiz-type widget has `variants: Variant[]`. Runtime randomly picks one and merges it over the base, producing a fresh question per attempt.

---

## 7. Visual Design System

### 7.1 Architecture

**Foundation: codebase-to-course's `styles.css` (forked verbatim, 1195 LOC, MIT, no build step).**
**Layer: ClassBuild's theme parameterization, ported as pure CSS custom properties.**
**Add: ClassBuild's cog-sci science-overlay colors.**

```
chiron/skill/shell/
├── styles.css                  ← FORK from codebase-to-course
├── themes/
│   ├── _tokens.css             ← :root CSS custom properties (Theme contract in CSS)
│   ├── warm-paper.css          ← DEFAULT (codebase-to-course vermillion-on-cream)
│   ├── midnight.css            ← ClassBuild dark/violet
│   ├── ocean.css               ← ClassBuild dark/cyan
│   ├── clinical.css            ← NEW — medical white/blue/teal
│   └── linguistic.css          ← NEW — language warm earth tones
├── _science-overlay.css        ← cog-sci pillar colors (orthogonal to themes)
└── _base.html
```

### 7.2 Theme interface (TypeScript)

```typescript
interface Theme {
  id: 'warm-paper' | 'midnight' | 'ocean' | 'clinical' | 'linguistic';
  name: string;
  pageBg: string; cardBg: string; elevated: string;
  accent: string; accentLight: string; warmAccent: string;
  textPrimary: string; textSecondary: string; textMuted: string;
  success: string;
  headingFont: string; bodyFont: string;
  isDark: boolean;
}
```

### 7.3 Theme auto-pick by domain

| Domain | Default theme |
|---|---|
| code | warm-paper |
| medicine | clinical |
| language-de / language-it | linguistic |
| research-paper | warm-paper |

User overrides with `--theme <id>`.

### 7.4 Science overlay colors

```css
--color-science-spacing:      #8b5cf6;  /* violet */
--color-science-interleaving: #06b6d4;  /* cyan */
--color-science-retrieval:    #f59e0b;  /* amber */
--color-science-examples:     #22c55e;  /* green */
--color-science-dual-coding:  #3b82f6;  /* blue */
```

Used to color callouts / tags that mark which cog-sci principle a content block is exercising.

### 7.5 LLM injection

`buildThemePromptBlock()` (ported from ClassBuild) injects the chosen theme's tokens into the chapter-generation system prompt so the LLM produces content using `var(--color-accent)` not hardcoded hex. Output is theme-portable.

---

## 8. Persistence (SQLite Schema)

Lives at `<lesson-output-dir>/.chiron-state.db`. Per-lesson, not per-user (single learner = the developer).

```sql
-- Quiz attempts (full history for review + analytics)
CREATE TABLE quiz_attempts (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    variant_id TEXT,
    selected_answer TEXT,
    correct INTEGER,
    confidence INTEGER,
    timestamp INTEGER NOT NULL,
    UNIQUE(course_id, chapter_id, question_id, timestamp)
);

-- Numeric mastery per concept (decay-aware)
CREATE TABLE mastery (
    course_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    score REAL NOT NULL,        -- 0.0-1.0
    last_reviewed_at INTEGER,
    PRIMARY KEY (course_id, concept_id)
);

-- Chapter completion (drives resume)
CREATE TABLE chapter_completion (
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (course_id, chapter_id)
);

-- Weakness log (drives interleaving + future review focus)
CREATE TABLE weakness_log (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    error_pattern TEXT,
    timestamp INTEGER NOT NULL
);

-- LLM gateway: usage log + cache (combined for simplicity)
CREATE TABLE llm_usage (
    id INTEGER PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    cache_hit INTEGER,
    request_hash TEXT NOT NULL,
    status TEXT,
    error TEXT
);

CREATE TABLE llm_cache (
    request_hash TEXT PRIMARY KEY,
    response_text TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- Spaced-repetition cards (Chiron owns SR — Anki not required)
CREATE TABLE sr_cards (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    concept_id TEXT,
    card_type TEXT NOT NULL,    -- 'cloze' | 'term-def' | 'vignette' | 'fill-blank' | etc.
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    -- SM-2 / FSRS state
    ease_factor REAL DEFAULT 2.5,
    interval_days INTEGER DEFAULT 0,
    repetitions INTEGER DEFAULT 0,
    next_due_at INTEGER NOT NULL,
    last_reviewed_at INTEGER,
    suspended INTEGER DEFAULT 0
);

CREATE INDEX idx_sr_cards_due ON sr_cards(next_due_at) WHERE suspended = 0;

CREATE TABLE sr_review_log (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL,
    rating INTEGER NOT NULL,    -- 1=again, 2=hard, 3=good, 4=easy
    interval_days_after INTEGER,
    FOREIGN KEY (card_id) REFERENCES sr_cards(id)
);

-- Bookmarks (resume + revisit)
CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    scroll_position REAL,
    last_visited_at INTEGER NOT NULL,
    note TEXT
);
```

**Migration strategy:** version table `_chiron_meta` with `schema_version` column. Migrations applied at lesson open (idempotent).

---

## 9. Pipeline Stages & Prompt Templates

### 9.1 Five-stage pipeline (per lesson generation)

```
STAGE 0: INGEST       → source-type adapter (code-repo / pdf / vocab-list / transcript) → raw text + metadata
STAGE 1: BRIEF        → unified intermediate Brief (per-domain prompt fills schema)
STAGE 2: SYLLABUS     → ClassBuild-style typed Syllabus (Opus, extended thinking)
                          → ChapterSyllabus[] with scienceAnnotations + spacingConnections + WidgetSpec[]
STAGE 3: VALIDATE     → Zod schema check + concept-DAG validator + rubric check
                          → on failure: 3-attempt LLM retry with structured issue list
                          → for medicine: ALSO run QUEST-AI 3-stage Generate→Verify→Refine
STAGE 4: BUILD        → per-chapter parallel fan-out:
                          chapter HTML (Opus) · quizzes (Sonnet) · peer dialogue ·
                          domain-expert dialogue · widgets · SR cards · TTS (language)
                          + answerBalancer post-pass
STAGE 5: ASSEMBLE     → multi-file → single-file build · SQLite init · bookmarks/SR seeded
                          → open lesson.html in browser
```

### 9.2 Prompt template stack (file paths)

```
chiron/skill/prompts/
├── 00-ingest/
│   ├── code-repo.md
│   ├── pdf.md
│   ├── vocab-list.md
│   └── transcript.md
├── 01-brief.md
├── 02-syllabus.md
├── 03-validate-rubric.md
├── 04a-chapter-write.md
├── 04b-quiz-mcq.md
├── 04c-quiz-clinical-vignette.md
├── 04d-quiz-fill-blank.md
├── 04e-quiz-cloze.md
├── 04f-quiz-spot-the-bug.md
├── 04g-quiz-agreement-matrix.md
├── 04h-quiz-confidence-weighted.md
├── 04i-quiz-slider-estimation.md
├── 04j-quiz-assertion-reason.md
├── 04k-quiz-boss.md
├── 04l-peer-dialogue.md
├── 04m-domain-expert.md
├── 04n-sr-card-gen.md
├── 04o-infographic.md
├── 04p-chemical-rendering.md
├── 04q-chalkdsl.md
├── 05-answer-balancer.md
└── medicine-only/
    ├── verifier-stage1-generate.md
    ├── verifier-stage2-verify.md
    └── verifier-stage3-refine.md
```

Each prompt file is a Markdown template with `{{placeholder}}` slots filled at runtime.

---

## 10. Final File Layout

```
~/dev/projects/chiron/
├── README.md
├── CLAUDE.md
├── .gitignore
├── memory-bank/                 # navigation index
├── prd/                         # design PRDs
├── research/                    # raw inputs
└── skill/                       # the deployable Claude Code skill
    ├── SKILL.md                 # main entry — trigger phrases + workflow shell
    ├── prompts/                 # per-stage LLM prompt templates (see §9.2)
    ├── ingest-adapters/         # source-type adapters
    │   ├── code-repo.ts
    │   ├── pdf.ts
    │   ├── url.ts
    │   ├── transcript.ts
    │   └── vocab-list.ts
    ├── concepts/                # static concept DAGs per domain
    │   ├── code.json
    │   ├── medicine.json
    │   ├── language-de.json
    │   ├── language-it.json
    │   └── research-paper.json
    ├── curricula/               # static curriculum templates
    │   ├── code.json
    │   ├── medicine-amboss.json
    │   ├── medicine-uptodate.json
    │   ├── language-vocab.json
    │   ├── language-grammar.json
    │   └── research-paper.json
    ├── personas/                # peer + expert + native-speaker per domain
    │   ├── code.json
    │   ├── medicine.json
    │   ├── language-de.json
    │   ├── language-it.json
    │   └── research-paper.json
    ├── shell/                   # HTML rendering (forked from codebase-to-course)
    │   ├── _base.html
    │   ├── _footer.html
    │   ├── styles.css
    │   ├── main.js
    │   ├── build.sh
    │   ├── themes/
    │   │   ├── _tokens.css
    │   │   ├── warm-paper.css
    │   │   ├── midnight.css
    │   │   ├── ocean.css
    │   │   ├── clinical.css
    │   │   └── linguistic.css
    │   └── _science-overlay.css
    ├── lib/
    │   ├── llm.ts               # 50-line gateway with sha256 cache
    │   ├── validator.ts         # Zod + concept-DAG + rubric checks
    │   ├── answer-balancer.ts   # post-pass to defeat longest-correct-answer artifact
    │   ├── sr-scheduler.ts      # SM-2 implementation (~50 LOC)
    │   ├── theme.ts             # buildThemePromptBlock + theme registry
    │   ├── widget-renderer.ts   # WidgetSpec → HTML injector
    │   ├── chemistry-renderer.ts  # MathJax+mhchem + Kekule.js wrappers
    │   ├── chalkai-loader.ts    # on-demand ChalkAI runtime loader
    │   ├── sqlite-init.ts       # schema migration
    │   └── apkg-export.ts       # OPTIONAL Anki export (post-v1)
    └── tests/
        ├── golden-inputs/       # 4 reference lessons (one per domain)
        │   ├── code-small-repo/
        │   ├── medicine-pneumonia/
        │   ├── language-de-dative/
        │   └── research-paper-jones2025/
        ├── snapshots/           # expected key fields
        └── test.sh              # 50-line regression script
```

---

## 11. LLM Gateway (`lib/llm.ts`)

Per the locked decision, ~50 lines. Direct SDK calls, sha256 cache, cost log. No secret scan, no telemetry, no per-stage budgets.

```typescript
import { Anthropic } from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function llmCall(opts: {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  db: Database.Database;
}): Promise<string> {
  const hash = createHash('sha256')
    .update(JSON.stringify({ model: opts.model, system: opts.system, prompt: opts.prompt, maxTokens: opts.maxTokens }))
    .digest('hex');

  // Cache check
  const cached = opts.db.prepare('SELECT response_text FROM llm_cache WHERE request_hash = ?').get(hash);
  if (cached) {
    opts.db.prepare('INSERT INTO llm_usage (timestamp, provider, model, cache_hit, request_hash, status) VALUES (?, ?, ?, 1, ?, ?)').run(Date.now(), 'anthropic', opts.model, hash, 'SUCCESS');
    return (cached as { response_text: string }).response_text;
  }

  // Provider call
  try {
    const response = await client.messages.create({
      model: opts.model,
      system: opts.system,
      max_tokens: opts.maxTokens ?? 4096,
      messages: [{ role: 'user', content: opts.prompt }],
    });
    const text = response.content.map(c => c.type === 'text' ? c.text : '').join('');
    opts.db.prepare('INSERT INTO llm_cache (request_hash, response_text, created_at) VALUES (?, ?, ?)').run(hash, text, Date.now());
    opts.db.prepare('INSERT INTO llm_usage (timestamp, provider, model, input_tokens, output_tokens, cache_hit, request_hash, status) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').run(Date.now(), 'anthropic', opts.model, response.usage.input_tokens, response.usage.output_tokens, hash, 'SUCCESS');
    return text;
  } catch (err) {
    opts.db.prepare('INSERT INTO llm_usage (timestamp, provider, model, cache_hit, request_hash, status, error) VALUES (?, ?, ?, 0, ?, ?, ?)').run(Date.now(), 'anthropic', opts.model, hash, 'ERROR', String(err));
    throw err;
  }
}

export function getCourseCost(db: Database.Database, courseId: string): number {
  const row = db.prepare('SELECT SUM(cost_usd) AS total FROM llm_usage').get() as { total: number | null };
  return row.total ?? 0;
}
```

---

## 12. v1 Success Criteria

v1 ships when **all 9** are met:

1. ✅ Generates a German vocab lesson with `fill-blank` (fuzzy umlaut grading) + `cloze` cards + Klaus native-speaker TTS dialogue + in-lesson SR review
2. ✅ Generates a USMLE/AMBOSS-style hypertension lesson with **15+ clinical-vignette MCQs** (vignette → labs → leading Q → 5 options → per-distractor explanations + Hammer difficulty + Attending Tip + `<keyinfo>` tags)
3. ✅ Generates a code-repo lesson with side-by-side code-English + `spot-the-bug` + AI peer-learner discussion of architectural choice
4. ✅ Generates a research-paper lesson from an arbitrary PDF with abstract digest + methods walkthrough + results explanation + critical appraisal + comprehension MCQs + forest-plot visualization
5. ✅ All four lessons render in browser without build step (open `index.html` and it works)
6. ✅ Resume + revisit work — re-open lesson, due cards appear at top, scroll position restored
7. ✅ A new domain (e.g., music-theory) can be added by dropping 3 JSON files + optional prompt variant — no skill rewrite
8. ✅ Learner state persists across sessions (SQLite)
9. ✅ Optional `.apkg` Anki export works for users who want mobile review (post-v1 stretch goal)

---

## 13. Buildout Plan

### Phase 1 — Scaffold (estimate: 1 day)
- [ ] `git init` chiron project
- [ ] `chiron/skill/` directory structure with empty subdirs
- [ ] Symlink `~/.claude/skills/chiron/` → `chiron/skill/`
- [ ] Stub `SKILL.md` with trigger phrases + workflow shell (no domain logic)
- [ ] Fork codebase-to-course's shell into `chiron/skill/shell/`
- [ ] Copy ClassBuild's `themes.ts` → port to TS + pure CSS
- [ ] Initial `lib/llm.ts` (50 LOC, sha256 cache, cost log)
- [ ] Initial `lib/sqlite-init.ts` with schema + migrations

### Phase 2 — Code domain end-to-end (estimate: 3 days)
- [ ] `concepts/code.json` (small DAG — 15 concepts is fine for v1)
- [ ] `curricula/code.json`
- [ ] `personas/code.json` (Chiron-mentor + Alice + Bob)
- [ ] Ingest adapter: `ingest-adapters/code-repo.ts`
- [ ] Per-stage prompts (00-05)
- [ ] WidgetSpec rendering for `mcq` + `true-false` + `spot-the-bug` + `mermaid` (dependency graph)
- [ ] Validator: Zod + concept-DAG check
- [ ] Answer balancer post-pass
- [ ] First end-to-end test: small TS repo → course

### Phase 3 — Language (German) end-to-end (estimate: 3 days)
- [ ] `concepts/language-de.json` (vocab + grammar tracks)
- [ ] `curricula/language-vocab.json` + `language-grammar.json`
- [ ] `personas/language-de.json` (Klaus + study group)
- [ ] Ingest adapter: `ingest-adapters/vocab-list.ts`
- [ ] New widget primitives in `widget-renderer.ts`:
  - [ ] `fill-blank` with fuzzy umlaut/accent grading
  - [ ] `matching-pair` (N↔N drag-drop)
  - [ ] `cloze` (Anki-compatible)
- [ ] Klaus voice via Gemini TTS
- [ ] First end-to-end test: dative case lesson

### Phase 4 — Medicine (AMBOSS) end-to-end (estimate: 4 days — longest phase)
- [ ] `concepts/medicine.json`
- [ ] `curricula/medicine-amboss.json` + `medicine-uptodate.json`
- [ ] `personas/medicine.json` (Dr. Reyes + Mike + Priya)
- [ ] Ingest adapter: `ingest-adapters/pdf.ts` (textbook chapter)
- [ ] New widget primitives:
  - [ ] `mcq-clinical-vignette` (vignette + Hammer + per-distractor + keyInfo + Attending Tip)
  - [ ] `agreement-matrix`
  - [ ] `assertion-reason`
- [ ] **QUEST-AI verifier loop** (medicine-only) — Generate → Verify → Refine, 3-attempt with structured issue feedback
- [ ] **High-volume vignette generation** — 15-20+ per topic with vignette taxonomy enforcement
- [ ] Chemistry rendering: MathJax + mhchem extension wired
- [ ] Molecule rendering: Kekule.js OR RDKit-JS (pick one during build)
- [ ] Pathway rendering: D3.js custom or Mermaid
- [ ] First end-to-end test: community-acquired pneumonia AMBOSS-style

### Phase 5 — Research-paper end-to-end (estimate: 2 days)
- [ ] `concepts/research-paper.json` (IMRAD-aware DAG)
- [ ] `curricula/research-paper.json`
- [ ] `personas/research-paper.json` (Dr. Hofmann + Bob)
- [ ] PDF adapter (already built in Phase 4)
- [ ] Forest-plot widget renderer
- [ ] First end-to-end test: a recent NEJM paper

### Phase 6 — Mode B integration (estimate: 0.5 day)
- [ ] Detection heuristic in `SKILL.md`
- [ ] Delegation to `~/.claude/skills/case-study.md` for Mode B inputs

### Phase 7 — Resume + revisit + SR review UI (estimate: 2 days)
- [ ] In-lesson "due cards" review surface in `main.js`
- [ ] Bookmarks + scroll-position restore
- [ ] SR-card review writes to `sr_cards` + `sr_review_log`
- [ ] SM-2 scheduler in `lib/sr-scheduler.ts`

### Phase 8 — ChalkAI on-demand integration (estimate: 1 day)
- [ ] `lib/chalkai-loader.ts` — load runtime only when chapter has `WidgetSpec.type = 'reactive-math'`
- [ ] First test: a simple geometry manipulative

### Phase 9 — Eval rig + golden inputs (estimate: 1 day)
- [ ] 4 golden inputs (one per domain) committed to `tests/golden-inputs/`
- [ ] Snapshot key fields per output (chapter count, concepts count, quiz count, etc.)
- [ ] `test.sh` runs all 4 + diffs snapshots + opens browser

### Phase 10 — Cost guard + ship (estimate: 0.5 day)
- [ ] Pre-generation cost estimate + `[y/N]` prompt
- [ ] Hard-fail at $25/course
- [ ] Mark v1 shipped

**Total estimate: ~17 days of focused work.** Realistic with side-quests: 4-6 weeks.

### Defer indefinitely (until pain forces it)
- MCP server packaging
- OpenTelemetry / structured logging
- Skill-creator full Executor→Grader→Comparator→Analyzer
- Per-stage cost budgets
- Stateful misconception retrieval engine
- Italian language (Phase 11 — after v1 ships)
- Voice input (user speaking back)
- Image input (X-rays, equations)

---

## 14. Open Questions / Hypotheses

These are explicit unknowns to resolve during build. Tracked in [`memory-bank/follow_ups.md`](../memory-bank/follow_ups.md).

| # | Question | How to resolve |
|---|---|---|
| 1 | Kekule.js vs RDKit-JS for 2D molecule rendering — which is smaller / easier to integrate? | Prototype both with metformin SMILES in Phase 4 |
| 2 | Does `mcq-clinical-vignette` need a different rendering primitive than standard MCQ? | Probably yes (vignette can be 200-500 words; layout differs) — design in Phase 4 |
| 3 | Does fuzzy umlaut grading work well enough? Or do we need a proper German morphological analyzer? | Test in Phase 3 with 30 fill-blank examples; if false-negatives >10%, escalate |
| 4 | Will Gemini TTS sound natural enough for German + Italian? Alternative: ElevenLabs | Phase 3 + 11 test |
| 5 | Can a single LLM (Sonnet) handle all 12 question types well, or do we need different models per type? | Phase 2-4 monitoring; if specific types underperform, switch model for that prompt |
| 6 | Will solo-learner persona-engagement feel forced? (Risk: cringe-y AI peers) | Phase 2 first-look; if yes, make personas terser / more rare / opt-out |
| 7 | Does iframe-srcdoc rendering scale to 20+ chapters? | Phase 9 stress-test; if not, switch to single-document rendering |
| 8 | Anki MCP reliability — how often does AnkiConnect drop connections? | Post-v1 testing only (since `.apkg` export is the path) |

---

## 15. Decisions Log (rolling — append-only)

(See PRD §4 for the 12 locked architectural decisions. Future decisions appended here.)

| Time | Decision | Rationale |
|---|---|---|
| 2026-04-28 | Chiron is the project name | Greek mythology: tutor of Achilles + Asclepius + Jason + Heracles — one teacher, many subjects |
| 2026-04-28 | All 4 v1 domains co-equal | User explicit directive |
| 2026-04-28 | Medicine MCQ paired with clinical vignette (mandatory) | AMBOSS / USMLE convention — pattern recognition is the actual skill |
| 2026-04-28 | High-volume vignette generation for medicine (15-20+ per topic) | Pattern-recognition learning is exposure-driven |
| 2026-04-28 | Chiron owns SR end-to-end via SQLite | User: "we need a database where we can resume + revisit content" — Anki app-switching fragments the experience |
| 2026-04-28 | ChalkAI is the math/physics interactivity backbone (on-demand load) | User explicit directive; ChalkAI's reactive DSL is the right abstraction |
| 2026-04-28 | Chemistry rendering via MathJax+mhchem + Kekule/RDKit-JS + D3.js pathways | User: "don't forget chemical formulas for pharm + enzymatic reactions in disease processes" |
| 2026-04-28 | Domain extensibility = first-class (drop 3 JSON files) | User directive: "I want to be able to add domains as needed" |
| 2026-04-28 | research-paper added as 4th v1 domain | User scenario: PDF → structured lesson |
| 2026-04-28 | AI multi-persona engagement (peer learners + expert + native speaker) | User directive: "have agents pretending to be other people learning to help engage socially" |
| 2026-04-28 | Repurpose ClassBuild's discussion.ts + activities.ts for AI peer dialogue | User: "but I really like ClassBuild's style" — keep depth, repurpose features |
| 2026-04-28 | CSS = fork codebase-to-course (1195 LOC) + layer ClassBuild theme parameterization (pure CSS, no Tailwind) | Avoid build step; keep mature aesthetic foundation; gain theme variants |
| 2026-04-28 | Both AMBOSS-style and UpToDate-style supported as parallel medicine sub-modes | Both serve different audience-stages (board-prep vs clinical decision support) |

---

## 16. References

### Internal artifacts
- [`research/`](../research/) — all raw inputs (audits, deep research, debate transcript)
- [`memory-bank/projectbrief.md`](../memory-bank/projectbrief.md) — why + audience + scope
- [`memory-bank/productContext.md`](../memory-bank/productContext.md) — per-domain user flows
- [`memory-bank/systemPatterns.md`](../memory-bank/systemPatterns.md) — architecture + 11 key patterns
- [`memory-bank/techContext.md`](../memory-bank/techContext.md) — stack + SQLite schemas
- [`memory-bank/follow_ups.md`](../memory-bank/follow_ups.md) — open questions + hypotheses
- [`prd/universal_lesson_generator_2026-04-28.md`](universal_lesson_generator_2026-04-28.md) — tracking PRD (decisions log + open items)

### Heritage repos (locally cloned at `~/dev/audits/`)
- [zarazhangrui/codebase-to-course](https://github.com/zarazhangrui/codebase-to-course) — HTML rendering shell forked
- [jtangen/classbuild](https://github.com/jtangen/classbuild) — typed pedagogy + 7-question challenge + theme system
- [JulienAvezou/ai-course-generator](https://github.com/JulienAvezou/ai-course-generator) — concept-DAG-as-validator + LLM-as-advisor + LLM gateway pattern

### Sibling skill (system-wide)
- `~/.claude/skills/case-study.md` — Mode B 3-act lecture, paired-debate methodology

### External libraries / packages
- [bijonai/ChalkAI](https://github.com/bijonai/ChalkAI) — reactive math/physics DSL (on-demand)
- [MathJax + mhchem](https://docs.mathjax.org/en/latest/input/tex/extensions/mhchem.html) — chemistry equations
- [Kekule.js](https://github.com/partridgejiang/Kekule.js) or [RDKit-JS](https://github.com/rdkit/rdkit-js) — molecule structure rendering (decide in Phase 4)
- [Mermaid](https://mermaid.js.org) — flowcharts / sequence diagrams
- [Pyodide](https://pyodide.org) — in-browser Python (optional, code domain only)

### Pedagogical reference platforms
- AMBOSS — high-yield medical board-prep template
- UpToDate — clinical decision support template
- See [`research/2026-04/02_deep_research_amboss_uptodate_*.md`](../research/2026-04/) for full templates with prompt scaffolding

---

## 17. Buildout signoff

**Design phase complete: 2026-04-28**
**Buildout starts: TBD**
**Sessions to monitor: this PRD's `## Sessions` section will auto-update as work progresses.**

Next action: kick off Phase 1 (Scaffold) when ready.
