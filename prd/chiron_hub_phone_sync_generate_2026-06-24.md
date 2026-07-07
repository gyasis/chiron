# Chiron Hub — LAN home hub, phone sync, on-device generate PRD

**Date:** 2026-06-24
**Status:** ACTIVE — **2026-07-07:** the Phase-2 **engine chains are BUILT + E2E-tested**; the **Wizard** (generate) and **Staging/Review** (accept) app surfaces are **design-locked** (pilots). Next: the **dispatcher** + the **Chiron generate-server** that powers both. (Original: DRAFT — LAN home hub, phased.)
**Owner:** Gyasi Sutton (solo)
**Related:** [`chiron_lesson_scope_and_reuse_2026-06-24.md`](./chiron_lesson_scope_and_reuse_2026-06-24.md) (library.yaml + the Library app), `skill/player` (PWA import/offline/delete-local engine), `skill/library` (faceted Library UI), `skill/chiron-tauri` (native wrapper, audio Range fix). Working artifacts: `~/Documents/generated/chiron-library/`, the LAN HTTPS server `~/.local/bin/chiron-https-serve`.

**Delete when:** Phase 1 (browse/sync/download/remove-local on the phone) AND Phase 2 (on-device Generate with live "preparing…" status) both ship.

---

## 1. Problem / goal
The user generates many lessons (heading to hundreds) on the home box and wants to **study on the phone** without juggling files. Needs: a **home hub** that is the source of truth for all lessons; a **phone app** (installed PWA, no address bar) that **syncs the full catalog over the home network**, **downloads** lessons for offline, and **removes** local copies to save space — and, eventually, **triggers generation** of a not-yet-built lesson from the app, showing a **"preparing lesson…"** status while the hub builds it.

## 2. Decision — LAN home hub (private)
The hub is the **always-on Linux box on the home LAN**, served over **LAN HTTPS**. The phone reaches it directly at home (most private; matches "my home network"). Not GitHub Pages for the data (Pages is only the optional install-shell fallback).

## 3. The never-erase-source rule (BLOCKING)
**Phone-side "Remove" clears ONLY that phone's local cache** (Cache Storage / app data). It MUST NOT delete, or send any delete to, the hub. The hub's lessons are the source of truth and are never mutated by the phone. (Consistent with the user's hard data-safety rule.) The phone is a *cache* of the hub.

**No desktop delete affordance (BLOCKING, user 2026-06-24).** Storage management
(Download / Remove-from-device) is **PHONE-ONLY**. The **desktop view shows NO
remove/delete control at all** — only Open (+ Generate) — so nothing can be mistakenly
deleted. The app NEVER deletes a *source* lesson anywhere; the hub source is removed only
by the user, manually, on the filesystem (with the project's 3× confirmation). "Remove"
is always device-cache-only and never appears on desktop. (Implemented: `library.js`
gates Download/Remove behind `matchMedia('(max-width:760px)')`.)

## 4. Architecture
```
HOME HUB (Linux box, always-on, LAN HTTPS)        PHONE (installed PWA — Library UI)
 ├─ all generated lessons (source of truth)  ◀─sync─ browse full faceted catalog (library.yaml-driven)
 ├─ lessons.json  catalog (the manifest)              Ready  → Download → cache offline (SW + fflate)
 ├─ *.chiron bundles (one per lesson)                 Ready  → Open → stream from hub over LAN (range)
 ├─ library.config.json (menu from library.yaml)      Cached → Remove → clears LOCAL cache ONLY
 ├─ [P2] POST /generate {subject,scope,domain}        Queued → Generate → "preparing lesson…" (poll)
 └─ [P2] GET  /jobs/<id> → {state,progress}                     grounding→writing→baking→ready → Download
```
- **Catalog** = `lessons.json` (player format: file/title/domain/clips/sizeMB/tags) + `.chiron` bundles, built by extending `build-library-index.mjs` (bundle each ready lesson + emit the manifest).
- **App** = the faceted **Library UI** + the **player's engine** (`import_from_server`/cache/`delete_lesson` local-only). One installable PWA.
- **Generation (P2)** reuses the hardened pipeline (chapterN.json → assembler → **Atelier bake** → bundle → catalog), wrapped in a small hub job API.

## 5. Phases
- **Phase 1 — Discover + Sync (no generation).**
  1. Hub publishes the catalog: `lessons.json` + fresh `.chiron` for all ready lessons + `library.config.json`, served via `chiron-https-serve` (LAN HTTPS).
  2. Merge: Library faceted UI + player's server-catalog/offline/remove-local engine → one PWA.
  3. Install on the phone from the hub HTTPS URL → browse, open (stream from hub), Download (offline), Remove (local only).
- **Phase 2 — On-device Generate.**
  1. Hub `/generate` + `/jobs` API: enqueue → run the real pipeline → add to catalog.
  2. App **Generate** on a queued lesson → POST → "preparing lesson…" live status (poll `/jobs`) → ready → Download.
  3. Bake step still routes to **Atelier** (Mac) per `chiron.md` R-CH1.

### Phase-2 engine — RESOLVED by investigation (2026-06-28/29)
The off-site generation engine + job payload (what "the real pipeline" in 5.2.1 actually is)
was scoped in `chiron_offsite_lesson_gen_promptchain_2026-06-28.md` → deliverables in
[`chiron_offsite_lesson_gen_DELIVERABLES_2026-06-28.md`](./chiron_offsite_lesson_gen_DELIVERABLES_2026-06-28.md). Verdict folded back here:

- **Engine = (C) HYBRID** — a deterministic, **resumable** PromptChain spine with two bounded
  agentic seams (grounded authoring + clinical verify). Built as **FOUR concrete prompt-chains**,
  one per lesson type, same spine: **1 Medical-AMBOSS · 2 Wards medical-Italian · 3 Medical-language
  Italian (patologie) · 4 Pure Italian**. (Headless `claude -p` YOLO is the per-domain fallback +
  a parity-fixture oracle, usable surgically as a function step.)
- **`/generate` job runner** = `validate job-payload (D3) → dispatch the lesson-type's chain → on
  success: assemble + bake (Atelier) + catalog/bundle; on any loop exhausting its bound: write
  `status=needs_review` + the structured abort report and STOP` (never ship an unverified medical
  lesson). **Stateful: checkpoint per completed `chapterN.json`, resume from the failed chapter** —
  not fire-and-forget. This answers Open Question 3 (in-process queue + per-chapter checkpoint files).
- **Job payload** (`POST /generate`) ⊇ `{subject, domain, sub_mode/curriculum, scope, grounding
  {primary, source_path, foundations_depth}, persona, audio, on_fail:"review_queue", output_dir}` —
  the per-lesson *content* decisions; nearly every other historical "ask the human" was one-time
  infra now settled in rules. See D3 for the full schema + decision-point map.
- **No big model codes HTML (BLOCKING for the runner).** Every chain emits **typed `WidgetSpec`
  JSON piecemeal** → a **generic, data-driven assembler** (`renderWidget` + shell/theme/audio inject)
  builds `lesson.html`. Pre-Phase-2 prerequisite: **generalize the per-lesson `build-*-assemble.mjs`
  forks into ONE data-driven assembler per chain**, and put chains 2/3/4 on that same data→render rail
  (today the Italian lessons hand-author HTML — the R-CH-PIPELINE antipattern). See D4c.
- **Grounding** (`harrison-search`, MRCP PACES / SSM MCQ) = registered **tool/function steps**; large
  pulls get a **big-context DIGEST step** (Gemini 1M / Claude) into a span-preserving `source/` pack
  before authoring. See D4a.

## 5b. Current state + locked designs (2026-07-07)

**Engine chains — BUILT, full-widget, E2E-tested, tracked in `skill/chains/`:**
- Medicine depth ladder: **primer** (grouped/quick), **atlas** (organ-system survey, reads `skill/blueprints/disease-atlas.json`), **systematic** (single-disease 11-section deep-dive), + the original **amboss** chain. All use the FULL `04a` widget palette + curriculum `widgetMix` + `srCards` (the primer's stripped-palette regression was fixed).
- Italian: **medical-italian-passage**, **wards**, **pure-italian** (recovered from a stash; assemblers exist — **NOT yet E2E-re-verified → Phase-0 task**).
- `disease-atlas.json` — curated **392-disease** master list by organ system (USMLE Step 1/2 + UK Foundation Y1/2); atlas-mode source; the `highYield` flag naturally bounds each system's chapter count.
- Verified this session: generated + baked E2E (**query → lesson → audio**) for endocrine primer, aortic-aneurysm systematic, cardiovascular + respiratory atlases — all full-widget, published.

**Audio infra fixes (committed):** manifest ordered by **CHAPTER sequence** (was alphabetical `section_id` → Listen widgets out of order); player **blob-caches clips** so seeking works with **no HTTP-Range dependency** (desktop + mobile), traveling inside the `.chiron` package; loudness `-16 LUFS`.

**Wizard (generate) — DESIGN LOCKED** (pilot `~/Documents/generated/chiron-wizard-pilot-variants.html`):
- **Variant A — single-panel smart form** (chosen). Subject box **auto-detects** subject_type → suggested depth (system→atlas, disease→systematic).
- **Multi-page image capture** — snap N pages → each OCR'd → **"used as context"** (checkbox); maps to `ingest-adapters/image.ts` + the phone `capture-server`.
- **Single-icon sun/moon dark toggle**; dark = the real `midnight` theme palette.

**Staging / Review (accept) — DESIGN LOCKED** (pilot `~/Documents/generated/chiron-staging-review-pilot.html`):
- Generated lessons land **`status: staged`** → shown in the library's **🟡 Needs Review** band (already built in `library.js`).
- Per-card **Open** (view + listen) · **Accept** (`staged→published` + rebuild catalog) · **Send back** (regenerate with a note). Desktop + mobile.

**The Chiron server (the convergence — powers Wizard + Staging):**
- `POST /generate {subject, domain, depth, subject_type, images[], source_note}` → **ingest/OCR pages → dispatch to the correct chain → author → assemble → bake (Mac/Atelier) → bundle + catalog** → lands staged. (This *is* §5 Phase-2's job runner, now that the engine exists.)
- `GET /jobs/<id>` → live status (grounding→writing→baking→ready) for the Wizard progress.
- `POST /accept/<id>` (Staging Accept) · `POST /regenerate/<id>` (Send back).
- **OCR/image→markdown is a server-side ingest step BEFORE the chain**, feeding grounding context via the same slot Harrison-search uses.

**Phase 0 (prerequisite, IN PROGRESS 2026-07-07):**
1. **Dispatcher** — one entry point routing `domain × depth × subject_type → the correct chain` (chains are 6 separate scripts today; the server needs one call).
2. **E2E-verify the 3 Italian chains** (recovered from stash; untested this session).

## 6. Reuse (don't reinvent)
- Player `skill/player/app.js`: `serverUrl`, `server_lessons`, `import_from_server`, `importBundleBytes` (fflate unzip → Cache), `delete_lesson` (local), `sw.js` (SW serves cached lessons). Lift the engine; keep the Library UI.
- `chiron-https-serve` (LAN HTTPS, supports Range → audio works).
- `build-library-index.mjs` (catalog/tagging) — extend to bundle + emit `lessons.json`.

## 7. Open questions
1. Trusted LAN HTTPS for a real phone PWA install — self-signed needs device trust; **mkcert** (local CA trusted once on the phone) is the clean fix. Decide in Phase 1 install step.
2. Hub always-on: a small `systemd --user` service for `chiron-https-serve` (+ later the generate API) so the hub survives reboots.
3. ~~Phase-2 job runner: in-process queue vs a tiny job file/dir; bake concurrency vs Atelier (one omnivoice).~~ **RESOLVED** (see §5 "Phase-2 engine"): in-process queue + per-chapter checkpoint files (stateful/resumable); bakes serialize through the one Atelier omnivoice regardless of engine.

## Dev Diary

### 2026-07-07 — captured current state; locked designs; starting Phase 0
**Done:** engine chains built + E2E-tested (medicine ladder + amboss; Italian recovered from stash); `disease-atlas.json` (392 dz); audio manifest-order + blob-seek fixes committed; `-16 LUFS`. **Wizard** + **Staging/Review** app surfaces piloted and **design-locked** (single-panel form + multi-page "use-as-context" capture; Needs-Review → Open/listen → Accept/Send-back). Chiron generate-server API scoped (`/generate /jobs /accept /regenerate`).
**Discussed / decided:** OCR = **server-side ingest step** (reuse `ingest-adapters/image.ts`), pre-chain, into the grounding slot. Dark mode uses the `midnight` theme. Dev-toggle idea (show composed prompt / step chain no-bake) **parked**.
**Next pickup:** Phase 0 — build the **dispatcher** (`domain×depth×subject_type → chain`) + **E2E-verify the 3 Italian chains**, then build the **Chiron server** wrapping it.

### 2026-07-07 (later) — Phase 0 COMPLETE
**Done:** **Dispatcher** shipped (`skill/chains/dispatch.py`, commit `5934d74`) — the single entry the server calls; `resolve(domain,depth,subject,subject_type,extra)→{runpy,env,slug,depth}` + `run(res,stage)`, auto-derives depth (system→atlas · disease→systematic · geriatrics→primer), maps subject → each chain's env contract (`CH_SUBJECT`/`SSM_QID`/`CH_TOPIC`). Routing verified dry-run across all **7 chains**. **All 3 Italian chains E2E-verified** through the dispatcher: passage (`SSM_QID=ssm2019_050`)→220K; ward (`CH_TOPIC=cardiologia`)→192K/36 listen; pure-italian (`magari`)→200K/36 listen.
**Fixed:** wards + pure-italian chains printed `=== done → lesson.html` even when `CH_STAGE=author` skipped the assemble step (false success). Made the done-print conditional on `lesson.html` actually existing (observability). NB stage contract: these two chains assemble only at `STAGE ∈ {assemble,audio,all}`; the server generates at `stage=all`, so it's unaffected.
**Next pickup:** **Phase 1 — the Chiron generate-server** (`POST /generate` → dispatcher subprocess + job tracking; `GET /jobs/<id>`; `POST /accept/<id>` flips staged→published + rebuilds catalog; `POST /regenerate/<id>`). Server-side ingest/OCR pre-chain; Mac/Atelier bake at the audio stage.

---

*Captured 2026-06-24. LAN home hub; phone is a cache of the hub; phone-remove never touches the source. Updated 2026-07-07: chains built, Wizard + Staging locked, Chiron server next.*
