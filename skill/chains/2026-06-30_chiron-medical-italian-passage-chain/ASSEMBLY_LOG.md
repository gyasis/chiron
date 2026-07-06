# Assembly Log — chiron medical-Italian passage chain

## The rule (BLOCKING discipline)
- A **hand assembly** = any manual build/edit of a lesson OUTSIDE the chain. **It is a FAIL** — the
  chain should produce the lesson with **zero hand assembly**.
- Hand assembly IS allowed to fix/modify a lesson — but **every time** we hand-assemble, we MUST then
  **run a NEW lesson fully through the chain (no hand touch)** to prove the chain still runs clean.
- The north star: a **clean full-chain run** (`CH_STAGE=all`, no manual edit of the output).
- The chain's own automated steps (`run.py` Phase 0–5, incl. `assemble-passage.mjs` = Phase 3) are
  **NOT** hand assembly — they are the chain.

## Clean full-chain runs (the proof) — APPEND ONE PER RUN
| date | qid | stages run | result | notes |
|---|---|---|---|---|
| 2026-06-30 | ssm2018_111 | author→assemble (chain) | ✅ lesson.html (88KB) — matches fattore-v shell; annotated-passage + glossary + why-care + mcq render; 3 widgets dropped+logged | chain components only, NO hand edit. Visual compare vs fattore-v = strong match. |
| 2026-06-30 | ssm2025_132 | ingest→author→assemble (`CH_STAGE=assemble`, random — "Anemia macrocitica / B12") | ✅ **CLEAN FULL-CHAIN, SINGLE INVOCATION, ZERO HAND ASSEMBLY** → lesson.html (112KB, 5/5 sections, annotated-passage renders, 14 srCards). Self-repair recovered a malformed 04t JSON on attempt 1. | THE PROOF: unseen MCQ, no hand touch. Same 3 widgets dropped (systematic, not random). |

| 2026-06-30 | ssm2020_136 | ingest→author→**scenario**→assemble (`CH_STAGE=assemble`, random — "Nefropatia saturnina / lead") | ✅ **CLEAN, ZERO HAND ASSEMBLY** → lesson.html (215KB): breakdown (65 tokens) + grounded clinical-scenario chat (8 turns, attending+resident) + **8 EN translations behind a 🇬🇧 toggle** + all widgets, **0 dropped** | proves: breakdown + grounded scenario + EN-toggle all clean on an unseen MCQ |

### Features added this session (all chain-code)
- **Phase 2.6 — grounded clinical-scenario chat** (`group-chat-animation`): PACES (symptom-led) + Harrison's (disease) grounding SCOPED to this builder only; medical-Italian doctor↔colleague/patient scene dramatizing the MCQ→answer; rendered in the medicine section; shell engine (`main.js`) now included so chat/flow/layer-toggle animate.
- **🇬🇧 English toggle** on the scenario chat: each turn has `body` (IT) + `bodyEn` (EN); one theme-styled button reveals all translations (Italian default).
- **Phase 4 — audio transcripts** (04s bilingual + Veloce/Lenta passage reads → audio-scripts.json) wired (Phase 5 Mac bake gated).
- **TODO (universalize):** the scenario chat + EN toggle live in the passage assembler; to serve WARD lessons too, port to the chiron skill (`renderGroupChatAnimation` + `main.js` + reveal CSS).

| 2026-06-30 | ssm2018_084 | full chain (`CH_STAGE=audio`, random — "Definizione dei tofi" / gout) | ✅ **LOCK-IN VERIFIED** — all 7 fix-categories PASS automatically (real shuffled MCQ, no spoiler, single letters, chat 🇬🇧 EN-toggle, bilingual audio + Veloce/Lenta, 0 dropped). Scenario: attending+patient+resident. | proof every fix is structural, zero hand-coding |

### LOCKED-IN structural fixes (mechanical — emitted on EVERY run, never hand-applied to a lesson)
All of these live in code and run automatically; a fresh `CH_STAGE=all` produces them with zero hand touch.

| Fix | Permanent home |
|---|---|
| Widget normalizers (annotated-passage `anomalies`/`register`; glossary `terms`→`entries`; pattern-cards `front/back`→`title/body`; flow-animation `steps`→`actors`+`steps`; flashcard verb-filter) | `skill/scripts/assemble-passage.mjs` (`normalizeWidget`) |
| **MCQ**: real option text (`label`=`text`), **shuffle** (anti-gaming), `explanation`=`reasoning`, correctIndex | `assemble-passage.mjs` (`normalizeWidget`, mcq case) |
| **No answer spoiler** in §3 intro; Chiusura references answer **by text** (not stale letter) | `assemble-passage.mjs` (question + closing sections, `correctText`) |
| **No double letters** in the read-first item (`<ol type="A">` letters; text only in `<li>`) | `assemble-passage.mjs` (`optionsList`) |
| Drop-and-log for any widget that still fails the renderer | `assemble-passage.mjs` (`render` → `.scratch/dropped-widgets.json`) |
| Shell engine inclusion (chat/flow/layer-toggle animate) | `assemble-passage.mjs` (`shellEngine` ← `shell/main.js`) |
| **Flow-animation** clean directed flow + bigger arrows | `shell/clinical-widgets.css` (SHARED → ward lessons too) |
| **Chat EN-toggle** (Italian default, 🇬🇧 reveal per turn) | `lib/widget-renderer.ts` `renderGroupChatAnimation` (→dist) + `clinical-widgets.css` + `main.js` (SHARED, universal) |
| Phase 2.6 grounded clinical-scenario chat (PACES+Harrison, scoped) · Phase 4 04s bilingual + Veloce/Lenta · Phase 5 bake | `run.py` |

### Chain-code fixes (NOT hand assembly — improvements to the chain itself)
- **`assemble-passage.mjs` normalizer** (2026-06-30): field-alias normalization (annotated-passage `anomalies`/`register`; glossary `terms`→`entries`) + drop-and-log for widgets that still fail the renderer contract → `.scratch/dropped-widgets.json`. This is the medicine-chain pattern ("re-prompting can't fix field-aliases — normalize+drop"). Fixing chain code ≠ hand assembly.
- **TODO (fold back into chain):** normalize pattern-cards (`.replace`), flow-animation (needs `actors`), language-flashcard-deck (verb `.io` subfield) so they render instead of drop.

## Hand assemblies (the fails to fold back into the chain) — APPEND ONE PER EDIT
| date | qid | what was hand-edited | why | folded back into chain? | clean re-run done? |
|---|---|---|---|---|---|
| — | — | (none yet on this chain) | — | — | — |

> When you hand-edit a generated lesson: add a row above (what + why), then queue a fresh
> `CH_STAGE=all` run on a DIFFERENT random MCQ and log it in the clean-runs table.
