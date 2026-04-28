# Audit: jtangen/classbuild

**Date:** 2026-04-28
**Audited at:** `~/dev/audits/classbuild/`
**Repo:** https://github.com/jtangen/classbuild
**License:** MIT (Copyright (c) 2026 Jason Tangen)
**Tech stack:** TypeScript, React 19 SPA + Node CLI, BYOK Anthropic + Gemini

---

## What it is

Domain-agnostic AI course generator with rigorous cognitive-science scaffolding. Takes a topic + audience + chapter count, runs a 5-stage pipeline (Setup → Syllabus → Research → Build → Export), and produces:
- Multi-chapter HTML viewer (single-file output for users; multi-file source authoring)
- Practice quiz, in-class quiz, weekly challenge (7 question types)
- Audio TTS via Gemini, infographics via Gemini Imagen
- SCORM 2004 wrapper, PPTX/DOCX exports (instructor artifacts)

---

## Architecture map

```
SETUP (form) → SYLLABUS (Opus, JSON, streaming) → RESEARCH (Haiku + web_search, parallel ×3)
   → BUILD (per-chapter parallel fan-out: chapter HTML, practice quiz, in-class quiz,
            discussion, activities, audio transcript, slides, weekly challenge,
            infographic prompt → Gemini image, transcript → Gemini TTS)
   → EXPORT/PUBLISH (assemblePublishPackage → static iframe-based viewer)
```

Single `streamMessage()` (`src/services/claude/streaming.ts`) wraps the Anthropic SDK with extended-thinking budgets (low 4k / med 8k / high 16k / max 32k), `web_search_20250305` server tool, rate-limit retry.

**Twelve prompt builders** (one per material type) all live in `src/prompts/`. Two-frontend / one-core split: CLI (`scripts/generate-course.ts`, ~900 lines) and React UI (`src/pages/BuildPage.tsx`) both call the same prompt builders.

State: 3 Zustand stores — `courseStore` (persisted, versioned-with-migration), `apiStore` (persisted keys), `uiStore` (transient).

---

## The 5-stage pipeline

### Stage 1 — Setup
Pure form. Captures: topic, specificTopics, avoidTopics, textbookReference, educationLevel (6 enums), priorKnowledge, cohortSize, learnerNotes, teachingEnvironment, numChapters, chapterLength (concise 2k / standard 4k / comprehensive 6k words), widgetsPerChapter, themeId, voiceId.

### Stage 2 — Syllabus *(the most important file)* — `src/prompts/syllabus.ts` (243 lines)
**Model:** Opus + `thinkingBudget: 'high'`.
**Output:**
```typescript
Syllabus { courseTitle, courseOverview, chapters: ChapterSyllabus[] }
ChapterSyllabus {
  narrative, keyConcepts[], widgets: WidgetSpec[],
  scienceAnnotations: ScienceAnnotation[],     // ≥3 per chapter
  spacingConnections: number[]                  // chapter numbers this revisits
}
SciencePrinciple = 'spacing'|'interleaving'|'retrieval'|'examples'|'dual-coding'
```

**The system prompt explicitly instructs:** *"Chapter 1 has none; by Chapter 8+, there should be 2-4 connections back to earlier chapters. Later chapters should have MORE annotations as spacing and interleaving connections accumulate."*

This is **how cognitive science is structurally enforced** — the syllabus is the cross-chapter graph that downstream stages key off of.

Has `parsePartialChapters()` brace-depth tracker for streaming JSON. Has `normalizePrinciple()` for canonicalization. Has `refinementFeedback` branch — instructor iterates the syllabus before commitment.

### Stage 3 — Research — `src/prompts/research.ts`
**Model:** Haiku with Anthropic server-side `web_search_20250305`. Per-chapter parallel ×3 concurrency.
**Output:** `ResearchDossier { sources: ResearchSource[], synthesisNotes }` — title/authors/year/url/doi/summary/relevance/isVerified. Asks for 5-8 high-quality sources.
**DOI validation post-pass** via `src/utils/doiValidator.ts` flips `isVerified` after a HEAD check.

### Stage 4 — Build (per chapter, parallel material fan-out)

Twelve material types, all keyed off `ChapterSyllabus + ResearchDossier + chapterContent excerpt`:
- **chapter.ts** (Opus, extended thinking) — full standalone HTML with the entire CSS template inlined into the system prompt. Themed via `buildThemePromptBlock()`.
- **practiceQuiz.ts** (Sonnet) — 18-20 MCQs in regex-parseable text format; **correct answer is always option a, app shuffles at runtime**.
- **`answerBalancer.ts`** runs an audit: if >25% of questions have correct-answer-longer-than-all-distractors (a known LLM tell), Haiku rewrites those distractors to be similar length.
- **inClassQuiz.ts** (Sonnet) — 10 JSON questions; CLI generates 5 shuffled versions + answer key DOCX.
- **discussion.ts**, **activities.ts** — JSON arrays (classroom features).
- **audioTranscript.ts** → Gemini TTS, chunked at 2800 chars on paragraph/sentence boundaries.
- **slides.ts** → JSON `SlideData[]` rendered via `pptxgenjs`.
- **weeklyChallenge.ts** — see Quiz section below.
- **infographic.ts** — meta-prompt: Claude writes the image prompt, Gemini generates.

### Stage 5 — Export / Publish

Walks `outputDir/{chapters,quizzes,audio,img,downloads,...}` by filename prefix `01_`/`02_`, builds `ChapterPackageData[]`, renders `index.html` via `coursePackageTemplate.ts` (35KB template). Each chapter's HTML goes into a sandboxed `<iframe srcdoc>` with a `RESIZE_SHIM` postMessage script for parent height-sync.

---

## Cognitive science encoding — three coupled mechanisms

1. **Typed schema as scaffold**: `SciencePrinciple` is a 5-value union; `ScienceAnnotation` requires `principle + description + relatedChapters[]`; `ChapterSyllabus.spacingConnections: number[]` is a first-class field. The LLM has to fill these slots.
2. **Per-chapter quotas in prompts**: "MINIMUM 3 annotations per chapter, covering different principles." "Chapter 1 has none; by Chapter 8+, 2-4 spacing connections."
3. **Downstream re-injection**: Each per-chapter prompt receives the upstream `ChapterSyllabus` and adjacent chapters' `keyConcepts`. weeklyChallenge.ts is told *"if prior chapter information is provided, generate 2-3 ADDITIONAL questions drawn from those earlier chapters. Mark them with `isSpacedReview:true` and `sourceChapter:N`."*

Per-principle implementation:
- **Spacing** → graph data (`spacingConnections`) + `isSpacedReview`-tagged review questions in weekly challenges.
- **Interleaving** → mix-tier question types in challenges; cross-chapter examples in chapter prompts.
- **Retrieval** → mandated `<div class="callout-label">Think About It</div>` boxes inside chapter HTML; quiz formats; `confidence-weighted` question type.
- **Concrete examples** → research dossier with verified DOIs is fed back into chapter generation as required citations.
- **Dual coding** → `WidgetSpec[]` + `<figure class="gemini-image">` placeholders are required schema fields.

---

## Quiz / assessment primitives — the crown jewel

### (a) Practice quiz — text format, regex-parsed

18-20 MCQs, "correct is always a, app shuffles". Plus the **`answerBalancer.ts` post-pass** that detects the longest-correct-answer LLM tell and rewrites distractors via Haiku (~120 lines of careful prompt engineering: *"NEVER modify the correct answer ... rewritten distractor should be MORE seductive — a better wrong answer, not just a longer one"*). **This pattern alone is worth stealing.**

### (b) In-class quiz — JSON, 10 questions

Distractors carry per-distractor feedback. Generates 5 shuffled paper versions + answer-key DOCX (instructor artifact).

### (c) Weekly challenge — `weeklyChallenge.ts` (the most pedagogically advanced file)

**Seven question types arranged in 4 tiers (warmup/core/challenge/boss):**

1. `mcq` — standard
2. `two-stage` — answer + must-also-pick-correct-justification (catches right-answer-wrong-reason)
3. `assertion-reason` — 5-option logical relationship (`both-true-reason-explains` etc.)
4. `agreement-matrix` — classify 5-8 statements as always/sometimes/never
5. `confidence-weighted` — MCQ + confidence rating, scoring rewards calibration
6. `slider-estimation` — numeric with `acceptableRange ±15%`, gradient scoring
7. `boss` — synthesis question requiring ≥2-3 chapter concepts

**Critical anti-gaming feature:** every question has a `variants: Array<Record<string, unknown>>` field. At runtime one variant is randomly selected and merged-over-base, producing a fresh question per attempt. Mastery gate is 85%, unlimited retakes. Also `isSpacedReview + sourceChapter` for interleaved review questions from prior chapters.

---

## What Chiron takes verbatim

1. **Typed-schema-as-pedagogy-scaffold pattern** — `SciencePrinciple` union, `ScienceAnnotation`, `spacingConnections: number[]`, `WidgetSpec`. Force the LLM to fill schema slots → cognitive science emerges from structure, not from hopeful prose.
2. **The 7-question-type weekly challenge schema** (`weeklyChallenge.ts` + `WeeklyChallengeData` types) — `two-stage`, `assertion-reason`, `agreement-matrix`, `confidence-weighted`, `slider-estimation`, `boss`, plus `variants[]` for anti-gaming and `isSpacedReview` for interleaving. Drop in unmodified.
3. **The `answerBalancer.ts` audit-and-rewrite post-pass** — generic LLM-output-quality pattern. Detect a known artifact (longest-answer-is-correct), feed flagged items to a cheaper model with a tightly scoped rewrite prompt.
4. **Theme parameterization** — `Theme` interface + 4 named palettes (Midnight/Classic/Ocean/Warm). Chiron extends to 5 (warm-paper default + clinical for medicine + linguistic for language).
5. **`buildThemePromptBlock()` LLM-injection pattern** — chapter generator gets the theme's tokens so output uses `var(--color-accent)` not hardcoded hex.
6. **Streaming progressive parser** (`parsePartialChapters` brace-depth tracker) — for live UI feedback on long JSON outputs.
7. **`stop-after: syllabus|research`** flag for human-in-the-loop checkpointing.
8. **`refinementFeedback` branch** — user iterates the syllabus before committing to research/build.

## What Chiron rejects (over-engineering for solo learners)

- ❌ PPTX export, DOCX export, SCORM 2004 wrapper, in-class-quiz-5-versions-with-bubble-sheets — instructor artifacts. Solo learner doesn't print.
- ❌ The 4 themes in full → keep theme system but reduce to 5 purposeful variants (default + dark + 3 domain-themed).
- ❌ 6 voice options → keep TTS but per-domain-defaulted (Klaus for DE, Maria for IT, Dr. Reyes for medical persona).
- ❌ `activities.ts` + `discussion.ts` (classroom 60-students facilitation) → REPURPOSE for AI multi-persona engagement (Alice/Bob peer learners).
- ❌ The 35KB `coursePackageTemplate.ts` — competing with codebase-to-course's HTML shell. Use codebase-to-course's instead.

---

## Files & paths

- Local clone: `/home/gyasisutton/dev/audits/classbuild/`
- Key files: `src/prompts/syllabus.ts`, `src/prompts/weeklyChallenge.ts`, `src/services/quiz/answerBalancer.ts`, `src/themes.ts`, `scripts/generate-course.ts`
- Audited HEAD commit: clone date 2026-04-28 ~12:35
