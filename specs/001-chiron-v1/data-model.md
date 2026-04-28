# Phase 1 Data Model — Chiron v1

**Branch**: `001-chiron-v1` | **Date**: 2026-04-28
**Plan**: [`plan.md`](./plan.md) | **Spec**: [`spec.md`](./spec.md)

This document specifies all entities — both runtime (in-memory + SQLite) and design-time (JSON catalogs). Every entity ties back to a Functional Requirement (FR-###) in the spec or a section of PRD §6/§8.

---

## 1. Runtime entities (transient + persisted)

### 1.1 `Brief` (transient — Stage 1 output)

Unified intermediate representation produced by per-domain ingest adapters.

| Field | Type | Required | Source |
|---|---|---|---|
| `domain` | `'code' \| 'medicine' \| 'language-it' \| 'research-paper'` | yes | FR-002 |
| `mode` | `'A' \| 'B'` | yes | FR-003 |
| `sourceType` | `'code-repo' \| 'pdf-text' \| 'pdf-scanned' \| 'image' \| 'image-folder' \| 'multi-pdf' \| 'vocab-list' \| 'transcript' \| 'url' \| 'html-file' \| 'agent-report' \| 'bundle'` | yes | FR-032 (a-l) |
| `sourcePath` | `string` (absolute path or URL) | yes | FR-030 |
| `sourceCopiedTo` | `string \| null` (relative to lesson dir) | conditional | FR-030 — set for any local-file source; null for code-repo/url |
| `extractedText` | `string` | yes | FR-016 source-grounding root; ordered concatenation per FR-034 |
| `sourceManifest` | `SourceFileEntry[]` | conditional, present for `multi-pdf`/`image-folder`/`bundle` | FR-034 per-file provenance |
| `agentSourceProvenance` | `string \| null` | conditional, set for `agent-report` and any bundle entry of role=`agent-report` | FR-035 |
| `metadata` | `Record<string, unknown>` | yes | per-source: word count, language code, repo SHA, paper DOI, image count, page count, etc. |
| `briefSchemaVersion` | `string` | yes | for forward compat |

#### `SourceFileEntry` (one per file in multi-source ingest)

| Field | Type | Notes |
|---|---|---|
| `path` | `string` (relative to bundle root or original location) | |
| `role` | `'primary' \| 'supplement' \| 'figure' \| 'appendix' \| 'agent-report'` | from `chiron.manifest.json` if present, else inferred from extension/heuristic |
| `extractor` | `'text-pdf' \| 'vision-pdf' \| 'vision-image' \| 'html' \| 'transcript' \| 'agent-report' \| 'code'` | which adapter pipeline produced the text |
| `tokenCount` | `int` | tracked for cost estimation (R-10) |
| `extractedAt` | `int` (unix ms) | |

Persisted as JSON sidecar at `<lesson-output-dir>/brief.json` for reproducibility.

### 1.2 `ChapterSyllabus` (transient — Stage 2 output)

Validated by Zod (FR-006). One per chapter; the lesson has an array of these.

| Field | Type | Required | Source |
|---|---|---|---|
| `chapterId` | `string` (kebab-case slug) | yes | FR-005 |
| `chapterNumber` | `int >= 1` | yes | drives ordering |
| `title` | `string` | yes | display |
| `narrative` | `string` (~150-400 words) | yes | high-level chapter arc |
| `keyConcepts` | `string[]` (concept IDs from concept DAG) | yes, ≥1 | feeds validator |
| `widgets` | `WidgetSpec[]` | yes, ≥1 | FR-018, see contract |
| `scienceAnnotations` | `ScienceAnnotation[]` | yes, **≥3** per chapter | FR-022 |
| `spacingConnections` | `int[]` (chapter numbers) | conditional, **2-4** for chapter 8+ | FR-022 |
| `personaTriggers` | `string[]` | optional | hints into 04l/04m persona prompts |
| `priorChapterStruggleSummary` | `string[]` (3 bullets) \| null | conditional, set for chapter 2+ | FR-023 pseudo-state |

#### `ScienceAnnotation`

| Field | Type | Required |
|---|---|---|
| `principle` | `'spacing' \| 'interleaving' \| 'retrieval' \| 'examples' \| 'dual-coding'` | yes |
| `description` | `string` | yes |
| `relatedChapters` | `int[]` | optional |

### 1.3 `WidgetSpec` (discriminated union)

See [`contracts/widget-spec.ts`](./contracts/widget-spec.ts) for the canonical TypeScript definition. 21 variants total per FR-018. Every quiz-type widget carries `variants[]` for anti-gaming (FR-021).

### 1.4 `MoleculeRenderer` (interface)

Abstract interface defined in `lib/chemistry-renderer.ts` per FR-031. Concrete library (Kekule.js or RDKit-JS) selected in Phase 4.

```ts
interface MoleculeRenderer {
  // Render a SMILES string into a DOM node.
  // Implementation may load its library lazily (must be idempotent on repeat calls).
  render(smiles: string, container: HTMLElement, options?: { width?: number; height?: number }): Promise<void>;
  // Implementation identifier — for the eval rig snapshot.
  readonly impl: 'kekule' | 'rdkit-js';
}
```

---

## 2. Persisted entities (SQLite — `<lesson-output-dir>/.chiron-state.db`)

Schema mirrored exactly from PRD §8. Full SQL in [`contracts/sqlite-schema.sql`](./contracts/sqlite-schema.sql).

### 2.1 `quiz_attempts` — full attempt history

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `course_id` | TEXT NOT NULL | matches lesson dir name |
| `chapter_id` | TEXT NOT NULL | matches `ChapterSyllabus.chapterId` |
| `question_id` | TEXT NOT NULL | derived from widget position |
| `variant_id` | TEXT | which variant was rendered (FR-021) |
| `selected_answer` | TEXT | raw answer payload |
| `correct` | INTEGER (0/1) | |
| `confidence` | INTEGER | for `confidence-weighted` widgets |
| `timestamp` | INTEGER NOT NULL | unix ms |

UNIQUE: `(course_id, chapter_id, question_id, timestamp)`.

### 2.2 `mastery` — per-concept mastery score

| Column | Type | Notes |
|---|---|---|
| `course_id` | TEXT NOT NULL | |
| `concept_id` | TEXT NOT NULL | from concept DAG |
| `score` | REAL NOT NULL | 0.0–1.0, decay-aware |
| `last_reviewed_at` | INTEGER | unix ms |

PRIMARY KEY: `(course_id, concept_id)`.

### 2.3 `chapter_completion` — drives resume

| Column | Type | Notes |
|---|---|---|
| `course_id` | TEXT NOT NULL | |
| `chapter_id` | TEXT NOT NULL | |
| `completed_at` | INTEGER NOT NULL | unix ms |

PRIMARY KEY: `(course_id, chapter_id)`.

### 2.4 `weakness_log` — feeds interleaving + next-chapter pseudo-state

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `course_id` | TEXT NOT NULL | |
| `concept_id` | TEXT NOT NULL | |
| `error_pattern` | TEXT | freeform tag from validator |
| `timestamp` | INTEGER NOT NULL | unix ms |

### 2.5 ~~`llm_usage` + `llm_cache`~~ — REMOVED by Clarification Q8

These tables were originally specified in PRD §8 + §11 to track in-tree LLM calls and cache by sha256. Q8 reversed that architecture: Chiron is skill-driven, the parent Claude Code agent makes text-LLM calls in its own context, Gemini calls go through MCP. There is no in-tree LLM gateway → no in-tree usage log → no in-tree cache. **Do not create these tables.**

### 2.6 `sr_cards` + `sr_review_log` — SM-2 spaced repetition

| Column (sr_cards) | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `course_id` | TEXT NOT NULL | |
| `chapter_id` | TEXT NOT NULL | |
| `concept_id` | TEXT | |
| `card_type` | TEXT NOT NULL | `'cloze' \| 'term-def' \| 'vignette' \| 'fill-blank' \| …` |
| `front` | TEXT NOT NULL | |
| `back` | TEXT NOT NULL | |
| `ease_factor` | REAL DEFAULT 2.5 | SM-2 |
| `interval_days` | INTEGER DEFAULT 0 | SM-2 |
| `repetitions` | INTEGER DEFAULT 0 | SM-2 |
| `next_due_at` | INTEGER NOT NULL | unix ms |
| `last_reviewed_at` | INTEGER | unix ms |
| `suspended` | INTEGER DEFAULT 0 | |

INDEX: `idx_sr_cards_due ON sr_cards(next_due_at) WHERE suspended = 0`.

`sr_review_log` records each review with `rating` (1=again, 2=hard, 3=good, 4=easy) and resulting `interval_days_after`. SM-2 implementation in `lib/sr-scheduler.ts` (~50 LOC per R-07).

### 2.7 `bookmarks` — resume + scroll-position restore

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `course_id` | TEXT NOT NULL | |
| `chapter_id` | TEXT NOT NULL | |
| `scroll_position` | REAL | 0.0–1.0 within chapter |
| `last_visited_at` | INTEGER NOT NULL | unix ms |
| `note` | TEXT | optional user note |

### 2.8 `_chiron_meta` — schema version (added per PRD §8)

| Column | Type |
|---|---|
| `key` | TEXT PRIMARY KEY |
| `value` | TEXT NOT NULL |

Seed row: `('schema_version', '1')`. Migrations driven by R-08.

---

## 3. Design-time catalogs (JSON files in `chiron/skill/`)

These are static authored content, not runtime state. Adding a new domain post-v1 is exactly: drop these three files (FR-025).

### 3.1 `concepts/<domain>.json` — concept DAG

```jsonc
{
  "domain": "code",
  "concepts": [
    { "id": "var-binding", "title": "Variable binding", "prereqs": [] },
    { "id": "scope", "title": "Lexical scope", "prereqs": ["var-binding"] }
    // …
  ]
}
```

Validation (FR-006): no cycles; every prereq exists; every concept referenced from a `ChapterSyllabus.keyConcepts` MUST exist here.

### 3.2 `curricula/<domain>.json` — curriculum template

```jsonc
{
  "domain": "code",
  "templateStyle": "scroll-modules",
  "chapterCountTarget": 8,
  "perChapterQuizTarget": 10,
  "perChapterSrCardTarget": 7,
  "modeAOnly": true,
  "domainExtras": {
    // domain-specific knobs — e.g. medicine has "vignetteTaxonomy" array
  }
}
```

Medicine has `medicine-amboss.json` and `medicine-uptodate.json` per FR-005.5.2.

### 3.3 `personas/<domain>.json` — persona roster

```jsonc
{
  "domain": "language-it",
  "expert": { "name": "Maria", "role": "native-speaker", "ttsVoice": "it-female-1" },
  "peers": [
    { "name": "Luca", "role": "fellow-learner-confused" },
    { "name": "Sofia", "role": "fellow-learner-eager" }
  ]
}
```

Locks Italian-only language persona for v1 (Clarification Q1). German persona file is deferred.

---

## 4. Validation rules — quick reference

| Rule | Source | Enforced where |
|---|---|---|
| Concept DAG has no cycles | FR-006 | `lib/validator.ts` startup check |
| `ChapterSyllabus.scienceAnnotations.length >= 3` | FR-022 | Zod refinement in `lib/validator.ts` |
| Chapter 8+ has 2-4 `spacingConnections` | FR-022 | Zod conditional refinement |
| Every quiz widget has `variants[]` | FR-021 | Zod refinement on union members |
| `mcq-clinical-vignette` has all required sub-fields | FR-019 | Zod schema (see contract) |
| Medicine-domain chapter passes QUEST-AI verifier | FR-007 | pipeline Stage 3 (medicine-only) |
| `start_deep_research` ≤ 1 per lesson, opt-in | FR-029 | call-site guard + lesson run log |
| Source PDF copied into lesson dir | FR-030 | `ingest-adapters/pdf.ts` post-extract |
| Image/folder/bundle ingest produces ordered concatenation | FR-034 | `ingest-adapters/{image,multi-pdf,bundle}.ts` |
| Agent-report cannot be sole source for medicine | FR-035 | `ingest-adapters/agent-report.ts` + `bundle.ts` post-walk |
| Vision-extraction calls go through `mcp__gemini-mcp__interpret_image` | FR-033 | invoked from inside the running skill; no in-tree logging (Q8) |
| Unknown bundle file → warning, not failure | spec edge case | `ingest-adapters/bundle.ts` |
| Schema migrations idempotent forward-only | R-08 | `lib/sqlite-init.ts` open path |
| Single learner — no auth, no multi-tenant | Constitution II | architectural — no auth code exists |
| Source-grounding hard fail when missing | FR-016 | `ingest-adapters/*.ts` early check |
