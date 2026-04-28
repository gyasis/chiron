# Project Brief — Chiron

**Created:** 2026-04-28
**Owner:** Gyasi Sutton (solo)
**Status:** Pre-build / design phase

## The why

Solo learners have three problems no existing tool solves at once:

1. **Subject-matter isolation.** Tools are domain-locked — a code-tutorial tool can't teach German verb conjugation; a medical-flashcard tool can't teach a Python codebase; a language app can't generate USMLE-style clinical vignettes.
2. **Pedagogy gaps.** Most LLM tools either dump exposition (too passive) or quiz brutally (too punishing) — neither models the *retrieval-practice + spaced-repetition + dialogic explanation* loop that actually drives long-term retention.
3. **Social vacuum.** Solo learners lack peers. No one to explain to. No one's question to answer. No native speaker to practice with. Studies consistently show that **explaining to a peer** outperforms re-reading by ~2× for retention (Roediger & Karpicke; Bjork).

Chiron addresses all three: **one tool, three (initial) domains, AI-simulated peer learners + native-speaker for engagement, Anki-backed spaced-repetition for retention.**

## The audience

**Primary (and currently only) user: Gyasi Sutton.** No multi-user expansion planned. The skill design and persistence model assume one learner.

That said, the design is generic enough that the skill could be ported to other users in the future — but adding multi-user infra (auth, separate state files, sharing) is explicitly out-of-scope for v1.

## What's in scope (v1)

| Capability | In scope? |
|---|---|
| Domain: code (repos → courses, like `codebase-to-course`) | ✅ |
| Domain: medicine (textbook chapters / clinical guidelines → AMBOSS-style lessons) | ✅ |
| Domain: language (German + Italian; vocab / grammar / immersion) | ✅ |
| Domain: research-paper (any PDF research paper → structured lesson — abstract / methods / results / discussion / critical-appraisal) | ✅ |
| **Domain extensibility** — user can add new domains by dropping 3 JSON files (concepts/curricula/personas) without rebuilding the skill | ✅ |
| Mode A — exposition + embedded quizzes (Coursera-style) | ✅ |
| Mode B — case-study Socratic 3-act lecture (existing skill) | ✅ |
| Spaced-repetition via Anki MCP | ✅ |
| AI peer-learner personas (Alice, Bob…) | ✅ |
| AI native-speaker persona (language) | ✅ |
| 7-question-type assessment library (MCQ, T/F, vignette-MCQ, fill-blank, matching, cloze, spot-the-bug, slider-estimation, agreement-matrix) | ✅ |
| HTML self-contained output | ✅ |
| TTS audio (German, Italian, peer voices) | ✅ |
| Infographics (Gemini image gen) | ✅ |
| SQLite or JSON learner state | ✅ |
| Concept-DAG-as-validator | ✅ |

## What's out of scope (v1)

| Capability | Out of scope? |
|---|---|
| Multi-user / sharing / classroom features | ❌ |
| Mobile apps (web-only HTML) | ❌ |
| Live tutoring chat with the lesson generator | ❌ — focus on async lesson, not real-time tutor (defer to v2) |
| New domains beyond code/medicine/language | ❌ — defer until v1 ships |
| Custom rendering targets (Coursera, Notion, Obsidian) | ❌ — HTML only for v1 |
| Voice input (user speaking back) | ❌ — defer |
| Image-as-input (X-rays, equations) | ❌ — defer |
| Code execution / runnable code blocks in lessons | ⏸ — borderline; revisit during build |

## Success criteria (v1 ships when…)

1. ✅ Generates a German vocab lesson with fill-blank + cloze cards + native-speaker TTS dialogue + in-lesson SR review
2. ✅ Generates a USMLE/AMBOSS-style hypertension lesson with 5+ clinical-vignette MCQs (vignette → labs → leading Q → 5 options → per-distractor explanations + Hammer difficulty + Attending Tip)
3. ✅ Generates a code-repo lesson with side-by-side code-English + spot-the-bug + AI peer-learner discussion of architectural choice
4. ✅ Generates a research-paper lesson from an arbitrary PDF (e.g., a recent NEJM paper) with abstract digest + methods walkthrough + results explanation + critical appraisal + comprehension MCQs
5. ✅ All four lessons render in browser without build step
6. ✅ Resume + revisit work — re-open lesson, due cards appear, scroll position restored
7. ✅ A new domain (e.g., music-theory) can be added by dropping 3 JSON files + optional prompt variant — no skill rewrite needed
8. ✅ Learner state persists across sessions (SQLite)
9. ✅ Optional `.apkg` Anki export works for users who want mobile review

## Anti-goals

- Don't build a new SR engine (use Anki).
- Don't build a new LLM framework (use Claude Code skill packaging).
- Don't build a new HTML rendering library (use codebase-to-course's shell).
- Don't optimize for breadth ahead of depth (3 domains done well > 10 domains done weakly).
