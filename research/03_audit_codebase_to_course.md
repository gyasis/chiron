# Audit: zarazhangrui/codebase-to-course

**Date:** 2026-04-28
**Audited at:** `~/dev/audits/codebase-to-course/`
**Repo:** https://github.com/zarazhangrui/codebase-to-course
**Stars:** 4.1k
**License:** MIT (assumed; LICENSE not yet confirmed)
**Audited commit:** verified at HEAD on clone date

---

## Verdict

✅ **SAFE** — both security-auditor + adversarial-bug-hunter converged.

- Pure DOM/UI engine (`main.js`, 498 lines): zero `fetch`, `XMLHttpRequest`, `eval`, `new Function`, `document.write`, `localStorage` write, `sessionStorage`, `navigator.send*`, WebSocket, dynamic `<script>` injection, or analytics.
- `styles.css` (34KB): zero `url(...)` calls, zero `@import` from external. Token-driven CSS design system.
- Only external dep: Google Fonts CDN (preconnect + one stylesheet link in `_base.html`).
- No postinstall hooks, no rc-file mutation, no telemetry.

**One small caution:** SKILL.md L23 (`git clone <url> /tmp/<repo-name>`) relies on Claude's own quoting. No exploit demonstrated in practice (git URL parser rejects shell metacharacters), but harden with `tr -cd 'A-Za-z0-9._-'` slug-sanitization if generalizing.

---

## File layout

```
codebase-to-course/
├── SKILL.md                  (17KB — main skill instructions)
├── README.md                 (4.3KB)
├── .gitignore
└── references/
    ├── _base.html            (2.2KB — HTML scaffold)
    ├── _footer.html          (27 bytes — closing tags)
    ├── build.sh              (210 bytes — concats _base.html + modules/*.html + _footer.html)
    ├── content-philosophy.md (9KB — pedagogical voice + tone guide)
    ├── design-system.md      (12KB — CSS token guide + design conventions)
    ├── gotchas.md            (3KB — known pitfalls)
    ├── interactive-elements.md (32KB — quiz/widget patterns)
    ├── main.js               (19KB — UI engine, IIFE-scoped)
    ├── module-brief-template.md (2.6KB — the brief-as-contract abstraction)
    └── styles.css            (34KB — single-file design system)
```

13 files total, 412KB. Most of the "intelligence" is in SKILL.md (prompts) + the markdown reference files. The shipped JS+CSS is mature, opinionated, and reusable.

---

## Architectural pattern (the part that matters for Chiron)

### The 4-phase pipeline

```
P1 Codebase Analysis  → "read all key files, trace data flows, cast of characters"
P2 Curriculum Design  → 4-6 modules, fixed module-purpose menu
P2.5 Module Briefs    → only for "complex" inputs; pre-extracts snippets so subagents don't re-read source
P3 Build              → two paths:
    - Sequential: one module at a time in main context
    - Parallel: subagents in batches of 3, each receiving only its brief + curated reference subsections
P4 Assemble + open
```

The **brief mechanism is the key reusable trick** — it's a domain-input-adapter contract. The writing agents are told nothing about the source, only what to teach. This abstraction layer is what makes `codebase-to-course` extensible.

### HTML output structure

**Multi-file source, single-file delivery.**
- Each module is `modules/0N-slug.html` containing only a `<section class="module" id="module-N">` block.
- `build.sh` cats `_base.html + modules/*.html + _footer.html` → `index.html`.
- Navigation: scroll-snap (`scroll-snap-type: y proximity`) with top progress bar + side nav-dots that highlight via IntersectionObserver.
- Keyboard arrows page between modules.
- **Not slides; not chapters with routing — one long scrollable page with snap.**

### Quiz primitives (3 types, all stateless / no scoring / no persistence)

1. **Standard MCQ** — author writes pure HTML with `data-correct="option-b"` on `.quiz-question-block`; option buttons call `onclick="selectOption(this)"`; "Check" button calls `checkQuiz('container-id')`. `main.js` compares `data-value` against `data-correct`, shows red/green + explanation inline.
2. **Drag-and-drop matching** — `data-correct` on `.dnd-zone`.
3. **Spot-the-bug** — `onclick="checkBugLine(this, true|false)"` (correctness hardcoded into the click handler).

**No score tally, no module-level result, no localStorage, no completion state.** This is the gap Chiron must fill (SQLite-backed scoring + SR + resume/revisit).

### Code-specific HARDCODES (need generalization for non-code domains)

- Phase 1 ("read all key files, trace data flows, cast of characters") assumes a filesystem of source code.
- `git clone <url>` first-run flow assumes GitHub URLs.
- "Vibe coder" target persona — entire content-philosophy is framed around steering AI tools, debugging, architectural decisions. For medicine/law/language, swap persona doc.
- Mandatory "Code ↔ English Translation Block" per module — pure code affordance.
- Module-purpose menu ("Meet the actors", "How pieces talk", "APIs/databases", "When things break") — all software metaphors.
- Mandatory "Group Chat" + "Message Flow / Data Flow Animation" — encodes "components communicating".
- "Spot the bug" challenge — code-only.

### What's reusable across domains (~85% of CSS+JS is generic)

- `styles.css` (34KB) — token-driven design system. **Fully domain-agnostic.**
- `main.js` (19KB) — generic event-wiring around `data-*` attributes. **Fully domain-agnostic.**
- The thing that's code-specific lives entirely in: (a) SKILL.md prose, (b) `content-philosophy.md`, (c) `interactive-elements.md` examples, (d) the module-purpose menu. Swap those four and the engine carries over.

---

## What Chiron takes verbatim

1. **`styles.css` (full file)** — fork as base of Chiron's design system. Layer ClassBuild's theme parameterization on top.
2. **`main.js` core** — extend with new quiz primitives (`mcq-clinical-vignette`, `fill-blank` with fuzzy umlaut grading, `matching-pair`, `cloze`, `true-false`, `spot-the-bug` already exists, `agreement-matrix`, `confidence-weighted`, `slider-estimation`).
3. **`_base.html` + `_footer.html` + `build.sh`** — multi-file authoring → single-file delivery pattern. Multi-file source, one self-contained `lesson.html` output.
4. **The brief-as-contract abstraction** — `module-brief-template.md` becomes Chiron's source-ingestion intermediate format ("Chiron Brief").
5. **Scroll-snap navigation + IntersectionObserver-based nav dots** — keyboard-accessible, no framework needed.
6. **Sandboxed iframe-srcdoc + RESIZE_SHIM** pattern (referenced in audit) — the right way to compose multiple chapter HTMLs without CSS bleed.

## What Chiron rejects

- ❌ "Vibe coder" persona framing → swap with domain-appropriate (Dr. Reyes for medicine, Klaus for German, etc.)
- ❌ Mandatory code-vs-English split-pane → optional, code-domain only
- ❌ "Group Chat" components-talking metaphor as universal → domain-specific (Socratic dialog, case-conference, study-group)
- ❌ Stateless quiz engine → replace with SQLite-backed (Chiron owns SR + scoring + resume)

---

## Critical CSS detail (the part you can lift)

`styles.css` opens with:

```css
:root {
  --color-bg:             #FAF7F2;       /* warm off-white, like aged paper */
  --color-bg-warm:        #F5F0E8;
  --color-bg-code:        #1E1E2E;
  --color-text:           #2C2A28;
  --color-text-secondary: #6B6560;
  --color-text-muted:     #9E9790;
  --color-border:         #E5DFD6;
  --color-surface:        #FFFFFF;
  --color-accent:         #D94F30;       /* vermillion */
  --color-accent-hover:   #C4432A;
  --color-accent-light:   #FDEEE9;
  /* ... etc ... */
}
```

This is the "warm aged-paper" aesthetic. Documented alternatives in `design-system.md`: coral (#E06B56), teal (#2A7B9B), amber (#D4A843), forest (#2D8B55). Chiron makes the accent a theme-variable (warm-paper / midnight / ocean / clinical / linguistic).

---

## Files & paths

- Local clone: `/home/gyasisutton/dev/audits/codebase-to-course/`
- Most-cited reference: `references/styles.css`, `references/main.js`, `references/module-brief-template.md`
