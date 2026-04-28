# Phase 0 Research — Chiron v1

**Branch**: `001-chiron-v1` | **Date**: 2026-04-28
**Plan**: [`plan.md`](./plan.md) | **Spec**: [`spec.md`](./spec.md)

The PRD locks 12 architectural decisions in §3 and the spec inherits all of them; the clarification session resolved 5 more. The remaining unknowns are narrow and listed below. None block Phase 1 design — they are flagged here so Phase 4/5 implementers don't re-litigate them.

---

## R-01: TTS provider for Italian native-speaker persona (Maria)

**Decision**: Default to **Gemini TTS**; fall back to ElevenLabs if voice quality is insufficient during Phase 3 testing.

**Rationale**:
- Gemini TTS is already part of the user's active toolkit (rules in `~/.claude/rules/tools/gemini.md`); no new account/API integration friction.
- The "fallback to ElevenLabs" path is documented in PRD §14 Q4 as the resolution path for this exact uncertainty.
- Italian phonetics are well-supported by both providers; the deciding factor is naturalness, not coverage.

**Alternatives considered**:
- **ElevenLabs as default** — better voice quality reputation, but extra account/billing setup the solo user doesn't already have. Defer unless Gemini fails the ear test.
- **OpenAI TTS** — not in the user's existing tool inventory; no advantage over Gemini.
- **No TTS / text-only Maria** — would gut the language-domain UX (FR-019 acceptance scenario 2 explicitly requires TTS-voiced dialogue).

---

## R-02: Concrete library for the `MoleculeRenderer` interface

**Decision**: **DEFERRED** to Phase 4 prototyping (FR-031, Clarification Q5). Code targets the abstract `MoleculeRenderer` interface; both candidates (Kekule.js and RDKit-JS) are evaluated against the metformin SMILES test in Phase 4.

**Rationale**:
- The user explicitly chose deferral over locking now (Clarification Q5 → C).
- The deferral is safe because every consumer goes through `lib/chemistry-renderer.ts`'s `MoleculeRenderer` interface; swapping the implementation later is a single-file change.
- Phase 4 medicine work is when the first real test molecule exists, so the prototype is naturally co-located with the use case.

**Phase 4 prototype rubric** (resolves the deferral):
1. Bundle size (gzipped, no editor / read-only mode).
2. Time-to-first-render for the metformin SMILES on a typical laptop.
3. SMILES coverage — render at least 20 representative cardiology / pulm / antibiotics drugs without errors.
4. License compatibility (both candidates are permissive; this is a sanity check).

**Alternatives considered**:
- **Lock Kekule.js now** — has an editor mode that's overkill for read-only display; bundle size higher.
- **Lock RDKit-JS now** — battle-tested in production drug-discovery tools; reasonable default but Clarification Q5 explicitly chose deferral.
- **Drop molecule-2d entirely** — would weaken the medicine domain's pharm/chem coverage; rejected.

---

## R-03: Pyodide bundling strategy for `code-runner` widget

**Decision**: **Lazy-load Pyodide from CDN** when a chapter actually contains a `code-runner` widget with `runtime: 'pyodide'`. Do NOT bundle Pyodide into the lesson HTML (≈8MB); do NOT eagerly load.

**Rationale**:
- Most code lessons are TS/JS (run natively in the browser). Pyodide is needed only when the source repo is Python.
- Bundling Pyodide into every `lesson.html` would balloon the file size and violate the "open `index.html` and it works offline" promise — but lazy CDN load only runs when the widget is actually exercised, and the lesson without it still renders fully.
- This matches PRD §3 #11 ChalkAI on-demand pattern (load runtime only when widget type requires it).

**Alternatives considered**:
- **Bundle Pyodide always** — kills offline-of-everything promise (8MB self-contained); rejected.
- **Drop Pyodide / Python from v1** — would reduce code-domain depth (Python tutorials are common); rejected.
- **Use a remote Python sandbox (Pyodide.org / Modal)** — phones home, violates Constitution V; rejected.

**Impact on FR-009 / FR-027 / SC-005**: The "open without a server, no build step" requirement holds — the lesson HTML still opens and renders content. Only the `code-runner` widget's *Python execution* needs the CDN; if the user is offline, the code-runner widget falls back to a "Pyodide unavailable" message and the rest of the lesson works.

---

## R-04: PDF text extraction approach (REVISED 2026-04-28 by Clarification Q6 + Q7)

**Decision**: Two-layer extraction.
1. **Text-layer first** — try `pdfjs-dist` extraction in `pdf.ts`. If the PDF has a usable text layer (>50 chars on the first non-cover page), use it.
2. **Vision fallback via Gemini `interpret_image` MCP** — if no text layer, rasterize each page to an image (e.g. `pdf-to-img`) and call `mcp__gemini-mcp__interpret_image` per page (FR-032 b, FR-033).

**Rationale (revised)**:
- Original "no OCR / fail fast" decision (R-04 v1) was reversed by Q6: textbook chapters routinely arrive as scanned PDFs and v1 must handle them.
- Initial revision used Anthropic vision; **superseded** by Q7: user explicitly chose Gemini `interpret_image` MCP, aligning with the existing Gemini-as-paired-partner toolchain (`~/.claude/rules/tools/gemini.md`).
- Gemini's `interpret_image` accepts an image path and returns text + structured analysis — perfect for page extraction and figure interpretation in one call.
- No Constitution V violation: Gemini is already in the user's local toolchain (and used for Italian TTS per R-01); no new vendor introduced.
- Vision cost is logged in `llm_usage` with `provider='gemini'` (FR-014, FR-033). Cost-estimate prompt counts image pages × Gemini interpret_image rate.

**Alternatives reconsidered**:
- **Local Tesseract.js** — still rejected (accuracy, language coverage, bundle size).
- **Cloud OCR vendors** (Google Document AI, AWS Textract) — still rejected (new vendors).
- **Anthropic vision (in-SDK)** — was the interim choice but **rejected per Q7** in favor of Gemini interpret_image. Anthropic remains the text-LLM gateway for content generation; it does NOT do vision in Chiron.

---

## R-09: Image / page-image-folder / mixed-bundle ingest

**Decision**: Add three new ingest adapters — `image.ts`, `multi-pdf.ts`, `bundle.ts` — plus extend `pdf.ts` (R-04 revised) to cover the 12 source types in FR-032.

**Per-adapter behavior**:

| Adapter | Source types (FR-032) | Behavior |
|---|---|---|
| `pdf.ts` | (a) text-PDF, (b) scanned-PDF | Try text layer via `pdfjs-dist`; on miss, rasterize each page and call Gemini `interpret_image` MCP per page. |
| `image.ts` | (c) image folder, (d) single image | Send each image to Gemini `interpret_image` MCP; preserve order by filename (alphabetic). |
| `multi-pdf.ts` | (e) multi-PDF chapter | Process each PDF via `pdf.ts`; concatenate extracted text in supplied order; preserve per-file provenance in `Brief.sourceManifest[]`. |
| `url.ts` | (i) URL, (j) standalone HTML file | Fetch (or read from disk) → sanitize HTML → text-extract. |
| `agent-report.ts` | (k) agent-generated markdown/JSON | Treat as `secondary` source; populate `Brief.agentSourceProvenance`; refuse if it would be the sole source for medicine domain (FR-035). |
| `bundle.ts` | (l) mixed-source folder | Walk folder; dispatch each recognized file to its adapter (images → `image.ts` → Gemini interpret_image); honor `chiron.manifest.json` if present; emit ordered concatenation. |

**Rationale**:
- Vision-based extraction unifies under one provider (Anthropic) and one logging path (`llm_usage`).
- Per-file provenance (`sourceManifest[]`) preserves auditability — generated content can cite the originating file when needed.
- `bundle.ts` is the only adapter that calls *other* adapters; the rest are leaf adapters. This keeps the dispatch graph shallow.
- Manifest is **optional** — implicit dispatch by file extension covers 90% of cases. Manifest is the escape hatch for "this PDF is the appendix, that PDF is the main chapter."

**Alternatives considered**:
- **One mega-adapter** that introspects everything itself — rejected; per-source-type code is clearer and maps 1:1 to FR-032 slots.
- **No manifest, only alphabetic order** — rejected; users will want to override order without renaming files.
- **Defer mixed bundles to post-v1** — rejected; the user explicitly asked for "support all" in Clarification Q6.

---

## R-10: ~~Cost-estimate model for vision-heavy ingests~~ (REMOVED 2026-04-28 by Clarification Q8)

Reversed. There is no in-tree cost guard (Q8 dropped FR-015 / SC-010). Cost visibility is whatever Claude Code surfaces for the parent session and whatever the Gemini MCP server prints inline when `interpret_image` is called. The user is in control and can interrupt.

What replaces this: **transparent pre-flight visibility**. Stage 0 progress reporting (FR-028) MUST announce the image count up front (e.g. `[stage 0/5] ingest: scanned-PDF (32 pages — 32 interpret_image calls follow)`) so the user can interrupt before a heavy run starts. That's the new guardrail — agent-mediated, user-controlled, no in-tree budget logic.

---

## R-11: Gemini MCP toolset reference (NEW 2026-04-28 by Clarification Q8)

**Decision**: SKILL.md MUST enumerate the Gemini MCP tools available, per FR-036. The buildout agent should not have to re-discover them.

| MCP tool | Stage | Frequency |
|---|---|---|
| `mcp__gemini-mcp__interpret_image` | Stage 0 (vision extract) | Heavy when source has images |
| `mcp__gemini-mcp__gemini_research` | Stage 4 (chapter gap-fill) | Rare |
| `mcp__gemini-mcp__start_deep_research` (+ `check_research_status`, `get_research_results`, `save_research_to_markdown`) | Anywhere — opt-in only, ≤1/lesson (FR-029) | Never default; on user request only |
| `mcp__gemini-mcp__estimate_research_cost` | Pre-flight before deep research | Optional companion to `start_deep_research` |
| `mcp__gemini-mcp__gemini_brainstorm` | Stage 2 / Stage 4 (when stuck) | Sparingly |
| `mcp__gemini-mcp__gemini_code_review` | Stage 4 (code domain only) | Per-chapter sanity check |
| `mcp__gemini-mcp__ask_gemini` | Anywhere | Last resort |
| `mcp__gemini-mcp__watch_video` | (Future) | Reserved for post-v1 video-source support |

Other MCP servers (notably `mcp__context7-mcp__query-docs` for library docs in code lessons) are also available; SKILL.md should mention the pattern even if not exhaustively list every server.

---

## R-12: Vendored runtime libraries (NEW 2026-04-28 by Clarification Q9)

**Decision**: All small runtime libraries (MathJax + mhchem, Mermaid, the chosen MoleculeRenderer, forest-plot mini-lib, codebase-to-course shell + theme tokens) are vendored into `chiron/skill/shell/vendor/` and inlined into `lesson.html` at Stage 5 Assemble. **Pyodide is the only exception** (~8MB; lazy CDN per R-03).

**Rationale**:
- Constitution V (self-contained local output, zero telemetry) requires it. CDN scripts are soft phone-home — the CDN sees the user's IP every time they re-open a lesson.
- Reproducibility — a lesson generated today opens identically 5 years from now even if a CDN goes dark or a library breaks an API.
- Library version updates become explicit (rebuild vendor/ from a pinned version), not silent (CDN rolls a new version under us).
- Vendored MathJax + Mermaid are well under 1MB combined; inline cost is negligible compared to lesson content.

**Alternatives considered**:
- **All from CDN** — rejected; soft telemetry, link-rot risk.
- **Hybrid (small libs CDN, Pyodide deferred)** — rejected; same telemetry concern as full-CDN.
- **Vendor Pyodide too** — rejected; 8MB inline per lesson is impractical and the `code-runner` widget is rare.

**Implementation note**: `shell/build.sh` reads `shell/vendor/*` and inlines them as `<script>` / `<style>` blocks in the assembled `lesson.html`. Library updates are manual: drop a new version into `shell/vendor/<lib>/`, document the version in `shell/vendor/README.md`, and re-test against the 4 golden inputs.

---

## R-05: Per-stage progress reporting mechanism

**Decision**: Plain text `stderr` lines with structured prefixes (`[stage 2/5] syllabus: …`, `[stage 4 chapter 3/8] writing chapter…`), emitted from the skill runtime. The Claude Code session displays them inline. No TUI library, no progress bar, no JSONL stream.

**Rationale**:
- Satisfies FR-028 / SC-012 (no >30s silence) without a new dependency.
- The user runs Chiron interactively from Claude Code; stderr lines surface naturally.
- A TUI library (ora, listr2) adds a dependency and breaks redirect-friendliness.

**Alternatives considered**:
- **JSONL stream** — useful for downstream tooling but the audience is one human; YAGNI.
- **`listr2` / `ora` spinners** — pretty but adds dep; rejected.
- **Silent generation + post-run summary** — explicitly violates the soft-cap-with-progress decision (Clarification Q3).

---

## R-06: LLM model selection per stage (REVISED 2026-04-28 by Clarification Q8)

**Decision (revised)**: **Whatever model the parent Claude Code session is running on.** Chiron does not select per-stage models because Chiron does not make direct SDK calls (Q8). The parent agent uses its own context to execute every stage of the skill.

**Rationale (revised)**:
- Q8 reversed PRD §11 — there is no `lib/llm.ts`, no per-stage model selector, no Anthropic SDK dep.
- The user runs Chiron from a Claude Code session whose model they've already chosen (Opus, Sonnet, or Haiku). That model executes the whole pipeline.
- If a stage genuinely needs different reasoning (e.g. medicine QUEST-AI verifier benefits from extended thinking), the user can manually switch sessions or use `/fast` to toggle. This is a feature: the user remains the model-selection arbiter.
- For tasks where Gemini's strengths help (image extraction, secondary-topic deep research, brainstorm), Chiron explicitly invokes Gemini via MCP per FR-036.

**Alternatives considered**:
- **Original R-06 (Sonnet/Opus/Haiku per stage via SDK)** — rejected by Q8.
- **Hardcode "use Opus for syllabus" via re-prompting** — futile if user is on Sonnet; Chiron can't override the parent model.
- **Make Chiron a Node CLI with its own SDK + keys** — explicitly rejected by Q8; user wants pure skill.

---

## R-07: SM-2 vs FSRS for spaced repetition

**Decision**: **SM-2** in v1 (~50 LOC, Wikipedia-quality reference impl). Re-evaluate FSRS post-v1 if SR effectiveness data (review-log analysis) suggests it's worth the complexity.

**Rationale**:
- PRD §3 (locked decision context) and §5.5 explicitly say "SM-2 algorithm in `lib/sr-scheduler.ts` (~50 LOC)."
- FSRS is more accurate but ~10× the implementation; not justified for v1 single learner.
- The data captured in `sr_review_log` (FR-013) is sufficient to retrofit FSRS later without losing history.

**Alternatives considered**:
- **FSRS** — better long-term accuracy; deferred per PRD locked decision.
- **Anki-only** — explicitly rejected by PRD/Constitution: SR review must be inline in the lesson HTML, not require app-switching.

---

## R-08: Schema migration strategy on lesson re-open

**Decision**: Idempotent forward-only migrations driven by the `_chiron_meta.schema_version` row. On lesson re-open, run all migrations whose version is greater than the stored value, in order, inside a transaction. If migration fails, abort and surface the error — do not corrupt state.

**Rationale**:
- PRD §8 says "version table `_chiron_meta` with `schema_version` column. Migrations applied at lesson open (idempotent)."
- Forward-only avoids the rollback complexity that the single-user use case doesn't need.
- Spec edge case "SQLite schema mismatch on lesson re-open: apply migrations idempotently; if migration fails, surface error and refuse to corrupt state" is satisfied.

---

## Resolved unknowns

All NEEDS CLARIFICATION items from the plan's Technical Context are now resolved or explicitly deferred:

| Unknown | Resolution |
|---|---|
| TTS provider | R-01: Gemini default, ElevenLabs fallback |
| Molecule renderer | R-02: deferred to Phase 4 prototype, abstract interface |
| Pyodide bundling | R-03: lazy CDN load when widget present |
| PDF extraction | R-04 (revised): text-layer first via `pdfjs-dist`, vision fallback via Anthropic SDK |
| Progress reporting | R-05: stderr text lines |
| Model per stage | R-06: Sonnet default, Opus syllabus + verifier, Haiku balancer |
| SR algorithm | R-07: SM-2 in v1 |
| Migration strategy | R-08: forward-only idempotent on open |
| Image / multi-PDF / bundle ingest | R-09: 4 new adapters (`image.ts`, `multi-pdf.ts`, `agent-report.ts`, `bundle.ts`) |
| ~~Cost estimation with vision~~ | R-10 REMOVED by Q8 — no in-tree cost guard |
| Gemini MCP toolset reference | R-11: enumerated in SKILL.md per FR-036 |
| Vendored runtime libraries | R-12: small libs vendored into `shell/vendor/`; only Pyodide stays lazy-CDN |

No remaining NEEDS CLARIFICATION blocks Phase 1.
