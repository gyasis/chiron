# PRD — Rewire the Chiron tutor onto Acolyte as the universal sidebar driver

**Status:** OPEN · **Created:** 2026-07-30 · **Repo:** chiron (`skill/shell/tutor.js`) + acolyte (`~/Documents/code/acolyte`)
**Ephemeral marker:** delete after the Chiron tutor is served by acolyte in prod and the legacy `tutor.js` is retired.

## 1. Context — why

Chiron has its **own** in-page tutor sidebar (`skill/shell/tutor.js` + `tutor.css`, classes `.ct-*` / `.chiron-listen`, wired to the Chiron tutor **service on :8912**). It is a **parallel rebuild** of exactly what **acolyte** (`~/Documents/code/acolyte/src/widget.ts`, `.acolyte-*`) is *for*: a **universal, embeddable sidebar widget you drop into any website and configure**. That is acolyte's headline use case (already embedded in the twicedata site). The Chiron tutor should have been acolyte **configured with Chiron's features**, not a from-scratch second widget.

Trigger: while adding speech-to-text we found the mic **already existed in acolyte** and had to be **ported** into `tutor.js` — a symptom of the duplication. (The mic port shipped 2026-07-30; this PRD is the structural follow-up.)

## 2. Goal

Make **acolyte the driver** of the Chiron tutor sidebar, wired to Chiron's **exact** features — acolyte stays the reusable scaffold; Chiron supplies config + adapters. **Zero feature regression** vs today's `tutor.js`.

## 3. Chiron tutor features that MUST be preserved (the acceptance checklist)

- **Backend**: POST `:8912 /tutor-chat` with `{lesson_slug, section_id, section_text, selection, messages, model, mode, lang}`; grounded answer (SIMPLE one-shot vs COMPLEX draft→Harrison-search→reconcile; `model:'agent'` tool-calling). `GET /tutor-models`, `/healthz`.
- **Model selector** populated from `/tutor-models` (cloud / Gemini / governor), persisted choice.
- **Lesson grounding**: current section id + section text + the user's **text selection** in the lesson ("select text to highlight it" affordance).
- **Dispatch bar** buttons (lesson / images / clear) + the collapsible `.chiron-listen` audio-widget integration.
- **Speech-to-text mic** (just added — must survive; acolyte already has it natively, so this becomes free).
- Markdown/math rendering, per-lesson chat state, the right-edge "Tutor" tab, mobile drawer behavior.

## 4. Approach (to refine)

1. **Acolyte config/adapter surface** — acolyte already takes a backend + config. Define a Chiron adapter that maps acolyte's chat contract → the `:8912 /tutor-chat` payload (grounding fields, model, mode, lang), and acolyte's model picker → `/tutor-models`.
2. **Grounding hooks** — acolyte needs a "context provider" callback so the host page supplies `section_id/section_text/selection` per message (Chiron wires it to the lesson DOM + the text-selection highlighter).
3. **Embed** — the Chiron shell loads acolyte (one `<script>` + config) instead of `tutor.js`; the assemblers/`render_episode_viewer.py` copy acolyte's bundle as a self-contained sibling (R-CH-PIPELINE: local relative assets, no up-tree paths).
4. **Retire** `tutor.js` / `tutor.css` once parity is verified across all domains (medicine, language-it, video-it).
5. **Generalize back into acolyte** anything Chiron needed that acolyte lacked (context-provider callback, model-list endpoint config) — so the *next* site gets it for free. That is the whole point.

## 5. Decisions / open questions

- Does acolyte's current config surface already support a pluggable backend + context-provider, or does it need those added? (Audit `acolyte/src/widget.ts` config/`state`.)
- Keep acolyte's `.acolyte-*` styling, or theme it to Chiron's tokens? (Likely: acolyte exposes CSS vars, Chiron sets them.)
- Bundle delivery: acolyte built to a single self-contained JS the pipeline copies per-lesson (matches the Chiron self-contained-bundle rule).

## 6. Non-goals

- Not rebuilding acolyte's chat/tool UI — reuse it.
- Not changing the :8912 tutor service contract.

## 7. Definition of done

Every Chiron lesson's sidebar is **acolyte**, configured to :8912, with **all** §3 features working (verified on medicine + language-it + video-it), `tutor.js`/`tutor.css` removed, and the reusable pieces (context provider, model-endpoint config) merged into acolyte proper.

## Cross-references
- Mic port (done 2026-07-30): `skill/shell/tutor.js` `.ct-mic` — ported from `acolyte/src/widget.ts:596-645`.
- Chiron tutor service: memory `project-chiron-lesson-tutor` (:8912, `tutor_server.py`).
- Acolyte: `~/Documents/code/acolyte` (README = "universal embeddable sidebar"), consumer `twicedata-new/static/acolyte/`.
