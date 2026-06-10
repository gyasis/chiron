# LANGUAGE-LESSON-SKELETON v1

`language-lesson-skeleton.html` is the canonical starting point for every
Chiron language lesson. It supersedes the per-lesson ad-hoc approach where
each lesson re-invented its own shell.

---

## What the skeleton provides

- **Grid layout** — `body { display:grid; grid-template-columns:240px 1fr }` with a
  `height:100vh; overflow-y:auto` main column and a sticky left sidebar.
- **Sidebar TOC** — minimalist `.toc-link` items with a left accent-bar active state
  (`color-mix(in srgb, var(--chiron-accent) 20%, transparent)`). Theme switcher
  pinned to the bottom via `margin-top:auto` on `.theme-section`.
- **Theme contract** — `<link>` tags for `themes/_tokens.css` + the 5 variant files
  (midnight / warm-paper / clinical / linguistic / ocean) + the early-apply
  `?theme` / `localStorage` switcher script. Default theme is `linguistic`.
  Every component class uses `var(--chiron-*)` tokens — no hardcoded hex in
  component CSS (the only hex values appear inside `.chiron-listen*` /
  `.chiron-play-inline` as `var(…, #fallback)` fallbacks for tokenless
  environments).
- **Audio player** — the floating 🎧 panel IIFE, verbatim from `skill/shell/main.js`.
  Grouped into "Full lesson" (summary/shortened artifacts) and "By section"
  (section artifacts). Inline ▶ buttons wired to anchored elements (vocab
  phrases, dialogues, grammar pearls, stories). Reads `audio/manifest.js`
  (sets `window.__chironAudioManifest`) or falls back to fetching
  `audio/manifest.json` directly. Silent no-op if no audio is baked.
- **Scroll-spy JS** — updates `.active` / `aria-current` on TOC links as the user
  scrolls; smooth-scrolls on TOC click.
- **Component library** — SR cards (simple + rich `data-card-type`), vocab tables
  (`.v-table`), speaker turns (`.turn`), pedagogical callouts (grammar-pearl /
  cultural-note / tip), cloze exercises, cold-open block, Match Madness game.
- **Reveal-English toggle** — any element with a `data-en="<plain-English explanation>"`
  attribute auto-gets a small "🇬🇧 English" button that reveals a hidden English block
  (a `<script>` near `</body>` wires it). **Write grammar pearls (and any Italian-only
  callout) in ITALIAN, and put the English explanation in `data-en`** — the learner
  tries the Italian first and reveals English on demand. Pure CSS/JS, no audio.

---

## Audio-anchor id conventions

The Stage-6 `bakeAudio` pipeline reads element ids to decide which audio clip
to wire where. Use exactly these patterns:

| Id pattern | Audio kind | Panel or inline? |
|---|---|---|
| `vocab-<slug>` | `phrase` | inline ▶ inserted before the `<td>` element |
| `dlg-<section-id>` | `dialogue` | inline ▶ inserted before the dialogue container |
| `pearl-<slug>` | `grammar-pearl` | inline ▶ inserted before the callout |
| `story-<section-id>` | `story-verbatim` | inline ▶ inserted before the target-lang paragraph |
| `storydesc-<section-id>` | `story-description` | inline ▶ inserted before the English-gloss paragraph |
| `<section-id>` (the `<section>` itself) | `section` | panel group "By section" |
| (whole-lesson clips) | `summary` / `shortened` | panel group "Full lesson" |

`<section-id>` must match between: the `<section class="lesson-section" id="…">`,
the corresponding `<a class="toc-link" data-toc-target="…">` in the sidebar, and the
`ids` array in the scroll-spy `<script>`.

### Dialogue voicing rule (DOMAIN-level, persona-independent — BLOCKING)

A practice dialogue is between the **learner** (Gyasi / "you") and **another speaker**
(the tutor, a patient, a colleague, a character). **The learner's own turns are NEVER
voiced or audio-baked** — those are HIS lines to say in person; the dialogue is practice.
Voice ONLY the non-learner speaker's turns.

- Mark turns in the HTML: the OTHER speaker = `class="turn persona-a"`; the **learner =
  `class="turn persona-b" data-learner="true"`**.
- When baking a `dlg-*` clip, include ONLY the `persona-a` (non-learner) turns; skip every
  `data-learner` turn. Both still render IT + English gloss on the page.
- This is a **language-domain** rule (true for any tutor) — it lives here, NOT in a persona
  pack, so swapping the persona never loses it. (Origin 2026-06-10.)

---

## How the parent agent fills the skeleton

1. **Replace every `<!-- {{PLACEHOLDER}} -->` comment** with the lesson-specific
   content. Placeholders follow the `{{SCREAMING_SNAKE_CASE}}` convention.
2. **TOC** — add one `<a class="toc-link" data-toc-target="<id>">` per chapter;
   update the `ids` array in the scroll-spy script to match.
3. **Chapters** — replicate the `<section class="lesson-section" id="chapter-N">`
   pattern for each major topic. Each chapter follows this anatomy:
   `.vocab-arc` (vocab table) → dialogue (`id="dlg-<section-id>"`) →
   `.callout.grammar-pearl` (`id="pearl-<slug>"`) → story block
   (`id="story-<section-id>"` + `id="storydesc-<section-id>"`) →
   `.callout.cultural-note` → `.cloze-wrap`.
4. **SR cards** — one `.sr-deck` per chapter grouping inside `#sr-drawer`.
5. **Match Madness** — edit the `PAIRS` array in the inlined `<script>` inside
   `#match-madness`.
6. **Speaker roles** — add `.turn.<role>` CSS blocks for each persona name if
   the default `persona-a` / `persona-b` / `learner` / `narrator` variants are
   insufficient.

Stage-6 `bakeAudio` then reads the lesson HTML, resolves all audio-anchor ids
against the manifest, and injects `audio/manifest.js` into the lesson directory.
When the lesson is opened in a browser, the audio player IIFE auto-wires.

---

## Relationship to other files

- **Pairs with** `prd/canonical_shell_and_match_madness_2026-05-12.md` — the PRD
  that specified the canonical shell contract and the Match Madness game.
- **Theme files** — `skill/shell/themes/_tokens.css` + the 5 variant CSS files.
  Do not inline theme values; always reference via `var(--chiron-*)`.
- **Audio player source** — `skill/shell/main.js` (the last top-level IIFE).
  If the player logic is updated in `main.js`, sync the inlined copy in
  `language-lesson-skeleton.html`.
- **Reference lesson** — `/home/gyasis/Documents/generated/chiron-italian-cafe/lesson.html`
  is the polished café lesson this skeleton was extracted from.
