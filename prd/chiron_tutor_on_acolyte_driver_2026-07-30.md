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

---

## 8. Amendment 2026-08-14 — the THREE-TIER acolyte model (scope is config, not a fork)

Design session with Gyasi. The tutor sidebar is **one of three** acolyte surfaces, not the
only one. Same widget, same codebase — the tier is the **scope config**.

| Tier | Surface | Scope | Config |
|---|---|---|---|
| **1. Foundation** | new **Ask page** (ChatGPT-style, whole-page) | the whole corpus | `rag.sourceUrl = library.corpus.json`, `crossPageReferences:true`, `grounding:'permissive'`, persona `bare` — it *routes and finds*, it doesn't teach |
| **2. Per-lesson** | the sidebar (this PRD's §3) | **this page only** | `rag.auto:true`, `crossPageReferences:false`, `grounding:'strict'` — acolyte's DOM-scan default already IS this |
| **3. Subject** | spawned from a subject | one slice | `rag.sourceUrl = library.corpus.<domain>.json`, domain persona, seeded greeting |

**Why tier 2 is strict:** Gyasi's requirement — *"when it's active per page the truth is per
page; we force the context of that page so further questions make sense."* `grounding:'strict'`
is exactly that, and it is a one-word config. Question 4 stays anchored to §3 of *this* lesson
instead of drifting into the general corpus mid-thread.

**Spawn paths (both directions):**
- library subject facet → `🎓 Study with a tutor` → Ask page pre-scoped to that subject
- an answer whose sources all land in one subject → dispatch action `🎓 Go deeper with the
  <subject> tutor` (thread carries over, scope narrows) — *"spawns from that subject"*
- **reverse leg (required):** the strict per-lesson tutor, on an out-of-scope question, offers
  `↗ Ask this across the whole library` and hands up to tier 1. Strict scoping is only
  tolerable with a visible escape hatch.

### 8.1 Answers to §5's open question

- **Context-provider — already exists, it's called `rag`.** `RAGConfig` has four modes
  (`auto` DOM-scan · `selector` · `sections` inline · `sourceUrl` sidecar). Nothing to add.
- **Pluggable backend — needs an adapter, but not in acolyte.** `:8912 /tutor-chat` is not
  OpenAI-shaped. Cheaper fix: give `:8912` an OpenAI-compatible `/v1/chat/completions` face and
  point acolyte at it as `provider:'openai-compatible'`. Keeps acolyte generic (revises §6's
  "not changing the :8912 contract" — this is additive, the existing route stays).
- **One genuine acolyte-core gap:** scope is fixed at `mount()`. Changing subject mid-session
  should re-target RAG without a remount. **v1 fakes it with a remount** — may never be needed.

### 8.2 Build order (Chiron chrome first, acolyte last)

Decided against building acolyte features first: `library.index.json` is a **catalog** (338
lessons of metadata, **zero prose**) while `rag.sourceUrl` needs `[{id,title,text,meta}]`. The
blocker was never an acolyte feature — Chiron did not emit a corpus.

0. **corpus emitter** ✅ DONE (below)
1. **Ask page** at `:8911/ask/` — `mount()` against the corpus, acolyte exactly as it ships
2. retrofit the lesson sidebar onto the same widget · dispatch plugin (🎧 ➕ 📘, Chiron-side)
3. subject spawn · `:8912` OpenAI face · runtime scope switch **only if step 1 proves it needed**

### 8.3 Step 0 SHIPPED — `skill/scripts/build-library-corpus.mjs`

Walks each ready lesson's `lesson.html` → passages in acolyte's exact `RAGContent[]` shape
(bare top-level array, per `acolyte/src/internal/rag.ts:44`).

- **Measured:** 338 lessons → **21,312 passages**, 28.9 MB (6.3 MB gzip), 11 s cold / 5 s cached.
- **Sizing:** cut at `<h1..h3>` inside each outermost `<section id>`, capped 1400 chars, floor
  120 — chapter-sized units blow past the ~600-token single-vector sweet spot
  (`rag-chunking-retrieval.md` §4).
- **`meta.href`** = `/lessons/<path>#<section>` so a source card jumps to the exact section.
- **Widget sections skipped** (`sr-drawer`, `match-madness`, …) — drill scaffolding matches every
  query about its own words.
- **`video-it` needed its own extractor.** The 6 episodes render from an embedded
  `const DATA = {...}` payload, so a section walk found **zero** passages in them. Now one
  passage per scene: situation + `visual_situation.it` + `target_structures` + every line with
  `en_gloss` and `teaching_note`. That last part is the point — *"how do they say X"* is
  answerable only from the lines. 166 passages recovered.
- **Per-domain shards** — the corpus is lopsided (medicine 20,169 of 21,312, 27.1 MB; the other
  three total 1.8 MB). A scoped ask must never pay for the whole body, so
  `library.corpus.<domain>.json` ships alongside. Tier 3 loads a shard; only "everything" pays
  the 6.3 MB. **Open:** whether the full corpus is viable client-side on a phone at all, or
  whether tier 1 needs server-side retrieval — decide from step 1's measurements, not now.

### 8.4 INGEST — how a new lesson joins the corpus

Hooked at the **end of `build-library-index.mjs`**, not at the server's `_rebuild_catalog()`:
the chains (×4) and `episode_pipeline.py` call the index builder *directly*, so hooking the
server would have missed them. One seam, all 10 call sites covered. Since the server rebuilds
the index on accept / publish / bundle, **a lesson enters the corpus at the same moment it
enters the library** — no separate step to remember, nothing to forget on a new domain.

Cost control: each lesson's html is fingerprinted `mtime:size` in `.corpus-cache.json`;
unchanged lessons are reused verbatim. A rebuild after one new lesson parses one lesson
(verified: `parsed 1, cached 337`). `--only <slug>` forces one, `--force` ignores the cache,
`CHIRON_SKIP_CORPUS=1` opts out. Non-fatal by design — a corpus failure must never take the
library build down with it.

**Prototype of tier 1** (approved by Gyasi 2026-08-14):
`~/Documents/generated/chiron-ask-prototype.html` — rail with thread history + scope selector,
760px conversation column, grounded answer with source chips, dispatch action row, composer with
mic + model + persona pickers.
