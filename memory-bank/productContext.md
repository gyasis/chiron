# Product Context — Chiron

**What the user-facing experience feels like across the three domains.**

---

## Code domain — example user flow

User: *"Make a course out of `~/dev/projects/foo` so I can understand it before I extend it."*

Chiron:
1. Detects local codebase. Reads files, identifies abstractions ("Cube model", "dbt staging", "Cube view", "Zeno chart"), orders them pedagogically.
2. Generates a 5-7 chapter HTML course site (single page, scroll-snap modules):
   - Each chapter has: narrative explanation + side-by-side code-to-English block + an embedded MCQ + a "spot the bug" challenge + a "how would Alice the peer explain this?" persona block where AI-Alice misunderstands and the user explains back to her.
3. Generates 30-50 Anki cards covering term-definition, design-pattern names, key code snippets.
4. Pushes Anki cards via MCP. Opens `index.html` in browser.
5. Lesson can be revisited; learner state (which quizzes attempted, which cards reviewed) persists in `.chiron-state.db`.

---

## Medicine domain — example user flow

User: *"Make a lesson on community-acquired pneumonia from this textbook chapter."* (provides PDF)

Chiron asks: *"AMBOSS-style (board prep — concise, bulleted, buzzwords + Hammer-rated MCQs) or UpToDate-style (clinical decision support — exhaustive prose, GRADE recommendations) or both?"*

### AMBOSS-style output
1. Ingests PDF. Extracts sections in **AMBOSS hierarchy**: Epidemiology / Etiology / Pathophysiology / Clinical Features / Diagnostics / Pathology / Differential Diagnoses (tabular) / Treatment / Complications & Prognosis.

   **Chemistry / pharm content is rendered structurally**, not just narrated:
   - Drug structures from SMILES via Kekule.js (e.g., the metformin biguanide structure rendered, not just described)
   - Pharmacology MOA: enzymatic reaction equations via MathJax+mhchem (e.g., `\ce{Angiotensin I ->[\text{ACE}] Angiotensin II}` — substrate, enzyme above arrow, product)
   - Underlying biochem: pathway diagrams (e.g., for diabetes — glucose → pyruvate → acetyl-CoA → Krebs cycle, with insulin/glucagon regulatory arrows)
   - Disease pathophys at molecular level: enzymatic dysregulation rendered (e.g., for gout — `\ce{Hypoxanthine ->[\text{xanthine oxidase}] Xanthine ->[\text{xanthine oxidase}] Uric acid}`)
   - Normal physiology: shown when relevant for contrast (e.g., normal coag cascade vs. hemophilia A)
2. Generates HTML lesson:
   - Each section: **nested bullets only** (no prose), buzzwords **bolded**, high-yield facts in `<mark>` (yellow), hover-tooltip definitions on medical jargon
   - Embedded **clinical-vignette MCQs** (Hammer difficulty 1-5): "A 67-year-old male presents with 3 days of productive cough, fever to 38.9°C, SpO2 91% on room air. Chest X-ray shows right lower lobe consolidation. WBC 15.2 with left shift. **What is the most likely organism?**" → 5 options → on submit, per-distractor explanation appears: "Streptococcus pneumoniae — correct: most common cause of CAP in this age group. Mycoplasma pneumoniae — tempting because of CAP overlap, but typically presents with dry cough in younger patient and patchy interstitial infiltrate, not lobar consolidation." Plus `<keyinfo>` tags highlighting "67-year-old", "lobar consolidation", "left shift". Plus **Attending Tip**: *"Lobar consolidation + acute presentation in older adult = think pneumococcus until proven otherwise."*
   - Differential diagnosis as **table** (Disease | Key Clinical Differentiator | Diagnostic Finding)
   - AI **Dr. Reyes** persona Socratically asks follow-ups
   - SQLite SR cards generated per high-yield concept
3. Word count target: 1,500-2,000

### UpToDate-style output
1. Same source PDF. Extracts sections in **UpToDate hierarchy**: Introduction / Pathogenesis / Clinical Manifestations / Evaluation and Diagnosis / Differential Diagnosis (prose) / Management / **Summary and Recommendations**.
2. Generates HTML lesson:
   - Each section: **academic prose paragraphs**, heavy citations
   - Final section is bulleted **GRADE-graded recommendations**: *"For outpatient adults with CAP, we suggest amoxicillin or doxycycline as first-line monotherapy (Grade 2B). For patients with comorbidities or recent antibiotic exposure, we recommend amoxicillin-clavulanate plus a macrolide (Grade 1B)..."*
   - Society guideline links (IDSA, ATS)
3. Word count target: 5,000-10,000
4. No Qbank quizzes — instead, embedded clinical decision algorithms / calculators

Both outputs share Chiron's HTML shell + SQLite resume/revisit + AI multi-persona engagement.

---

## Language domain (German example) — example user flow

User: *"Teach me dative case in German with practice."*

Chiron:
1. Identifies grammar concept (dative case). Pulls source from open-source German grammar references.
2. Generates HTML lesson:
   - Chapter 1: When dative is used (with → mit, from → von, since → seit, prepositions list)
   - Chapter 2: Dative pronouns (mir, dir, ihm, ihr, uns, euch, ihnen)
   - Chapter 3: Dative articles (dem, der, dem, den+n)
   - Chapter 4: Practice (fill-in-the-blank conjugation: "Ich gebe ___ Buch ___ Mann" → der → dem with fuzzy umlaut grading)
   - Chapter 5: Dialogue practice with **AI native-speaker persona** ("Klaus") — TTS-voiced. User reads a sentence in dative; Klaus responds in German; user interprets/responds. Mode A scrolling chapter, but the dialogue feels conversational.
3. Generates 50-80 Anki cards: vocabulary (sentence-shaped cloze cards), preposition + case pairs, conjugation drills.
4. Pushes deck. Opens lesson.

---

## Research-paper domain — example user flow

User: *"Make a lesson out of this paper."* (drops PDF: `~/Downloads/jones2025_glp1_cardiovascular.pdf`, specifies domain: `research-paper`)

Chiron:
1. Ingests PDF via generic `pdf-extractor` adapter (works for any PDF — medical, science, humanities). OCR fallback if scanned.
2. Identifies sections automatically (most papers follow IMRAD: Introduction / Methods / Results / Discussion). Maps to Chiron's `curricula/research-paper.json` template:
   - **Chapter 1: Why this paper matters** — the gap in literature, the question being asked
   - **Chapter 2: Methods** — study design (RCT? cohort? meta-analysis?), population, intervention, primary outcome — explained for the unfamiliar
   - **Chapter 3: Results** — what the data showed (with figure/table summaries — Gemini image gen for the key plot)
   - **Chapter 4: Discussion** — what the authors claim + how to interpret it
   - **Chapter 5: Critical appraisal** — methodological strengths and limitations, conflicts of interest, generalizability — Socratic prompts: "is the sample size adequate? is the comparator fair? are the conclusions supported by the data?"
   - **Chapter 6: Connections** — how this paper fits the broader literature; what's the next experiment?
3. Embedded quizzes:
   - MCQ on study design ("This is a [randomized / cohort / case-control / meta-analysis] study because...")
   - MCQ on primary outcome ("The primary endpoint was...")
   - True/false on common misinterpretations
   - Critical-appraisal slider ("On a scale of 1-10, how confident should we be in this finding?")
4. AI **peer-learner Bob** asks: *"Wait, didn't they exclude patients with X? How does that affect the conclusions?"* — user has to explain back.
5. AI **PI persona Dr. Hofmann** (the senior researcher) Socratically asks: *"What study would you design to follow this up?"*
6. SR cards generated: methodology terms, key statistics, citation network nodes
7. Lesson output as standalone HTML with the SQLite state DB. Resume + revisit work as in other domains.

This domain is **especially powerful for journal clubs, study clubs, and self-directed deep-dives into specific topics.**

## Cross-domain: how peer-learner personas work

In every domain, Chiron generates 2-3 **peer-learner personas** (e.g., "Alice", "Bob") whose role is to:

- **Ask the question the user might be afraid to ask** ("wait, why is that the answer? I thought it was X")
- **Propose plausible-but-wrong reasoning** so the user has to correct them — explanation-based retrieval (Feynman technique)
- **Express enthusiasm / confusion / hypothesis** so the lesson feels socially alive

Implementation: in `discussion.ts`-like prompt, generate a 3-message exchange between Alice and Bob about the chapter's key concept. Then prompt the user with: "Alice asks Bob: '<question>'. What would you say to clarify?"

This is a **content-layer feature**, not a multi-user system.

---

## Cross-domain: Mode B (case-study) integration

If user input fits Mode B (e.g., "case study this clinical incident" or "explain the pattern in this bug"), Chiron delegates to the existing `~/.claude/skills/case-study.md` skill. Mode B output is the 3-act lecture format. Chiron's job is detecting which mode applies and routing accordingly.

---

## Resume / Revisit — primary user flow (2026-04-28 pivot)

**Chiron owns the SR + review experience. Anki is optional export only.**

When the user re-opens a Chiron lesson HTML:

1. **Lesson knows where they left off** — `bookmarks` table records last chapter + scroll position. Lesson auto-scrolls to it on load (or shows a "resume from chapter X?" prompt).
2. **A "Review" pseudo-section appears at the top** if there are due flashcards — pulls from `sr_cards WHERE next_due_at <= now`. User does the review session inline. Each card review writes to `sr_review_log` and updates the card's SM-2/FSRS state.
3. **Past chapters can be revisited** — re-attempt quizzes (variant rotation prevents pure memorization), inspect mastery scores per concept, see weakness log.
4. **Optional: export `.apkg`** — if user wants cards in mobile Anki, button generates Anki package. One-way export. Chiron remains the canonical state.

Why not just use Anki: the user wants the review *integrated* with the lesson surface (read passage → review related card → scroll on). Switching apps to Anki for review fragments the experience and loses context.

## What success feels like

- User runs `/chiron` with a source.
- Lesson HTML opens in browser within ~5 minutes.
- User reads, attempts quizzes, has a brief peer-learner exchange.
- SQLite at `<lesson-dir>/.chiron-state.db` records progress + due cards.
- Days later, user re-opens `index.html`. Lesson resumes at last position. Due cards appear at the top. Quick 5-min review, then continue with new chapter.
- Long-term retention happens via the integrated review loop.
- (Optional): user clicks "Export to Anki" if they want cards on mobile.
