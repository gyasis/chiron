# Paired Debate — Chiron Architecture
## Claude × Gemini, 2 rounds + 3-act synthesis

**Date:** 2026-04-28
**Format:** ROUND 1 = Architectural Hawk (Gemini, principled / staff-engineer position) → ROUND 2 = Pragmatic Counter-Lecture (Gemini, solo-dev steelman) → ACT III = Synthesis (Claude)
**Inputs:** 3 audits (codebase-to-course, classbuild, ai-course-generator) + 2 deep-research outputs (broad market scan, AMBOSS+UpToDate medical formatting) + memory-bank locked decisions
**Output:** locked architectural decisions for Chiron v1

---

## ROUND 1 — The Architectural Hawk's Lecture

> *"Cathedral, not shed. We aren't building a 'toy' for a weekend project; we are architecting a pedagogical engine."*

### 1. Single Skill vs. Bundle vs. MCP Server
**Position:** **MCP Server with Domain-Specific Toolsets.**
**Rationale:** At Google/Anthropic, we don't build monolithic "skills." We build MCP servers. Chiron should be an MCP server that exposes a standardized interface. This decouples the "Brain" (Claude) from the "Actuator" (Chiron). MCP gives interoperability with any IDE or agent that speaks the protocol.
**Why alternatives wrong:** A "bundle" of skills is a maintenance nightmare — 80% logic duplication. A single monolithic skill hits context window limits and becomes a "God Object" impossible to debug.

### 2. Mode A vs. Mode B Selection
**Position:** **Heuristic Auto-Detect with Explicit "Intent Confirmation" Handshake.**
**Rationale:** The system must be "Inference-First." When a user drops a 500-page PDF on German Law, the system should infer Mode A. However, the Architectural Hawk never assumes. Present a **Proposed Execution Plan (PEP)**: "I've analyzed this input. Mode A is optimal for comprehensive coverage; Mode B is optimal for case-study mastery. I recommend Mode A. Proceed?"
**Why alternatives wrong:** Explicit choice alone is high-friction. Generating both by default is computationally wasteful and creates "decision fatigue."

### 3. Source-Ingestion Adapter Contract
**Position:** **Unified Intermediate Representation (The "Chiron Brief").**
**Rationale:** Compilers go through LLVM IR. You must implement a **Unified Brief Format (UBF)**. Whether the input is `.ts`, `.pdf`, or `.mp3` transcript, the first stage must normalize it into a structured JSON Brief.
**Why alternatives wrong:** Per-domain pipelines lead to "Spaghetti Specialization." If you build "Medicine Pipeline" and "Code Pipeline" separately, you can never build a "Medical Software" course.

### 4. Language: TypeScript vs. Python
**Position:** **TypeScript (Strict Mode) for the Entire Stack.**
**Rationale:** You are building a web-based interactive experience. Output is HTML/JS. Reference repos are TS. **Effect-TS** or **Zod** provide runtime validation as robust as Pydantic. Keeping the stack isomorphic eliminates the "serialization tax."
**Why alternatives wrong:** Python's LLM tooling is slightly ahead, but not enough to justify architectural fragmentation.

### 5. Curriculum Template Format
**Position:** **Strict Rigid Schemas with Discriminated Unions.**
**Rationale:** A DSL is a trap. Use **Strict Schemas** where each domain is a variant of a base `Curriculum` type. Medicine *must* have `vignette_count`; Code *must* have `repo_map`.
**Why alternatives wrong:** Flexible DSLs lead to "Schema Drift." LLM eventually generates a key your renderer doesn't support.

### 6. QUEST-AI 3-Stage Verifier Loop
**Position:** **Mandatory Global Verifier Pattern.**
**Rationale:** "Unverified output" is a bug. **Generate → Verify → Refine** is the core of the engine, not a "medicine feature."
**Why alternatives wrong:** Making it optional creates tiered quality. If Chiron is to be trusted as a "tutor," its word must be gold.

### 7. Skill Validation Rig
**Position:** **Adopt the Full Pipeline (Executor → Grader → Comparator).**
**Rationale:** You cannot improve what you cannot measure. Need a "Golden Dataset" of 10 inputs. Without a Comparator, you are just "vibes-based engineering."
**Why alternatives wrong:** Skipping this "to ship v1" is a debt you'll never pay off.

### 8. LLM Gateway
**Position:** **Custom Minimal Gateway with OpenTelemetry/Traceability.**
**Rationale:** Build a thin wrapper implementing **SHA-256 Content-Addressable Caching**, **Semantic Logging**, and **Circuit Breaking**.
**Why alternatives wrong:** Third-party gateways are black boxes.

### 9. HTML Rendering: Multi-file vs. Single-file
**Position:** **Multi-file Build Pipeline (The "Static Site Generator" Pattern).**
**Rationale:** Architecture is about separation of concerns. Content (JSON), styling (CSS), and logic (JS) should be distinct assets.
**Why alternatives wrong:** "Single-file portability" is a myth for complex apps. Once you add D3.js, Vue, and custom widgets, the file becomes a 10MB unreadable blob.

### 10. AI Peer-Learner Persona Engine
**Position:** **Stateful (Session-bound Persistence).**
**Rationale:** Effective pedagogy requires a "Narrative Arc." If Alice and Bob forget that I struggled with "Pointer Arithmetic" in Chapter 1, they are useless in Chapter 4.
**Why alternatives wrong:** Stateless personas are "Chatbot Goldfish."

### 11. ChalkAI Integration
**Position:** **Sidecar Service / Federated Component.**
**Rationale:** Treat ChalkAI as a Federated Component. HTML shell provides a "Mount Point" where the ChalkAI runtime can boot up.
**Why alternatives wrong:** Reimplementing the DSL pattern is "Not Invented Here" syndrome.

### 12. Cost Guard
**Position:** **Hierarchical Token Quotas (Per-Stage + Per-Run).**
**Rationale:** Hard Quotas at "Course" level (e.g., $5.00) and Soft Quotas at "Stage" level. If a stage exceeds budget, pause and ask for "Budget Extension."
**Why alternatives wrong:** A single course budget is too blunt.

---

## ROUND 2 — The Pragmatic Counter-Lecture

> *"You're a product engineer building for an audience of one. Every abstraction is a tax you'll pay forever. The hawk wants a cathedral; you need a shed."*

### 1. Single Skill vs. Skill Bundle vs. MCP Server
**Counter-position:** Single Skill. It's a Python script or a single TS file.
**Hidden Costs:** MCP servers require lifecycle management, transport protocols, debugging a "middleman" layer.
**Option C:** A `Makefile`. `make learn-german` or `make learn-med`. No discovery logic, no registries.
**2-Week Ship:** A single CLI script with a `--domain` flag.

### 2. Mode A vs. Mode B Selection
**Counter-position:** Explicit selection only. Use a flag: `--mode case` or `--mode survey`.
**Hidden Costs:** "Auto-detection" via LLM is a latency hit and a point of failure.
**Option C:** "Heuristic Router." If input is < 2000 words, default to Mode B (Case). If > 2000, Mode A (Survey).
**2-Week Ship:** Explicit CLI flags.

### 3. Source-Ingestion Adapter Contract
**Counter-position:** No contract. Use `cat` and `pbpaste`.
**Hidden Costs:** Building a "Unified Brief" adapter for four specific domains is engineering theater.
**Option C:** Just-in-time extraction. One "Ingest" prompt per domain that converts raw text into a flat JSON blob.
**2-Week Ship:** A `scripts/clean_text.py` that dumps everything into `raw.txt`.

### 4. TypeScript vs. Python
**Counter-position:** Python. Period.
**Hidden Costs:** TypeScript's LLM ecosystem is second-class.
**Option C:** Python for the "brain" (logic/LLM), raw HTML/JS for the "body" (render).
**2-Week Ship:** Python scripts writing to `lesson.html`.

### 5. Curriculum Template Format
**Counter-position:** Rigid f-strings.
**Hidden Costs:** A DSL is a project in itself. You'll spend your weekend debugging your own parser.
**Option C:** Markdown templates with "Magic Comments" like `<!-- CHALK_WIDGET_HERE -->`.
**2-Week Ship:** Five hardcoded `.txt` files containing system prompts.

### 6. QUEST-AI 3-Stage Verifier Loop
**Counter-position:** Skip it. You are the verifier.
**Hidden Costs:** 3x tokens, 3x latency. For a solo learner, a hallucination is an opportunity to look it up and *learn*.
**Option C:** "Verification on Demand." Add a button: "Verify this chapter."
**2-Week Ship:** Zero verifier loops. Sonnet 3.5 is smart enough.

### 7. Skill Validation Rig
**Counter-position:** Manual eyeball test.
**Hidden Costs:** Building a "validation rig" for a solo project is the ultimate procrastination.
**Option C:** A "Golden Set" of 4 inputs. Run script, open 4 HTML files. If they look good, done.
**2-Week Ship:** A `test.sh` running 4 example lessons in Chrome.

### 8. LLM Gateway
**Counter-position:** `os.environ["ANTHROPIC_API_KEY"]`.
**Hidden Costs:** LLM gateways are for teams. You are one guy.
**Option C:** A simple `llm_call(prompt)` wrapper with a `print()` for cost.
**2-Week Ship:** Direct SDK calls. No gateway, no secret scanning.

### 9. HTML Rendering
**Counter-position:** Single-file inline HTML.
**Hidden Costs:** A "build system" (Vite/Webpack) for a lesson generator is a dependency nightmare. Open the project in two years — build broken.
**Option C:** Tailwind via CDN, single `<script>` tag. Everything in one `.html`. Portable and immortal.
**2-Week Ship:** Python `render.py` injecting JSON into `template.html`.

### 10. AI Peer-Learner Persona
**Counter-position:** Stateless.
**Hidden Costs:** Stateful "Alice" (storing misconceptions in SQLite) sounds cool but adds prompt-window bloat.
**Option C:** "Pseudo-state." End of Chapter 1, LLM summarizes "what user struggled with" into 3 bullets. These pass into Chapter 2 prompt.
**2-Week Ship:** Stateless "Alice" — Socratic interlocutor within current chapter only.

### 11. ChalkAI Integration
**Counter-position:** Steal the DSL pattern, skip the library.
**Hidden Costs:** Importing a full runtime when you just need a few LaTeX formulas and a diagram is overkill.
**Option C:** Mermaid.js + MathJax via CDN. They handle 90% of medicine and code repos.
**2-Week Ship:** Mermaid.js for diagrams, MathJax for formulas.

### 12. Cost Guard
**Counter-position:** Single course budget check.
**Hidden Costs:** Per-stage budgets ("don't spend more than $0.05 on outline") are too granular.
**Option C:** Hard character limits on inputs and a `dry-run` flag.
**2-Week Ship:** `input()` prompt: "This course will cost ~$0.40. Proceed? [y/N]".

### What I'd actually do this weekend

- **Forget the "Architecture":** Write one Python script (`chiron.py`) that takes a PDF + domain flag.
- **Ditch the DB:** Flat folder structure: `/lessons/german_1/`. SQLite is for v2.
- **The "Surgical" UI:** Single HTML template with Dark Mode + Print to PDF.
- **No Loops:** One big prompt for "Pedagogy", one for "Content." Two API calls per chapter.
- **Manual Ingestion:** If a research paper is too long, copy-paste relevant sections.

**Summary:** Hawk wants a "Lesson Generation Engine." Build a "Markdown-to-HTML-via-LLM" script. Don't let "good engineering" stop you from shipping.

---

## ACT III — Synthesis

### Where the hawks AGREE

1. **TypeScript wins as the single language.** Hawk: "isomorphic stack reduces serialization tax." Pragmatist: "match the heritage repos so you can copy-paste." Either way, TS.
2. **SHA-256 content-addressable caching is non-negotiable.** Even Pragmatist concedes "never pay for the same prompt twice" is worth ~30 LOC.
3. **Multi-file authoring is fine** as long as the *output* is a clean distributable. They disagree on output format but agree on modular *authoring*.
4. **There must be SOME validation.** Neither says "ship blind."
5. **Stateful pedagogy beats fully-stateless.** Pragmatist's "Option C" (chapter-end summary fed forward) is *also* stateful, just with a smaller window.

### Where they DISAGREE — and the synthesis

| Axis | Hawk | Pragmatist | Chiron synthesis |
|---|---|---|---|
| **1. Packaging** | MCP server | Single CLI script | **Single Claude Code skill with sub-prompt routing per domain.** MCP overkill (no third party consumes Chiron); CLI loses skill UX. The skill IS the right abstraction. |
| **2. Mode A vs B** | Auto-detect with PEP confirmation | Explicit `--mode` flag | **Heuristic with override.** Pragmatist's heuristic is right: <2000 words → Mode B candidate; >2000 → Mode A. Show inferred mode + 1-line reason; user types `mode b` to override. No 6-step PEP ceremony. |
| **3. Source ingestion** | Unified Brief IR (LLVM analogy) | `cat` + `pbpaste` per domain | **Unified Brief IR — but lazy.** Hawk right long-term (cross-domain courses). Pragmatist right short-term (don't over-build). **Build Brief schema now, but each adapter is a 30-line per-domain function — no shared base class until v2.** |
| **4. Language** | TS strict mode | Python | **TypeScript.** Hawks agree. Heritage compatibility wins. Use Zod for runtime validation. |
| **5. Curriculum templates** | Strict discriminated unions | Hardcoded f-strings | **Strict TS discriminated unions, NOT a DSL.** Pragmatist's "DSL is a trap" is right — but f-strings are too loose. Discriminated unions give you LLM-output validation without inventing a parser. |
| **6. QUEST-AI verifier** | Mandatory globally | Skip; you are verifier | **🔴 CONDITIONAL — mandatory for medicine; opt-in elsewhere.** Hawk overcautious for solo learning, but Pragmatist underestimates medical hallucination risk (don't memorize fabricated drug doses). For medicine: 3-stage no exceptions. For code/language/research-paper: skip in v1, add in v2 if regressions surface. |
| **7. Eval rig** | Full skill-creator pipeline | 4 golden inputs + eyeball | **🔴 4 golden inputs + scripted regression run.** Pragmatist right that Executor→Grader→Comparator→Analyzer is procrastination. But "manual eyeball" is too loose. **Build a 50-line `test.sh` running 4 reference lessons + diffing key fields against stored snapshot. Add comparator only when prompt churn becomes painful.** |
| **8. LLM gateway** | Custom w/ OpenTelemetry | Direct SDK calls | **🔴 The pragmatist is RIGHT here.** Solo dev with one set of API keys does not need a "proxy for yourself." But sha256 caching still matters. **Build a 50-line `llm.ts`: SDK call + sha256 cache + `console.log` cost. No secret scanner, no Postgres usage table.** |
| **9. HTML output** | Multi-file build pipeline | Single-file inline | **🔴 The pragmatist is RIGHT.** Hawk's "10MB single-file" is a strawman — codebase-to-course's actual output is single-file and works. **Single-file HTML output with Tailwind CDN + ChalkAI runtime via CDN. Multi-file *authoring* (modular templates), single-file *delivery* (one self-contained `lesson.html`). Best of both.** |
| **10. Peer personas** | Full stateful with misconception retrieval | Stateless | **Option C wins (Pragmatist's own).** Chapter N writes "what user struggled with" 3-bullet summary → fed into Chapter N+1's prompt. Pseudo-stateful. ~10 LOC. No SQLite "misconception retrieval" engine for v1. |
| **11. ChalkAI** | Sidecar federated component | Skip — Mermaid + MathJax | **🔴 CONDITIONAL — ChalkAI for math/physics; Mermaid+MathJax everywhere else.** Pragmatist right that 80% of cases (medicine ECG, code dependency graphs, research-paper forest plots) are Mermaid + MathJax. Reserve ChalkAI for genuine math/physics interactive cases. **Architectural rule: ChalkAI runtime loads on-demand only when chapter has `WidgetSpec.type = 'reactive-math'`.** |
| **12. Cost guard** | Hierarchical per-stage quotas | Single-course `[y/N]` | **Single-course estimate + hard fail at $25.** Hawk's per-stage budgets over-engineered. Pragmatist's `[y/N]` is enough. Add hard-stop hardcoded at $25 just in case. |

### The pedagogical core (3 lessons that generalize)

1. **For an audience of one, the right architecture is "expensive only where the marginal user benefits."** Hawk's instinct (build the eval rig, the gateway, the verifier loop) is correct *for a team*. For Chiron, rules invert: build it only if it shortens *the developer's* iteration cycle. Sha256 caching shortens it. OpenTelemetry doesn't.

2. **"Unified IR" is right long-term, but the abstraction should grow from concrete cases.** Build the second domain by copy-paste; abstract on the third. Premature unification (Hawk) and zero abstraction (Pragmatist) are both wrong. The cost of a Brief schema is small if it's "schema only, no shared adapter base class."

3. **Verification is domain-specific, not universal.** Hawk's "verification is the cost of doing business" treats all hallucinations as equally costly. They're not. A wrong German verb is self-correcting. A wrong drug dose memorized into Anki is *durably* dangerous. Verifier loops belong where the cost of wrong is asymmetric.

### Concrete recommendation

**Order: this week → next sprint → defer indefinitely.**

#### This week (the v1 minimal)
1. Single Claude Code skill, TypeScript, single-file HTML output
2. 4 domain adapters (code / medicine / language-de / research-paper) — copy-paste, no shared base
3. Discriminated-union Curriculum schema. Zod validation at LLM-output edge
4. Mode A + Mode B with heuristic + override
5. 50-line LLM call wrapper with sha256 cache
6. Pseudo-stateful Alice (chapter-summary feed-forward)
7. Single-course cost estimate + `[y/N]` prompt + hard-fail at $25
8. ChalkAI loaded on-demand only when `WidgetSpec.type = 'reactive-math'`. Mermaid + MathJax for everything else
9. SQLite for resume + revisit + SR (locked decision, no debate)
10. 4 golden inputs + `test.sh` regression script

#### Next sprint (after v1 ships lessons)
- Medical 3-stage Generate→Verify→Refine verifier loop (medicine domain only)
- Per-language language adapters (Italian)
- `.apkg` Anki export for users who want it
- ChalkAI sidecar federation (full Vue runtime, when math/physics actually surfaces)

#### Defer indefinitely (until pain forces it)
- MCP server packaging (only if a third party wants to consume Chiron)
- OpenTelemetry / structured logging (only if cost runaway happens)
- Skill-creator full Executor→Grader→Comparator→Analyzer (only when prompt churn breaks `test.sh`)
- Per-stage cost budgets (only if hard-fail-at-$25 fires more than once)
- Stateful misconception retrieval engine (only if pseudo-state proves insufficient)

### Resolving the original question

**Single TypeScript Claude Code skill, single-file HTML delivery, discriminated-union schemas, sha256 cache, ChalkAI on-demand, medicine-only verifier loop, pseudo-stateful Alice, 4 golden inputs.** That is v1. Every other architecture piece earns its place by being specifically motivated by a problem actually hit — not by general principle.

The hawk wanted to build a cathedral. The pragmatist wanted to build a shed. Chiron is a **purpose-built workshop** — bigger than a shed (typed schemas, sha256 cache, verifier for medicine), smaller than a cathedral (no MCP, no telemetry, no gateway). The discriminator: every feature has a concrete user-of-one benefit, not a "what would Google do" justification.

---

## Postscript

This debate ran on 2026-04-28 during the Chiron design phase. Round 1 + Round 2 generated by `mcp__gemini-mcp__gemini_brainstorm` in parallel, ~7-9 minutes total. Act III synthesis written by Claude in the main session. Methodology field-tested via `~/.claude/skills/case-study.md` (which itself was generalized from `hh-case-study` earlier the same day).

Outcome: 12 architectural decisions locked. v1 buildout plan defined. Comprehensive PRD to be generated next.
