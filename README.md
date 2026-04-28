# Chiron

> *"A centaur. A teacher. The tutor of Achilles, Asclepius, Jason, and Heracles."*

**Chiron** turns any subject — code repos, medical chapters, German/Italian language, books, papers — into a structured, interactive lesson with embedded quizzes, AI-simulated peer learners, and Anki-backed spaced-repetition retention. Built as a Claude Code skill for solo learners.

## Status

🚧 **Pre-build** — design phase. See:
- Design PRDs: [`prd/`](prd/) (project-local, NOT in global `~/dev/prd/scratch/`)
- Memory bank: [`memory-bank/`](memory-bank/)

## What it is

A unified Claude Code skill (with sub-skills per domain where pedagogy demands specialization) that produces a self-contained interactive HTML lesson site for one of three (initial) domains:

- **Engineering / Code** — repos → multi-chapter HTML course with side-by-side code-to-English, embedded MCQs / true-false / spot-the-bug, AI peer-learner study-group dialogue
- **Medicine** — clinical guidelines / textbook chapters → AMBOSS-style sections (Definition / Pathophysiology / Clinical features / Diagnostics / Treatment / Complications) with USMLE-style clinical-vignette MCQs (vignette stem + lab values + leading question + 5 options + per-distractor explanations)
- **Language (German / Italian)** — vocab / grammar / immersion → fill-in-the-blank, matching pairs, cloze deletion, AI native-speaker conversation partner with TTS audio, AI peer-learner role-play

## Pillars

| Pillar | Implementation |
|---|---|
| **Two pedagogical modes** | Mode A (exposition + quizzes — `codebase-to-course`-style) + Mode B (case-study — `case-study` skill: 2 hunters + paired debate + 3-act lecture) |
| **Cognitive science scaffolding** | ClassBuild's typed-schema approach: `SciencePrinciple` union, `ScienceAnnotation`, `spacingConnections[]` enforced via type system, not vibes |
| **AI multi-persona engagement** | Peer-learner agents (Alice asks why X; Bob suggests Y; you respond) + native-speaker for language. Fights solo-learner isolation |
| **Spaced-repetition retention** | Anki via MCP server (no custom SR engine — Anki is gold-standard with SM-2/FSRS) |
| **Deterministic progression** | Concept DAG as build-time validator + linear milestone FSM at runtime — LLM is advisor, not arbiter (per `JulienAvezou/ai-course-generator` pattern) |

## Domains are co-equal

Code, medicine, and language are equally weighted. Specialized paths exist where pedagogy demands it (medical MCQ pairs with clinical vignette; language MCQ pairs with fill-blank; code MCQ pairs with spot-the-bug). The HTML rendering shell + the SR layer + the AI-peer-learner personas are **shared across all three**.

## Heritage

Chiron stands on the shoulders of:

| Source | What we borrowed |
|---|---|
| [`zarazhangrui/codebase-to-course`](https://github.com/zarazhangrui/codebase-to-course) (4.1k★) | HTML rendering shell — `main.js` + `styles.css` + `_base.html`. ~85% domain-agnostic per audit. |
| [`jtangen/classbuild`](https://github.com/jtangen/classbuild) (MIT) | 5-stage pipeline · typed-schema-as-pedagogy · 7-question-type weekly challenge · `answerBalancer.ts` post-pass · multimedia (TTS + infographics) · repurposed discussion/activities for AI peer dialogue |
| [`JulienAvezou/ai-course-generator`](https://github.com/JulienAvezou/ai-course-generator) (MIT) | Concept DAG as build-time validator · LLM-as-advisor-not-arbiter · LLM gateway w/ secret scan + token gate + sha256 cache · LLM-with-validator retry pattern |
| [`~/.claude/skills/case-study.md`](~/.claude/skills/case-study.md) | Mode B 3-act-lecture pattern with 2 adversarial hunters + Gemini paired debate |
| Anki MCP servers ([`amidvidy`](https://github.com/amidvidy/anki-mcp), [`nailuoGG`](https://github.com/nailuoGG/anki-mcp-server), [`samefarrar/mcp-ankiconnect`](https://github.com/samefarrar/mcp-ankiconnect)) | SR backend — generate cards, push to Anki, let Anki schedule reviews |
| AMBOSS / UpToDate (formatting research in flight) | Medical content section structure, vignette templates, evidence grading |

## Why "Chiron"?

Chiron was unique among centaurs: civilized, learned, and the prototype tutor. He taught **medicine** to Asclepius (the god of healing), **strategy and music** to Achilles, **navigation** to Jason, and **astronomy** to Heracles. One teacher, many subjects, deep mastery — exactly what this project is for.

## License

TBD — likely MIT.
