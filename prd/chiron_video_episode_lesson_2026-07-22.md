# PRD — Chiron Video-Episode Lesson ("Chiron Player")

**Status:** design / pre-pilot
**Created:** 2026-07-22
**Branch:** main · **Repo:** chiron (in-repo PRD, house convention — NOT global prd CLI)
**Ephemeral marker:** keep until the video-episode generation chain ships + first real episode lesson generated.

## 1. Context / What & Why

A NEW Chiron lesson type + generation chain: turn a **video the user OWNS** (movie or, preferred, an
**episode**) into a **Lucrezia Italian lesson** built around the actual footage. Inspired by Language
Reactor / asbplayer (authentic video + interactive transcript) but delivered as a **Chiron lesson** with
Lucrezia as tutor and an **FSI-style situational** pedagogy. Example framing (illustrative only): an
Italian series episode, treated as a downloaded local file.

The **spine is Lucrezia's baked teaching audio**, not the video. The video is the immersion middle.

## 2. The learning loop (FSI situational, per SCENE)

Episode = sequence of scene-lessons. Per scene:
1. 🎧 **Pre-brief** (Lucrezia, baked audio) — situation + who's who + 2-3 target structures to listen for.
2. ▶️ **Watch** the scene (real footage, original actor audio, character-attributed subs available).
3. 🎧 **Debrief** (Lucrezia, baked audio) — what happened + key phrases + why said that way.
4. 📖 **Read / study** — line-by-line character-attributed transcript; teach the **Italian OF the dialogue**
   (vocab/grammar/register/idiom per line). This is the curriculum.
5. ✍️ **Role-play** (text-first v1) — "you are <character>, reply"; Lucrezia feedback. Voice/mic later.
6. ↺ **Re-watch** with comprehension.

**Unit = SCENE** (coherent situation, FSI core unit). Line-by-line lives inside step 4.

## 3. Locked decisions (from user, 2026-07-22)

| Area | Decision |
|---|---|
| Playback surface | **BOTH** — HTML self-contained bundle (primary) + `chiron-player` CLI (same lesson JSON) |
| Role-play | **Text-first** (mic/Whisper feedback later) |
| First move | **/pilot first** — token-faithful HTML of the loop w/ dummy character-attributed data |
| Character NAMES | **Try screenplay (real names) → fall back to LLM-inferred + user confirm** |
| Persona | **Lucrezia** (Italian); dialogue-voicing rule; Lucrezia teaching audio baked, actor audio = source layer |
| Pedagogy | **Scene-by-scene FSI situational cycle** (§2), teach the Italian of the dialogue |

## 4. Transcript / script engine (THE hard core)

Priority ladder to get the script:
1. **Embedded subtitles** — `ffmpeg -map 0:s` (fast/free when present).
2. **Download** the episode SRT/transcript.
3. **VoxStruct** (`~/Documents/code/VoxStruct`, v0.2.1) — user's own package: ASR (Whisper/Vosk/Coqui,
   **remote sidecar by default** `VOXSTRUCT_ASR_BACKEND=remote` → Atelier whisper `:8766`) + **LLM
   supervision** to clean/structure, pause-based segmentation, YouTube support, markdown+metadata output.
   `TranscriptBuilder` is **speaker-aware** (`speaker` per segment, `speaker_changes`, `--detailed`
   emits speaker attribution).

**Character/voice attribution — MULTI-MODAL CASCADE (decided 2026-07-22).** VoxStruct is speaker-aware but
has no built-in diarizer, so we bolt on a fused stack; each layer helps the next, fall back down when a
layer is ambiguous:
1. **Voice — pyannote diarization** (CONFIRMED "bolt on pinote") → SPEAKER_00/01/02 turns by voice. Feeds
   VoxStruct's speaker field. Primary attribution signal.
2. **Text — screenplay parse** (when a script is found): must **separate actual spoken DIALOGUE from scene
   descriptions / stage directions / character-cue lines** (screenplay structure parsing — non-trivial),
   extract real character NAMES, align to diarized turns.
3. **Vision — facial recognition FALLBACK** (when voices can't be distinguished OR no script): detect +
   cluster on-screen faces during each line to attribute the speaker visually. Heavier; only when 1+2 fail.
4. Fuse → SPEAKER_xx → real character name (screenplay names, else LLM-infer + user confirm).

Runs on the Mac/Atelier (pyannote needs HF token + model; face-rec is a new sidecar). Not simple — scope
each layer; ship voice-first, add screenplay parse, then vision fallback.

**Persistent per-SERIES cast registry (decided 2026-07-22).** Because these are episodes of a series with
recurring characters, enroll each **main actor once** — store their **voice embedding (pyannote) + face
embedding** → a per-series cast DB keyed to character/actor. Every new episode matches against the registry
instead of cold-diarizing, so attribution gets faster + more accurate over time (and confirmed names carry
across episodes). Registry seeds from the first episode's user-confirmed mapping.

## 4b. Visual situation understanding — Gemini (decided 2026-07-22)

Teach the SITUATION, not just the dialogue. Use **Gemini multimodal video understanding**
(`mcp__gemini-mcp__watch_video` / `interpret_image` on scene clips/keyframes) to produce a
**visual track** per scene: what's happening on screen, **gestures / body language**, facial expression,
setting, who-does-what, emotional tone. Especially valuable for Italian (gesture carries meaning).

Feeds: the Lucrezia **pre-brief/debrief** ("notice how she crosses her arms — that's why the tone is
cold"), per-line/scene **teaching notes** (gesture ↔ meaning, non-verbal Italian, cultural body language),
and the scene **situation** description. This is SEMANTIC scene understanding — distinct from face-rec
(§4 layer 3), which is only speaker IDENTITY.

**HYBRID, local-first (decided 2026-07-22, verified Mac model inventory).** Don't lean only on Gemini.
- **Local VLMs on the Mac** (via Atelier governor `:8799/llm/ollama/api/chat` + images, R-AG1/2) for
  **per-keyframe** scene description (setting/expression/static gesture) — cheap, private, batchable:
  **`qwen3-vl:32b`** (20.9 GB, strongest local) primary · `qwen2.5vl:7b` (6 GB, fast, verified) ·
  `gemma3:27b`/`gemma4:*` alt · `moondream` (1.7 GB) cheap captions · **`deepseek-ocr`** (6.7 GB) for
  reading on-screen Italian text / burned-in subs.
- **Gemini `watch_video`** for the **TEMPORAL** layer only — motion + gesture-in-motion + scene dynamics
  (local VLMs see sampled frames, no motion). Reserve for scenes that need it (local-first ladder R-OC7).
- (No true local *video* model exists on the Mac — all local vision is image VLMs on sampled frames.)

## 5. Data model (both surfaces render this)

`episode → scene → line → { start, end, character, italian_text, en_gloss, teaching_note, visual_note? }`
plus per-scene `{ prebrief_audio, debrief_audio, target_structures[], situation, visual_situation }`
where `visual_situation` = Gemini's scene/gesture/setting understanding (§4b).

## 5b. Audio widget — persistent chiron-listen (REQUIRED, user 2026-07-22)

The standard Chiron **chiron-listen** audio widget MUST be present + persistent in this lesson type, exactly
like the existing language lessons — the ability to **just listen to Lucrezia** hands-free at two grains:
- **Per-scene** listen (Lucrezia narrates/walks through each scene), and
- **Whole-episode summary** listen (Lucrezia's overview of the entire episode).
Plus the per-scene pre-brief/debrief segments (§2). All baked (Atelier omnivoice, −16 LUFS). The widget rides
along every layout variant (not just one) — collapsible/auto-collapse per the existing chiron-listen behavior.

**Expectation set:** these lessons **BAKE LONGER** — far more audio (pre-brief + debrief + per-scene walk +
episode summary across many scenes) + the multimodal transcript pipeline. Plan for longer generation; make
the bake resumable/segment-cached (script_hash reuse, R-CH1) so re-bakes are cheap.

## 6. Reuse (do NOT reinvent)

- **Lucrezia audio bake** = existing Chiron path: Atelier **omnivoice** `:8770`, **−16 LUFS** (R-CH1/R-CH3b).
  Pre-brief + debrief are just more baked Lucrezia segments.
- **Whisper** ingest sidecar already wired (`:8766`, R-CH1 / G5 audio).
- **Pipeline-generated HTML only** (R-CH-PIPELINE) — agents emit DATA (scene/line JSON), assembler emits
  HTML; self-contained sibling asset paths; linguistic theme; chiron-listen audio widgets.
- Shell assets: `skill/shell/` (`language-lesson-skeleton.html`, `themes/linguistic.css`, `main.js`).

## 7. Open questions / next

- **NEXT ACTION: build the /pilot** (HTML, real Chiron linguistic tokens, dummy Italian
  character-attributed scenes) to validate the loop + player layout before writing the chain.
- Character attribution = voice(pyannote) → screenplay-parse → face-rec fallback (§4). Ship voice-first.
- Screenplay parsing must strip scene descriptions/stage directions from spoken dialogue.
- Screenplay fetch source(s) for Italian series — TBD.
- Face-recognition sidecar (Mac) — new build, fallback only.
- New generation chain + likely a new skill (e.g. `/chiron-episode`).

## 8. Voice-first build — SCOPE v1 (2026-07-23)

**Verified infra (live):** whisper sidecar `:8766` healthz 200 · omnivoice TTS `:8770` healthz 200 ·
VoxStruct already `VOXSTRUCT_ASR_BACKEND=remote → http://192.168.0.159:8766` · ffmpeg+ffprobe local ·
GEMINI/OPENAI keys in VoxStruct `.env`. **Key finding:** VoxStruct does the ASR+structuring but **does NOT
diarize** — it only preserves speaker labels if present. So pyannote is a SEPARATE stage merged onto ASR
word/segment timestamps (WhisperX-style max-overlap). Confirmed `get_asr_backend()` → `RemoteHTTPBackend(:8766)`
once VoxStruct's `.env` is loaded.

**Where it lives:** slots into chiron's existing arch (do NOT reinvent):
- ingest = a new **episode** flow beside `ingest-adapters/{video,audio,transcript}.ts` (Stage-0 pattern: deterministic + handoffs).
- heavy audio (VoxStruct+pyannote) = **python** → `skill/scripts/episode_ingest.py` (SCAFFOLDED this session).
- lesson gen = a new **chain** `("italian","episode") → chains/<date>_chiron-video-episode-chain/run.py` (register in `chains/dispatch.py`).
- render = extend existing `skill/player/` + the combined pilot layout.

**Pipeline status (skill/scripts/episode_ingest.py — compiles + backend verified):**
| # | stage | status |
|---|---|---|
|1| ffmpeg → 16k mono wav | ✅ built |
|2| ffprobe embedded subs → SRT parse (fast path, no speaker) | ✅ built (`--no-asr-if-subs`) |
|3| ASR word timestamps via VoxStruct remote → :8766 | ✅ built + backend resolves |
|4| **pyannote diarization → [{start,end,speaker}]** | ⛔ **STUB — THE GAP** |
|5| merge speakers→lines (max-overlap) | ✅ built |
|6| scene segmentation (silence-gap v1) | ✅ built (ffmpeg scene-detect/chapters later) |
|7| speaker→character (registry / SPEAKER_xx; screenplay+LLM later) | ✅ built (map/passthrough) |
|8| emit `transcript.json` (scene→line contract) | ✅ built |

**Emitted contract (Phase-1 output, Player renders this; Phase-2 fills the nulls):**
`{language, source_kind, scenes:[{scene,start,end,title?,situation?,visual_situation?,target_structures[],
prebrief_audio?,debrief_audio?, lines:[{start,end,character,italian_text,en_gloss?,teaching_note?}]}]}`

**THE GAP — pyannote (decision needed):**
- **(A)** governed Mac sidecar `pyannote/speaker-diarization-3.1` (HF token) beside whisper `:8766` — the durable path (matches R-CH1/atelier-governor), or
- **(B)** `pip install pyannote.audio` into VoxStruct's `.venv` for local dev (pulls torch) — faster to a first result.
Rec: **B to prove the merge end-to-end, then A** for production.

**Run today:** `~/Documents/code/VoxStruct/.venv/bin/python skill/scripts/episode_ingest.py EP.mkv --out ./out --lang it`
(speakers = SPEAKER_?? until pyannote; `--speaker-map SPEAKER_00=Lucia,…` to hand-label; `--no-asr-if-subs` for the subs fast path).
**Blocked on:** a real owned episode file to test against + the pyannote (A/B) decision.

**Phase order:** P1 voice-first transcript (this) → P2 enrichment chain (en_gloss/teaching_note/situation via Gemini+local-VLM) →
P3 Lucrezia bake (pre-brief/debrief/scene/episode audio) → P4 Player render + CLI → P5 per-series cast registry + face-rec fallback.

## 9. Scene layer + OmAgent adoptions (2026-07-25)

**Scene brackets = PySceneDetect (shots) + Gemini (semantic scenes), snap-merged** — new
`skill/scripts/scene_brackets.py`. Rationale: PySceneDetect detects SHOT cuts (frame-accurate) but a
narrative scene = many shots (shot/reverse-shot) → shots≠scenes; Gemini gives semantic narrative scenes
+ names but only ~1s-accurate. MERGE: Gemini decides boundaries, snap each to nearest PySceneDetect cut →
named, frame-accurate scenes. Gemini call = 360p proxy → Files API upload → JSON scene list (google-genai
in VoxStruct venv). `episode_ingest.py --scenes scenes.json` groups dialogue into these brackets.
`label_speakers` got a **dominant-cluster naming cap** (>30% of lines + <4 votes → stays SPEAKER_xx) to
kill the Camilla-50% mislabel. Deps added to VoxStruct venv: scenedetect 0.7.1, google-genai, opencv 5.0.

**OmAgent (arXiv 2406.16620 = "Video2RAG") adoptions** — our pipeline independently matches theirs
(scene-detect + ASR + face-rec → MLLM captions). Adopt: **(a)** structured 6-field scene-caption schema
(time·location·characters+relations+actions·event-list·on-screen-text/expressions·summary) → enrich the
Gemini scene prompt [HIGH, prompt-only]; **(b)** per-episode vector+keyword+**timestamp-filtered** store
feeding the Lucrezia tutor (:8912) so she answers grounded in the episode [HIGH, later phase]; **(c)** a
**Video Rewinder** tool — on-demand re-caption of a timerange when a scene is thin (scene_brackets already
has the proxy+Gemini machinery) [HIGH, later phase]. Consider: face-box burn-in for visual identity
[MED]. SKIP: full Divide-and-Conquer agent (Conqueror/Divider/Rescuer) — open-ended QA over unbounded
video, overkill for bounded-episode authoring.

## Decisions Log
- 2026-07-25 — **audio-llm sidecar = MULTI-MODEL + GOVERNOR-REGISTERED.** Rewrote sidecar to multi-model
  (one resident, hot-swap per request `model=<alias>`; weights cache to Mac HF_HOME disk). Registry:
  `qwen2-audio` (mlx-community/Qwen2-Audio-7B-Instruct-4bit — WORKS, default), `voxtral`
  (mlx-community/Voxtral-Mini-3B-2507-bf16 — needs more deps: librosa done, mistral-common insufficient →
  likely `mistral-common[audio]`; registered, not yet working), `qwen3-omni-captioner`
  (Qwen3-Omni-30B-A3B-Captioner — scene-desc, Phase 2). `GET /models`, `model=` on /classify + /describe.
  **Registered in the GOVERNOR** (`atelier/sidecars/governor/server.py`, backup made): URL map (:8768),
  log path, launchd label, description, managed-set — so the governor monitors/`make-room`/`force-stop`s it
  like the others; kickstarted + verified in /agent. NOTE: Qwen2-Audio still *transcribes* rather than emits a
  category, but the transcript cleanly separates AD (scene narration) vs clean (dialogue) → auto-selection =
  classify the transcript (diff vs subtitles / governor LLM); Voxtral (instruction-following) would answer
  directly once its deps land.
- 2026-07-25 — **AUDIO-LLM sidecar LIVE (:8768) + approach VALIDATED + newest model.** Built governed Mac
  sidecar `~/services/audio-llm-sidecar` (port 8768, launchd `io.macstudio.hub.audio-llm`, cooldown/self-reclaim,
  mlx-audio venv). `/classify` `/describe` (file|path|url). **Validated with Qwen2-Audio on Baby's 2 ita tracks:
  AD (stream5) → "Damiano arriva nel cortile… resta ad ammirare il suo mezzo…" (textbook scene NARRATION);
  clean (stream6) → "Perfetto per il cibo che non ti piace" (DIALOGUE).** Clear separation → the sidecar can pick
  the clean track AND harvest the AD narration for Phase-2 scene descriptions. Qwen2-Audio defaulted to transcribe
  (ignored the classify instruction), so → **switched to newest instruction-following audio model: Voxtral Mini
  (`mlx-community/Voxtral-Mini-3B-2507-bf16`)** so /classify answers the category. Model is one env var
  (`AUDIO_LLM_MODEL`). **Model map:** Voxtral = classify/Q&A (newest, instruction-following, Apple-Silicon-opt);
  **Qwen3-Omni-30B-Captioner** = best rich audio *captioner* (no prompt) → the Phase-2 scene-description model;
  Qwen2.5-Omni superseded. (User: use the NEWEST/best, not pinned to Qwen2.)
- 2026-07-25 — **Clean-audio result + AUDIO-LLM sidecar (in progress).** Re-ran on stream 6 (clean dialogue):
  player overlay GONE ✅, but attribution ~unchanged (62% vs 61%, Chiara still 156) → **the AD track was NOT
  the attribution culprit** (corrected my hypothesis); Chiara=156 is genuinely the voiceover narrator+lead.
  Remaining naming gap = sparse [Name] anchors + diarization limits → cross-episode registry over E02-06.
  **AUDIO-TRACK VERIFIER — building a governed Mac AUDIO-LLM sidecar** (user: Qwen2-**Audio** v2, NOT v3, +
  Qwen2.5-**Omni**) to classify clean-dialogue vs audio-description/commentary/dub from a 60-120s clip (robust
  when titles are missing/wrong) AND to positively ID the AD track for Phase-2 scene descriptions. Verified
  MLX path (no guessing): **Qwen2-Audio-7B** = `mlx-community/Qwen2-Audio-7B-Instruct-4bit` (~4.2 GB) via
  **`mlx-audio`**; **Qwen2.5-Omni-7B** = `giangndm/qwen2.5-omni-7b-mlx-4bit` via **`mlx-lm-omni`**;
  `mlx-omni-server` = OpenAI-compat option. New sidecar `~/services/audio-llm-sidecar` (port :8768), venv +
  mlx-audio installing. Governed like pyannote (healthz/readyz/admin-unload + cooldown self-reclaim R-AG4b +
  launchd + governor reg). Endpoints: /classify (fixed track-type JSON), /describe (free-form, for scene
  desc). Will PROBE the real mlx-audio API before finalizing server.py (avoid the pyannote guess-churn).
  Local-first (R-OC7); Whisper+governor-LLM transcript-diff is the cheaper fallback if the audio-LLM is
  overkill. **Also (Phase 2):** AD track (stream 5) = free professional Italian scene-description → transcribe,
  subtract subtitle dialogue, remainder feeds Lucrezia's situation/visual layer.
- 2026-07-25 — **AUDIO-DESCRIPTION track pollution (important, reusable) + real PLAYER.** Baby ships TWO
  `ita` audio streams: **5 = "Italiano - Audiodescrizione"** (AD narrator describing the scene, wrongly
  `default=1`) and **6 = "Italiano [originale]"** (clean dialogue). We were mapping the FIRST ita (5) → the
  player had a narrator OVERLAY and diarization saw the AD narrator as a constant extra "speaker" (a big Voce
  cluster + likely the Chiara over-count). FIX: `audio_stream_index` now SKIPS AD tracks by TITLE
  (`audiodescr|descript|comment|narrat|visual|impaired`) — the `visual_impaired` disposition is often unset —
  and prefers "originale"; re-transcode + re-diarize on stream 6. **OPPORTUNITY (Phase 2):** the AD track is a
  professional Italian scene-description synced to time — transcribe it, subtract the subtitle dialogue, and
  the remainder = per-scene visual/situation narration for the lesson (free, native, human-authored).
  **REAL PLAYER shipped:** `render_episode_viewer.py` now emits a `<video>` (episode.mp4, 720p h264+aac clean
  audio) with **click-a-line→seek**, click-chapter→seek, and play-along line highlighting — VERIFIED (clicking
  a 43.6s line set video.currentTime=43.61) + user-confirmed scene-skip + click-to-seek work.
- 2026-07-25 — **Sidecar-unreachable ROOT CAUSE + 2 fixes + persistent voice registry.**
  ROOT CAUSE (proven via governor `/pressure` autoheal log): the **Atelier governor auto-heal (g)**
  `kickstart -k`'d pyannote (twice; held 1.7/2.0 GB while `state=cold` > `AUTOHEAL_FLOOR_GB=1.5` — the
  R-AG4b MPS RSS leak). NOT memory pressure (76% free) / NOT OOM (graceful SIGTERM). The 22-call per-scene
  run collided with a kickstart window. FIX-1 (reliability): **retries** in the diarize client (survives a
  mid-run restart) — verified. FIX-2 (durable, user's idea): pyannote is a BURSTY BATCH sidecar → **cooldown**:
  `IDLE_UNLOAD_S=180` + self-reclaim `RECLAIM_THRESHOLD_GB=0.8` → idle → self-restart to cold/~0.05 GB, stays
  under the governor floor so it never needs to intervene + frees memory when unused (verified rss 0.05).
  **CROSS-SCENE + PERSISTENT VOICE REGISTRY** (raises naming coverage; user: "don't rebuild the map every
  episode"): community-1 `DiarizeOutput.speaker_embeddings` (N×256) now returned by the sidecar; per-scene
  local voices get embeddings; `VoiceRegistry.propagate` names un-anchored voices by cosine match to anchored
  ones (thresh 0.5). PERSISTED per series at `~/.chiron/voice-registry/<series>.json` (name→[≤8 exemplar
  embeddings]) — E01 builds Baby's cast; E02-06 SEED from it (match new-episode voices to the saved cast,
  only new characters need new mapping). `--series/--registry/--voice-thresh` flags; series auto-derived from
  filename. Also: viewer `render_episode_viewer.py` (self-contained HTML, scenes-as-chapters, char chips,
  Voce N for unknowns, desktop/mobile).
- 2026-07-25 — **E01 take-2 (scene layer): scenes GREAT, attribution still broken → next fix = per-scene.**
  scene_brackets.py on E01: 549 PySceneDetect shot cuts + 22 Gemini scenes (gemini-flash-latest, 28MB 360p
  proxy) snap-merged → 22 NAMED scenes w/ location+situation+characters_present (21/22). Gemini video_summary
  correctly IDs leads Chiara+Ludovica. Huge improvement over 77 silence-gap scenes. BUT attribution still
  wrong: naming cap did NOT clear "Camilla"=208 lines (50%) because it's whole-episode DIARIZATION OVER-MERGE
  (Chiara narration+Chiara+Ludovica → one cluster SPEAKER_03, named Camilla from exactly 4 votes == cap
  threshold). Verified: sc5 2-person bathroom dialogue all "Camilla"; Camilla's first line = Chiara's opening
  voiceover. **DECIDED NEXT FIX: per-scene attribution** — diarize each scene CLIP (2-4 local voices) + map
  local speakers → that scene's Gemini `characters_present`, anchored by subtitle [Name]s. Whole-episode
  diarization+global naming abandoned. (build pending.) Output: `~/Documents/generated/chiron-baby-s01e01/`.
- 2026-07-25 — **FIRST real run: Baby S01E01 "Superpoteri"** (episodes at `~/Documents/code/series/epi/downloads/`,
  each with sibling `.it.srt`/`.en.srt`). Ran `episode_ingest.py` with new `--srt` (use sibling Italian subs) +
  Italian-audio-track selection (stream 5, NOT the German default) + `[Name]` bracket parsing (capitalized=character,
  lowercase `[ridacchia]`/`[sospira]`=sound-cue → dropped) + `label_speakers` (vote a name per diarized voice from
  the subs' `[Name]`s, propagate across the cluster). **Result:** 417 dialogue lines, 879 diarized turns (pyannote
  community-1 MPS), 77 scenes, transcript.json (scene→line schema). 4 voices named (Camilla/Fabio/Nico/Matrigna) →
  60% line coverage. **OBSERVED QUALITY ISSUES (real, verified by reading the json):** (1) pyannote OVER-MERGED —
  `SPEAKER_03`=208 lines (50% of episode), so a stray `[Camilla]` vote mislabeled the whole cluster; protagonist
  Chiara (narrator) never named. Naming is over-confident on a bad cluster. (2) 77 scenes too granular (4s gap
  over-splits; median 4 lines, 15 one-line scenes). (3) dual-speaker cues `- [A] … - [B] …` assigned to one char.
  **FIXES (tunable, non-structural):** vote threshold + cap (don't name a >~30%-of-episode cluster from 1-2 votes);
  pyannote min/max_speakers hint or looser clustering; scene gap ~8-10s or ffmpeg video scene-detect; split dashed
  dual-speaker cues. Output: `~/Documents/generated/chiron-baby-s01e01/transcript.json`.
- 2026-07-24 — **pyannote sidecar VERIFIED WORKING (MPS).** Real `/diarize` returned speaker turns on MPS
  (`device:mps`, ~15.6s cold incl. model download, warm after). Using **pyannote.audio 4.0.7 latest** →
  model **`pyannote/speaker-diarization-community-1`** (v4's best; the 3.1 pipeline now pulls community-1
  internally anyway). Token = the cached `~/.cache/huggingface/token` (`token=True`), NOT `~/dev/.env`.
  v4 API fixes: `token=` not `use_auth_token=`; output object `.speaker_diarization.itertracks()`. User
  accepted gated terms on speaker-diarization-3.1 + segmentation-3.0 + **community-1**. Whole
  ASR→diarize→merge chain is now unblocked — only a real episode file remains to produce a live transcript.json.
- 2026-07-24 — **pyannote path = A (governed Mac sidecar), BUILT + LIVE.** New `pyannote-sidecar` on the Mac
  `:8767` (sibling of whisper :8766): code `~/Documents/code/atelier/sidecars/pyannote/server.py` symlinked into
  `~/services/pyannote-sidecar/`, uv venv (py3.11, torch 2.13.0 + pyannote.audio installed), launchd
  `io.macstudio.hub.pyannote` (caffeinate+uvicorn, MPS env, KeepAlive.SuccessfulExit=false; R-AG4b RSS
  self-restart via exit 42). Endpoints: /healthz /readyz /agent /admin/unload /diarize (file|path|url →
  {segments:[{start,end,speaker}],num_speakers}). healthz/readyz verified from Linux. `episode_ingest.py`
  stage 4 now POSTs the wav to `:8767` (CHIRON_DIARIZE_URL override, graceful []-fallback). Token loaded from
  Mac `~/dev/.env` via dotenv. **BLOCKER: HF_TOKEN not set** — needs a HuggingFace token with terms accepted on
  pyannote/speaker-diarization-3.1 + pyannote/segmentation-3.0 → Mac `~/dev/.env`. `readyz.hf_token:false` until then.
- 2026-07-22 — Spec captured. User picks: both surfaces, text-first role-play, pilot-first, screenplay→infer
  fallback, WhisperX/pyannote was the agent's wrong guess → corrected to **VoxStruct** (user's own package)
  as transcript engine. Pedagogy = scene-by-scene FSI situational loop with Lucrezia baked audio as spine.
- 2026-07-25 — **PHASE-2a ENRICHMENT SHIPPED + VISUALLY VERIFIED (the FSI curriculum layer).** New
  `skill/scripts/episode_enrich.py` — reads Phase-1 `transcript.json`, per-SCENE LLM pass (house pattern:
  PromptChain single-step, glm-5.1→gemini-flash ladder + self-repair + `over_worklist`, resumable, `.bak`
  before write) fills the null teaching slots: per LINE `en_gloss` + `teaching_note` (Lucrezia register,
  cites Italian in <em>, register-honest), per SCENE `target_structures[]` (2-4 "listen-for" points).
  **Baby E01 run: 417/417 glosses (100%), 295 teaching-notes, 22/22 scenes with target_structures** —
  no model exhaustions. Quality confirmed by reading the JSON (teaches *che cazzo*=vulgar, *ti sentissi*=
  imperfect-subjunctive-of-doubt, *c'ho*=spoken contraction). `render_episode_viewer.py` extended to render
  both new slots (per-line `.tn` teaching note w/ <em>→accent, per-scene `.ts` "LISTEN FOR" chips) —
  **pw-shot screenshot VERIFIED** they display in the player (scene 1 header chips + per-line notes visible).
  This is PRD §2 step-4 "teach the Italian OF the dialogue" = the READ/study curriculum. Run:
  `~/miniconda3/bin/python3 skill/scripts/episode_enrich.py <episode_dir> --concurrent`.
  **STILL AHEAD:** P2b `visual_situation` (gesture/setting from Gemini + the AD track); P3 Lucrezia bake
  (pre-brief/debrief/scene/episode audio — the lesson SPINE); P4 role-play. Curriculum content done; the
  audio-taught FSI loop (pre-brief→watch→debrief→study→role-play) is next.
- 2026-07-25 — **THREE audio-layer requirements captured (drive P2b→P3) + P2b started.**
  User clarified BEFORE building the bake, and these reshape the audio design:
  (1) **DUAL-MODE / listen-only podcast (BLOCKING).** Like the existing lessons' read-or-listen-or-both,
      the episode audio bake MUST stand alone: if the learner is NOT watching the video, Lucrezia still
      DESCRIBES what's happening on screen (setting/action/who-does-what/the tone-flip) AND teaches all the
      language detail (word meanings, how-often-used, grammar). Keep the warm beats ("I love this — watch how
      fast the tone flips") but write so it works watched OR heard-only. → this is WHY P2b (capture the visual
      description) must land before P3 (bake).
  (2) **INTERLEAVED splice-and-dice (new).** A separate audio mode where Lucrezia's baked TTS is SPLICED with
      the REAL video audio: she says "listen to this", plays the actual scene clip, may repeat a line 2×, pause,
      then resume. So the Phase-3 audio timeline is a MIX of segment types: {type:"tts",lang,text} + 
      {type:"clip",src:episode.mp4,start,end,repeat?,gainDb?} + pauses. Reuse ~/.local/bin tts-splice/tts-normalize
      + ffmpeg clip-cut. Needs per-line clip time-ranges (we HAVE them in transcript.json).
  (3) **GRACEFUL FALLBACK for the visual description (new).** AD track = PRIMARY source when present; if an
      episode has NO audio-description track, FALL BACK to a model: audio-llm sidecar `/describe`
      (qwen3-omni-captioner) on the scene clip, or Gemini watch_video / local VLM keyframe (PRD §4b). Never fail —
      always produce a visual_situation.
  **P2b BUILD (episode_visual.py, this session):** source Baby E01 has AD = stream 5 ("Italiano -
  Audiodescrizione"), stream 6 = clean [originale]. Plan: extract AD stream → chunk → whisper :8766 /transcribe
  (verbose_json, timed IT) → SUBTRACT dialogue-overlapping segments (transcript.json line intervals) so only the
  gap-narration remains → bin to scenes → per-scene LLM (reuse episode_enrich ladder) → `visual_situation
  {it,en,source,raw[]}` written into transcript.json. Runs under ~/miniconda3 (promptchain), whisper via requests
  (no voxstruct venv needed). raw[] timed narration kept for P3 interleave.

## 10. Radio-D teaching principles to fold in (2026-07-25, user)

Radio D (Deutsche Welle's audio-first course) = the existence proof that audio-only language teaching works.
Adopt its structure into the episode build (guidance; most are P3 player/bake, #1/#2/#6 touch enrich/2b):

1. **Difficulty ramp via SCAFFOLDING, not reordering (episodes stay in broadcast order).** Score each scene's
   difficulty from data we ALREADY have in the enriched transcript — speaker count, speech rate (chars/sec),
   slang/vulgar density, how much the visuals carry (dialogue-sparse + AD-rich = visual-carried) — and scale
   how much scaffolding a scene gets (harder scene → longer pre-brief, more glossing, slower). Deterministic
   `difficulty` score per scene; DO NOT reorder the episode. [enrich v2]
2. **Speech-ACT tags beside grammar (BOTH, not either).** target_structures are grammar-shaped
   ("imperfect-subjunctive-of-doubt"). Radio D groups by FUNCTION — how you greet / express irritation / ask
   someone to repeat. For a teen drama, "this is how Italians snap at someone" is more usable than the mood's
   name. Add `speech_acts[]` (function labels) alongside grammar target_structures. [enrich v2]
3. **REPLAY the clip, don't quote it.** Radio D replays the scene audio during the explanation (same clip twice:
   once cold, once framed). Our debrief quotes the line as text — instead play the real 4-second clip inline
   (nearly free; we have per-line time-ranges). = the INTERLEAVE requirement (§9 audio-req 2). [P3 + player]
4. **A CALIBRATION scene first.** Radio D's episode 1 teaches no vocab — it proves how much you infer from sound
   alone. Add one early scene where Lucrezia says "don't chase words — just watch/listen, tell me what happened,"
   killing the "I won't understand any of this" barrier before it forms. [P3 authored intro scene]
5. **Grammar as EXPANDABLE, not inline (Netflix-and-chill mode).** Radio D quarantines grammar in a "?"-boxed
   aside. Our subjunctive note sits mid-brief. In the player, make the grammar detail SKIPPABLE — a collapsible
   the learner opens if they want it; the default flow stays clean. [player]
6. **Fallback description MUST describe what was SEEN, not what was SAID (load-bearing).** The AD track already
   describes visuals (a human watched). But the audio-captioner fallback (Qwen3-Omni) ONLY HEARS — so the true
   "describe what's seen" fallback is GEMINI watch_video / local VLM on keyframes (actual pixels), with the
   audio-captioner as LAST resort. Enforced the writing constraint explicitly in episode_visual.py
   (shape_visual captioner directive + caption prompt): describe setting/who/actions/gestures/mood for a
   non-watching listener, never a summary of the words. TODO: add the Gemini/VLM-pixels fallback ahead of the
   audio-captioner in the ladder (Baby has an AD track, so not exercised yet). [2b hardening]

## 11. TWO SURFACES for the SAME data: video-podcast AND audio-podcast (2026-07-25, user — BLOCKING)

Every rule/tag/segment MUST be designed for BOTH surfaces at once. This is the master constraint on P3:

- **VIDEO-PODCAST** (watching, on a screen — the Player): video + click-to-seek transcript, `visual_situation`
  shown as an "on screen" line (supplement — you can see it), `target_structures`/`speech_acts` as chips,
  teaching notes inline, grammar in an EXPANDABLE box (Radio-D #5), a per-line REPLAY button (#3),
  difficulty shown as scaffolding density (#1), the per-scene clean WATCH, and the FINAL immersion play.
- **AUDIO-PODCAST** (mobile, screen OFF, listening only — a single baked timeline): Lucrezia VOICES everything
  the screen would show. `visual_situation` becomes SPOKEN narration (essential, not supplement —
  "Chiara entra nella toilette…"); `speech_acts` spoken ("ecco come ci si arrabbia in italiano…"); the real
  clip audio SPLICED in ("ascolta…" → clip, maybe 2×); grammar an OPTIONAL spoken aside; difficulty scales how
  much she explains before playing. Must stand alone with no screen. This is the Radio-D mode.

Same `transcript.json` feeds both. The **P3 bake emits an AUDIO TIMELINE** (the audio-podcast) = ordered segments
`{type:"tts",lang,text,voice} | {type:"clip",src,start,end,repeat?,gainDb?} | {type:"pause",ms}`; the **Player
renders the video-podcast** from transcript.json + the per-scene TTS segments. Design each feature as a
(video-rendering, audio-rendering) PAIR — never one without the other.

**PLAYBACK MODES (decided 2026-07-25, user = "Both"):**
1. Per-SCENE cycle (FSI): pre-brief → **clean WATCH of the real clip with ORIGINAL Italian audio (no Lucrezia
   over it)** → debrief → study → role-play. Everything per SCENE (not per episode).
2. **FINAL whole-episode IMMERSION playthrough**: continuous watch of the FULL episode, ORIGINAL audio + video,
   NO Lucrezia, no subs — the graduation/comprehension test ("did I get it?"). The one deliberately per-EPISODE
   surface, alongside the episode-summary listen.

All per-SCENE (confirmed): visual_situation, target_structures, speech_acts, teaching, pre-brief/debrief/
scene-walk audio. Per-EPISODE only: the summary listen + the final immersion playthrough.

- 2026-07-25 — **GRADUATION bar (user):** the FINAL immersion is THE test — play the ENTIRE episode with
  ORIGINAL audio and NO help; the AUDIO-ONLY full-episode comprehension (screen off, understand every word) is
  the golden bar ("if you get it completely after all the scene lessons, you're golden"). Exists on both
  surfaces but the audio-only pass is the real graduation.
- 2026-07-25 — **PHASE-2b SHIPPED + VISUALLY VERIFIED (visual_situation from the AD track).** New
  `skill/scripts/episode_visual.py`: extract AD stream (Baby E01 = stream 5) → chunked whisper :8766 transcribe
  → SUBTRACT dialogue-overlapping segments (transcript line intervals) → bin gap-narration to scenes → per-scene
  LLM shape (reuse episode_enrich ladder) → `visual_situation {it,en,source,raw[]}`. **Baby E01: 22/22 scenes,
  all from AD track, 384 timed narration segs kept for the P3 interleave.** No captioner fallback needed.
  Output is authentic native Italian scene narration (scene 1: "Chiara, una sedicenne dai chiari occhi sognanti,
  è sveglia a letto…") = the listen-only-podcast source. `render_episode_viewer.py` renders an "ON SCREEN" block
  (EN gist + IT) — **pw-shot VERIFIED** it displays. Fallback (no AD) = audio-llm captioner with the seen-not-said
  constraint (Radio-D #6); TODO add Gemini/VLM-pixels ahead of it. MULTI-LANGUAGE/PERSONA seam added:
  episode_enrich + episode_visual take --lang/--persona (default it/lucrezia). Transcription hit one whisper 500
  on chunk 10 (recovered — chunk-level graceful skip). Run: `episode_visual.py <dir> --video-src <mkv> --audio-lang it`.
- 2026-07-25 — **ENRICHMENT v2 SHIPPED + VERIFIED (difficulty + speech-acts, Radio-D #1/#2).** New
  `skill/scripts/episode_tags.py` (additive, resumable). (1) **difficulty** = deterministic per-scene
  {score 0-1, band easy|medium|hard, factors:{speakers, speech_rate_cps, slang_frac, visual_carry}} from data
  already present — weighted 0.30 speakers + 0.30 rate + 0.20 slang + 0.20 visual-carry. Baby E01: 3 easy / 15
  medium / 4 hard (a real ramp). Drives SCAFFOLDING density, NEVER reorders. (2) **speech_acts[]** = LLM
  (episode_enrich ladder), the FUNCTIONAL layer beside grammar target_structures: {function (learner-facing "how
  you DO it"), example_it (a real phrase FROM the scene), example_en}. 22/22 tagged — e.g. scene 5 "snapping at
  someone rudely → Che cazzo vuoi?", scene 4 "asserting dominance / brushing someone off coldly". Both feed BOTH
  surfaces. Player renders a difficulty BAND BADGE + rail difficulty DOTS + a "how to" speech-act chip row
  (example on hover) — **pw-shot VERIFIED** (MEDIUM badge + green/amber/red rail dots visible). Multi-lang/persona
  via --lang/--persona. Run: `episode_tags.py <dir> --lang it`. transcript.json now carries the COMPLETE lesson
  dataset (P1 timings/attribution + P2a gloss/notes/structures + P2b visual_situation + v2 difficulty/speech_acts)
  → ready for P3 dual-surface bake.

## 12. PHASE-3 dual-surface bake — SHIPPED (slice verified), fast-bake = Modal (2026-07-25)

`skill/scripts/episode_audio.py` — stages author→bake→splice→player, scene-resumable, `--scenes N` slice.
- AUTHOR (LLM, Lucrezia EN): per scene {prebrief, key_lines[{line_i,intro,explain}], debrief}, difficulty-scaled,
  grounded in visual_situation (screen-off) + teaching_notes + speech_acts → deterministic scene.audio_timeline =
  [{tts}|{clip line_i,start,end,repeat}|{pause}] (clip timings REAL; hard scenes REPLAY the clip = Radio-D #3).
- BAKE = MODAL fast-bake ("mold out"=Modal): fans TTS to Modal L4 (modal/modal_synth.py, bucket=8 concurrent =
  the rolling-window workers), byte-identical to Mac omnivoice, -16 LUFS. VERIFIED 12 segs → 45s GPU. Slow =
  --engine mac (omnivoice :8770). TTS voice = lucrezia_english; the ITALIAN comes from the REAL clips (authentic).
- SPLICE (audio-podcast only): cut clips + tts-splice → per-scene mp3 + episode-podcast.mp3. scene1.mp3 111s,
  scene2.mp3 70s verified.
- DUAL-SURFACE (decided w/ user): VIDEO surface does NOT bake a spliced file — the player ORCHESTRATES a playlist
  (play TTS → SEEK <video> to clip → resume; only TTS baked, clip plays live). AUDIO-PODCAST = the spliced mp3.
  Same audio_timeline drives both. "Listen with Lucrezia" button VERIFIED headless (click→audioSrc=scene1_0.mp3,
  playing, readyState 4).
- TODO: bilingual TTS split if EN-only+IT-clips insufficient; calibration scene (#4); expandable grammar (#5);
  final immersion playthrough surface (§11 mode 2).
- 2026-07-25 — **AUDIO-LEVEL FIX (clip loudness, user-reported "can barely hear the Netflix special").**
  Measured: Lucrezia TTS −16.8 LUFS (good), raw episode.mp4 clip −27.1 LUFS (TV master), "normalized" podcast
  clip −35.2 LUFS — single-pass loudnorm MIS-normalizes short 2-4s dialogue clips. FIX 1: episode_audio.py
  `_cut_clip` now MEASURES integrated LUFS then gain+alimiter to −16 (bounded, max +18dB) → re-cut clips
  −15.7..−17.0 across scenes, re-spliced all 22 podcasts (verified). FIX 2: video surface — HTML <video>.volume
  caps at 1.0 so the −27 LUFS stayed quiet even at max; added a WebAudio GainNode (VIDEO_GAIN=3.6 ≈ +11dB) +
  compressor/limiter in render_episode_viewer.py, inited on first play/Listen gesture. VERIFIED headless:
  AudioContext running, gain 3.6, video playing through it. Both surfaces now level-matched to Lucrezia.
- 2026-07-25 — **PLAYER: multiple VIEW MODES + video-PIN (user: "more than one way to see the lesson").**
  render_episode_viewer.py now has a top-bar mode switcher (persisted to localStorage), the pilot's multiple ways:
  • READER (default) — video PINNED at top (sticky), scene-info + dialogue + full teaching scroll under it.
  • CINEMA — focus the video: rail hidden, single column, IT-only subtitles (en_gloss + teaching_note hidden),
    bigger Italian. "just watch."
  • BILINGUAL — focus the language: video un-pinned/smaller, larger IT + EN, all teaching shown. "drill it."
  VERIFIED headless (computed styles + scroll test): reader videoTop stays 53px on 900px scroll (pinned);
  cinema rail display:none + en hidden; bilingual playerpin position:static + IT 17px. BUG FIXED: sticky pin
  was dead because `html,body{overflow-x:hidden}` creates a scroll container that kills position:sticky →
  changed to `overflow-x:clip` (clips h-overflow without breaking sticky). Screenshot confirms the
  READER·CINEMA·BILINGUAL switcher renders. Audio levels confirmed good by user ("loud enough, almost perfect").
- 2026-07-25 — **PLAYER: PODCAST/audio-first mode (mobile) + LAN address.** 4th view mode "Podcast"
  (render_episode_viewer.py), matching the existing chiron-listen bottom-dock pattern: hides the video, shows
  the scrollable dialogue, and a FIXED BOTTOM mini-player (scrubber + play/pause + prev/next + title/time +
  ⤢ maximize) that plays the spliced per-scene podcasts (scene.podcast_audio) and AUTO-ADVANCES scene→scene.
  ⤢ opens a full-screen SHEET = the 22-scene playlist (tap to jump) + the current scene's read-along dialogue.
  VERIFIED headless at 390×844 mobile: mode-podcast, bar fixed at bottom (bottom=844), video hidden, play →
  loads scene1.mp3, sheet opens w/ 22 scenes. Console clean (only favicon 404). Persists via localStorage.
  **Lesson served LAN-bound for phone testing: http://192.168.0.112:8913/viewer.html** (temp python http.server,
  0.0.0.0:8913). TODO: wire into the chiron server (:8911 static /lessons/**) for a permanent address like the
  other lessons. Modes now: Reader (video pinned) · Cinema (IT-only subs) · Bilingual (IT+EN big) · Podcast (mobile audio-first).
- 2026-07-25 — **BUG FIX: bilingual TTS split (user: "Lucrezia mispronounces Italian in the English voice").**
  Root cause: my P3 shortcut baked ALL narration with lucrezia_english, so cited Italian words got English
  pronunciation. FIX (matches the medical-Italian/MCQ 04s workflow the user confirmed): the AUTHOR stage now
  emits each spoken field as language RUNS [{lang:"en"|"it",text}] — English narration = en runs, every cited
  Italian word/phrase = its OWN it run. assemble_timeline stores runs per tts segment; stage_bake bakes EACH run
  with voice_for(lang) (en→lucrezia_english, it→lucrezia_italian) via Modal (both voices in refs), then
  tts-splices the runs (90ms) into the segment mp3. VERIFIED scene 1: authoring tags Italian correctly ("She
  says [it]alzati[/it] and [it]vestiti[/it]…"), bake = 44 runs · 8 segments · voices=[lucrezia_english,
  lucrezia_italian]. Splice/player/podcast unchanged (they consume the segment mp3). Full 22-scene re-bake
  running. The Italian in Lucrezia's narration is now in her Italian voice; the real clips remain authentic.
- 2026-07-25 — **ALIGNED the bilingual bake to the CANONICAL lesson logic (user: "do what the other lessons
  did, don't invent — reference them").** Read the authoritative sources: `prompts/04s-lecture-script.md` (the
  shared bilingual rule) + `lib/schemas/lecture-script.ts` (`GAP_MS`). CONFIRMED the core is identical: "every
  Italian word/phrase is its OWN lang:it segment; never leave Italian in an en span (English-accent = wrong)"
  = exactly the pronunciation bug + my fix. CORRECTED my divergences: (1) I had INVENTED gap values (word:0
  crossfade, then 90ms) — replaced with the EXACT canonical `GAP_MS = {word:60, clause:400, sentence:900,
  paragraph:1800}` (default sentence). word=60ms is the house tight micro-gap that makes an Italian word inside
  an English clause FLOW (user: the switch "can't be seen"). (2) segment schema now {lang,text,gapAfter} with the
  canonical word/clause/sentence/paragraph vocabulary. (3) self-containment kept NATURAL not mechanical (user:
  "don't repeat the same thing over and over") — teach each phrase once; the real clip already voices the Italian.
  VERIFIED scene 1: "She says [it word]alzati[/it] — get up. …the reflexive pronoun [it word]ti[/it] attached…"
  — each Italian word its own it-segment, tight gaps, flows. Full aligned 22-scene re-bake running. (Episode
  structure — per-scene prebrief→clip→explain→debrief — legitimately differs from 04s summary/section artifacts
  because it interleaves the real video clips; only that delivery differs, the language logic is the same.)
- 2026-07-25 — **PLAYER polish: Bilingual = true SIDE-BY-SIDE + Reader current-line PINNED-TO-TOP.**
  (1) Bilingual mode was too similar to Reader (user) → rebuilt the dialogue cue into 3 grid cells
  (who-c · it-c · en-c); Reader/Cinema stack English UNDER Italian, Bilingual puts English in column 3
  (side-by-side parallel text) with an "Italiano | English" header + divider. VERIFIED: Italian col 130-524px,
  English col starts 540px, same row; Reader stays stacked (EN 44px below IT). Four now-distinct modes:
  Reader (watch) · Cinema (IT-only immersion) · Bilingual (side-by-side study) · Podcast (audio-first mobile).
  (2) Reader teleprompter scroll (user): the CURRENT line pins to the TOP of the dialogue (just under the pinned
  video) and playback scrolls UP — upcoming lines below, never chase the newest at the bottom. `cueToTop()` on
  line-change in mode-reader only; VERIFIED current cue top lands 9px under the pinned video bottom, video stays
  visible. Rendered from a transcript SNAPSHOT (aligned audio re-bake still running) — will re-render from the
  final file for the bilingual audio.
- 2026-07-25 — **PODCAST maximize sheet: its own big controls (user: controls vanished when zoomed in).** The
  ⤢ sheet (inset:0) covered the bottom mini-bar → play/next disappeared when maximized. FIX: the sheet now has
  its own control block at the top — a big 66px round play/pause + ⏮/⏭ prev/next + scrubber + title/time — above
  the scrolling scene-playlist + read-along dialogue. Mini-bar and sheet share the SAME handlers (factored
  podToggle/podLoad + setAll dual-update), so state stays in sync. VERIFIED mobile 390×844: sheet open, big play
  66x66, prev/next visible, controls above the list, clicking the sheet's play starts playback (→ ⏸).

## 13. TEACHING PLAN (the lesson ARC) + on-video subtitles + tutor tab (2026-07-25, user)

**The lesson is a STAGED progression (scaffold-heavy → strip support → graduate), not "watch the episode":**
- Per SCENE (FSI cycle): 🎧 pre-brief (Lucrezia) → ▶️ WATCH real scene (original IT audio, subtitles IT/EN/off
  = learner's choice) → 🎧 debrief (Lucrezia + clip replays) → 📖 study (line-by-line, Reader/Bilingual) → ✍️ role-play (later).
- Whole-episode: episode SUMMARY listen + PODCAST mode (scene-by-scene hands-free).
- 🎓 GRADUATION: whole episode, original audio, NO Lucrezia, NO subtitles — comprehension test ("if you get it, golden").
- The SUBTITLE TOGGLE is the SCAFFOLDING DIAL: subs on early (see/understand) → off for graduation. Same footage, dial support.

**SHIPPED — on-video subtitle toggle (user):** IT / EN / Off buttons overlay subs ON the video (LR-style), synced to
line timings, persisted (localStorage). VERIFIED: IT shows italian_text over the video, EN adds en_gloss, both can
show, Off clears. render_episode_viewer.py: .vidwrap>.subs overlay + .subsbar buttons + updateSubs() on timeupdate.

**NEXT — TUTOR TAB (user: "same as the other apps"):** the episode player needs the eco-lite tutor sidebar like every
Chiron lesson. Reviewed: shell/tutor.js (1927 lines, self-contained IIFE, self-mounts edge-tab+drawer, talks
http://<host>:8912/tutor-chat + /tutor-models, scope section/lesson/free, grounds on section text + selection) +
tutor.css (796). Tutor service :8912 is UP. INTEGRATION PLAN: copy tutor.js+tutor.css into the lesson dir as
siblings (R-CH-PIPELINE), include in the viewer, and feed it the CURRENT SCENE's dialogue as sectionText + the
user's selection (Italian-only grounding). Not yet built — next focused piece.
- 2026-07-25 — **BUGFIX (scene-click "restarts" + Listen broken across scenes) = SERVER had no HTTP Range +
  TUTOR TAB shipped.** ROOT CAUSE (diagnosed, not guessed): python `http.server` doesn't support Range requests
  → `vid.seekable.end=0`, so every scene-click seek to 309s silently failed and the video played from 0
  ("restarts"); the Listen timeline's clip segments seek too, so they broke identically. FIX: `~/.local/bin/
  serve-range` (threaded static server WITH 206/Range) → VERIFIED seekable.end=2612, click scene5 → video at
  311, Listen button present in all 4 modes. (The chiron server :8911 FastAPI StaticFiles already supports
  ranges, so it works there too — the temp test server was the problem.) **TUTOR TAB (user "same as other
  apps"):** render_episode_viewer.py now copies shell/tutor.js+tutor.css into the lesson dir (siblings) + includes
  them + wraps the scene in `<section class="chapter" id="scene-N">` (updated per scene via selectScene +
  dispatch scroll so the self-mounting tutor re-reads the CURRENT scene's dialogue as grounding). VERIFIED:
  edge-tab "🎓 Tutor" mounts, drawer opens, 8 models loaded from live :8912/tutor-models, section grounds on
  scene-5 (3318 chars of that scene's dialogue). Aligned bilingual audio (359 it-voice runs) is live in the render.
- 2026-07-25 — **BUGFIX: TTS runs randomly super-quiet (user "some Italian vs English clips still super low").**
  ROOT CAUSE (measured, not guessed): `_norm` (the per-run TTS normalizer) used single-pass `loudnorm`, which is
  WILDLY inconsistent on short TTS runs — verified it CRUSHED normal words at random: "Che cazzo vuoi?" −19→−34,
  "vestiti" −23→−31, "She says get up…" −17→−38, while others hit −16 fine. Not Italian-specific — the normalizer.
  (Same class of bug as the earlier video-clip −35; `_cut_clip` was already fixed, `_norm` was missed.) FIX:
  `_norm` now MEASURE-then-GAIN + alimiter (bounded −9..+18dB), deterministic + length-independent. VERIFIED same
  6 runs re-baked → ALL within 0.3dB of −16 (Che cazzo vuoi −15.95, vestiti −16.06, She says −16.21). Both TTS
  runs AND video clips now use measure-then-gain (single-pass loudnorm banned for short audio). Re-baking all 22.
  NOTE: an ultra-short lone function-word run ("ti") can synth near-silent (−56) — bounded gain avoids amplifying
  noise; a rare edge case (LLM rarely splits a bare clitic into its own run).
- 2026-07-25 — **DECOUPLED normalizer (user: "prevent re-bakes").** Split leveling out of the Modal bake into a
  separate, re-runnable stage so re-leveling NEVER re-synthesizes (no GPU). New pipeline:
  author → **bake** (Modal synth → persist RAW un-normalized run wavs to audio/raw/scene<N>/s<seg>_r<run>.wav) →
  **normalize** (measure→gain→limiter each raw run to −16, then tts-splice the segment's runs into one flowing
  utterance → audio/seg/) → **splice** (podcasts). `--stage normalize` re-levels from audio/raw/ alone — tune
  the normalizer and re-run in seconds, no Modal. Normalization stays at the RUN level (each IT word / EN phrase
  individually) so within-segment IT↔EN balance is correct — a segment-level pass can't fix a quiet Italian word
  relative to its English. `_norm` = the mechanical plugin (bounded measure+gain+alimiter). Running full rebuild
  once to populate audio/raw/ + corrected seg mp3s.
- 2026-07-25 — **AUDIO LIBRARY for un-voiceable short words (user's plan) + self-healing rescue + QC gate.**
  ROOT of the "some clips super low": a TTS can't voice a bare clitic/function word SOLO ("ti" alone → −43 LUFS
  silence) — but in a CARRIER it voices fine (verified: same words in a list → −15.8). So (user's idea) pre-render
  a reusable LIBRARY of these once and splice them in. Built `build_audio_library.py`: synth "Ascolta bene:
  <word>." → whisper word-align → cut the LAST token (fixed carrier = position-stable, robust where silence-split
  + rapid-list-align both FAIL) → normalize → ~/.chiron/audio-library/<voice>/<slug>.wav + manifest. Built 51
  words for lucrezia_italian, 50 voiced (n' skipped — it's a contraction fragment, never isolated, per user;
  ho/ce/gli were false-"quiet" = loudnorm can't measure <0.4s, RMS shows −16..−18 real audio). **Self-healing
  rescue:** stage_normalize detects a near-silent raw run (LUFS<−40) and SPLICES the library clip for that word
  — automatic, in the re-runnable normalize stage (no re-bake). Covers all 17 of the episode's failing words.
  Also hardened `_lufs`: RMS mean_volume fallback for sub-0.4s clips (loudnorm returns None on short audio →
  silently disabled normalization). LOUDNESS QC GATE (`--stage qc`, local ffmpeg meter, no model — Gemini QC
  judges CONTENT not level): flags off-target segments + near-silent raw runs with word+scene. This trio
  (library + rescue + QC) makes Lucrezia's short-word pronunciation reliable + reusable across all IT lessons.
- 2026-07-25 — **CHIRON LIBRARY INTEGRATION: new 'video-it' domain + E01 registered (was NOT in the library).**
  User: is E01 in Chiron with the correct subject/category? → it wasn't (standalone viewer.html only). The
  Italian domain had only topic+lang_level facets (no way to model series). DECISION (user): a dedicated
  **video-it domain** ("Italian · Video") facets [series, lang_level]; **subject = the SERIES**, each episode =
  a lesson under it. Wired the real chiron mechanism (not a bolt-on): (1) library.yaml — added video-it domain +
  `series` facet (rail, appliesTo video-it, source derived) + lang_level appliesTo video-it; (2) library.js —
  FIELD map `series:'subject'` (series facet reads the subject field = series name); (3) E01 dir — created
  `lesson.html` (the builder scans for it) + `chiron.json` {domain:video-it, status:staged, entry:lesson.html,
  tags:{dom:video-it, subj:"Baby", level:B1, scope:episode}, audioClips:174}; (4) ran build-library-index.mjs
  (parses yaml→config + scans lessons→index, copies app assets to chiron-library/). VERIFIED in the LIVE library
  UI (:8911/library/): E01 in LESSONS as domain=video-it, subject=Baby, level=B1, status=staged, card rendered;
  video-it domain + series facet in config; served library.js has the mapping. E01 shows in the Needs-Review band
  (Accept → published). NEXT: the orchestrator (episode_pipeline.py) will stamp this chiron.json automatically so
  every episode self-registers under its series; then dogfood E02.
- 2026-07-25 — **PRODUCTIONIZED: episode_pipeline.py orchestrator + E02 dogfood (user: wire the chain, run E02).**
  New `skill/scripts/episode_pipeline.py` — ONE command, an owned episode file → a registered Chiron lesson,
  everything derived generically (series/epcode/title/slug/clean-stream/srt from the filename — NOTHING
  hardcoded; verified on E02: Baby/S01E02/Burattino/stream6/it.srt). Chains 9 stages with the right interpreter
  (VoxStruct venv for scenes+ingest, conda for enrich/tags/visual/audio/render, node for register), resumable
  (--from/--only/--force, each stage skips if output exists). Register step writes chiron.json {video-it,
  subj=series, level, staged} + rebuilds the library → auto-lists under Italian·Video / <series>.
  **E02 DOGFOOD (Baby S01E02):** stages 0-5 ran clean generically — transcode episode.mp4 (313MB), scenes (32),
  ingest (439 lines/32 scenes), enrich 439/439, tags 32/32, visual 29/32. TWO findings: (1) BUG FIXED —
  stage_bake's Modal subprocess timeout was a FIXED 1800s; E02's 1291 runs (vs E01's 964) blew it →
  TimeoutExpired. Fixed: timeout now SCALES `max(1800, total*5+600)`. (2) MINOR — whisper :8766 + audio-llm :8768
  each 500'd transiently during visual → 3/32 scenes lack visual_situation (AD narration); a per-chunk retry in
  episode_visual would close it (follow-up). Resumed E02 --from audio with the timeout fix. This is exactly the
  "let it run, fix GENERIC issues not hardcode" dogfood the user wanted.
- 2026-07-25 — **E02 COMPLETE + registered; 2 more generic dogfood fixes (self-healing library + punct-drop).**
  E02 finished after the timeout fix: 242 segments, 32 scene podcasts, 1291 raw runs; lesson.html + chiron.json;
  **library index now lists BOTH under Italian·Video/Baby** (S01E01 174 clips, S01E02 242 clips, staged). The QC
  gate on E02 flagged ~16 near-silent runs; the library rescue auto-fixed 14 (lo×5, io, fa, te, mi, me, Giù,
  fare). Remaining were two classes → two GENERIC fixes: (1) **punctuation-only runs dropped** in _runs (a lone
  "." / "—" synths to silence + has no speech) — forward fix, E03+ never emit them. (2) **SELF-HEALING library
  auto-grow** — refactored build_audio_library into a reusable `build_words(voice, words)`; stage_normalize's
  rescue now, on a near-silent word NOT yet in the library, CARRIER-SYNTHS it once (Ascolta bene: <word> →
  whisper-align → cut → −16), caches it to ~/.chiron/audio-library, and reuses it forever. So ANY word that
  flakes (alle, Scusa, convince…), not just pre-listed clitics, is fixed automatically and the library grows
  across episodes. Re-normalizing E02 with auto-grow (no re-bake — raw runs kept). All fixes are pipeline-level,
  not E02 hacks → E03-E06 inherit them. (Also noted: episode_visual whisper/audio-llm transient 500s → per-chunk
  retry is the remaining follow-up; 29/32 visual on E02 is acceptable.)
- 2026-07-25 — **PLAYER: how-to click-reveal + Coursera-style Lucrezia READ-ALONG (user-found gaps).**
  (1) The "how to" speech-act chips had cursor:help + a tooltip (looked interactive, did nothing) → now
  CLICKABLE: click a chip → reveals the concrete example inline («Sta sfigata.» — "What a loser.") + highlights;
  click again to collapse. VERIFIED. (2) READ-ALONG panel under "Listen with Lucrezia": renders the ENTIRE scene
  sequence — every Lucrezia word (per-run language colour) PLUS the interleaved video SUBTITLE lines (the real
  clips) — and a highlight pill FOLLOWS her words as she speaks (proportional-by-char, scrollable, auto-scrolls to
  the current word). So while watching the video you also READ what she's saying (catches single-word audio
  dropouts) — user's Coursera ask. VERIFIED on E02 scene 1: 229 Lucrezia words + 3 clip subtitle lines, full
  sequence (not per-segment), highlight advances, panel scrolls. Both episodes re-rendered. NOTE: word-sync is
  proportional (approximate) — exact per-word timing would need whisper-aligning the TTS at bake (heavier;
  offered if the approximate isn't tight enough). Still open from this batch: backfill the 3 E02 scenes missing
  visual_situation (whisper 500s) via a per-chunk retry in episode_visual.
- 2026-07-27 — **Server integration split into its own (deferred) PRD.** During E03 generation the user asked
  "where does Chiron show the progress like the other lessons?" Verified: the video pipeline
  (`episode_pipeline.py`) is disconnected from the server job registry (`jobs.json`/`/jobs`, only fed by
  `POST /generate`→dispatch chains) — finished episodes appear in the Library via `register`, but there's no
  live progress, no build-log history, no rebake-from-Chiron. User: set a PRD, don't build yet (more
  episode↔Chiron functionality to connect first), but scope a Phase-1 seam = progress detection + build-log
  history + rebake hook so the CLI is observable/rebakeable from Chiron. → **`chiron_episode_server_integration_2026-07-27.md`**.
  Also this session: phrase-level bilingual audio fix (whole-phrase citation, content-QC whisper+Gemini,
  2-round rebake cap, retry metric qc-stats.json) — recipe `chiron-bilingual-tts-phrase-level-bake` +
  chiron-bank memory `project-bilingual-tts-phrase-level-audio`. E03 now generating via the full pipeline.
