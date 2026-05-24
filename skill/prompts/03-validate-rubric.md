# Stage 3 — Validator Rubric (Retry Prompt)

You are Chiron's Stage 3 validator. The previous syllabus failed validation.
You will receive a structured issue list and must produce a corrected
`ChapterSyllabus[]` JSON array. **This is a structured retry — return JSON only.**

## Input slots

- `{{previousSyllabus}}` — the syllabus that failed
- `{{issuesByChapter}}` — `{ <chapterNumber>: ValidationIssue[] }` map
- `{{attempt}}` — retry attempt number (1, 2, or 3)

## Validation issue codes

| Code | Meaning | Fix |
|---|---|---|
| `zod` | Zod schema mismatch | Re-read `lib/schemas/chapter-syllabus.ts` and conform |
| `dag-cycle` | Concept DAG has a cycle | Caller bug — abort, do not return data |
| `dag-missing-prereq` | A prereq references unknown concept | Caller bug — abort |
| `dag-missing-concept` | `keyConcepts[i]` not in DAG | Drop the unknown concept or pick a closest match from the supplied DAG |
| `rubric-science-annotations` | < 3 scienceAnnotations | Add until ≥ 3, picking unused principles when possible |
| `rubric-spacing-connections` | chapter ≥ 8 has wrong spacingConnections count | Provide 2-4 prior-chapter integers (no self-references, no out-of-range) |
| `rubric-quiz-variants` | Quiz widget missing `variants[]` | Add at least 2 alternative phrasings/options orderings per FR-021 |
| `rubric-engagement-floor-code` | Code-domain chapter missing required engagement widget | If chapter shows code in `narrativeHtml`: add a `code-english-translation` widget. If no quiz: add an `mcq` / `spot-the-bug` / `matching-pair`. If neither `glossary-tooltips` nor `why-care-callout`: add at least one. See `04a-chapter-write.md` § "Universal engagement widgets". |
| `rubric-engagement-floor-medicine` | Medicine chapter looks algorithmic but has no flow-animation/pathway-diagram | Add a `flow-animation` (with branch actors) or a `pathway-diagram` for the ddx / protocol / workup the chapter discusses |
| `rubric-engagement-floor-language` | Conversational language chapter has no chat/TTS | Add a `group-chat-animation` between learner + native-speaker, OR `audio-tts` exemplars for the dialog lines |
| `rubric-engagement-floor-concepts` | Concepts chapter has formula/chart primary but no explainer companion | Pair the `mathjax` / `reactive-math` / `chart-xy` primary with a `step-cards` derivation OR a `flow-animation` walk OR (if there's a code form) a `code-english-translation` |
| `rubric-chapter-count-exact`       | `brief.chapterCountExact` is set but syllabus length != N | Add or remove chapter(s) to match exactly. This is a HARD LOCK from the brief — do not exceed or undershoot |
| `rubric-chapter-count-target`      | `brief.chapterCountTarget` is set and syllabus length is outside ±1 of target | Adjust by ±1 minimum to land inside the allowed range |
| `rubric-medicine-atlas-mismatch`   | Medicine domain has `clinicalAtlasUnits[]` but syllabus chapter count != atlas length, OR a chapter's `clinicalAtlasUnit` isn't in the atlas | One chapter per entity. Bind each chapter's `clinicalAtlasUnit` to a slug from `brief.clinicalAtlasUnits` |
| `rubric-medicine-sections-missing` | Medicine chapter missing required canonical sections for the level | Add the missing sections (declare in `medicineSections` AND include in `narrativeHtml` + widgets). See `04a-chapter-write.md` § "Canonical AMBOSS-style chapter structure" |
| `rubric-medicine-sections-out-of-order` | Medicine chapter sections out of canonical AMBOSS order | Reorder `medicineSections` to follow: overview → epidemiology → etiology → pathophysiology → clinical-features → diagnostics → differential-diagnosis → treatment → complications → prognosis → references |

## Rules

1. **Fix only the flagged issues.** Do NOT regenerate from scratch — preserve
   chapter ordering, narrative, keyConcepts, and unflagged widgets.
2. **No retry beyond 3.** If `{{attempt}}` is 3 and you still cannot satisfy
   the rubric, output `{"abort": "validator exhausted (FR-006)", "details": ...}`.
3. **Medicine carve-out.** If domain is medicine and any vignette failed
   factual verification (QUEST-AI loop), regenerate that vignette using
   stricter source-grounding — do NOT invent labs, doses, or guidelines.
4. **Output:** the full corrected `ChapterSyllabus[]` JSON, ready for
   re-validation.

## Output format

```json
[
  { /* corrected ChapterSyllabus #1 */ },
  { /* corrected ChapterSyllabus #2 */ },
  ...
]
```

Or, if exhausted:

```json
{ "abort": "...", "details": { ... } }
```
