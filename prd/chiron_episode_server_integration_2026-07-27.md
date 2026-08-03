# PRD — Episode-Pipeline ↔ Chiron Server Integration (progress · build-logs · rebake)

**Status:** design / DEFERRED — do NOT implement yet (user, 2026-07-27)
**Created:** 2026-07-27
**Branch:** main · **Repo:** chiron (in-repo PRD, house convention — NOT the global prd CLI)
**Ephemeral marker:** keep until the episode-pipeline↔server progress+logs+rebake seam ships.
**Parent / sibling:** `chiron_video_episode_lesson_2026-07-22.md` (the video-episode LESSON PRD; this is its
server-plumbing follow-on — see that PRD's TODO "wire into the chiron server (:8911)").

## 1. Context / What & Why

The video-episode generator (`skill/scripts/episode_pipeline.py`) is a **standalone CLI** with **zero
connection to the Chiron generate-server (:8911)**. Chain-based lessons (medicine/language) are started via
`POST /generate` → `dispatch.py`, which registers a **job** in the server's `jobs.json` and exposes live
status (`GET /jobs`, `GET /jobs/{id}` with a derived phase + log tail) — that's how the Library UI shows
**progress + a history of previous builds**. Video episodes get **none of that**: their only server
touchpoint is the final `register` stage (writes `chiron.json` status:`staged` + rebuilds the library
index), so a finished episode **appears** in the Library ("Italian · Video / Baby → Needs Review") but with
**no live progress, no build-log history, and no rebake-from-Chiron**.

**User intent (2026-07-27):** don't build the full connect yet — "there's a lot more functionality we need
to connect between the episode generators and Chiron." But **hook enough in** that, when the CLI runs,
**Chiron can detect the progress** and **show the build logs** (Chiron already keeps per-build logs so we
can judge whether a **rebake** is needed) — and ideally **trigger a rebake if needed**. Lessons must keep
showing up in the Library.

## 2. Goal (the minimal seam — Phase 1 only)

Make an `episode_pipeline.py` run a **first-class, observable job** in the Chiron server, WITHOUT porting the
whole generator into the server yet:

1. **Job registration + live progress.** The CLI registers a job (id, slug, chain=`video-it`, status) at
   start and updates its **phase per stage** (transcode → scenes → ingest → enrich → tags → visual → audio
   → render → register → done), so the existing `/jobs/{id}` UI shows it live like chain lessons.
2. **Persist build logs in Chiron.** Each build's stdout log lands where the server keeps chain logs
   (`STATE/<id>.log`), so the Library holds a **history of previous episode builds** — the artifact used to
   decide "do we rebake?" (mirrors how Chiron already surfaces chain build logs).
3. **Surface audio quality / rebake signal.** Fold the audio stage's `audio/qc-stats.json`
   (retry_rate / rebake_fix_rate / residual_rate — see recipe
   `chiron-bilingual-tts-phrase-level-bake`) into the job record so the UI shows quality + whether a rebake
   would help.
4. **Rebake hook.** The server can trigger a **targeted rebake** of an existing episode (reuse the built-in
   incremental `--stage content-qc` / hash-skip rebake) from the build history — "detect progress and even
   rebake if needed."
5. **Lessons keep landing staged → Needs Review** (already works via `register`; don't regress it).

## 3. Explicitly OUT of scope for Phase 1 (deferred — the "lot more functionality")

- Starting an episode build **from the server UI** (full `/generate` parity for video — needs a video
  source picker, upload/selection, queueing). Phase 1 is CLI-launched, server-**observed**.
- The broader episode-generator ↔ Chiron feature connect (role-play, assessment engine, unified learning
  protocol, phone-sync specifics) — tracked in the sibling PRDs.
- Video job queueing / concurrency management on the server.

## 4. Key facts (verified 2026-07-27)

- Server job registry: `skill/server/app.py` — `JOBS` dict ⇄ `STATE/jobs.json` (atomic write via
  `jobs.json.tmp` + `os.replace`), `_derive_phase(log, status)`, `GET /jobs`, `GET /jobs/{id}` (phase + log
  tail), `POST /accept/{id}` (staged→published + catalog rebuild). Populated ONLY by `POST /generate` →
  `dispatch.py` (the chains). Port :8911, 127.0.0.1 for generate; static `/lessons/**` `/library/**`.
- `episode_pipeline.py`: 9 stages, resumable; touches the server only at `register` (chiron.json
  `{domain:"video-it", status:"staged", tags:{dom,subj=series,level,scope:"episode"}}` +
  `build-library-index.mjs`). No jobs.json, no progress, no log persistence to STATE.
- Audio stage already emits `audio/qc-stats.json` + supports incremental/targeted rebake
  (`_seg_hash` + `.bakehash.json`, `--stage content-qc`, `CHIRON_MAX_REBAKE_ROUNDS`).

## 5. Design options for the CLI↔server seam (decide at build time)

| Option | How | Trade-off |
|---|---|---|
| A. CLI writes `jobs.json` directly | pipeline appends/updates its job record + writes `STATE/<id>.log` | simplest; must honor the server's atomic-write + schema, risk of write races with the server |
| B. CLI POSTs to a new server endpoint | e.g. `POST /jobs/external` (create) + `PATCH /jobs/{id}` (phase) + log stream | clean ownership (server owns jobs.json); needs new endpoints; CLI must reach :8911 |
| C. Server adopts running CLI builds | server watches `GEN/*/` + a per-build status file the CLI drops | decoupled; polling lag; another status format |

**Leaning B** (server owns its registry; CLI is a client) — but confirm when building. Whatever the seam,
reuse the existing `_derive_phase` + log-tail UI so no new frontend is needed for Phase 1.

## 6. Success criteria

- Running `episode_pipeline.py <ep>` makes E-N appear in the Library **during** generation with a live phase,
  and its **build log is viewable in Chiron** afterward.
- The job record shows the audio **retry/residual stats**; a **rebake** can be triggered for a built episode
  and reflects in the same history.
- No regression: finished episodes still land `staged` → Needs Review; chain lessons unaffected.

## 7. Decisions Log

- **2026-07-27** — PRD created (deferred). Origin: during E03 generation the user asked "where does Chiron
  show the progress like the other lessons?" Verified the video pipeline is disconnected from the server job
  registry (§4). User: set a PRD, don't build yet — but scope Phase 1 to progress-detection + build-log
  history + rebake hook so the CLI is observable/rebakeable from Chiron, deferring the fuller connect.
- **2026-07-27** — **Bake ENGINE routing policy + measured cost (Modal vs Mac).** Decided: interactive /
  single-episode bakes stay on **Modal L4** (default, fast); whole-season / multi-title **overnight** batches
  go to the **Mac omnivoice sidecar** (`--engine mac`, $0, serial) — same voice model, byte-identical output.
  Measured (E03, 47-min episode, 708 runs): Mac **10.1 s/run serial ≈ 2 h/episode, $0**; Modal L4 **956 GPU-s
  ≈ 16 GPU-min, ~$0.21/episode** (rate ≈ $0.0045/content-min). **1h45–2h MOVIE ≈ $0.50–0.60 bake** (+ rebakes
  + optional Gemini QC → all-in ~$0.75–1.00; `--no-gemini` = $0 QC). Cost scales with Lucrezia's runs (scenes
  × dialogue density), not raw length. `stage_bake` HARD-EXITS on Modal-unreachable (no auto-fallback). Built
  the overnight batch runner **`skill/scripts/bake-season.sh`** (glob/dir → each title via full pipeline on
  `--engine mac`, serial, per-title logs, resumable). Full detail + cost table in recipe
  `chiron-bilingual-tts-phrase-level-bake`. NOTE: when Phase 1 wires the CLI into the server (§2), the job
  record should also carry the **engine + GPU-seconds + $ estimate** so the build-log history shows per-lesson
  cost (feeds the compute-budget decision).
