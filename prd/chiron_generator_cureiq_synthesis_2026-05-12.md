# Chiron Generator Enhancements — CureIQ Synthesis PRD

**Date:** 2026-05-12
**Status:** DRAFT — umbrella roadmap; first sub-feature (Lesson Expander) has its own PRD at [`chiron_lesson_expander_2026-05-12.md`](./chiron_lesson_expander_2026-05-12.md)
**Owner:** Gyasi Sutton (solo)
**Related:** [`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md) (parent skill design), [`chiron_server_cms_2026-05-12.md`](./chiron_server_cms_2026-05-12.md) (sibling CMS PRD), prior art: [`gyasis/CureIQ`](https://github.com/gyasis/CureIQ) (Python MCQ ingestion system, 2024-2025)

**Delete when:** All sub-features (image-source adapter, RAG-source adapter, lesson expander, G5 rich-media adapters, G6 capture sidecar) ship and pass acceptance.

**Revision Log:**
- 2026-06-18 — G1 (image adapter) shipped (`skill/ingest-adapters/image.ts`). Added **G5 — Rich-media source adapters (video/audio/YouTube)** (§8) and **G6 — Phone-camera capture sidecar** (§9), synthesized from CureIQ's `image_capture.py` (0.0.0.0 upload server + `capture="environment"` mobile camera) and grounded in `mcp__gemini-mcp__watch_video`. G5 **video** slice built this session (see §8).

---

## 1. Executive Summary

This PRD extends Chiron's **generator side** (the Claude Code skill that produces lesson bundles) with three capabilities synthesized from the user's prior CureIQ project, plus one architectural integration with Chiron's multi-hop generation pipeline:

| Sub-feature | One-liner | Sub-PRD |
|---|---|---|
| **G1 — Image source adapter** | Ingest text-bearing images (e.g., AMBOSS page screenshots, textbook page photos, X-rays with captions) as a lesson source via OCR+vision LLM in one call | Inline in §5 |
| **G2 — RAG source adapter** | Generate a lesson from an existing RAG dataset (HybridRAG / DeepLake index) rather than re-ingesting from raw PDF every time | Inline in §6 |
| **G3 — Lesson expander** | Given an existing Chiron lesson, generate N more quiz items (MCQs / vignettes / fill-blanks) against the same source without re-generating the whole lesson | **Detailed in [`chiron_lesson_expander_2026-05-12.md`](./chiron_lesson_expander_2026-05-12.md)** |
| **G4 — Multi-hop integration** | Wire G1/G2/G3 into Chiron's existing 5-stage pipeline (INGEST → BRIEF → SYLLABUS → VALIDATE → BUILD → ASSEMBLE) so they compose | Inline in §7 |
| **G5 — Rich-media source adapters** | Ingest a **video** file or **YouTube URL** (and audio) as a lesson source — Gemini reads the video (transcript + visual) via `watch_video`; "throw a video, get a lesson/quiz" | Inline in §8 |
| **G6 — Phone-camera capture sidecar** | Start a small LAN server; pair your **phone camera** (book page, whiteboard) over the network; captured images flow straight into the image adapter. Synthesized from CureIQ's `capture="environment"` upload server | Inline in §9 |

All generator-side changes; the CMS PRD already handles the consumption side via the upload bundle protocol.

---

## 2. Context & Motivation

The Chiron skill currently has 5 source-ingestion adapters defined in `chiron_design_v1_2026-04-28.md` §10: `code-repo`, `pdf`, `url`, `transcript`, `vocab-list`. Three pain points the user hit during real use of CureIQ and that Chiron does not yet solve:

1. **AMBOSS / UpToDate pages screenshot easier than they download.** When studying, you snap a screenshot of a key AMBOSS page or take a phone photo of a textbook page. Today Chiron can't ingest that — you have to OCR it manually and feed text. CureIQ's `image_reader.py` solves this; Chiron should adopt that capability.

2. **Re-ingesting the same source from raw PDF every time is wasteful.** When a heavy clinical reference (Robbins, Harrison's) is already chunked and embedded in HybridRAG/DeepLake, Chiron should be able to draw from that index directly instead of re-walking the raw PDF.

3. **High-volume vignette generation needs incremental top-up.** `chiron_design_v1` §4 already locked the requirement that medicine lessons generate 15-20+ vignettes per topic. In practice you'll want to add another 10 vignettes to a *specific* topic 2 months later without regenerating the whole lesson. CureIQ's `MCQA_generator.py` is exactly this — given a corpus and an existing question set, emit N more questions.

Each is a generator-side capability; none of them require changes to the CMS server.

---

## 3. Architectural Locks (from CureIQ synthesis + the May 12 chat)

| # | Decision | Why |
|---|---|---|
| 1 | **Image input is OCR+vision in ONE call, not OCR-then-vision two-step** | AMBOSS pages are text-heavy with embedded tables, formulas, marginalia — extracting raw text alone loses structure. A vision-capable LLM (Gemini `interpret_image` already in Chiron's allowed-tools, or Claude with vision) reads both text AND layout in one pass. |
| 2 | **RAG source = a *named* source the user references, not a hidden search** | When user says "generate a lesson on pneumothorax FROM my Robbins index", `--source rag:robbins` is explicit. Chiron retrieves top-K chunks from that named index and treats them as the source corpus. No silent web search. |
| 3 | **Lesson expander preserves the original lesson** | Never mutates the existing `lesson.html`. Either (a) appends new vignettes to the same lesson's `.chiron-state.db` (via the CMS `/api/mark` regenerate flow → CMS triggers expander), or (b) generates a sibling lesson `<slug>-extra-N` that the CMS treats as a related lesson. v1 picks (a). |
| 4 | **Image and RAG adapters emit the same Brief schema as PDF/code-repo adapters** | Don't fork the pipeline. Adapters normalize to the unified Brief (locked in `chiron_design_v1` decision #3). New adapter implementations, same downstream stages. |
| 5 | **Lesson expander is invokable via slash-command + via CMS-flagged regeneration** | User CLI: `/chiron-expand <slug> --count 20 --type clinical-vignette`. CMS-driven: marked_cards rows with `mark_type='regenerate'` are picked up by a poll/manual run that calls the expander against the marked items' source. |

---

## 4. Phased Adoption Plan

Order chosen to maximize early value with minimum dependency:

| Phase | Feature | Why this order |
|---|---|---|
| **GP1** | G3 — Lesson Expander (own PRD) | Immediate utility (you have lessons today; you'll want more vignettes for any of them); no new ingestion surface required; uses existing source files in `lessons/<slug>/source/`. |
| **GP2** | G1 — Image source adapter | **✅ SHIPPED 2026-06-18** (`skill/ingest-adapters/image.ts`). Second-highest immediate utility (you screenshot AMBOSS pages constantly). Pure additive — new adapter file, no pipeline changes. |
| **GP3** | G5 — Rich-media (video/YouTube) | **video slice built 2026-06-18** (`skill/ingest-adapters/video.ts`). Same additive adapter→handoff pattern as G1; reuses `mcp__gemini-mcp__watch_video` (zero new Gemini plumbing). Audio is a small follow-on. |
| **GP4** | G2 — RAG source adapter | Depends on a stable HybridRAG/DeepLake index for the source domain you care about. Comes after you've built up an index worth pulling from. |
| **GP5** | G6 — Phone-camera capture sidecar | **✅ BUILT 2026-06-18** as a standalone Node server (`skill/scripts/capture-server.mjs`) — LAN server + phone-camera page + capture + inbox hand-in; 6 integration tests. (Tauri embedding deferred — not needed for the working feature.) |
| **GP6** | G4 — Multi-hop integration | Once the source adapters individually work, integrate so one lesson generation can draw from PDF + image + video + RAG + expanded-from-prior-lesson in one pipeline. |

---

## 5. G1 — Image Source Adapter

### Goal
Accept one-or-more images as the source for a lesson. Images may be: a screenshot of an AMBOSS / UpToDate / Wikipedia page (text-heavy), a textbook page photo, a hand-drawn diagram with annotations, a labeled radiograph, a structured-form image (CHA2DS2-VASc score sheet).

### Adapter contract
File: `chiron/skill/ingest-adapters/image.ts`. Reads a list of image paths, returns a `Brief` (same shape as other adapters per `chiron_design_v1` §3 decision 3).

```typescript
interface ImageSourceOpts {
  paths: string[];           // absolute or relative paths to image files
  domain_hint?: string;      // 'medicine' | 'code' | 'language-...' | 'research-paper'
  caption_hint?: string;     // user-supplied 1-line caption per call ('AMBOSS page on pneumothorax')
}
```

### Implementation pattern
Use the vision-capable LLM already in Chiron's allowed-tools list (`mcp__gemini-mcp__interpret_image`) with a structured extraction prompt that returns:

```typescript
interface ImageExtraction {
  full_text: string;                 // OCR'd text, in reading order
  structural_blocks: Array<{          // tables, bullet lists, etc.
    type: 'paragraph' | 'table' | 'bullet_list' | 'figure_caption' | 'callout';
    content: string;
  }>;
  detected_entities: Array<{          // medicine: drug names, anatomy; code: function names
    type: string;
    text: string;
    salience: 'high' | 'medium' | 'low';
  }>;
  inferred_domain: string;            // LLM's guess at domain (sanity check vs domain_hint)
  source_provenance: string;          // 'AMBOSS' | 'UpToDate' | 'Wikipedia' | 'textbook' | 'handwritten' | 'unknown'
}
```

The Brief is then assembled from the merged `full_text` + `structural_blocks` of all images, with `detected_entities` feeding the concept-extraction stage.

### Functional Requirements

- **FR-G1-001** — `ImageSourceAdapter.ingest(opts)` accepts JPEG, PNG, WEBP, HEIC (via conversion). Each image MUST be ≤8MB; total batch ≤32MB.
- **FR-G1-002** — Each image is run through `mcp__gemini-mcp__interpret_image` with the structured-extraction prompt; output is parsed by zod schema; failures retry once then surface to user.
- **FR-G1-003** — For text-heavy images (e.g., AMBOSS page), `full_text` MUST capture ≥90% of visible legible text (manual spot-check during build).
- **FR-G1-004** — `source_provenance` field detects AMBOSS / UpToDate styles when present; this gates the medical sub-mode selection in `chiron_design_v1` §5.2 (AMBOSS-style vs UpToDate-style lesson output).
- **FR-G1-005** — All source images MUST be copied into `lessons/<slug>/source/images/` and referenced in `manifest.json.source_meta.images[]`. Preserves traceability + allows the lesson-expander (G3) to re-read the original images.

### Non-Functional Requirements

- **NFR-G1-001** — End-to-end ingestion of 5 typical AMBOSS-screenshot images completes in <90s.
- **NFR-G1-002** — Cost per image ≤$0.05 at default model (Gemini 1.5 Pro vision tier). Logged via existing `llm_usage` table.
- **NFR-G1-003** — Adapter MUST work offline if user passes pre-extracted text via `paths: [...] + override_text: "..."` — used in tests + when API is down.

### User Stories

- **US-G1-101** — As a med student, when I snap an AMBOSS page screenshot, I want to point Chiron at it and get a full lesson without manually transcribing the text.
- **US-G1-102** — As a learner, when I have 4 screenshots from different AMBOSS pages on the same disease, I want to feed them all at once and get a unified lesson.
- **US-G1-103** — As a user, I want the original images preserved in the lesson bundle so I can re-process them or audit what Chiron read.

---

## 6. G2 — RAG Source Adapter

### Goal
Generate a Chiron lesson from a named RAG dataset that the user has already built (HybridRAG / DeepLake / Athena-LightRAG indexes available via local MCP servers).

### Adapter contract
File: `chiron/skill/ingest-adapters/rag.ts`.

```typescript
interface RagSourceOpts {
  index_name: string;                 // e.g., 'robbins-pathology' — must match a configured RAG endpoint
  query: string;                      // 'pneumothorax — types, presentation, management'
  retrieval_strategy: 'hybrid' | 'semantic' | 'keyword' | 'multi_hop';
  top_k?: number;                     // default 30
  expand_neighbors?: boolean;         // pull adjacent chunks for context (default true for textbook indexes)
}
```

### Implementation pattern
The adapter is a thin orchestration over the existing RAG MCP servers (already in Chiron's environment):
- `mcp__athena-lightrag__lightrag_hybrid_query` or `lightrag_multi_hop_reasoning`
- `mcp__deeplake-rag__retrieve_context` (with the index name)
- `mcp__hybridrag__*` if available

Returns a `Brief` whose body is the concatenated retrieved chunks (deduped, ordered by source page where available).

### Functional Requirements

- **FR-G2-001** — `RagSourceAdapter.ingest(opts)` MUST validate `index_name` against a project-local registry (`chiron/skill/rag-registry.json`) listing which MCP server backs which named index. Unknown index = hard fail with the registry contents shown.
- **FR-G2-002** — Default retrieval = `hybrid` with `top_k=30, expand_neighbors=true` — same defaults as the user's CureIQ flow when generating from textbook chapters.
- **FR-G2-003** — Retrieved chunks MUST carry source provenance: `{ source: 'robbins-pathology', page: 1234, score: 0.87, chunk_id: 'rb-12-04' }`. This metadata flows through to the lesson manifest for citation-on-hover.
- **FR-G2-004** — Adapter MUST cap retrieval cost at $1.00 per generation (RAG MCP servers track their own usage; adapter aborts and asks user if exceeded).

### Non-Functional Requirements

- **NFR-G2-001** — End-to-end retrieval + Brief assembly in <30s for a 30-chunk pull.
- **NFR-G2-002** — RAG registry is a flat JSON file the user maintains; no live MCP-discovery at generation time.

### User Stories

- **US-G2-101** — As a learner who has built a Robbins pathology RAG index, I want to type `/chiron-medicine "pneumothorax management" --source rag:robbins-pathology` and get a lesson grounded in that index rather than starting from a fresh PDF.
- **US-G2-102** — As a user, I want every fact in the generated lesson to carry a hover-tooltip showing which page of Robbins it came from (citation traceability).

---

## 7. G4 — Multi-hop Integration

### Goal
Let a single lesson draw from multiple source adapters in one generation run. E.g., "generate a pneumothorax lesson from THIS AMBOSS image + THIS RAG index + THIS prior lesson's existing vignettes."

### Implementation pattern
Extend Chiron's STAGE 0 INGEST (per `chiron_design_v1` §9.1) to accept an array of source-spec entries:

```typescript
type SourceSpec =
  | { type: 'pdf'; path: string }
  | { type: 'code-repo'; path: string }
  | { type: 'url'; url: string }
  | { type: 'transcript'; path: string }
  | { type: 'vocab-list'; path: string }
  | { type: 'image'; paths: string[]; domain_hint?: string }                // G1
  | { type: 'rag'; index_name: string; query: string; top_k?: number }      // G2
  | { type: 'prior-lesson'; slug: string; include: 'all' | 'concepts' | 'cards' };  // G3

interface MultiSourceBrief {
  sources: SourceSpec[];
  merged_text: string;
  merged_concepts: Concept[];
  merged_entities: Entity[];
  provenance_map: Record<string, SourceSpec>;  // entity-id → which source it came from
}
```

The BRIEF stage merges adapter outputs, deduplicates concepts/entities, and preserves a provenance map for downstream citation.

### Functional Requirements

- **FR-G4-001** — INGEST stage MUST accept an array `sources: SourceSpec[]` of 1-10 sources.
- **FR-G4-002** — All adapters MUST emit a normalized intermediate before merge (existing Brief shape from `chiron_design_v1` decision #3).
- **FR-G4-003** — Merged Brief MUST preserve per-fact provenance — every concept and every quiz item generated downstream can be traced to its originating source.
- **FR-G4-004** — On adapter conflict (same fact, different sources, different content), the merged Brief MUST flag it as `conflict: true` in the entity list and the BUILD stage MUST surface it as a "note: sources disagree on X" callout in the lesson HTML.

---

## 8. Generator-Side Schema Additions

For the generator (Chiron skill), the manifest gets new optional fields. These are emitted on upload and consumed by the CMS (which already handles them per the server PRD's FR-027):

```typescript
interface Manifest {
  // existing fields per chiron_design_v1 §8 unchanged
  slug: string;
  title: string;
  domain: string;
  generated_at: string;
  chiron_version: string;

  // NEW (this PRD)
  sub_subject?: string;                    // 'cardiology' | 'pulmonology' | etc.
  sources?: SourceSpec[];                  // for traceability + lesson expander
  source_meta?: {
    images?: string[];                     // relative paths within bundle
    rag_indexes?: string[];                // names of RAG indexes pulled from
    prior_lessons?: string[];              // slugs of lessons used as priors
  };
}
```

---

## 9. Buildout Plan

Each sub-feature is a 1-3 day build. Order:

| Phase | Days | Feature | Validation |
|---|---|---|---|
| **GP1** | 2 days | G3 Lesson Expander | Detailed in [`chiron_lesson_expander_2026-05-12.md`](./chiron_lesson_expander_2026-05-12.md) |
| **GP2** | 2 days | G1 Image Source Adapter | Generate a lesson from 5 AMBOSS-page screenshots; full_text capture ≥90%; manifest preserves source images |
| **GP3** | 1 day | G2 RAG Source Adapter | Generate a lesson from a named HybridRAG index with citation provenance |
| **GP4** | 1 day | G4 Multi-hop Integration | Single command generates a lesson from image + RAG + prior-lesson in one run |

**Total: ~6 days of focused work**, sequenced after server PRD P0.5 ships.

---

## 10. Intentionally Deferred

- **Audio source adapter** — podcast / lecture audio → transcribe → lesson. Defer until use case is concrete (Chiron already has a `transcript` adapter that accepts pre-transcribed text).
- **Video source adapter** — YouTube lecture → keyframes + transcript → lesson. Defer to v2.
- **Live OCR via webcam** — point camera at a textbook page in real time. Defer indefinitely.
- **RAG index auto-creation** — Chiron building its own RAG index from a folder of PDFs. Out of scope; that's a separate "ChiranRAG" tool if ever.
- **Mutating an existing lesson's HTML in place** — G3 explicitly appends new cards to the same DB but does not edit the chapter prose. In-browser lesson editing is a v2 concern.
- **Cross-language source merging** — e.g., generate a single lesson from a German PDF + an English RAG index. Domain stays per-language.

---

## 11. Open Questions

| # | Question | How to resolve |
|---|---|---|
| 1 | For text-bearing images (AMBOSS), is single-call vision-LLM extraction better than dedicated OCR (tesseract) + separate vision pass? | Phase GP2 — test both on 10 AMBOSS screenshots, measure full-text capture rate and structural fidelity |
| 2 | Does `mcp__gemini-mcp__interpret_image` accept multi-image batches or only one-at-a-time? | Check during GP2 |
| 3 | What happens to a lesson's `.chiron-state.db` when the expander adds 10 new SR cards mid-life — does SM-2 ease-factor inheritance need a starting hint? | GP1 — start new cards at default `ease_factor=2.5, interval_days=0, repetitions=0`, accept they enter the queue immediately |
| 4 | Should the RAG adapter use the existing Anthropic SDK with grounding, or call MCP RAG tools? | GP3 — prefer MCP (already configured per-user); SDK is the fallback if MCP unavailable |
| 5 | Multi-source provenance display in lesson.html — hover tooltips, footer citations, or marginalia? | GP4 — start with hover tooltips, revisit |

---

## 12. Decisions Log

| Time | Decision | Rationale |
|---|---|---|
| 2026-05-12 | Generator enhancements ARE a separate PRD from the server CMS | Two distinct concerns: this PRD = ingestion + generation pipeline; server PRD = hosting + review. Clean separation. |
| 2026-05-12 | Image input uses single-call vision LLM, not OCR-then-vision two-step | AMBOSS pages are text-heavy with structure (tables, marginalia); single-call captures layout context one-shot |
| 2026-05-12 | Lesson expander gets its OWN sub-PRD (`chiron_lesson_expander_2026-05-12.md`) | High user demand, focused scope, implementable first and independently |
| 2026-05-12 | RAG source adapter requires a project-local registry of named indexes | Avoid live MCP-discovery surprises; explicit > implicit |
| 2026-05-12 | All adapters emit the same Brief shape | Locked in `chiron_design_v1` decision #3 — preserve unification |

---

## 13. References

- [`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md) — parent skill design (5-stage pipeline, Brief schema, source adapter philosophy)
- [`chiron_server_cms_2026-05-12.md`](./chiron_server_cms_2026-05-12.md) — sibling CMS PRD (consumes the bundles this PRD's enhancements produce)
- [`chiron_lesson_expander_2026-05-12.md`](./chiron_lesson_expander_2026-05-12.md) — G3 detailed sub-PRD
- [`universal_lesson_generator_2026-04-28.md`](./universal_lesson_generator_2026-04-28.md) — project tracking PRD (index of all PRDs)
- [`gyasis/CureIQ`](https://github.com/gyasis/CureIQ) — prior art repo (Python, June 2025), specifically:
  - `app/models.py` — Question / UserPerformance / StudySession / MarkedQuestion schemas
  - `data_processing/MCQA_generator.py` — MCQ generation pipeline (inspiration for G3)
  - `data_processing/image_reader.py` — image-to-text pipeline (inspiration for G1)
- `mcp__gemini-mcp__interpret_image` — vision-LLM tool already in Chiron's allowed-tools list
- `mcp__athena-lightrag__*`, `mcp__deeplake-rag__*` — RAG MCP servers for G2

---

## 8. G5 — Rich-media source adapters (video / YouTube / audio)

### Goal
Accept a **video file** or a **YouTube URL** (and, as a follow-on, an audio file)
as the source for a lesson. "Throw a video at chiron and get a lesson or a set of
MCQs." Gemini reads the media — transcript + visual content — and the extracted
text feeds the normal pipeline like any other source.

### Architectural fit (the key finding)
chiron already has the exact machinery: a **deterministic adapter emits a handoff
sidecar; the parent Claude agent fulfills it via Gemini MCP** (this is how
scanned-PDF/image vision works today). Rich media needs **zero new Gemini
plumbing** — `mcp__gemini-mcp__watch_video` already handles every transport:
- **YouTube URL** → `Part.from_uri(url)` passed straight to Gemini (no download)
- **local <20MB** → inline; **>20MB** → File API upload + auto-poll
- returns transcript + visual summary; supports time-range prompts ("summarize 1:00–1:30")

So the adapter only points at the source and names the tool. `interpret_image`
(G1) covers the book-page-photo case already.

### Adapter contract
File: `skill/ingest-adapters/video.ts`. Accepts one local video path OR a YouTube
URL, returns a `Brief` (same shape as all adapters). Writes a single handoff to
`<lesson-output-dir>/.scratch/vision-handoffs.json` (the sidecar the pipeline
already reads):
```
{ source, isYouTube, mcpTool: 'mcp__gemini-mcp__watch_video', prompt }
```
Local files are copied into `source/` (FR-030); YouTube URLs are NOT downloaded
(`sourceCopiedTo: null`). `recordVideoResult(briefPath, analysis)` folds the
returned analysis back into the Brief (clears `<PENDING-VISION-HANDOFF>`).

### Functional Requirements
- **FR-G5-001** — `ingestVideo` accepts `.mp4/.mov/.webm/.mkv/.avi/.m4v/.mpeg/.mpg`
  and any `youtube.com`/`youtu.be` URL; unknown extension hard-fails.
- **FR-G5-002** — exactly one `watch_video` handoff per video; the Stage-0 driver
  (`prompts/00-ingest/video.md`) fulfills it and folds the result in.
- **FR-G5-003** — base extraction prompt yields transcript + visual summary +
  a `SUBJECT:` line; medicine domain classifies subject via CureIQ's
  body-system/topic/specialty taxonomy (from `image_reader.py`).
- **FR-G5-004** — `SourceType` gains `'video'`; `SourceFileEntry.extractor` gains
  `'vision-video'`; `bundle.ts` dispatches video extensions.
- **FR-G5-005** — extracted text is treated as untrusted (prompt-injection
  isolation, FR-016), same as image vision output.

### Status (2026-06-18)
**Video slice BUILT** on branch `feat/rich-media-ingest`: `video.ts`,
`SourceType 'video'` + `vision-video` extractor, `bundle.ts` dispatch,
`pipeline.ts` handoff case, `prompts/00-ingest/video.md`, and
`tests/video-adapter.test.ts` (5 tests, green; tsc clean).

**Audio slice BUILT** (same branch): `audio.ts`, `SourceType 'audio'` +
`whisper-audio` extractor, `bundle.ts` dispatch, `pipeline.ts` case,
`prompts/00-ingest/audio.md`, `tests/audio-adapter.test.ts` (4 tests, green).
Transcription is **LOCAL via the Atelier whisper sidecar** (mlx-whisper on the
Mac Studio, `http://192.168.0.159:8766/transcribe`, model alias `large-v3` =
heaviest/most-accurate; `turbo` = fast) — NOT gemini/MCP. The user has whisper;
no cloud needed (local-first). Endpoint/model overridable via
`CHIRON_WHISPER_URL` / `CHIRON_WHISPER_MODEL`. **End-to-end verified**: omnivoice
TTS → whisper round-trip returned the phrase verbatim (`{text,language,segments}`,
confidence 0.78, 1.5s). watch_video was ruled out for audio — it hard-guards
`video/` mime and gemini-mcp exposes no audio tool (verified in server.py).

---

## 9. G6 — Phone-camera capture sidecar (the "see a book page" inbox)

### Goal
Point your **phone camera** at a real book page / whiteboard / screen and have
the image flow straight into chiron's image adapter — the original purpose of
CureIQ's capture server. This is "a few skills" of work: a running service +
phone pairing + camera capture + hand-in. It is **deliberately out of the
serverless single-file core** — its home is the **Tauri shell** (`chiron-tauri/`).

### Prior art (CureIQ, to port)
`web/api/image_capture.py` → `ImageCaptureGateway` ran a FastAPI server on
`host="0.0.0.0", port=5667`; `web/templates/upload.html` had a **Mobile Upload**
block with `<input type="file" accept="image/*" capture="environment">` (opens the
phone's rear camera). Flow: phone → server page → snap → `POST /process-image/`
→ vision OCR → ingest.

### Component breakdown ("the few skills")
1. **Capture server** — small local HTTP service bound to the LAN (Tauri-hosted,
   or a `chiron capture` skill), serving an upload page + `POST /capture`.
2. **Phone pairing** — show a QR code / `http://<lan-ip>:<port>` so the phone
   joins; reuse the LAN-host patterns from home-infra notes.
3. **Camera capture UI** — the `capture="environment"` mobile page (+ desktop
   drag-drop + clipboard-paste, as CureIQ had).
4. **Hand-in to ingest** — captured image lands in a watched inbox dir →
   `ingestImage` runs → lesson/quiz generation (or G3 lesson-expander top-up).

### Functional Requirements (draft)
- **FR-G6-001** — `chiron capture start` launches the LAN server, prints the
  pairing URL/QR, and a watched inbox dir under the lesson workspace.
- **FR-G6-002** — uploaded images are validated (type/size), copied to the
  inbox, and routed through `ingestImage` (G1) — no duplicate vision code.
- **FR-G6-003** — single-learner / LAN-only by default (no auth, no exposure
  beyond localhost/LAN); matches chiron's "single learner = Gyasi" lock.
- **FR-G6-004** — graceful when offline / no phone: desktop drag-drop +
  clipboard-paste fallbacks (CureIQ's `ClipboardImageReader` parity).

### Status (2026-06-18)
**BUILT** on branch `feat/capture-sidecar` — as a **standalone Node server**
(`skill/scripts/capture-server.mjs`), NOT Tauri. Rationale: chiron's stack is
Node/TS and `.mjs` is the runnable-script convention; a zero-dependency
`node scripts/capture-server.mjs` delivers the working feature without a
Rust/desktop build. Tauri embedding is a later nicety, not a prerequisite.

Delivered against the component breakdown:
1. **Capture server** ✅ — dependency-free `node:http`, binds `0.0.0.0:<port>`
   (default 8788), LAN-only, no auth (FR-G6-003). Raw-body uploads (no multipart
   parsing, no deps); mime + size validation (FR-G6-002, default 25MB cap), early
   `Content-Length` reject + unlink-on-abort.
2. **Phone pairing** ✅ — prints reachable LAN URLs on start, real home-LAN IPs
   ranked first (docker/VM bridges last) so the QR targets a reachable address.
   Optional terminal QR via lazy `qrcode` import (graceful if absent).
3. **Camera capture UI** ✅ — mobile-first page with `capture="environment"`
   (rear camera) + gallery + desktop drag-drop + clipboard-paste; live thumbnails
   + running count.
4. **Hand-in to ingest** ✅ (decoupled) — captures land in the inbox dir; the
   server prints the exact `chiron --source <inbox>` (image-folder/G1) command
   and exposes `GET /list`. An `onCapture` hook is available for auto-ingest
   wiring later. Kept decoupled from the TS pipeline (observable, build-free).

Tests: `skill/tests/capture-server.test.mjs` (6 integration tests — page serve,
capture+save, list, mime reject 415, oversize reject 413, health). Live CLI
smoke confirmed: LAN URL banner + capture round-trip.

**Deferred (follow-ons):** auto-ingest on capture (wire `onCapture` → `ingestImage`
→ pipeline); a desktop QR rendered in-page; Tauri shell embedding;
`HEIC→jpg` transcode for older iPhones (currently stored as-is).

---

## 14. Speckit handoff

This PRD is structured for `/speckit-specify` ingestion. Each sub-feature (G1/G2/G3/G4) has its own FR/NFR/user-story block (G3 in a sibling PRD). After TTS fix and server CMS P0.5 ships, run `/speckit-specify` against this PRD scoped to ONE sub-feature at a time, generate per-feature `spec.md` + `plan.md` + `tasks.md`, build incrementally.

**Recommended order for speckit invocation:** G3 (lesson expander, own PRD) → G1 (image adapter ✅) → G5 (rich-media: video ✅ / audio) → G2 (RAG adapter) → G6 (capture sidecar, Tauri) → G4 (multi-hop integration).
