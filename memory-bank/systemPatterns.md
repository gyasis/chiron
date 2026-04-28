# System Patterns — Chiron

**Architecture, key patterns, and the rationale behind them.**

---

## High-level architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. SOURCE INGESTION — adapters (code repo / PDF / transcript /    │
│    syllabus / clinical guideline / vocab list)                    │
│    Output: unified "brief" intermediate format                    │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. CONCEPT EXTRACTION — LLM identifies key abstractions           │
│    Output: List<Concept> with prereqs                             │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. DEPENDENCY DAG VALIDATION (build-time, not runtime)            │
│    Walks concept order, flags missing prereqs                     │
│    LLM-with-validator retry pattern (3 attempts max)              │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. CURRICULUM DESIGN — chapter outline + cog-sci scaffolding      │
│    Output: typed Syllabus with ScienceAnnotation[],               │
│            spacingConnections[], 7-question-type quotas           │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. PER-CHAPTER PARALLEL FAN-OUT                                   │
│    ├── chapter HTML (Mode A exposition, side-by-side, callouts)   │
│    ├── quiz set (per-domain primitive selection)                  │
│    ├── peer-learner discussion (Alice/Bob personas)               │
│    ├── domain-specific persona (Dr. Reyes / Klaus / etc.)         │
│    ├── infographic (Gemini image)                                 │
│    ├── audio TTS (per-language voice for language domain)         │
│    └── Anki cards (cloze, term/def, vignette card)                │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 6. ASSEMBLE + PUBLISH                                              │
│    HTML site (codebase-to-course shell) + Anki deck export        │
│    + .chiron-state.{db,json} for runtime persistence              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Key patterns (and the source they come from)

### 1. Typed-schema-as-pedagogy (ClassBuild)

Define cognitive-science principles as TypeScript unions and require the LLM to populate them:

```typescript
type SciencePrinciple = 'spacing' | 'interleaving' | 'retrieval' | 'examples' | 'dual-coding';

interface ScienceAnnotation {
  principle: SciencePrinciple;
  description: string;
  relatedChapters: number[];
}

interface ChapterSyllabus {
  // ...
  scienceAnnotations: ScienceAnnotation[];  // ≥3 per chapter
  spacingConnections: number[];             // ch numbers this revisits
}
```

Cog-sci becomes structurally enforced, not vibes.

### 2. Concept DAG as build-time validator (ai-course-generator)

Static JSON file: `concepts/<domain>.json` with `{conceptId: [prereqIds]}`. NOT used at runtime for progression. Used at curriculum-design time by `validateCoursePlan()` which walks proposed chapter order accumulating `Set<introducedConcepts>` and flags `unsatisfied_prerequisites`.

Runtime progression is a separate, simpler linear FSM over `Chapter.position`.

### 3. LLM-as-advisor-not-arbiter (ai-course-generator)

The LLM:
- ✅ Generates content (chapters, quizzes, dialogue)
- ✅ Grades attempts (was the answer correct?)
- ✅ Suggests next-chapter / weakness focus
- ❌ Does NOT decide progression unlock — that's the FSM's job
- ❌ Does NOT decide mastery threshold — that's deterministic

### 4. LLM-with-validator retry loop (ai-course-generator)

When generating curriculum or content, run the LLM output through validators (schema check + concept DAG check + rubric check). If validation fails, feed the structured issue list back to the LLM as input for retry. Max 3 attempts. If still fails, hard-fail the job.

### 5. LLM gateway with hardening (ai-course-generator)

Single gateway function. Order of checks:
1. **Secret regex scan** of input (PEM, GH tokens, sk-..., AWS keys, Slack tokens) — block + log if hit
2. **Token pre-flight** — estimate input tokens, reject if over `inputTokenLimit`
3. **sha256 cache lookup** — request keyed by `sha256({provider, model, prompt, ...})`. In-memory + persistent (SQLite for Chiron). Bypass cache for unique inputs (per-user diffs).
4. **Provider call** (OpenAI / Anthropic / Gemini)
5. **Usage row** — record per-call: tokens, status, cache hit, cost, etc.

### 6. Answer-balancer post-pass (ClassBuild)

LLMs have a known artifact: longest answer is correct. Detect this on quiz output (if >25% of MCQs have the correct answer measurably longer than all distractors), feed flagged questions to a cheaper model with a tightly-scoped rewrite prompt: "Rewrite the distractors to match the correct answer's length and seductiveness. NEVER modify the correct answer."

This pattern generalizes — detect known LLM artifacts, surgical-rewrite with cheaper model.

### 7. 7-question-type challenge library (ClassBuild)

Per-chapter weekly-challenge bundle has 4 tiers (warmup/core/challenge/boss) and 7 question types:
- `mcq` (standard, 4-5 options)
- `mcq-clinical-vignette` (medicine — vignette stem + labs + leading question + 5 options + per-distractor explanation) ← **new for Chiron**
- `two-stage` (answer + must-pick-correct-justification — catches right-answer-wrong-reason)
- `assertion-reason` (5-option logical-relationship for clinical reasoning)
- `agreement-matrix` (always/sometimes/never classification — great for medicine)
- `confidence-weighted` (MCQ + confidence rating — calibration scoring)
- `slider-estimation` (numeric with acceptable range ± 15%)
- `boss` (synthesis question — requires ≥2 chapter concepts)
- `fill-blank` (language — fuzzy umlaut/accent grading) ← **new for Chiron**
- `matching-pair` (language — N↔N)
- `cloze` (language — sentence-shaped Anki-compatible)
- `spot-the-bug` (code — find the wrong line/char)
- `true-false` (code, simple recall)

Each question has a `variants[]` field. Runtime randomly picks one variant + merges over base, producing a fresh question per attempt (anti-memorization).

### 8. AI multi-persona engagement (Chiron's own innovation)

Each chapter generates 2-3 named peer-learner personas. Their role:
- Ask the question the user might be afraid to ask
- Propose plausible-but-wrong reasoning
- Express enthusiasm / confusion

Plus per-domain expert persona:
- Medicine → "Dr. Reyes" (attending physician — Socratic follow-ups)
- Language → "Klaus" / "Maria" (native speaker — dialogue + TTS pronunciation)
- Code → "Chiron-the-mentor" (the project's namesake — architectural reflection)

Repurposed from ClassBuild's `discussion.ts` and `activities.ts`. Generic LLM prompt template per persona role.

### 9. Two pedagogical modes

| Mode | Trigger | Output shape |
|---|---|---|
| A | "course on X" / "make a lesson out of Y" / "teach me Z" | Multi-chapter scroll-snap HTML site |
| B | "case study this" / "explain the pattern" / "what's actually going on here, professor-style" | 3-act lecture (delegates to `case-study` skill) |

Mode is auto-detected from user intent + source type. Default Mode A. Mode B routes to existing system-wide skill at `~/.claude/skills/case-study.md`.

### 9a. Medicine = high-volume vignette generation (mandatory)

**Medicine domain MUST generate a large volume of clinical vignettes per topic** for comprehensive pattern-recognition learning. Quality matters but volume is also a feature — medical learning is fundamentally exposure-driven.

**Volume targets per topic:**
- **Minimum 15-20 vignettes per disease/condition** (varied presentations: classic, atypical, pediatric, elderly, immunocompromised, pregnant, with-comorbidities, complications)
- Spread across Hammer difficulty 1-5 (mostly 2-3 with some 4-5 stretch)
- Each vignette has a `variants[]` array so re-attempts get fresh stems (anti-memorization)

**Why so many:** clinicians develop disease pattern recognition by seeing the same condition in dozens of forms. A single textbook description doesn't build robust schema — varied vignettes do. AMBOSS Qbank's strength is partly its sheer volume per topic.

**Implementation:** the curriculum-design phase explicitly prompts the LLM to generate N vignettes covering the **vignette taxonomy**: `[classic_presentation, atypical_presentation, pediatric, elderly, immunocompromised, pregnancy, with_comorbidity_X, with_complication_Y, drug_induced_phenocopy, mimicker_to_rule_out]`. Per-axis coverage forces breadth.

**Cost guard:** vignette generation is the most token-expensive part of medical lesson generation. Track cost in `llm_usage` table; warn if a single topic's vignette generation exceeds $2.

### 9b. Medical sub-modes within Mode A — AMBOSS vs UpToDate

For medicine domain, Mode A has two parallel templates picked by `audience_focus`:

**AMBOSS-style** (`board_exam_pattern_recognition`):
- Sections: Epidemiology / Etiology / Pathophysiology / Clinical Features / Diagnostics / Pathology / **Differential Diagnoses (tabular)** / Treatment / Complications & Prognosis
- Format: nested bullets (no prose), bolded buzzwords ("currant jelly sputum"), `<mark>` for high-yield facts, hover-tooltip definitions, **Attending Tip** at end of each chapter (1-sentence heuristic)
- Word count: 1,500-2,000 per topic
- Quiz primitive: `mcq-clinical-vignette` with **5-7 sentence vignette**, 5 options, per-distractor "why tempting / why wrong / when would it be right", `<keyinfo>` tags on 3 critical diagnostic clues, **Hammer difficulty 1-5**

**UpToDate-style** (`point_of_care_management`):
- Sections: Introduction / Pathogenesis / Clinical Manifestations / Evaluation and Diagnosis / Differential Diagnosis (prose) / Management / **Summary and Recommendations (GRADE-graded)**
- Format: academic prose paragraphs, heavy citations, narrative differentials
- Word count: 5,000-10,000 per topic
- **GRADE framework mandatory**: "We recommend..." (1A/B/C strong) or "We suggest..." (2A/B/C weak), e.g., *"In patients with X, we recommend Y over Z (Grade 1B)."*
- Quiz primitive: optional — UpToDate doesn't have a Qbank; if quiz needed, use medical calculators / decision algorithms instead

**Both can be generated as parallel views of same source content** — user picks one or both at lesson-generation time.

### 9c-design. Visual design system — fork codebase-to-course + layer ClassBuild theme parameterization

**Decision (locked 2026-04-28 after CSS-deep-comparison):**

Chiron's CSS = **80% codebase-to-course's mature `styles.css` (1195 LOC, no build step) + 20% ClassBuild's theme parameterization (pure CSS, no Tailwind)**.

Why this hybrid:
- codebase-to-course has one mature, opinionated aesthetic (warm aged-paper, vermillion accent on `#FAF7F2`) that has been battle-tested in 4.1k★ skill. Single source, no decision fatigue.
- ClassBuild has the **theme parameterization pattern** + the **cog-sci science-overlay colors** (`--color-science-{spacing,interleaving,retrieval,examples,dual-coding}`) which support typed-schema-as-pedagogy.
- Tailwind-via-import (ClassBuild's choice) breaks the no-build-step property locked in the synthesis. So we re-implement ClassBuild's parameterization as pure CSS custom properties.

**Layout:**

```
chiron/skill/shell/
├── styles.css                  ← FORK from codebase-to-course (1195 LOC, no build step)
├── themes/
│   ├── _tokens.css             ← :root CSS custom properties (the typed Theme contract in CSS form)
│   ├── warm-paper.css          ← DEFAULT — codebase-to-course's vermillion-on-cream
│   ├── midnight.css            ← ClassBuild's dark/violet
│   ├── ocean.css               ← ClassBuild's dark/cyan
│   ├── clinical.css            ← NEW — medical white/blue/teal
│   └── linguistic.css          ← NEW — language earth tones (warm sienna, cream)
├── _science-overlay.css        ← ClassBuild's cog-sci pillar colors (verbatim — orthogonal to themes)
└── _base.html
```

**TypeScript-side `Theme` interface** (mirrors ClassBuild's themes.ts):

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

**Theme selection rules:**
1. User can override per-lesson with `--theme <id>` flag.
2. Otherwise, auto-pick by domain:
   - `code` → warm-paper (codebase-to-course default)
   - `medicine` → clinical (white/blue, professional)
   - `language-de` / `language-it` → linguistic (warm earth tones)
   - `research-paper` → warm-paper (default editorial feel)
3. Default: warm-paper if domain not specified.

**LLM injection (ClassBuild's `buildThemePromptBlock()` ported):**

When generating chapter HTML, the chosen theme's color tokens are injected into the system prompt so the LLM produces content using `var(--color-accent)`, `var(--color-bg-warm)`, etc. — the LLM never hardcodes hex values. This keeps generated content theme-portable.

**Science-overlay colors** stay in a separate stylesheet imported by ALL themes. They're domain-orthogonal — every domain benefits from cog-sci visualization (e.g., highlighting spacing-related callouts in violet across all themes).

**No build step. No Tailwind. No SCSS.** Pure CSS with custom properties. Forks codebase-to-course's structure verbatim and adds the theme layer on top.

### 9d. Interactive widget panels — lessons must be dynamic

**Lessons are NOT static HTML.** Every chapter can include interactive widget panels — runnable in-browser without external dependencies. Use cases:

| Domain | Widget examples |
|---|---|
| **Code** | Inline code editor with run button (Pyodide / JS sandbox), AST visualizer, dependency graph explorer, REPL |
| **Medicine** | Clinical decision algorithm walker, drug-interaction checker, anatomy hover-overlay, calculator (CHADS2-VASc, MELD), ECG strip with annotations, image-occlusion (anatomy / radiograph) |
| **Language** | Pronunciation player + record-and-compare, conjugation drill, sentence-builder drag-drop, reading speed metronome, idiom-substitution slot-machine |
| **Research-paper** | Forest-plot interpreter, p-value/effect-size visualizer, sample-size calculator, study-design comparison matrix |
| **Math/physics** | Reactive geometric manipulatives (slider → graph updates), graph-plotter (Desmos-like), vector/matrix interactive, physics simulation (pendulum, projectile, spring) |
| **Chemistry / Pharm / Biochem** (medical-adjacent) | Rendered 2D molecule structures from SMILES (drug/metabolite), chemical reaction equations with arrow notation, enzymatic-pathway diagrams (substrate→enzyme→product), oxidation/reduction half-reactions, acid/base equilibria, biochemical pathways (glycolysis, Krebs cycle, beta-oxidation), drug MOA at molecular level |

**Architectural pattern:**
1. **Typed `WidgetSpec[]` per chapter** — forces LLM to declare widget contract upfront in the syllabus phase (lifted from ClassBuild). Schema: `{type, title, params, expectedInteraction}`.
2. **IIFE-wrapped vanilla-JS panel** rendered in lesson HTML. No framework runtime; widgets are isolated `<script>` blocks.
3. **Optional reactive helper for math/physics** — investigate ChalkAI's ChalkDSL approach (LLM writes declarative schema → Vue reactivity + D3.js). Or simpler: tiny reactivity primitive (~50 LOC).
4. **Pre-existing widget library** — for canned sims (e.g., PhET physics, Desmos graphing, GeoGebra), embed via iframe or use their public APIs. Faster than generating from scratch.
5. **LLM-generated bespoke widgets** — for novel cases, the LLM writes self-contained HTML+CSS+JS in a `<div class="widget">` block. ClassBuild does this for chapter widgets.

**Decisions (locked 2026-04-28):**

| Need | Library | Notes |
|---|---|---|
| Math/physics interactive widgets | **ChalkAI** ([bijonai/ChalkAI](https://github.com/bijonai/ChalkAI)) | LLM writes ChalkDSL → reactive Vue + D3.js. Loaded on-demand only when chapter has `WidgetSpec.type = 'reactive-math'`. |
| Math formulas (LaTeX) | **MathJax** | Always loaded; small footprint via CDN. |
| Chemical equations + reactions | **MathJax + mhchem extension** | `\ce{H2O + CO2 -> H2CO3}` syntax; one CDN line to enable. |
| 2D molecule structures from SMILES | **Kekule.js** or **RDKit-JS** (decision deferred to first-build) | Render drug structures, metabolites, biomolecules client-side. Loaded on-demand for medicine/biochem chapters. |
| Diagrams (flowcharts, sequence, ER) | **Mermaid** | Default for non-chemistry diagrams. |
| Code execution (in-browser Python) | **Pyodide** | Optional, code-domain only, on-demand. |
| Pre-built physics/chemistry sims | **PhET** (iframe embeds) | When canned simulation is sufficient. |
| 3D molecules | **3Dmol.js** | Deferred to v2 unless directly needed. |

Other packages (Desmos, GeoGebra, Observable) are candidates for specific use cases but the above is the primary stack.

**Constraint:** all widgets must work offline (no network calls beyond initial CDN load). The "open `index.html` and it works" property is non-negotiable.

### 9c. Universal medical prompt parameters

A single underlying prompt can serve both AMBOSS and UpToDate by parameterizing:

| Parameter | AMBOSS | UpToDate |
|---|---|---|
| `format_style` | `bulleted_nested` | `academic_prose` |
| `audience_focus` | `board_exam_pattern_recognition` | `point_of_care_management` |
| `recommendation_framework` | `consensus_only` | `GRADE_framework_enforced` |
| `differential_format` | `tabular_comparison` | `narrative_rule_out` |
| `ui_elements` | `attending_tips_and_buzzwords` | `society_guideline_links` |
| `word_count` | 1500-2000 | 5000-10000 |
| `quiz_primitive` | `mcq-clinical-vignette` (vignette + Hammer + per-distractor) | none (calculators / algorithms) |

### 10. Built-in SR with SQLite (PIVOTED 2026-04-28 — Chiron owns SR, not Anki)

**Chiron implements its own SR scheduler** backed by SQLite. SM-2 is ~50 lines; FSRS is ~150 lines. Either is well-documented. The review experience lives **inside** the Chiron HTML lesson so it integrates with reading and quizzes — switching to Anki for review fragments the workflow.

Cards stored in `sr_cards` table with `ease_factor`, `interval_days`, `repetitions`, `next_due_at`. Review writes to `sr_review_log` and updates card state via SM-2/FSRS. Lesson HTML's `main.js` queries due cards on load and surfaces them at the top of the page.

**Anki integration is OPTIONAL** — a "Export to Anki" button generates `.apkg` for users who want mobile review. One-way export. Chiron remains canonical.

---

## Persistence model

### Design persistence (this project's design)
- PRD: `~/dev/prd/scratch/universal_lesson_generator_2026-04-28.md`
- Memory bank: `memory-bank/*.md` (this folder)

### Runtime persistence (when learner uses Chiron)
- SQLite: `<lesson-output-dir>/.chiron-state.db`
  - Tables: `quiz_attempts(moduleId, questionId, correct, ts, confidence)`, `mastery(conceptId, score, lastReviewedAt)`, `chapter_completion(chapterId, completedAt)`, `weakness_log(conceptId, errorPattern, ts)`
- Anki state lives in Anki itself, not duplicated

### Schemas
- `concepts/<domain>.json` — concept DAG
- `curricula/<domain>.json` — module-purpose menus per domain
- `personas/<domain>.json` — peer-learner & expert persona templates
- `prompts/<stage>.md` — prompt templates per pipeline stage

---

## File layout (planned for Chiron skill itself)

```
chiron/                              # this project
├── README.md                        ✓
├── CLAUDE.md                        ✓
├── memory-bank/                     ✓ (in flight)
│   └── *.md
└── skill/                           # the Claude Code skill itself
    ├── SKILL.md                     # main skill file (entry point)
    ├── prompts/
    │   ├── ingest.md                # source ingestion (dispatches to adapters)
    │   ├── concept-extract.md
    │   ├── curriculum-design.md     # incl ClassBuild's syllabus pattern
    │   ├── chapter-write.md
    │   ├── quiz-generate.md
    │   ├── peer-discussion.md
    │   ├── persona-expert.md
    │   ├── sr-card-gen.md
    │   └── infographic.md
    ├── ingest-adapters/              # source-type adapters
    │   ├── code-repo.md              # git clone → file walk → identify abstractions
    │   ├── pdf.md                    # generic PDF (medical / research / textbook)
    │   ├── url.md                    # webpage / article
    │   ├── transcript.md             # YouTube transcript / podcast / lecture audio
    │   └── vocab-list.md             # CSV / list (language)
    ├── concepts/
    │   ├── code.json
    │   ├── medicine.json
    │   ├── language-de.json + language-it.json
    │   └── research-paper.json       # IMRAD-aware concept DAG
    ├── curricula/
    │   ├── code.json
    │   ├── medicine-amboss.json      # AMBOSS-style section template
    │   ├── medicine-uptodate.json    # UpToDate-style section template
    │   ├── language-vocab.json
    │   ├── language-grammar.json
    │   └── research-paper.json       # IMRAD + critical appraisal template
    ├── personas/
    │   ├── code.json                 # Chiron-mentor + Alice + Bob
    │   ├── medicine.json             # Dr. Reyes + Mike (med student) + Priya (resident)
    │   ├── language-de.json          # Klaus + study group
    │   ├── language-it.json          # Giulia + study group
    │   └── research-paper.json       # Dr. Hofmann (senior PI) + Bob (skeptical peer)
    ├── shell/                        # HTML rendering (forked from codebase-to-course)
    │   ├── _base.html
    │   ├── _footer.html
    │   ├── styles.css
    │   ├── main.js                   # extended with new quiz primitives + SR review UI
    │   └── build.sh
    └── lib/
        ├── llm-gateway.{ts,py}
        ├── validator.{ts,py}         # concept-DAG check, rubric check
        ├── answer-balancer.{ts,py}
        ├── sr-scheduler.{ts,py}      # SM-2 / FSRS spaced-rep
        └── anki-export.{ts,py}       # OPTIONAL .apkg generator
```

Language TBD (TypeScript or Python — defer to paired debate).

## Domain extensibility — first-class architectural property

**Adding a new domain (e.g., music-theory, law, history, finance) is a 3-file drop:**

```
concepts/music-theory.json
curricula/music-theory.json
personas/music-theory.json
```

Plus *optionally* one prompt-template variant under `prompts/` if the domain has unusual content shape (notation rendering, citation parsing, equation rendering).

The shell, the LLM gateway, the SR scheduler, the answer-balancer, and the multi-persona engine ALL stay unchanged. The skill auto-detects the new domain on next invocation by scanning `concepts/` for new JSON files.

**This means v1 ships with 4 domains (code / medicine / language-DE / language-IT / research-paper) but the skill is built to grow.**

---

## Open architectural questions for paired debate

See `~/dev/prd/scratch/universal_lesson_generator_2026-04-28.md` §5b.
