# Chiron Persona Packs — design (2026-06-10)

**Status:** design / brainstormed (Gemini). Build not started.
**Origin:** Building the Lucrezia audio lessons surfaced it — the generated full-lecture was compelling *because* it was in-character ("Buongiorno! Come stai?… imagine you're standing with me in Trastevere… A presto!"). Gyasi: "it's not Maria the tutor — it's now **Lucrezia the tutor**." The personality lives in the **audio**: how the lecturer greets you, their warmth, their asides, their feelings.

## The insight

A **persona pack** turns chiron's generic domain tutor (`personas/<domain>.json` → "Maria") into a **specific, named human teacher** who *overrides* the generic one, carrying a voice + personality + a linked real-world source. Personality is not decoration — it's the thing that makes the **lecture audio** feel like a mentor, which is the stickiness a solo learner needs.

## Three-layer composition (the lecture generator reads all three)

| Layer | File(s) | Defines |
|---|---|---|
| **Domain base** | `personas/<domain>.json` (existing) | *What* is taught + the generic cast (tutor + peers) |
| **Persona pack** | `personas/packs/<id>/` (NEW) | *Who* is talking — the named human, their voice, greeting, register, idiosyncrasies, linked source |
| **User overlay** | user memory / config | *To whom* — Gyasi is a doctor learning to practice in Italy |

The pack `extends` the domain tutor and **replaces** it when active.

## A pack = one folder (v1, file-first, no DB)

`personas/packs/lucrezia/persona.md` — one human-readable file Gemini reads as the "Persona Context Block":
- **identity** — Lucrezia Oddone; the real person == the cloned voice.
- **voice** — `lucrezia_italian` / `lucrezia_english` (OmniVoice refs).
- **emotional register** — a tunable per-pack dimension (warmth, humor, formality, default-mood, and a light↔serious range — a pack can carry a personal/relational register, e.g. a warm colleague-tutor vs a formal lecturer). **The Lucrezia pack's specific register is PRIVATE — it lives ONLY in the user-local `~/.chiron/packs/lucrezia/persona.md`, intentionally NOT recorded in this git-tracked/public repo doc.** Generic guardrails every pack register must honor: tasteful, never overt, the persona never replaces correctness, and rigor wins for hard concepts (the teaching is never diluted by tone).
- **greeting** — "Buongiorno! Come stai?" · **sign-off** — "A presto!"
- **signature method** — the "Trastevere method": relate grammar/terms to a real scene or personal anecdote.
- **idiosyncrasies / catchphrases** — "Allora,", "il solito", "close your eyes and imagine…".
- **asides** — instruct Gemini to drop 2-3 personal `[aside: …]` reflections ("Gyasi, this part trips up doctors, but you'll get it").
- **linked source** — channel `@lucreziaoddone` (`UCnVc-IW8Q98qFmQcXla5FdQ`) + the yt-dlp access recipe (see [[reference-chiron-audio-lecture]] / the Lucrezia memory).
- **medical-proxy behavior** — she has NO medical content → apply her warm slow-explanation method to clinical material (STYLE-only).
- **when-to-use** — domains: `language-it`; **opt-in / user-local**.

**Deferred (anti-over-engineering):** Gemini proposed a `source_index.sqlite` + a `PackManager` class + separate `fragments.json`. NOT for v1 — fold fragments into `persona.md`, and resolve sources with a **live yt-dlp title match** at lesson time. Build an index only if her catalog search gets slow.

## Injection

When a `language-it` lesson runs with `persona=lucrezia`, the Stage-4 (chapter/dialogue) and Stage-6 (lecture-script) prompts receive the Persona Context Block from `persona.md` — greeting, register, method, asides, sign-off. (Already proven: the café full-lecture was authored in her voice with exactly this kind of context.)

## When-to-pull routing (per lesson request)

`yt-dlp --flat-playlist` her videos → keyword-match the lesson topic against titles:

| Match | Action |
|---|---|
| **High** (e.g. "ordering coffee" ↔ her gelato/pizza/coffee videos) | **Content + Style** — pull that video's transcript as a primary source + her examples |
| **None** (e.g. "taking a cardiac history") | **Style only** — her method/voice, content from medical sources |
| **Partial** (e.g. "body parts" → "clinical anatomy") | **Hybrid** — her vocab video for basics, Gemini extrapolates to clinical |

## Activation

Opt-in + user-local: default tutor = generic Maria; a `personas/packs/<id>/` registered for `language-it` auto-activates for *this* install (or the user names it: "use the Lucrezia persona"). A shared/other chiron has no `packs/` → unaffected. Keeps the user-specific binding out of the core skill.

## Decisions
- **Packs live user-local: `~/.chiron/packs/<id>/`** (decided 2026-06-10) — the core chiron repo stays generic; a pack is dropped in per-install. A shared chiron has no `~/.chiron/packs/` → unaffected. The skill reads packs from there, never from the repo.

## Open questions (refining before build)
1. ~~Where do packs live~~ → **decided: `~/.chiron/packs/`**.
2. How is "active persona" selected — per-lesson arg, a default-per-domain config, or auto by domain?
3. Do peers (Luca/Sofia) also get pack-able, or is v1 tutor-only?
4. `persona.md` shape — YAML frontmatter (machine bindings) + prose body (DNA)?
5. Medical bridge — style from the pack, content source-grounded (chiron rule #6), not hallucinated.

## Cross-references
- Audio pipeline + voice: [[reference-chiron-audio-lecture]], `prd/chiron_audio_lecture_2026-06-09.md`.
- Lucrezia channel + access + medical goal: user memory `reference_lucrezia_italian_channel.md`.
- Existing personas: `skill/personas/<domain>.json`.
