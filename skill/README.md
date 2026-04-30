# Chiron Skill — Domain Extensibility (FR-002 / US6)

## TL;DR

Adding a new domain to Chiron = drop **3 files**. The pipeline auto-discovers them, validates them, and routes to them based on `TriggerContext.domain`. No pipeline code changes required — that's the whole point of FR-002.

See `SKILL.md` for the top-level skill descriptor; this file documents the extensibility contract.

---

## The 3 files

For a new domain `<domain>` (e.g. `music-theory`, `chemistry`, `ml-systems`), drop these three files:

1. **`skill/concepts/<domain>.json`** — concept DAG.
   - Shape: array of `{id, label, prereqs[], description}` nodes.
   - Constraints: no cycles, every `prereqs[]` entry must reference an existing `id`, ids must be unique.
   - Validated against `lib/validator.ts` (`validateConceptDag()`).

2. **`skill/curricula/<domain>.json`** — curriculum knobs.
   - Required fields: `chapterCountTarget`, `perChapterQuizTarget`, `perChapterSrCardTarget`, `widgetMix`, `themeId`, `personasFile`.
   - Optional: `subMode` for variants like `medicine-amboss` vs `medicine-uptodate`.

3. **`skill/personas/<domain>.json`** — AI multi-personas.
   - Shape: `{expert, peers[]}` per `lib/schemas/personas.ts`.
   - `expert`: subject-matter authority (e.g. attending physician, music theorist).
   - `peers[]`: 2–3 fellow-learner personas to drive Feynman-style discourse.

---

## Optional 4th: prompt-template variants

Most domains do **not** need these. Drop them only when the default prompts are pedagogically wrong for your domain.

- **Sub-mode curriculum variants**: for domains with `subMode`, drop `skill/curricula/<domain>-<submode>.json` (e.g. `curricula/medicine-amboss.json` vs `curricula/medicine-uptodate.json`). Stage 1 of the pipeline picks the right curriculum file based on `TriggerContext.subMode`.
- **Domain-specific quiz prompts**: drop `skill/prompts/04*-quiz-<domain-specific>.md` (e.g. `04c-quiz-clinical-vignette.md` for medicine USMLE/AMBOSS-style vignettes). Stage 4 routes to the domain-specific variant when present.
- **Domain-specific ingest prompts**: drop `skill/prompts/00-ingest/<sourceType>-<domain>.md` (e.g. `pdf-medicine.md` for clinical-textbook ingest with PHI/figure-caption-extraction tweaks).

---

## Validation steps

After dropping the 3 (or 4) files, run these checks before triggering `/chiron`:

1. **JSON parse check** (every file):
   ```bash
   node -e 'JSON.parse(require("fs").readFileSync("skill/concepts/<domain>.json","utf8"))'
   node -e 'JSON.parse(require("fs").readFileSync("skill/curricula/<domain>.json","utf8"))'
   node -e 'JSON.parse(require("fs").readFileSync("skill/personas/<domain>.json","utf8"))'
   ```

2. **Concept-DAG validator**:
   - **FUTURE**: `node skill/scripts/validate-domain.js <domain>` (this script does not exist yet — flag as TODO).
   - **For now**: invoke `lib/validator.ts.validateConceptDag()` manually from a one-off Node script or via the test driver.

3. **Drop a golden input** at `skill/tests/golden-inputs/<domain>-<topic>/` containing at least one `.chiron-input.json` manifest with `"domain": "<your-domain>"`.

4. **Drop a snapshot** at `skill/tests/snapshots/<domain>-<topic>.json` listing expected fields (concept count, chapter count, persona names, etc.).

5. **Run the test suite**:
   ```bash
   bash skill/tests/test.sh
   ```
   The driver auto-discovers `golden-inputs/` and `snapshots/` pairs — your new domain is picked up automatically. Confirm it passes.

---

## Worked example: `music-theory`

The newly-dropped files (T111 / T112 / T113) demonstrate the pattern end-to-end:

- `skill/concepts/music-theory.json` — 10 concepts (intervals, scales, chord quality, voice leading, …) with prereq edges.
- `skill/curricula/music-theory.json` — 5-chapter scroll-modules curriculum with `widgetMix` favoring interactive ear-training widgets.
- `skill/personas/music-theory.json` — Sofia (expert), Theo + Maya (peers).

**These three files were dropped without modifying any pipeline code.** The next time you trigger `/chiron` with `domain: 'music-theory'`, Chiron auto-discovers them, validates the DAG, and routes Stages 1–6 through the music-theory curriculum and personas. That is the extensibility win — adding a domain is a config change, not a code change.

---

## Anti-pattern warnings

- **Don't add domain-specific logic to `pipeline.ts`**. The pipeline is domain-agnostic by design. If you find yourself reaching for an `if (domain === 'medicine')` branch, the right answer is almost always a curriculum knob or a prompt-template variant.
- **Don't fork the validator for new domains**. Concept-DAG validation is universal — cycles, missing prereqs, duplicate ids are wrong everywhere.
- **Don't bypass the 3-file convention** by hardcoding domain strings in `lib/`, `shell/`, or anywhere else outside `skill/{concepts,curricula,personas,prompts}/`. The whole contract relies on auto-discovery.
- **Don't strip pedagogical depth** to "simplify" a new domain. If a domain genuinely needs MCQ + clinical vignette + agreement-matrix (medicine), give it all three. Per CLAUDE.md, domains are co-equal.
