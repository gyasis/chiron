# Stage 4u — Medical-Algorithm / Differential-Diagnosis widgets (SHARED)

You are choosing and filling the **medical-reasoning visual widgets**. This fragment is loaded by
BOTH the Claude Code skill (chapter-write) AND the PromptChain chain — a lesson generates the same
either way (parity). These three widgets are richer than an MCQ: they make the *reasoning structure*
visible. They apply to **medicine, wards, and medical-italian** lessons alike.

## The three widgets

### 1. `ddx-tree` — differential diagnosis (a finding fans into candidate diagnoses)
Use when the content distinguishes among **multiple diagnoses** from one root finding/criterion.
```json
{ "type":"ddx-tree", "id":"ddx-...", "title":"DDx: <root>",
  "root":"<the splitting finding, e.g. 'Joint pain' or 'MCV'>",
  "branches":[ { "label":"<category>", "sublabel":"<short discriminator>",
    "tone":"accent|teal|success|warning|error|muted",
    "leaves":[ { "title":"<diagnosis>", "detail":"<key distinguishing features>" } ] } ] }
```

### 2. `decision-flow` — clinical algorithm (a management/diagnostic pathway)
Use when there is an **algorithm**: a presenting state → a decision → yes/no branches to endpoints.
```json
{ "type":"decision-flow", "id":"calg-...", "title":"Algorithm: <name>",
  "start":"<presenting state>", "question":"<first decision, e.g. 'QRS < 120 ms?'>",
  "branches":[ { "label":"Yes · <branch>", "tone":"success|warning|accent|teal|error|muted",
    "steps":[ { "kind":"decision|dx", "text":"<text>", "tone":"success|warning|error|accent|teal" } ] } ] }
```

### 3. `compare-lanes` — X vs Y (contrast two entities feature-by-feature)
Use when the content **compares two (or more) entities** (look-alikes, a "vs" lesson).
```json
{ "type":"compare-lanes", "id":"ccmp-...", "title":"<A> vs <B>",
  "columns":[ { "label":"<A>", "tone":"accent" }, { "label":"<B>", "tone":"teal" } ],
  "rows":[ { "feature":"<dimension>", "cells":["<A's value>","<B's value>"] } ] }
```

## WHICH / HOW MANY / WHEN / WHERE — the agent decides (BLOCKING pedagogy)

Do NOT mechanically add one per lesson, and do NOT limit to a single type. **Read the chapter and decide
by content** — a lesson may use **zero, one, two, or all three**, possibly several of the same kind:

- **Broad / symptom-led subject** ("approach to X", "the swollen joint", "anemia") → almost always a
  **`ddx-tree`** (often the centrepiece), possibly more than one at different decision points.
- **Specific disease process / management** ("acute pericarditis", "AF management") → a **`decision-flow`**
  for its diagnostic workup or treatment algorithm; a `ddx-tree` only if a real differential exists.
- **"X vs Y" / look-alikes** ("RA vs OA", "SVT vs VT", "transudate vs exudate") → a **`compare-lanes`**.
- **Alongside an MCQ:** when a clinical-vignette MCQ tests a differential or an algorithm, **place the
  matching widget near it** so the visual scaffolds the question (the widget + the MCQ reinforce each other).
- **Placement (WHERE):** put the widget in the chapter `widgets[]` array at the point in the exposition
  where that reasoning happens (after the relevant prose, before/after the MCQ it supports).

Decide deliberately: name the teaching purpose, pick the type(s) that serve it, fill each from the
**grounded source** (never invent clinical content). `tone` is cosmetic — map branches to distinct theme
colours for legibility (e.g. inflammatory=accent, noninflammatory=teal, emergency=error).

### VARIETY & DENSITY (BLOCKING — don't be repetitive, don't overcrowd)
- **Vary across the lesson.** Do NOT put the *same* combo in every chapter (e.g. ddx-tree + compare-lanes
  in all 4). Let content drive it so different chapters feel different — one chapter might warrant a
  decision-flow, another a ddx-tree, another none of these three (just MCQs + the other widgets).
- **Opportunistic, not mandatory.** It's fine to use two or all three in ONE chapter when the content
  genuinely offers the opportunity (e.g. an "approach to X" chapter: ddx-tree for the differential AND a
  decision-flow for the workup). But that should be the exception, not every chapter.
- **Don't overcrowd.** Aim for roughly **one** of these reasoning visuals per chapter (occasionally two
  when warranted) — never a wall of them stacked together. Spread them; quality placement over quantity.
- These sit alongside (not instead of) the MCQs and the other widgets — a chapter should feel balanced.

> `decision-flow` is for a **static branching** algorithm. It does NOT replace the other widgets —
> `flow-animation` (animated step-through of a process), `group-chat-animation` (peer-discussion chat),
> `pattern-cards`, `glossary-tooltips`, etc. all remain first-class; use each for its own purpose. These
> three are an ADDITION to the widget vocabulary, not a replacement.
