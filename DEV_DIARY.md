# Dev Diary: Chiron

*This diary is pieced together after the fact from git history, project memory, PRDs and the live service list. Several PRDs have dated `## Note:` entries, but none of them ran a formal `prd diary` cycle.*

## What Chiron is

Chiron turns a source (a textbook PDF, a code repo, photos of book pages, a video or YouTube link, an audio lecture, or a plain request) into one self-contained lesson page. Each lesson keeps its own SQLite state, plus quizzes, flashcards, baked audio and AI personas. It treats three domains equally: **code, medicine and language** (Italian in practice). It has one learner, Gyasi. Over six months it grew from a single skill into a small platform:

- a generate server
- a LAN library and hub
- an in-page tutor
- an "Ask" search engine across all lessons
- an Android Tauri app
- Pimsleur-style audio seasons

The last stretch was aimed at the Ordine dei Medici di Napoli Italian exam on **2026-10-19**.

## Timeline

### 2026-04-28 → 05-01: Design and spec build
The repo started from a Spec Kit template. The design PRD `universal_lesson_generator_2026-04-28` and `chiron_design_v1` set the rules: three equal domains, the LLM advises but doesn't decide progression, a typed schema scaffolds the teaching, and the output is a single HTML file. Dev-kid ran the build in waves: 60/129 tasks by 04-29, 119/129 by 04-30, then an adversarial fix-up pass brought it to 177/182 (97%). An MIT license with a medical disclaimer was added 05-01. *(git; 55 commits in April)*

### 2026-05-12 → 05-24: Widgets and proof lessons
PRDs written 05-12: canonical shell + Match Madness, lesson expander, server CMS, and a synthesis drawing on CureIQ. Match Madness and the language flashcard deck joined the pipeline 05-14. **PR #1 (05-23)** added 10 universal and code-only widget renderers. The pipeline rebuilt the v1 lesson with all 35/35 checks passing. Proof lessons followed: quant-trading, bill-becomes-law, and a CAP Step-2-CK medicine lesson run end to end. *(git)*

### 2026-06-08 → 06-19: Audio, mobile, rich-media ingest
- **06-10:** Listen-mode audio lectures arrived. Loudness was set to −20 LUFS, and persona packs plus a Gemini audio check were added *(PRDs `chiron_audio_lecture`, `chiron_persona_packs`)*.
- **06-12 → 06-13:** The mobile player layer and responsive language lessons.
- **06-16 → 06-17:** First native Android Tauri app (a `lesson://` protocol replaced the service worker). The signed release APK shrank from 319 MB to 65 MB.
- **06-18:** Video/YouTube ingest (G5) and the phone-camera capture sidecar (G6). Audio ingest uses the Atelier whisper sidecar on the Mac. The CureIQ scheduler was audited and judged "fundamentally broken — do not port" *(memory: reference-cureiq-scheduler, atelier-whisper-sidecar)*.
- **06-19:** An event-sourced store for spaced repetition across lessons (now `~/chiron/catalog.db`), plus the assessment-engine PRD.
- **06-24 → 06-29:** Audio bakes standardized on Atelier omnivoice on the Mac, never local Linux TTS. Audio must work like a stand-alone podcast: say the Italian, then explain it in English. Lesson generation must pick widgets to fit the content, especially for pathology. **06-28:** the LAN Library hub went up as a PWA served over HTTPS *(memory feedback files; PRD `chiron_hub_phone_sync_generate`)*.

### 2026-07-06 → 07-18: The platform phase
- **07-06/07:** The medicine (AMBOSS) chain completed the 5-chain set. A dispatcher routes domain × depth × subject to the right chain. The **generate server (FastAPI, :8911)** was wired into the Wizard and Staging screens. The PRD notes say Phases 0–4 were done by 07-07.
- **07-08 → 07-15:** Mobile app releases v0.3 → v0.13: edge drawer, content-aware auto-routing, status display, pull-to-sync, and retry/accept from Activity.
- **07-16:** A dedicated Postgres store was chosen for the library (:5442); per-lesson SQLite gets copied in when a lesson is accepted *(memory: project-chiron-corpus-postgres)*. **PR #17:** the in-page **lesson tutor** (PromptChain on :8912, grounded on the page, then Harrison's, then the web).
- **07-17:** PRs #18–#30 in one day: tutor intelligence and capture, spine cards, the dispatch bar, MCQ generators, a captures browser, a generation queue, and LaTeX in the tutor. Also the unified-learning-protocol PRD.
- **07-18:** PRs #31–#37 added a **Modal fast-bake lane** for audio: benchmarks, a server picker, two audit-fix rounds, and a fallback ladder for chain models *(PRD `chiron_modal_fast_bake_lane`)*.

### 2026-07-22 → 08-03: Video episodes, Lucrezia, iPad
The **video-episode pipeline** (9 stages, domain `video-it`) turned the owned Italian series "Baby" into lessons. Fixes along the way:
- Scenes are now named from the dialogue when Gemini blocks the content.
- Italian is cited as whole phrases in bilingual audio, with a 2-round re-bake cap.
- The Italian domain no longer has a default, and `video-it` no longer resets (PRs #38–#42).

**07-29:** Lucrezia became the single Italian voice (#40). **07-30:** mic speech-to-text in the tutor (#43); the acolyte tutor PRD was written. **08-01:** Two fixes. Episodes were silent on the iPad, fixed by re-muxing the audio to AAC-LC. The server must be restarted with systemd so it binds to the LAN, never by hand-running `serve.sh`. The phone app is the Tauri APK, not the PWA. **PR #45 (08-03):** mobile publishing plus the episode pipeline. *(memory: 6 project/feedback files; git: 97 commits in July)*

### 2026-08-14 → 08-27: "Ask", search across all lessons
PRs #46–#74:
- an Ask corpus and page with a pilot design, citations and thread history
- a vector sidecar, then hybrid and dense retrieval
- **evaluation sets** (gold, medicine, cross-language, all domains)
- the **embed service (:8913, GPU bge-m3)**
- the tutor rebuilt on **acolyte** (#67)
- Anki cards (#70), "play the scene", Ask steps

**08-24:** the **Il Centro** player and source (#72–#73); its transport PRD is now paused. **08-23:** `fleet-ip` / `fleet-locate` / `anki-host` replaced hard-coded IPs.

### 2026-08-28 → 10-07: Quiet
There are no commits and no Chiron memory files in this window. Neither source shows what happened then (see caveats).

### 2026-10-08 → 10-12: The Ordine exam push
- **10-09:** An OMCeO Napoli email said a written and oral Italian test is required before registration with the Albo (deadline 2 Nov). The PRD `ordine_lingua_chiron_lessons` was opened the same day, and 5 lessons were baked on Mac omnivoice with 0 audio-check defects.
- **10-10:** The **model resolver** (`glm@latest`…) went in after retired cloud model ids broke bakes. Coloured accent card edges were stripped from the source and from 1,057 generated files (#75–#76).
- **10-11:** PRs #77–#88 built the **Pimsleur format**. Season 4 (congiuntivo) cost about $0.46 on Modal. Ordine Season 2 cost $0.575, all passing. The exam season ("Domande della commissione") added 40 Anki cards, bringing the Ordine deck to 115. Read-along came to all 27 Pimsleur lessons. Thinking is now switched off per lane (#83). An open issue: Anki on the MacBook quits silently during media bursts *(PRD `chiron_pimsleur_format` notes)*.
- **10-12:** **Mock oral** at `/oral` (#89): Lucrezia asks, whisper transcribes, gemma4/deepseek examines. Plus library tags, a focus switch, phone tags available offline, and sans-only type (#90–#93).

### 2026-10-14 → 10-17: Sessione sprint and the phone tutor
- **10-14:** PRD `chiron_sessione_tutor_cards` (ACTIVE, sprint). It adds Anki search-then-study, production and listening cards with rotating voices, and dictation. All top-150 cards in the "Esame medico" deck now have audio.
- **10-17:** PRs #94–#103 merged in one day:
  - the Sessione sprint
  - a word/sentence pool where weak words become listening drills
  - local tutor models used first while Ollama Cloud is capped
  - a pre-exam audit
  - a voice tutor on the phone ("Chiedi a Lucrezia")
  - phone parity wave 2
  - an **on-device Veloce tutor (LiteRT-LM Gemma 4 E2B)** with offline speech-to-text and text-to-speech
  - Veloce double-tap translation, read aloud (HEAD `85d962f`)

  A PRD note from the same morning lists fixes to chapter-completion tracking. So far they are patched only in the exam lesson, not in the generator.

## Current state (as of 2026-10-17)

**Running.** I checked with `systemctl --user`; all six units are active:

| Service | Port | Role |
|---|---|---|
| chiron-server | :8911 | generate / review / download API + library |
| chiron-tutor | :8912 | PromptChain page tutor, switchable models + Harrison's |
| chiron-embed | :8913 | GPU bge-m3 vectors for Ask |
| chiron-lessons | :8910 | static lesson server (serves `~/Documents/generated`) |
| chiron-hub | HTTPS | LAN catalog, phone PWA sync |
| chiron-tutor-prototype | :7220 | pronunciation-calibration prototype |

**Data.** 53 bundles in `~/chiron/bundles` and the cross-lesson `~/chiron/catalog.db` (cards, spaced-repetition state, full-text search).

**In progress:**
- `chiron_sessione_tutor_cards` (ACTIVE): deadline is the exam on 10-19.
- `ordine_lingua_chiron_lessons` and `chiron_pimsleur_format` (both DRAFT): the Pimsleur PRD closes once a whole season can be generated from one request.
- The fixes to chapter-completion tracking still need to move into the generator.
- Anki crashes on the MacBook remain an open investigation.
- Uncommitted in the working tree: `.claude/hooks/pre-compact.sh` and `chiron-tauri/.../tauri.conf.json` (probably a version bump), plus about 14 screenshots and `.bak` files.

**Paused:** `il_centro_service_transport`, `chiron_library_ssm_facet_and_bridge`.

## What shipped from it

- **Main deliverable:** the Chiron platform in `~/Documents/code/chiron`: 389 commits and 103 PRs over six months, covering the skill, 5 chains plus the dispatcher, the server, tutor, Ask, hub, and the Android Tauri app.
- **Skills:** `/chiron` (with code, medicine, language, Pimsleur, research-paper and case-study variants), `/chiron-medicine`, `/chiron-medical-ward`, `/chiron-lucrezia`, and `/il-centro`.
- **Infrastructure:**
  - the Modal fast-bake lane, born from the 07-18 burst
  - `chains/chiron_models.py`, the resolver that picks the newest model from the daily catalog (from the 10-10 outage)
  - a cross-lesson spaced-repetition catalog and a Postgres store for the library
  - the Ask evaluation sets
- **Rules and lessons that spread to other projects:** the per-lane thinking-off switch (rule R-TM4b in the thinking-models domain rule), stripping accent edges per design rule R-DT3 (also fixed in acolyte PR gyasis/acolyte#16), and `fleet-ip` / `fleet-locate` / `anki-host` replacing fixed IPs. Recipes: the iPad silent-audio fix, naming scenes from dialogue, and phrase-level bilingual TTS.
- **Study material:** the Ordine seasons (S1, S2, exam, congiuntivo), a 115-card Ordine Anki deck, and the mock oral at `/oral`.
- **PRDs:**

| Status | PRDs |
|---|---|
| Active | sessione_tutor_cards |
| Draft | pimsleur_format, ordine_lingua |
| Paused | il_centro, library_ssm_facet |
| Still listed in the scratch tier | modal_fast_bake_lane, ssm_tutor_rag_bridge |

  The project-local `prd/` folder holds 18 design PRDs from April to July.

## Provenance and caveats

- **Sources read:** 20 project memory files, 4 scratch PRDs (header, notes and revision log; not full bodies), the list of project-local PRD names, git log (389 commits, merge history), `systemctl --user`, and `~/chiron`.
- **Searches:** one `sio search "chiron" --recent 30 --files`. It returned only unrelated rookery and paperclip transcripts, so the timeline is pinned by git dates and PRD note timestamps. I didn't run a second search.
- **Gaps:**
  - PRs #2–#16 don't appear as merge commits, so they were probably squashed or merged directly.
  - Nothing explains 08-28 → 10-07.
  - The early phases (April–June) come from commit subjects, not memory files.
- Reconstructed read-only by razer's Claude Code on 2026-10-17 via `/dev-diary`; saved here as DEV_DIARY.md.
