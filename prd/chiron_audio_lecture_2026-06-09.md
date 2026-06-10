# Chiron — Audio Lecture ("Listen" Mode) PRD

**Date:** 2026-06-09
**Status:** DRAFT — design locked in conversation, buildout pending
**Owner:** Gyasi Sutton (solo)
**Audience:** future-Gyasi + any AI agent doing the buildout
**Supersedes:** the tabled `chiron_tts_provider_selection_2026-04-29` concept (issue #2 / T058) — this PRD resolves the provider question and expands TTS into a full lecture feature.

**Delete when:** Listen mode ships and a real lesson generates + plays a `pauls_tutor` lecture (live + prebaked) that passes the ear-test, with section-by-section voice-follow working.

---

## 1. The idea (in one paragraph)

Chiron lessons should be **listenable**, not just readable. A tutor's voice **teaches** the lesson — explains the concept, adds the aside, gives the example, connects ideas — something you listen to hands-free (commute, dishes, eyes closed) and then **come back and read the detail later**. The audio **enriches and teaches**; the page is the reference you return to. This is emphatically **not** text-to-speech of the on-screen prose ("reading the slides aloud" is dead and adds nothing).

## 2. Two foundational distinctions (do not blur these)

1. **Teach, don't read.** The audio is a *generated lecture*, not a narration of the written lesson. A teacher decides what to dwell on, what seconds to spend, what to gloss. The script the tutor speaks is **different content** from the page prose.
2. **This is NOT acolyte.** Acolyte (`~/Documents/code/acolyte`) is built for *short chat sessions*. Chiron lessons are full, expansive generations. **The ONLY thing borrowed from acolyte is its inline `<ref id="…">` marker technique, and ONLY for the section-by-section audio** (so the tutor "points at" the section as it speaks). None of acolyte's architecture, playback model, Kokoro engine, or prompting is used. Adopting more than the marker idea would severely limit us.

## 3. What gets generated per lesson

Default granularity is **ALL three** (switchable to narrow to one):

| # | Artifact | What it is |
|---|---|---|
| 1 | **Shortened lesson** | A condensed teaching pass over the whole lesson — the tutor's compressed lecture of the material. |
| 2 | **Summary** | A tight spoken summary / recap. |
| 3 | **Section-by-section talking** | The tutor lectures each section in turn; carries inline `<ref>` markers → voice-follow (scroll + soft glow of the section as it's taught). |

**Pedagogy is per-granularity (BLOCKING).** Each artifact uses a teaching strategy suited to *that* granularity — they are NOT one generic prompt:
- **Shortened lesson** → condensed-lecture pedagogy (compress while keeping the through-line + key examples).
- **Summary** → recap pedagogy (orient, name the takeaways, what to remember).
- **Section-by-section** → point-at-the-section teaching pedagogy (dwell, exemplify, `<ref>` the artifact being discussed).

These **extend chiron's existing pedagogy patterns** (the `skill/prompts/` templates + persona system), not a new from-scratch prompt. The Gemini script-author prompt is selected/parameterized **by the granularity strategy** in play.

For the **language (Italian) domain**, all three artifacts are additionally **bilingual / code-switched** (Lucrezia) — mostly-English instruction with perfect-Italian for the target words/phrases. See §4 "Bilingual code-switching." This is a second pedagogy axis (domain) layered on the granularity axis.

**Incremental generation:** build ONE unit first (e.g. the first section's lecture), the user reviews it, then continue — never commit to a full-lesson render blind.

## 4. The two brains (architecture)

| Role | Engine | Notes |
|---|---|---|
| **Pedagogy / lecture-script author** | **Gemini** (via `mcp__gemini-mcp__*`) | Writes what the tutor *says* — the teaching script for all three artifacts, applying chiron's pedagogy. In-contract: `SKILL.md` already whitelists the Gemini MCP tools. Deliberate, allowed divergence from pure-Q8 (Claude main context is NOT the script author here). |
| **Voice synthesis** | **OmniVoice** on **Atelier** (Mac `192.168.0.159`) | Voice = **`pauls_tutor`** (registry `atelier/voices/registry.json` — a cloned Dune/Fremen documentary-narrator: calm, authoritative, "teacher" timbre). Raw clone, no FX. |

**Pipeline:** Gemini authors script (with `<ref>` markers for the section artifact) → OmniVoice synthesizes the lesson's voice → loudness-normalize output (`ffmpeg loudnorm I=-16 TP=-1.5`) → persist.

### Voice routing is PER-LANGUAGE (decided 2026-06-09)

- **Non-Italian content** (code · medicine · research-paper — English lecture) → **`pauls_tutor`** (English Fremen-narrator timbre).
- **Language (Italian) domain** → **`lucrezia`, a BILINGUAL tutor** (NOT `pauls_tutor`). RESOLVED + DONE 2026-06-09: **two registered, verified refs** (whisper round-trips verbatim), committed to `atelier/voices/registry.json` — selected **per segment** by that segment's language:
  - **`lucrezia_english`** (`language:"en"`) — ref_text `"Hi everyone, and welcome back to my channel."` (YT LH0YYK5xgPw, ~2.85s — short ref; ear-test for thinness, swap to a longer English clip if needed).
  - **`lucrezia_italian`** (`language:"it"`) — ref_text `"Ciao a tutti e bentornati sul mio canale…"` (YT S7vnrD7_tYg, 0–8.2s).

### Bilingual code-switching (language domain — BLOCKING)

Lucrezia teaches Italian like a real bilingual tutor — she switches between English and Italian within a single lesson:

- **Medium of instruction = mostly English** (explanations, context, English sayings) → `language:"en"`, `lucrezia_english`.
- **Italian words / phrases / sayings = spoken in PERFECT Italian** → `language:"it"`, `lucrezia_italian`. The whole point is authentic pronunciation the learner can absorb.
- **Sections vary:** some strictly Italian, some intermingled English+Italian, depending on the content.

**Mechanism:** the Gemini script-author emits **per-segment language tags** for language-domain lessons (e.g. a segment list `[{lang:"en", text:…}, {lang:"it", text:…}, …]`, or inline `<say lang="it">…</say>`). The bake step synthesizes **each segment with its own `language` + matching Lucrezia ref**, then concatenates into one clip — consistent voice, correct language per segment. This rides the same per-segment chunking already needed for synth-time + highlight-follow (§6 / open-item #3): a segment now carries `{lang, ref}` in addition to its `<ref>` anchor.

**✅ VALIDATED 2026-06-09 (smoke test).** A 5-segment en↔it Lucrezia clip (greetings) synthesized segment-by-segment via OmniVoice `:8770`, concatenated + loudnorm → 16.4s clip. whisper round-trips every segment verbatim. Proves per-segment-language-switch + concat end-to-end. Artifact: `/tmp/lucrezia_cs/lucrezia_codeswitch.wav`.

**✅ HARDENED TEST 2026-06-09 (real lesson).** A 91.9s bilingual micro-lesson — English intro → authentic Italian story ("Al bar": `Stamattina sono entrata nel bar all'angolo…il mondo è andato piano`) → English breakdown → Italian close — 8 segments, **each output `normLUFS`-normalized to −30 LUFS** per `~/.claude/recipes/clone-voice-omnivoice.md` (fixes the en-quieter-than-it drift). Pure Italian + English segments transcribe verbatim. Artifact: `/tmp/lucrezia_lesson/lucrezia_lesson_final.wav`.

**🔑 FINDING → segmentation must be WORD/PHRASE level, not sentence level (BLOCKING).** Italian phrases quoted *inside* an English (`language:"en"`) segment come out **English-accented** — seg5's `"il mondo è andato piano"` whisper'd back as *"Perchinku Minuti El Mondo Andato Piano."* So the "Italian spoken in PERFECT Italian" rule requires the Gemini script-author to tag **every Italian token inline** (even one quoted mid-English-explanation) as its own `it` segment, and the bake to split at that granularity. The segment boundary (open-item #3) is therefore **per language-span**, finer than per-`<ref>`. Inter-segment gap can be tiny (≤80ms) so a mid-sentence en→it→en switch still sounds continuous.

**Loudness (BLOCKING, HARDENED 2026-06-09):** every synth OUTPUT is normalized to `PLAYBACK_TARGET=-30` LUFS with **`~/.local/bin/tts-normalize`** (pyloudnorm BS.1770 + RMS fallback) — NOT the bash `normLUFS`/ffmpeg single-pass `loudnorm`, which are **unreliable on the short word-level clips bilingual TTS produces** (R128 gating needs ~3s). `tts-normalize` hits −30 exactly at any length (verified 1.5s/3.4s/92s → −30.0). Ref staged at −16. Per `~/.claude/recipes/clone-voice-omnivoice.md` (hardened).

**Caveat:** the OmniVoice `instruct` param (accent/tone) is **silently dropped** by the current sidecar (per recipe gotchas) — so "accent via instruct" is NOT wired yet; authentic language comes from `language` + the right ref, not `instruct`. Update §4 capability note accordingly.

Remaining = ear judgment: voice consistency across languages + whether the short 2.85s English ref sounds thin.

### OmniVoice capabilities (confirmed 2026-06-09, k2-fsa/OmniVoice)

- **646 languages, 581k hrs.** Italian explicit: `256 | Italian | it | ita | 9402.46` (~9.4k hrs — well-resourced). Pass `language` on `/tts` (default `"en"`).
- **`instruct` accent/tone/emotion control** is advertised but **NOT wired in the current sidecar — the `TtsReq` model silently drops it** (recipe gotcha, confirmed 2026-06-09). Do NOT rely on `instruct` for accent yet. Authentic language/accent comes from the `language` param + the correct cloned ref (e.g. `lucrezia_italian` + `language:"it"`), not `instruct`.
- **Cross-lingual cloning is expected/supported** — a ref in language A + target text in language B → output carries A's accent (per upstream docs). So an Italian-speaker ref reading English = Italian-accented English.
- Other `/tts` knobs available: `instruct`, `speed`, `pitch_semitones` (−12..+12), plus the clone + `num_step`/`guidance_scale`/`class_temperature` already in use.

### Voice params (from Atelier registry conventions, verified 2026-05-25)
- Default `num_step: 48`, `guidance_scale: 2.0`, `class_temperature: 0.3`.
- **High-quality = on/off toggle** → `num_step: 64` (audibly more inflection/clarity, ~+32% synth time: 0.118 → 0.157 s/char). Default OFF.
- Normalize the **OUTPUT**, never the reference (normalizing a quiet ref amplifies its noise floor + clips the clone).

### OmniVoice integration — RESOLVED, verified live 2026-06-09

OmniVoice is a plain HTTP service on the Atelier box (`192.168.0.159`), driven exactly as the `voice-clone` skill drives it:

```
POST http://192.168.0.159:8770/tts        (Content-Type: application/json)  → WAV bytes
{ "text": "<lecture script>",
  "ref_audio": "/Users/gyasisutton/models/voice-refs/pauls_tutor_ref.wav",
  "ref_text":  "To avoid making rhythmic noises which attract the sandworms, the Fremen cross desert spaces using the sand walk, a dance-like motion with irregular rhythm which emulates the natural sounds of the desert.",
  "num_step": 48,            # 64 when the HQ toggle is ON
  "guidance_scale": 2.0, "class_temperature": 0.3 }
```
- **Output is WAV** → fold a WAV→MP3 conversion into the loudnorm pass: `ffmpeg -i out.wav -af loudnorm=I=-16:TP=-1.5 out.mp3`.
- **Governor `:8799`** is our observability free lunch: `GET /estimate?engine=omnivoice&chars=N` returns `{eta_seconds, eta_p90_seconds, rate, state}` (drives our progress ETA); `/telemetry` records each synth (feeds our audit log).
- **Measured rate ≈ 0.13 s/char** (warm): ~78s / 600 chars; p90 ~101s. A full section lecture (1.5–3k chars) ≈ 3–6 min synth EACH → synth MUST be background (validates §6 async), and long lectures should be **chunked into segments** (segment clips give the per-segment offsets that open-item #3 needs for highlight-follow).
- **Liveness probe** (cheap, no synth): `curl -s "http://192.168.0.159:8799/estimate?engine=omnivoice&chars=600"`.

## 4.5 Domain-aware audio pedagogy (2026-06-10 — MAJOR expansion)

Audio is a chiron-wide feature, but its **shape is per-domain pedagogy** — you identify what parts benefit most from audio, per domain. Not one-size-fits-all.

- **Lecture domains (medicine, research-paper, code):** audio = a **course-level lecture** (continuous, the summary/shortened/section lectures already built). Section-by-section is optional, not mandatory.
- **Language domain (Italian): granular, MULTI-TYPE audio.** The audio types (priority-ordered):

| # | Audio type | What | Voice | Rule |
|---|---|---|---|---|
| 1 | **Dialogue / scene** | EVERY dialogue & scene, fully voiced | per-line bilingual (en setup + it lines) | **ALWAYS — highest priority. No dialogue/scene ships without audio.** |
| 2 | **Short story — verbatim** | the Italian story read aloud, pure Italian | `lucrezia_italian` | always, for every story |
| 3 | **Short story — English description** | a SEPARATE English clip explaining what the story said | `lucrezia_english` | paired 1:1 with each verbatim story |
| 4 | **Vocab phrase — inline ▶** | a tiny clip per phrase; ▶ next to it; tap → hear it | `lucrezia_italian` (pure) | every vocab phrase |
| 5 | **Grammar pearl** | the pearl **read aloud / "audiofied"** (NOT a deep rules layer — just voiced), rendered as a labeled block with inline ▶ | Lucrezia (bilingual) | every grammar pearl |
| 6 | summary / full-lecture / section | the existing lectures | bilingual (Lucrezia) | existing |

- **+ Match-madness widget** in language lessons (existing chiron widget `match-madness` — wire it into the language skeleton).
- **UI consequence:** beyond the floating 🎧 panel (lectures), the language lesson needs **inline ▶ controls** on each vocab phrase, dialogue line, story, and grammar pearl — audio woven INTO the content, not only in the side panel.
- **Schema consequence:** `ArtifactKind` extends beyond `summary|shortened|section` to `dialogue | story-verbatim | story-description | phrase | grammar-pearl` (each with placement metadata so the inline ▶ binds to the right DOM node). `resolveLecture` + `audio-bake` + `manifest` carry the new kinds; the player gains inline-▶ wiring.

**Audio is DEFAULT-ON, with a `--no-audio` escape hatch (2026-06-10).** Generating audio is the default for language lessons; pass `--no-audio` (or "no audio" in the request) to skip lecture-gen + bake entirely for **faster lesson generation** when audio isn't needed. `stage6BakeAudio` is already opt-in (no-op without artifacts), so `--no-audio` = simply don't author/bake the audio.

**First slice DONE + browser-verified (2026-06-10):** dialogues (always-audio) + inline vocab ▶ (pure `lucrezia_italian`). Shipped: schema kinds `dialogue`/`phrase` (+ `grammar-pearl`/`story-*` scaffolded); `audio-bake` writes `audio/<kind>/<anchor>.mp3`; player rebuilt — **grouped 🎧 panel (Whole lesson / By section)** + **inline ▶** injected at each anchored element. Café lesson: 27 vocab phrases + 3 dialogues anchored, baked (35 clips total), verified in-browser — grouped panel ✓, 30 inline ▶ ✓, vocab + dialogue playback ✓, no JS errors. (One transient OmniVoice 500 recovered via reuse-rebake.) Player coupling note: the café lesson INLINES the player, so the swap was manual surgery — **TODO: emit the player as a standalone `audio-player.js` so self-contained lessons don't go stale.** Remaining types (story verbatim+description, grammar-pearl audio, match-madness) next.

**FULL language-audio slice DONE + browser-verified (2026-06-10).** Café lesson (`italian-cafe`) now has **44 audio clips**: 5 panel lectures + 27 inline vocab phrases + 3 dialogues + **3 grammar pearls (audiofied by Lucrezia)** + **6 story clips (3 verbatim Italian + 3 English-description, dual ▶)** + a **match-madness** widget. Plus the **side-rail TOC fix**: the language skeleton wrongly used horizontal top nav-dots that scroll away; converted to a **sticky 240px left-sidebar TOC** (7 labeled links + scroll-spy + theme switcher + responsive collapse) matching the medicine/FHE domains. Verified: 39 inline ▶, side TOC scroll, match-madness, audio panel — **0 JS errors**. **Skeleton TODO:** fold the side-rail TOC + inline-▶ audio into the canonical language-lesson skeleton so future `/chiron-language` lessons get them by default (currently retrofitted per-lesson). Plus the standing TODOs: extract player to standalone `audio-player.js`; bake retry-on-transient-error.

### Full-lecture design (decided 2026-06-10, Gyasi)

The **Full lecture ≠ Summary ≠ Section lecture** — three distinct jobs: Summary = ~30s recap; Section = ~1min deep-dive on one section; **Full lecture = the entire lesson TAUGHT aloud, end-to-end**, the hands-free "audiobook" version. Decisions:
1. **ONE huge flowing narrative** — woven, not section-concatenation; but **symbiotic with the lesson content** (grounded in the actual sections/phrases/pearls).
2. **Overlaps the section lectures, but is the FULLER one** — keep both (full = comprehensive arc; sections = deep dives).
3. **Scales to lesson size/content** (length grows with the number of sections / amount of material).
4. **Differs per domain:** **medicine** = "teach a chapter of a book" (the lecture IS the primary audio, course-level); **other domains** = a longer, more independent audio that fully explains the lesson.
- **Structure the Gemini prompt enforces:** warm hook → each section in order (set scene → key phrases in Italian → explain → one cultural nuance), woven as one story → synthesis + practice nudge. Teach-don't-read; mostly English narration with every Italian phrase as its own `it` segment.
- **Workflow: TRANSCRIPT-FIRST.** Generate the script *text* (Gemini) and review/refine it BEFORE baking — don't spend OmniVoice compute on a script that isn't right. Approved transcript → LectureScript (`«…»` = `it` segment) → bake (replaces `shortened.mp3`).
- **Validated 2026-06-10:** Gemini drafted a ~650-word café full-lecture (Trastevere morning → trattoria → il conto, one arc, Italian in «») — saved `chiron-italian-cafe/full-lecture.draft.md` for review. The Gemini-as-script-author approach works.

**⚠️ Bake resilience finding (2026-06-10):** under sustained load (~80+ synths across a session) the Atelier **OmniVoice sidecar can crash** — symptoms: a couple of HTTP 500s, then timeout, then "fetch failed" (connection refused). launchd auto-restarts it (KeepAlive; fresh PID, warm in ~seconds), and a **re-bake recovers** the failed clips via `script_hash` reuse (done clips skip, failed re-synth). **ROOT CAUSE diagnosed 2026-06-10 (Mac-side investigation):** Metal GPU OOM (`kIOGPUCommandBufferCallbackErrorOutOfMemory`, M1 Max) from **idle-unload thrash** — `KEEP_WARM=false` + `IDLE_UNLOAD_SECONDS=240` makes OmniVoice unload/reload its **7GB model per bake**; on a box already near the 55GB unified-memory cliff (Dia + Kokoro + ComfyUI also resident), a cold reload + 48-step diffusion blows the GPU command buffer. NOT swap-death, NOT concurrency (single-flight `Semaphore(1)` is correct). **Fix (Mac launchd plist):** `KEEP_WARM=true` (keep the model resident — no reload thrash) + `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` (Rule 3, `ollama-apple-silicon.md`) + gate governor Ollama probes on OmniVoice `busy=true`. This is the real cure; the bake retry-on-transient-error is the belt-and-braces complement. **HARDENING TODO:** `audio-bake` should **retry a clip on 500/timeout/fetch-failed** (e.g. 3× with backoff, re-checking `/readyz` so it waits out a sidecar restart) instead of marking it `failed` on the first error — turns a crash-mid-bake into a transparent recovery. Until then, re-run the bake after a crash (reuse makes it cheap).

**This is the next build phase** (extends the now-working core). Origin: Gyasi 2026-06-10 — "the audio part varies by domain… dialogues/scenes should ALWAYS be audio… short stories need verbatim Italian audio AND an English description… grammar pearls voiced + codified as rules."

## 5. Audio ↔ lesson binding (survives regeneration)

**Canonical artifact = the lecture script + `<ref>` markers, married into the HTML** (tiny, text). Audio is just a *render* of that script. Decided model: **content-hash–keyed sidecar**.

- Audio files live in `<lesson-output-dir>/audio/…`; HTML links by stable section id.
- Each clip recorded in the per-lesson `.chiron-state.db`, **keyed by a hash of the lecture script text**.
- On regeneration: script-hash unchanged → **reuse** the existing mp3 (don't lose, don't re-pay); changed → regenerate just that clip; manifest-vs-files → orphans are **detectable**, never silent.
- **Optional "bundle for export"** step inlines audio to data-URIs for a single portable file *on demand* — keeps the working copy light, self-contained only when you actually ship it.

This directly answers the four worries: don't lose / don't needlessly re-gen / don't orphan / still portable when wanted.

## 6. Delivery & playback

- **Async & non-blocking (BLOCKING).** Audio generation MUST NOT block lesson completion. The lesson HTML finishes and is usable on its own; audio bakes **asynchronously in the background** and the UI fills in as clips land. The feature is async by nature.
- **Shortest → longest generation order.** Bake in ascending length/time: **summary → shortened lesson → section-by-section.** The shortest artifact is playable first, so you can start listening while the longer ones are still generating.
- **Both** on-demand and prebuild (configurable). On-demand: a per-unit "Listen" control generates the clip first time, caches after. Prebuild: bake all units at lesson-build (still async / shortest-first).
- **Section voice-follow** (the only acolyte-derived behavior): inline `<ref id="section-id">` markers in the section script drive scroll-to + a single soft glow of the section as the audio reaches it. Conservative: max one orientation-scroll per lecture, glow is a one-shot fade. Markers are stripped from the spoken audio and from rendered text.

### Splicing / concatenation (RESOLVED 2026-06-09 — `tts-splice`)

Per-segment clips (esp. word-level language switches) must join **seamlessly**, not gappy. Pipeline order: synth each segment → `normLUFS` to −30 → **`tts-splice`** → final. Tool: **`~/.local/bin/tts-splice`** (Python; **soundfile + numpy + scipy**, all installed via `uv`; built + validated 2026-06-09, Gemini-researched). It trims edge-silence keeping **15ms lead / 30ms trail at −50 dBFS** (so plosive attacks + fricative/breath tails survive), 2ms declick, and joins per a **gap policy** grounded in speech-pause statistics:

| Join type | Gap (ms) | Join style |
|---|---|---|
| mid-word | 0 | 8ms **equal-power** crossfade |
| **word-level switch** (Italian word inside English) | 50–150 | xfade if 0, else silence |
| clause / comma | 300–500 (~470 mean) | silence |
| sentence | 750–1200 (~980 mean) | silence |
| paragraph / topic | 1500–2500 | silence |

Joins use an **equal-power** crossfade (cos/sin — constant perceived energy, the speech standard; linear dips volume at the seam). `tts-splice OUT.wav 0 a.wav b.wav c.wav` (uniform) or `--manifest file` (`path|gap_ms_after|[gain_db]`; `gain_db` e.g. −1.5 tames a foreign-word pitch reset). **Validated:** a 0-gap en→it→en splice ("…ask for a *cornetto* and you'll fit right in") removed ~0.76s of join dead-air vs raw concat and whisper-reads as one continuous sentence (`/tmp/lucrezia_splice/`). The Gemini-author emits the per-join gap class alongside each segment's `{lang, ref, <ref>}`.

**Future enhancement — prosody "context-buffer" stitching** (Gemini research): for the smoothest neural-clip joins, regenerate the **last 1–2 words of the previous clip together with the next clip** so OmniVoice matches pitch/inflection across the switch, then crossfade at a stable vowel. Deferred — the trim + equal-power splice is sufficient for v1; revisit if mid-sentence switches sound prosodically "reset." (Also: backfill gaps with faint room-tone instead of digital zero only if pure-silence gaps read as dead — clean TTS usually fine.)

## 7. Observability — progress + generation audit (founding principle)

No black-box generation. Both humans and agents can see what's happening.

- **Live progress.** Each unit reports progress as it generates (reuse the existing `skill/lib/progress.ts` surface): which artifact, which section, queued / authoring-script / synthesizing / normalizing / done. The UI shows per-unit status so the async bake is visible, not a silent wait.
- **Generation audit log.** The `.chiron-state.db` manifest records, per clip: artifact + granularity, section id, script-hash, voice + voice params (incl. HQ-toggle state / num_step), **reuse-vs-regenerate decision**, timestamp, byte size, and any failure with an actionable message. Machine-readable so an agent can poll "what baked, what was reused, what failed, what's pending."

## 8. Open decisions (resolve during buildout, in order)

1. **Atelier dependency / fallback.** Audio bake requires the Mac reachable: **OmniVoice `:8770`** (synth) + **governor `:8799`** (ETA/telemetry). Voice routing RESOLVED → per-language (§4: `pauls_tutor` for non-Italian; a native Italian clone for Italian, in progress). Graceful: lecture script+markers always render in HTML; audio bakes when Atelier is up (hash-cached → one-time). **Lean: hard-require the routed voice (no degraded substitute).** Confirm: any offline/dev fallback at all, or hard-require? Sub-task: ✅ DONE 2026-06-09 — `lucrezia_english` + `lucrezia_italian` cloned, verified (whisper round-trips verbatim), committed to `atelier/voices/registry.json` (registry now: galvatron, pauls_tutor, lucrezia_english, lucrezia_italian).
2. ~~**OmniVoice invocation path.**~~ **RESOLVED 2026-06-09** — `POST :8770/tts` (WAV out) + `ffmpeg loudnorm`→mp3; governor `:8799` for ETA/telemetry; `pauls_tutor` ref + params confirmed. See §4 "OmniVoice integration".
3. **Highlight-follow timing on PREBAKED audio.** Chunk each section lecture into segments (also needed for synth-time sanity) → **per-segment clips with known offsets** map directly to `<ref>` markers. Confirm segment boundary = per `<ref>` (one clip per pointed-at sub-section) vs sentence-level.
4. **Pipeline-stage mapping. RESOLVED 2026-06-09** (traced `lib/pipeline.ts` + `lib/assemble.ts` + `prompts/`). chiron is **Q8 prompt-handoff**: stages 1–4 don't call an LLM — they `loadTemplate(prompts/0X-*.md)` and emit a `PipelinePromptHandoff` the parent agent executes. Attachment points:
   - **Lecture-script gen (Gemini)** = a new Stage-04 prompt `prompts/04s-lecture-script.md` (per-granularity variants), emitted as a normal prompt-handoff but **routed by the parent to Gemini**. Output: structured JSON of the 3 artifacts, each a list of language-tagged segments `[{lang, text, ref, gap_after_ms, refAnchor}]` (+ verbatim-anchor flags). No new pipeline plumbing — a new prompt + a zod schema.
   - **Audio bake** = a NEW post-assemble module `lib/audio-bake.ts`, invoked AFTER `assembleLesson` (Stage 5), **async/non-blocking** (mirrors assemble's fire-and-forget browser open) — NOT a Q8 handoff (deterministic, no text-LLM). Per segment: POST OmniVoice `:8770/tts` (lang + routed ref: `pauls_tutor`/`lucrezia_english`/`lucrezia_italian`) → `tts-normalize -30` → `tts-splice` (gap policy) → `<lesson>/audio/<artifact>/<unit>.mp3`. Shortest-first (summary→shortened→sections); graceful if `:8770`/`:8799` down (lesson works, audio "pending").
   - **State DB** = extend `lib/sqlite-init.ts` with an `audio_clips` table (artifact, granularity, section_id, segments_json, **script_hash** for reuse, voice, gap_class, status, bytes, generated_at). `assembleLesson` already inits the DB (Step 2); audio-bake writes this table (the §7 audit log).
   - **Player + voice-follow** = in `skill/shell/`: a per-unit "Listen" control + `<audio>` for the sidecar mp3 + the `<ref id>`→scroll/glow JS (the lone acolyte-derived behavior); transcript+markers married into HTML at assemble; `build.sh` vendors the player JS/CSS.
   - **The existing `audio-tts` widget stays SEPARATE** (per-line Italian dialog ≠ lecture mode).

## 8.5 Build progress (implementation log)

- **2026-06-09 — deterministic core DONE + smoke-tested.**
  - `specs/001-chiron-v1/contracts/sqlite-schema.sql`: added `audio_clips` table (+ `idx_audio_clips_status`) — bake manifest + §7 audit log, `script_hash` reuse key.
  - `skill/lib/audio-bake.ts`: `bakeAudio()` — per-artifact (shortest-first), per-segment OmniVoice synth → `tts-normalize -30` → `tts-splice` → ffmpeg mp3 → `audio/...` + upsert `audio_clips`. Reuse on unchanged `script_hash`; graceful `pending` when Atelier down; progress→stderr. Compiles strict-clean.
  - **Verified against live OmniVoice:** summary (en/`pauls_tutor`) + a **bilingual section** (en `lucrezia_english` + it `lucrezia_italian`, `voice=mixed`) both baked to mp3 with correct manifest rows; re-bake → both `reused` (no re-synth).
  - **Bug fixed (was blocking):** `skill/lib/sqlite-init.ts` resolved the schema relative to the *source* depth, so the *compiled* `dist/lib/` build looked for `skill/specs/…` (doesn't exist) → `initDb` would fail on every real lesson (and thus every audio bake). Now walks up to find `specs/…/sqlite-schema.sql` (robust for src + dist).
- **2026-06-09 — Stage-6 wiring DONE (piece B).** `skill/lib/pipeline.ts`: added `stage6BakeAudio(ctx, {artifacts, voices, omnivoiceUrl?, playbackTarget?})` — runs AFTER `stage5Assemble` (lesson already built + open → non-blocking for the user), calls `bakeAudio`, no-op when no artifacts (audio is opt-in). `courseId = basename(lessonOutputDir)` (matches assemble). Compiles strict-clean; doctor ✅ healthy (36 modules), `tsc --noEmit` clean, test harness passes.
- **2026-06-09 — Stage-04s lecture-script gen DONE (piece A).** `skill/lib/schemas/lecture-script.ts`: `LectureScriptSchema` (Gemini authors pedagogy-only segments: `{lang, text, gapAfter: word|clause|sentence|paragraph, refAnchor?}` — NO voice) + `resolveLecture(script, domain)` → `LectureArtifact[]` (assigns voice via `voiceFor(lang,domain)`, gap-class→ms via `GAP_MS`, last-seg gap 0). `skill/prompts/04s-lecture-script.md`: the teach-don't-read prompt — per-granularity strategies, bilingual word-level Italian tagging (never leave it inside an `en` span), `<ref>` anchors. Exported via `schemas/index.ts`. Tested: schema parse, routing (`en/language-it→lucrezia_english`, `it→lucrezia_italian`, `en/code→pauls_tutor`), gap→ms, section-without-id rejected. Output matches `bakeAudio` input → full gen→bake path connected. Doctor ✅ (37 modules), `tsc --noEmit` clean.
- **2026-06-09 — Shell player + voice-follow DONE (piece C).** `lib/audio-bake.ts` now also writes `audio/manifest.json` (browser-readable view of `audio_clips`). `shell/main.js`: a self-building floating "🎧 Listen" panel (new IIFE) that fetches the manifest, lists Summary / Full lecture / per-section buttons (label = the section's heading text), plays the sidecar mp3, and on a section clip adds `.chiron-listening` glow to `#sectionId` + scrolls it into view (section-level voice-follow — the lone acolyte-derived gesture). `shell/styles.css`: themed player CSS via the `--color-*` tokens + reduced-motion fallback. No edits to `_base.html`/`_footer.html` (panel self-builds); graceful no-op when no audio. Builds clean; `main.js` syntax-valid; doctor ✅.
  - **v2 deferred:** fine-grained *within-section* `<ref>` follow needs per-segment cue timestamps in the bake (the spliced clip hides segment offsets). v1 ships section-level glow; cue-timed follow is the next enhancement (emit a `<unit>.cues.json` from the bake).
- **🎉 ALL PIECES BUILT (A+B+C + core + tooling).** Full path implemented & verified: Gemini 04s → `LectureScript` → `resolveLecture` → `stage6BakeAudio` → `bakeAudio` (OmniVoice → `tts-normalize` → `tts-splice` → mp3) → `audio/manifest.json` → shell player + section voice-follow. **End-to-end demo:** generating a real bilingual Italian lesson (`~/Documents/generated/chiron-italian-lesson/`, "Al bar") — Lucrezia bilingual, `al-bar` + `ordinare` section lectures + summary + full-lecture.
- **2026-06-10 — audio playback validated** (browser-driven): panel renders, mp3 loads (48s, −30 LUFS non-silent), click plays + section glows. **⚠️ `file://` BLOCKER (BLOCKING for the real product):** chiron's `assembleLesson` auto-opens `lesson.html` via `xdg-open` = `file://`, where the browser blocks `fetch` AND was masking the player. Mitigation shipped: `audio-bake` emits `audio/manifest.js` (a `<script>`-loaded global) + the player reads it before `fetch`. STILL: `file://` is unreliable for local media/the player — **the real chiron run must serve the lesson over HTTP (a tiny local server) OR embed audio**, not just `xdg-open` the file. (Also caught: shell assets must be RE-copied after edits — a stale `main.js` in the lesson folder showed no panel.) **NOTE:** the demo lesson was a hand-built STUB, NOT a real `/chiron` pipeline lesson — see memory `demo-on-real-system-not-stub`. Real `/chiron` generation is the next step.

## 9. Explicit non-goals

- NOT adopting acolyte's model/architecture/prompting/Kokoro (only its `<ref>` marker idea, section-by-section only).
- NOT Kokoro / edge-tts / Gemini-TTS / ElevenLabs as the voice — `pauls_tutor` via OmniVoice is THE voice.
- NOT reading the page prose aloud — every audio artifact is generated teaching, not narration of on-screen text.
- NOT replacing the existing `audio-tts` Italian-dialog widget — coexists.

## 10. References

- Voice: `atelier/voices/registry.json` → `pauls_tutor` (Mac `192.168.0.159`); synth via `voice-clone` skill's OmniVoice path; `~/.claude/rules/domains/mac-studio.md` for SSH/paths.
- Marker technique only: `~/Documents/code/acolyte/docs/voice-follow.md` (`<ref id>` → `splitByRefs` → `onRef` scroll+glow).
- Existing TTS plumbing to reuse: `skill/lib/tts-gemini.ts` (`prepareTtsHandoffs`/`recordTtsResult` — safe paths, idempotency, base64→mp3 persistence). Rename/repoint away from the dead `mcp__gemini-mcp__tts_synthesize_or_equivalent` placeholder.
- Pedagogy decisions captured in conversation 2026-06-09 (this PRD is the record).
