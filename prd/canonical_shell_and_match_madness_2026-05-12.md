# PRD — Canonical Lesson Shell, Match Madness Widget, and Italian-Lesson Regeneration

**Slug:** `canonical_shell_and_match_madness_2026-05-12`
**Status:** open
**Branch:** `001-chiron-v1`
**Repo:** `chiron`
**Created:** 2026-05-12
**Ephemeral marker:** delete after Italian lesson regenerated + matches Klinefelter shell + match-madness widget lands in skill and is consumed by both medicine and language lessons. Target retire date: 2026-05-19.

---

## 1. Context

Two lessons exist in `~/dev/projects/chiron/lessons/`:

| Lesson | Domain | Shell |
|---|---|---|
| `klinefelter-syndrome-2026-05-03` | medicine | Pulls from `skill/shell/` — uses `data-layout="l5"`, `data-view` picker, layouts directory, screenshots, etc. **122 KB lesson.html, multi-view, polished.** |
| `italian-cleaning-verbs-2026-05-12` | language-it | Custom inline component CSS, no shell consumption. **22 KB lesson.html, single-view.** Theme tokens consumed correctly (no hardcoded hex), but component layout is one-off. |

**Both lessons satisfy the BLOCKING theme contract** (themes/ copied next to lesson, linked via `<link>`, no hardcoded hex/rgb in lesson.html). But they DRIFT at the **component-layout layer** — there is no enforced shared shell. Without explicit instruction every new lesson reinvents its own CSS.

**User intent (2026-05-12):**
> "Without instruction the lesson will be all over the place. Use the medical lesson structure as the precedent. The language lesson content isn't bad — just style it like the medical one. Regenerate it. And set up a PRD in this vein."

Plus two earlier confirmed asks in the same session:

1. **Match Madness widget** — Duolingo-style 2×5 timed pair-matching, covering ALL verbs + nouns of the Italian lesson (not just a subset). Specced via Gemini research (see Decisions Log §4.1).
2. **Italian lesson depth** — add multiple dialogues + short stories (funny + serious + native-style narrative) in Italian.

---

## 2. Scope

### In scope

1. **Audit `skill/shell/`** — identify what the canonical shared shell actually is (layouts l1/l2/l5, view picker, header, footer, chrome). Document it.
2. **Define canonical lesson skeleton** — a single source-of-truth template every future lesson copies and fills, so component CSS never drifts. Likely: copy the shell HTML + the layouts CSS + a single `chiron-components.css` into each lesson dir alongside `themes/`.
3. **Backfill** — refactor `klinefelter-syndrome-2026-05-03` (if needed) to consume the canonical shell explicitly rather than carrying inline styles. Verify nothing visual regresses.
4. **Build `match-madness` typed widget** at `skill/lib/widgets/match-madness.ts` (TypeScript, strict, Zod-validated). Includes:
   - Type definition (rounds, pairs, timer_seconds, wrong_lock_ms, refill_delay_ms, accessibility_mode)
   - Renderer that emits the 2×5 grid HTML/CSS/JS (all colors via `var(--chiron-*)`)
   - SQLite schema migration for `match_madness_sessions` + `match_madness_pair_log` tables
   - Per-pair latency log feeding the SR scheduler
5. **Regenerate Italian lesson** — same content (cleaning verbs) PLUS:
   - Identical shell + component CSS as Klinefelter (consumes skill/shell)
   - **Match Madness chapter** covering all 14 verbs + 8 nouns = 22 pairs across 3 rounds
   - **Multiple dialogues** — current Alice + two more (e.g., Marco the native tutor explaining grammar; family scene)
   - **Short stories in Italian** — at least one funny, one serious, one narrative ("una storia in italiano"), A2 level with side-by-side gloss
6. **Verify BLOCKING contract still holds** — grep for hardcoded hex/rgb in regenerated lesson.html; must be zero in component CSS.

### Out of scope

- TTS audio generation (Italian native-speaker voicing) — defer to follow-up; will gate on Gemini TTS quality
- `.chiron-state.db` SQLite persistence wiring at runtime — schema landed, runtime hooks deferred
- German language support (v1.1)
- Anki .apkg export
- Backfilling Klinefelter with match-madness (only language domain needs it initially)

---

## 3. Subagent Log

| When | Agent | Purpose | Result |
|---|---|---|---|
| 2026-05-12 | gemini_research | Spec Duolingo Match Madness mechanics (grid, timer, scoring, pedagogy) | Returned — full spec captured in §4.1 |

---

## 4. Decisions Log

### 4.1 — 2026-05-12 — Match Madness spec adopted as-researched

**Decision:** Replicate Duolingo Match Madness with these parameters, per gemini_research result:

- 2×5 grid (10 tiles, L1 left / L2 right, text-only — no images/audio for the timed variant)
- 105-second session, 3 rounds (~45/55/60 matches each)
- Wrong-match penalty = 1.5s input lock (NOT time deduction); correct match = no time bonus by default
- Refill at same slot positions after ~200ms delay (preserves spatial-verbal dual coding)
- Combo meter = visual only, not scored
- Keyboard: `1–5` left col, `Q W E R T` right col
- Accessibility mode: timer off OR +5s/match
- Per-pair **latency** logged → feeds SR scheduler's "weak word" detection

**Why:** Direct port of a proven mechanic with known pedagogy (automaticity, Bjork desirable difficulty, flow state). The latency log is the Chiron value-add (Duolingo doesn't expose this).

### 4.2 — 2026-05-12 — Klinefelter lesson is the canonical structural precedent

**Decision:** The medical (Klinefelter) lesson at `~/dev/projects/chiron/lessons/klinefelter-syndrome-2026-05-03/` is the reference structure for ALL future Chiron lessons. Italian lesson will be regenerated to match it.

**Why:** User directive 2026-05-12. Klinefelter is the most evolved lesson — multi-view, layouts directory, screenshots, polished UX. New lessons should NOT roll their own component CSS.

**Implication:** Need to extract the structural pattern (layouts, views, chrome) into reusable shell files in `skill/shell/` if not already there, then both lessons + future ones copy/link from there.

### 4.3 — 2026-05-12 — Explicit visual speed-up on Match Madness (Chiron-can-do-better)

**Decision:** ADD an explicit visual acceleration layer on top of Duolingo's implicit pair-count scaling. User opted in (2026-05-12).

**Mechanics:**
- **Background pulse** — body element gets a subtle pulse animation. Pulse rate ticks up with each correct match (e.g., 60bpm at round start → 120bpm late-round).
- **Combo meter visual** — flame intensity / glow brightness scales with current streak.
- **Tile reveal time** — refill delay shrinks within a round (200ms → 100ms at high streak) to compound the urgency feel.
- Disable all visual speed-up in `accessibility_mode` (timer-off variant).

**Why:** Duolingo's "Madness" feeling emerges purely from pair count vs. time. Chiron can additionally surface a kinesthetic/visual flow signal so the learner *feels* the acceleration. Pedagogically: stronger flow-state trigger (Csikszentmihalyi). Empirically: needs A/B comparison post-implementation; track time-to-completion deltas.

### 4.4 — 2026-05-12 — Q1 + Q2 confirmed defaults

- Q1: Match-pair pool = **mixed** (verb↔EN primary, ~6 verb↔IT-noun collocations).
- Q2: Shell = **full Klinefelter layout/view picker** (l1/l2/l5 + lesson/quizzes/flashcards/vignette).

### 4.5 — 2026-05-12 — Architecture pivot: medicine and language get SEPARATE canonical skeletons

**Decision:** Medicine (Klinefelter) and language (Italian) are different pedagogical domains. They will share **theme tokens + base chrome** but have **domain-specific lesson skeletons** beneath. Klinefelter remains the canonical for medicine — UNTOUCHED. A new canonical `language-lesson-skeleton` is being built and test-driven via the Italian cleaning-verbs lesson.

**Why:** Forcing parity (e.g. porting Italian to Klinefelter's Svelte SPA path) is overkill for what's actually different — clinical reasoning vs. communicative competence have different chapter rhythms. The audit confirmed `skill/shell/_base.html` + `build.sh` is orphaned (neither existing lesson uses it). New plan: codify two parallel canonical skeletons that share tokens.

### 4.6 — 2026-05-12 — Language-lesson canonical skeleton v1

**Sections (woven narrative spine, NOT static vocab-then-quiz):**

0. Cold open (narrative hook in target language)
1. Vocabulary arc (mini-context → table → Alice confusion → Marco correction → inline cloze)  ×N clusters
2. Conjugation deep-dive (regular -are, -isco, regular -ere) with Alice mistake / you correct
3. Collocations in context (verb↔noun pairings, situational paragraph)
4. Stories — 6 total: funny / serious / immersion × A2 / B1, two-column with margin gloss
5. Match Madness (typed widget, 22-pair pool, visual speed-up enabled)
6. Extended dialogue (3-voice: Alice + Marco + you, 8-12 turns, comprehension check)
7. SR drawer (always accessible)
8. Closing (Marco's wrap-up)

**Visual conventions:** speaker color coding (Alice warm-accent, Marco primary, you neutral); inline retrieval prompts dispersed through narrative (not appended); two-column story layout with hover-reveal gloss; pedagogical callouts (Grammar Pearl, False Friend, Cultural Note); same theme tokens as Klinefelter.

**Codification target:** `skill/shell/_language.css` + `skill/shell/language-lesson-skeleton.md` (template doc). Future Italian B1, eventual post-v1 German inherit.

### 4.7 — 2026-05-12 — Story content sourcing: both original AND authentic-sourced

**Decision:** Stories include BOTH original (vocab-budget-locked to lesson scope) AND adapted from authentic Italian sources (folk tales, news, micro-fiction). User opted for full mix.

**Sourcing method:** Gemini research call to surface candidate authentic sources (e.g. Italo Calvino's *Fiabe italiane*, Pirandello micro-stories, news snippets), then adapted to A2/B1 with attribution.

**Why:** Authentic input is the gold standard for input-based SLA (Krashen, comprehensible input). Original ensures vocab budget control. Mix gives both safety and stretch.

### 4.8 — 2026-05-12 — MVP scope: full skeleton (all 0–8 sections)

User said "all on the table." First Italian lesson v1 implements every section.

### 4.9 — 2026-05-12 — PRD persistence convention

**Decision:** This PRD lives in `~/dev/projects/chiron/prd/`, NOT in the global `~/dev/prd/scratch/` librarian, per project CLAUDE.md.

**Why:** Chiron's design docs travel with the project repo. Explicit project rule.

---

## 5. Plan / Tasks

Execution order (≈ 2.5 hours total):

1. **[20m]** Audit `skill/shell/` — read every file, document what the canonical shell currently provides vs. what's missing. Confirm whether Klinefelter actually consumes it or duplicates it.
2. **[20m]** Define + extract canonical shell skeleton (if missing). Output: `skill/shell/_skeleton.html` + `skill/shell/_components.css` referenced by every lesson via `<link>`. Both lessons in `lessons/` will copy these files next to themselves (mirrors the `themes/` pattern, satisfies BLOCKING contract).
3. **[45m]** Implement `skill/lib/widgets/match-madness.ts` — typed widget + renderer + SQLite schema. TypeScript strict, Zod-validated input.
4. **[15m]** Generate 22-pair word inventory for Italian lesson (14 verbs + 8 nouns). Map into 3 rounds (R1 7 pairs, R2 7 pairs, R3 8 pairs).
5. **[25m]** Generate Italian content additions:
   - Dialogue 2: Marco-the-tutor grammar explainer (A2)
   - Dialogue 3: family-scene cleaning Saturday (A2, multi-character)
   - Funny short story — **A2 version (~120 words) AND B1 version (~180 words with stretched vocab + margin gloss)**
   - Serious short story — **A2 version (~120 words) AND B1 version (~180 words with margin gloss)**
   - Narrative immersion ("una storia in italiano") — **A2 version (~120 words) AND B1 version (~200 words with margin gloss)**
   - Total: 6 stories (3 themes × 2 levels). Each B1 version inserts ~5–8 new lexemes, glossed in right margin.
6. **[30m]** Regenerate `lessons/italian-cleaning-verbs-2026-05-12/lesson.html` consuming canonical shell + match-madness widget + new content. Keep brief.json/syllabus.json in sync.
7. **[10m]** Self-check: BLOCKING contract (grep hex/rgb), shell consistency between two lessons (diff structure), JSON validation.
8. **[10m]** Append decisions + result to PRD; mark ephemeral cleanup trigger.

---

## 6. Risks & Open Questions

- **R1:** Klinefelter may have its own inline component CSS, not actually consuming `skill/shell/`. If so, step 1 will reveal the gap and step 2 becomes "extract Klinefelter's working pattern into shared shell." Mitigation: audit before committing to a refactor path.
- **R2:** Match Madness widget runtime needs DOM interactivity (timers, key handlers, animations). Must NOT introduce a build step — should be inlined or referenced as a plain `.js` file copied next to the lesson. Decision: single-file inlined `<script>` per renderer output, keeps `open in browser` working.
- **R3:** Story content quality — at A2 level, narrative depth is constrained. Will use vocabulary intentionally restricted to: cleaning verbs (the lesson core) + already-known A2 function words. Glosses provided in right-side margin for any new lexeme. Funny vs. serious is tone; vocab budget same.
- **Q1:** Should match-madness pair pool be **only verbs↔English** or also include **verb↔Italian noun pairing** (e.g., *spazzare ↔ la scopa*)? Latter is a *collocation* drill — more useful. Default to **mixed mode**: most pairs are verb↔EN, but ~6 are verb↔noun collocations.
- **Q2:** Should the canonical shell include the layout/view picker (l1/l2/l5 + lesson/quizzes/flashcards/vignette)? Or strip to single layout for v1? Decision: **keep multi-layout** — Klinefelter already has it, language lessons benefit too.

---

## 7. Revision Log

- 2026-05-12 — initial draft, scope confirmed by user across 4 message turns.

---

## 8. Cleanup trigger

Delete this PRD when:

1. `skill/shell/_skeleton.html` + `_components.css` exist and are documented in `skill/README.md`, AND
2. `skill/lib/widgets/match-madness.ts` exists, compiles under `tsc --noEmit`, has type-level test coverage for the Zod schema, AND
3. `lessons/italian-cleaning-verbs-2026-05-12/lesson.html` consumes the canonical shell AND the match-madness widget AND new dialogue/story chapters, AND
4. Diff between Klinefelter and Italian lesson structural CSS is empty (component-layer parity verified), AND
5. BLOCKING contract self-check passes on regenerated Italian lesson (grep returns zero hardcoded hex/rgb in lesson.html), AND
6. PRD has been open for ≥ 7 days with no follow-up edits.
