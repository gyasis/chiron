# Follow-Ups — Chiron

**Open questions, deferred decisions, future investigations.**

---

## Pending external research

- 🟡 **AMBOSS + UpToDate deep research** (task `aa71eb17`, started 2026-04-28). Gates paired debate.
- ⚪ Investigate `S4nfs/Neeto-1.0-8b` — could it run locally for HIPAA-safe medical lesson generation? Worth a small spike.
- ⚪ Investigate QUEST-AI implementation — is there reference code we can adapt for the medical-MCQ verifier loop?

---

## Architecture decisions deferred to paired debate

(See `~/dev/prd/scratch/universal_lesson_generator_2026-04-28.md` §5b for the full list.)

- [ ] Single skill vs skill-bundle vs MCP server
- [ ] Mode A / Mode B selection heuristic
- [ ] TypeScript vs Python
- [ ] Source-ingestion adapter contract (uniform "brief" intermediate format)
- [ ] Anki MCP server choice — single or per-domain
- [ ] Verifier loop adoption (QUEST-AI 3-stage)
- [ ] Skill-creator eval rig adoption
- [ ] Curriculum template format flexibility
- [ ] Image-as-input deferral confirmation
- [ ] Code-execution-in-lesson decision (runnable code blocks?)

---

## Future capabilities (v2+)

- [ ] **Italian** (parallel to German implementation)
- [ ] **Voice input** — user speaks German, native-speaker persona responds
- [ ] **Image input** — user uploads X-ray, lesson explains findings
- [ ] **More domains** — law, music theory, history, finance, physics
- [ ] **Mobile-friendly HTML** — currently desktop-first
- [ ] **Live tutoring chat** — real-time Q&A vs current async lesson model
- [ ] **Adaptive sequencing** — re-order chapters based on demonstrated mastery
- [ ] **Spaced retrieval IN the lesson** (not just Anki) — old chapter cards interleaved into new chapter quizzes

---

## Hypotheses to validate during build

- ⚪ Does `mcq-clinical-vignette` need a different rendering primitive than standard MCQ? (Probably yes — vignette can be 200-500 words, layout differs)
- ⚪ Does fuzzy umlaut grading work well enough? Or do we need a proper German/Italian morphological analyzer?
- ⚪ Will Gemini TTS sound natural enough for German + Italian native-speaker dialogue? Alternative: ElevenLabs.
- ⚪ Can a single LLM (Sonnet) handle all 7 question types well, or do we need different models per type?
- ⚪ Will solo-learner persona-engagement feel forced? (Risk: cringe-y AI peers; mitigation: keep personas terse, rare, optional)

---

## Things to watch / monitor

- 🟡 ai-course-generator's Postgres-heavy approach — confirm SQLite is actually sufficient at our scale
- 🟡 ClassBuild's `answerBalancer.ts` — does it actually catch the long-answer artifact reliably? If not, we'll need our own quality checks
- 🟡 codebase-to-course's iframe-srcdoc rendering — does it scale to multi-chapter sites or is single-iframe better?
- 🟡 Anki MCP server reliability — how often does AnkiConnect drop connections? Need fallback (export `.apkg` if MCP fails)

---

## Notes from external sources to revisit

- "non-RAG outperformed RAG for pharmacology MCQs" (88% vs 69%) — implication: don't reach for RAG by default; LLM internal knowledge is often better for highly-axiomatic foundational content. Revisit when designing source-ingestion adapter for medicine.
- ChalkAI's reactive-DSL pattern — overkill for v1 but interesting for math/physics in v2.
- Skill-creator's 4-sub-agent eval rig — definitely adopt during Phase 8.

---

## Documentation debt

(none yet — pre-build)

---

## Tech debt to anticipate

- LLM provider lock-in to Anthropic — design gateway abstraction so OpenAI/Gemini fallback is clean
- Hardcoded German + Italian — language module should be parameterized so adding French/Spanish is template-only
- Single-page HTML scaling — if courses get large (>20 chapters), consider multi-page output
