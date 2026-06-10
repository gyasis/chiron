# Audio QC — 2-Loop Gemini QC Procedure

After baking audio for a lesson, run this procedure for each clip — especially
the full-lecture mp3. The goal is to catch TTS generation/splicing defects
(missing words, static, gaps, truncation) before the lesson ships.

Cross-reference: `prd/chiron_audio_lecture_2026-06-09.md`.

---

## Loop structure

Run up to **2 generations total** per clip. If a defect survives after 2 loops,
write `audio/qc-report.json` — the skeleton's info-icon picks it up automatically.

---

## Step 1 — Wrap the mp3 in a black-video mp4

`watch_video` rejects bare mp3 files. Wrap each clip first:

```bash
ffmpeg -i clip.mp3 \
  -f lavfi -i color=c=black:s=160x120:r=1 \
  -shortest \
  -c:v libx264 -pix_fmt yuv420p \
  -c:a aac \
  clip_qc.mp4
```

---

## Step 2 — Call `mcp__gemini-mcp__watch_video`

Upload `clip_qc.mp4` and send a QC prompt. **Do not pass a `model` parameter** —
the `gemini-3-pro-preview` model id is dead; omit it to use the current default.

QC prompt template:

```
You are an audio QC reviewer. The EXPECTED transcript for this clip is:

<paste expected transcript here>

Listen carefully and report ONLY TTS generation or splicing defects:
- Missing or dropped words
- Static, glitch, or distortion
- Unnatural gaps or silences (> ~1 s where none is expected)
- Truncation (clip ends before the last word)

For each defect, give: { "time": "M:SS", "type": "<category>", "detail": "<what happened>" }
If the audio is clean, respond with exactly: PASS
```

If the model responds with `PASS`, the clip is done — no further action needed.

---

## Step 3 — Re-bake on defect (≤ 2 total generations)

If defects are reported, re-bake the artifact with the following hardening applied:

**Known root cause — ultra-short single-word Italian segments glitch.**
Function words and suffixes baked as isolated single-word segments
(e.g. «avere», «essere», «-ito», «-ato») are prone to truncation and static.

Fix: **fold them into adjacent English narration** rather than isolating them as
standalone Italian segments. Re-run Step 1 → Step 2 on the new mp3.

---

## Step 4 — Write `audio/qc-report.json` if a defect survives

After 2 loops, if the defect is still present, write the report so the lesson
can display the info-icon:

```json
{
  "Full lecture": {
    "status": "needs-review",
    "defects": [
      { "time": "0:04", "type": "truncation", "detail": "word «avere» cut off at segment boundary" }
    ]
  }
}
```

Key = the audio control's label text (the `.lbl` inside `.chiron-listen-btn`).
Leave out any clip that passed — only include entries with surviving defects.

The skeleton's info-icon script (`language-lesson-skeleton.html`) reads this
file on page load and decorates the affected controls automatically.

---

## qc-report.json schema

```
{
  "<control label>": {
    "status": string,           // short human label, shown in popup header
    "defects": [
      {
        "time":   "M:SS",       // timestamp in the clip
        "type":   string,       // e.g. "truncation", "static", "gap", "dropped-word"
        "detail": string        // human-readable description
      }
    ]
  }
}
```

If the file is absent or unreachable, the skeleton silently skips all badges.
