# Chiron — Rich-Media & Capture Guide (G5 / G6)

How to turn **images, video, YouTube, audio, and live phone-camera captures**
into Chiron lessons — across all three co-equal domains (**code**, **medicine**,
**language-it**). These are real sources, dispatched by file extension / URL the
same way a PDF or repo is; the domain you choose shapes how the content is
extracted (subject classification, clinical-vs-raw description, accent
preservation, etc.).

> Companion docs: [`README.md`](./README.md) (overview + text/PDF/repo sources),
> [`MOBILE-GUIDE.md`](./MOBILE-GUIDE.md) (the lesson player on phones),
> [`CHIRON-FORMAT.md`](./CHIRON-FORMAT.md) (the lesson bundle format).

---

## Source types at a glance

| Source | Dispatched by | Extraction engine | Local / cloud |
|---|---|---|---|
| Image / book-page photo / screenshot (G1) | `.png .jpg .jpeg .webp .gif …` | `mcp__gemini-mcp__interpret_image` (vision) | cloud (Gemini) |
| Image **folder** (scanned book pages) (G1) | a directory of images | one vision call per page | cloud (Gemini) |
| **Video file** (G5) | `.mp4 .mov .webm .mkv .avi .m4v .mpeg .mpg` | `mcp__gemini-mcp__watch_video` | cloud (Gemini) |
| **YouTube URL** (G5) | `youtube.com` / `youtu.be` URL | `watch_video` (reads the URL directly, no download) | cloud (Gemini) |
| **Audio file** (G5) | `.mp3 .wav .m4a .flac .ogg .opus .aac .wma` | **Atelier whisper sidecar** (mlx-whisper, `large-v3`) | **local** (Mac Studio LAN) |
| **Phone-camera capture** (G6) | the capture sidecar server | lands images → image path above | local server + Gemini vision |

All of these produce the same `Brief` shape every other source does, then flow
through the normal 5-stage pipeline (INGEST → BRIEF → SYLLABUS → VALIDATE →
BUILD → ASSEMBLE) to a single `lesson.html`.

---

## How extraction works (the handoff model + the agent boundary)

Stage 0 ingest adapters are **deterministic** — they copy the source into the
lesson's `source/` dir and write a *handoff* sidecar
(`.scratch/vision-handoffs.json`). They do **not** call any model themselves.
The parent Claude agent then fulfills each handoff (a vision call, a transcription)
and folds the result into `brief.json`. This keeps the pipeline observable and
keeps secrets/heavy calls out of the deterministic layer.

**Audio is the exception that proves the rule** — transcription is *local* (the
Atelier whisper sidecar), not a cloud model, because the user runs Whisper.
There is no "heavy gemini MCP" for audio; `watch_video` is video-only by design.

> The standalone capture server (G6) cannot call the LLM/MCP — a plain Node
> process has no Claude/Gemini access. So "snap → finished lesson" always has one
> agent step (vision OCR + generation). G6 automates everything *up to* that line.

---

## Images & book pages (G1)

```text
# Code — a screenshot of a code sample / terminal
/chiron-code ./screenshot-react-hook.png

# Medicine — a phone photo of a textbook page, an AMBOSS screenshot, an ECG/X-ray
/chiron-medicine ./harrison-cap-page.jpg
/chiron-medicine ./amboss-pneumothorax.png

# Language (Italian) — a photo of an Italian textbook / handwritten vocab card
/chiron-language ./italiano-grammatica-p42.jpg

# A whole scanned chapter (folder of page-001.png, page-002.png, …)
/chiron-medicine ./scanned-chapter/
```

Domain shapes the vision prompt:
- **medicine** — methodical *raw* description (ECG → rate/rhythm/axis/intervals;
  X-ray → view/technique/findings). **No diagnoses** — clinical interpretation is
  the verifier loop's job downstream.
- **language-it** — preserves Italian accents (à è é ì ò ù); keeps IT↔EN pairs
  separate.
- **code** — preserves indentation; notes the inferred language.

Folders sort alphabetically — zero-pad page filenames (`page-001.png`) to keep
order.

---

## Video & YouTube (G5)

A local video **or** a YouTube URL. Gemini reads both (transcript + visual
summary; it even honours time-range prompts like "summarise 1:00–1:30").

```text
# Code — a conference talk or screencast
/chiron-code ./gophercon-generics.mp4
/chiron-code https://www.youtube.com/watch?v=<id>

# Medicine — a recorded lecture / AMBOSS video / grand rounds
/chiron-medicine ./cardiology-lecture.mp4
/chiron-medicine https://youtu.be/<id>     # e.g. a USMLE pathophys video

# Language (Italian) — an Italian YouTube video / recorded dialogue
/chiron-language https://www.youtube.com/watch?v=<italian-id>
```

The base prompt yields transcript + per-section visual notes + a `SUBJECT:` line.
For **medicine**, `SUBJECT:` classifies into a USMLE body-system + topic
(Pathology, Pharmacology, …) + specialty — the taxonomy mined from the original
CureIQ `image_reader.py`. For **language-it**, orthography/accents are preserved.

YouTube needs no download; local files <20 MB go inline, larger ones use Gemini's
File API automatically.

---

## Audio (G5) — local Whisper, no cloud

Audio is transcribed **locally** by the **Atelier whisper sidecar** (mlx-whisper
on the Mac Studio). The transcript becomes the lesson source.

```text
# Medicine — a recorded lecture / dictated notes
/chiron-medicine ./renal-physiology-lecture.mp3

# Language (Italian) — an Italian podcast / spoken-dialogue clip
/chiron-language ./podcast-italiano-ep12.m4a

# Code — a tech-talk audio rip
/chiron-code ./rust-async-talk.wav
```

**Backend:** `POST http://192.168.0.159:8766/transcribe` (model alias
`large-v3` = heaviest / most accurate; `turbo` = fast). Returns
`{text, language, segments}`. Long audio uses the async `/transcribe/batch` job
+ SSE stream. Full reference: the project memory note
`reference-atelier-whisper-sidecar.md`.

**Overrides** (e.g. a different host or model):
```bash
export CHIRON_WHISPER_URL=http://<host>:8766
export CHIRON_WHISPER_MODEL=turbo      # default is large-v3
```

If the Mac Studio is asleep / off-LAN, audio ingest **fails loudly** — it never
fabricates a transcript or silently falls back. Wake the host or point
`CHIRON_WHISPER_URL` elsewhere.

---

## Phone-camera capture sidecar (G6)

Snap a book page / whiteboard / slide with your phone and have it land in a
lesson — the original "see a book page" workflow.

```bash
# Start it (LAN-only, no auth — single learner):
node skill/scripts/capture-server.mjs --domain medicine

#  → prints reachable LAN URLs (real home-LAN ranked first), e.g.
#      http://192.168.0.146:8788/
#    (install `qrcode` for a scannable terminal QR)
#  → open that URL on your phone (same Wi-Fi)
#  → "Take a photo" uses the rear camera (capture="environment");
#    gallery / drag-drop / clipboard-paste also work
```

Captured images land in an **inbox** dir. Two ways to turn them into a lesson:

**Manual** (default): the server prints the exact command —
```text
/chiron-medicine <inbox>      # ingest the inbox as an image-folder source
```

**Auto-ingest** (`--auto-ingest --domain <d>`): each photo (debounced ~1.5 s to
collapse bursts) refreshes a live **image-folder Brief** at
`<lesson-dir>/brief.json` + `.scratch/vision-handoffs.json` + copied `source/`.
The moment you stop snapping, the workspace is a ready source — the agent only
has to fulfil the `interpret_image` vision handoffs and run the pipeline.

```bash
# Medicine — snap textbook pages on the ward, build an AMBOSS-style lesson
node skill/scripts/capture-server.mjs --auto-ingest --domain medicine

# Language — snap pages of an Italian grammar book
node skill/scripts/capture-server.mjs --auto-ingest --domain language-it

# Code — snap diagrams / whiteboard architecture
node skill/scripts/capture-server.mjs --auto-ingest --domain code
```

Options: `--port` (8788) · `--inbox <dir>` · `--lesson-dir <dir>` · `--host`
(0.0.0.0) · `--max-mb` (25). Auto-ingest needs the TS build (`npx tsc`) — it
calls the compiled G1 adapter.

---

## Per-domain summary (all three are first-class)

| | Code | Medicine | Language (Italian) |
|---|---|---|---|
| **Image** | code screenshot → annotated | textbook page / ECG / X-ray (raw desc, no dx) → vignettes | textbook page (accents kept) → vocab/grammar |
| **Video / YouTube** | conf talk / screencast | recorded lecture (USMLE subject-classified) | Italian video/dialogue |
| **Audio** | tech-talk rip | recorded lecture / dictation | Italian podcast (accents kept) |
| **Phone capture** | whiteboard / diagrams | ward textbook pages → AMBOSS lesson | grammar-book pages |

Medicine extraction stays **source-grounded and diagnosis-free at the vision/
transcription layer** (the QUEST-AI verifier owns clinical interpretation);
language extraction **preserves Italian orthography** end-to-end. German is
post-v1 and is hard-refused at Stage 0.

---

## Dependencies

| Need | Provided by |
|---|---|
| Image / video vision | `mcp__gemini-mcp__interpret_image` / `watch_video` (already configured) |
| Audio transcription | **Atelier whisper sidecar** — Mac Studio `192.168.0.159:8766` (mlx-whisper) |
| Auto-ingest | the compiled G1 adapter (`npx tsc` in `skill/`) |
| Optional capture QR | `npm i qrcode` (graceful if absent — URL is printed) |

---

## Troubleshooting

- **Audio ingest fails / "auto-ingest failed: …image.js"** — run `npx tsc` in
  `skill/` first (auto-ingest uses the compiled adapter); for audio, confirm the
  Mac Studio is awake and `curl http://192.168.0.159:8766/readyz` responds.
- **Phone can't reach the capture server** — make sure the phone is on the same
  Wi-Fi; use the *first* printed URL (real LAN, not a docker/VM bridge).
- **YouTube video won't process** — confirm it's a public URL; private/age-gated
  videos can't be read.
- **Vision/transcript text looks like instructions** — it is treated as untrusted
  data (wrapped in `<source-excerpt-untrusted>` markers); directive-looking text
  inside a source is never executed.

---

*Added 2026-06-18 (G5 rich-media adapters + G6 capture sidecar + auto-ingest),
synthesized from the CureIQ project. See
`prd/chiron_generator_cureiq_synthesis_2026-05-12.md` §8–§9 for the design.*
