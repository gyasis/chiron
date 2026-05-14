# Stage 4q — Match Madness (multi-set retrieval anchor)

You are Chiron's Stage 4 Match Madness author. Produce a **multi-set timed
retrieval-practice section** for the current lesson. This section is the
canonical return-to anchor: the learner replays it across sessions to
refresh ALL prior content.

PRD: `canonical_shell_and_match_madness_2026-05-12` §4.10–4.12 (2026-05-14).

## Nested structure (LOCKED)

- **Round** = one 105 s timed 2×5 grid of paired tiles
- **Set** = 3–5 rounds testing ONE content type (one `mode`)
- **Super-Set** (final) = up to 10 rounds drawing from ALL prior sets

## Input slots

- `{{lessonId}}` — kebab-case lesson identifier (e.g. `italian-kitchen-verbs-2026-06-01`)
- `{{domain}}` — `"code" | "medicine" | "language-it" | "language-de" | "research-paper"`
- `{{chapterTitles}}` — array of chapter titles to draw content from
- `{{keyVocab}}` — per-chapter vocab list (`{ chapterId: string[] }`) of headwords / terms
- `{{keyConcepts}}` — per-chapter concept-ids
- `{{topicSummary}}` — 1-paragraph summary of the lesson topic

## Output schema (Zod-validated — see `widget-spec.ts.MatchMadnessWidgetSchema`)

```json
{
  "type": "match-madness",
  "lessonId": "{{lessonId}}",
  "domain": "{{domain}}",
  "title": "Match Madness",
  "description": "One-sentence learner-facing intro.",
  "defaults": {
    "timerSec": 105,
    "wrongLockMs": 1500,
    "accessibilityModeAllowed": true,
    "keyboardShortcuts": true,
    "visualSpeedUp": {}
  },
  "sets": [
    {
      "id": "set-1-<slug>",
      "index": 1,
      "title": "...",
      "subtitle": "...",
      "mode": "<one of MmMode>",
      "rounds": 3,
      "pairs": [ { "id": "...", "left": "...", "right": "...", "hint": "..." }, ... ]
    },
    ...
    {
      "id": "set-super",
      "index": N,
      "title": "🔥 SUPER-SET",
      "subtitle": "Up to 10 rounds, all content mixed.",
      "mode": "mixed",
      "rounds": 10,
      "pairs": [ /* flat merge of all prior set pairs */ ],
      "drawsFromSetIds": [ "set-1-...", "set-2-...", ... ]
    }
  ],
  "unlockAccuracyThreshold": 0.6,
  "superSetUnlockAfterNSetsCompleted": 3
}
```

## Mode selection by domain (BLOCKING)

| Mode | Purpose | Domains |
|---|---|---|
| `vocab-pair` | word ↔ translation, term ↔ synonym | universal |
| `term-def` | term ↔ definition | code, medicine |
| `formula-result` | formula/expression ↔ result | code (math/algorithms) |
| `gender-pair` | article ↔ noun (la/lo/il/l') | language-it only |
| `prep-pair` | preposition phrase ↔ context gloss | language only |
| `collocation` | verb ↔ object | language only |
| `conjugation` | inflected form ↔ EN gloss with subject | language only |
| `mixed` | super-set, draws from prior sets | universal |

## Pair count rules

- Each set MUST have **≥ 5 pairs** (Zod minimum).
- Verb-conjugation sets typically have **as many pairs as the verb pool**
  (one form per verb in the io subject) — e.g. 14 verbs → 14 pairs.
- Vocab/term sets aim for **10–22 pairs** to give the timer room.
- The super-set MUST flat-concat pairs from ALL prior sets and list their
  ids in `drawsFromSetIds[]`.

## Per-domain set composition recipes

### `language-it` (canonical, today's lesson)

Eleven sets + super-set:

1. Verbs ↔ EN  (`vocab-pair`, 3 rounds)
2. Nouns ↔ EN  (`vocab-pair`, 5 rounds)
3. Noun gender la/lo/il/l'  (`gender-pair`, 5 rounds)
4. Prepositions in context  (`prep-pair`, 5 rounds)
5. Collocations verbo+oggetto  (`collocation`, 5 rounds)
6. Presente — io  (`conjugation`, 5 rounds)
7. Passato prossimo — io  (`conjugation`, 5 rounds)
8. Imperfetto — io  (`conjugation`, 5 rounds)
9. Futuro semplice — io  (`conjugation`, 5 rounds)
10. Congiuntivo presente — che io  (`conjugation`, 5 rounds)
11. Passato remoto — io  (`conjugation`, 5 rounds)
12. 🔥 SUPER-SET  (`mixed`, 10 rounds, all 280 pairs)

**Authoring shortcut:** for sets 6–11, the parent agent SHOULD NOT hand-author
inflected forms. Instead, emit just the verb pool (infinitive + family +
englishGloss + optional irregular overrides) and let the renderer's
`buildConjugationSet(...)` in `widgets/match-madness.ts` cross-product the
verbs × tense × subject. This guarantees the conjugator's spelling guard
(-care/-gare orthography) and irregular-participle handling are honored
uniformly.

### `language-de` (post-v1, deferred per SKILL.md)

Refuse if domain is `language-de`. Direct user to chiron v1.1 roadmap.

### `medicine`

Typical composition:

1. Drug ↔ class  (`vocab-pair`)
2. Term ↔ definition  (`term-def`)
3. Symptom ↔ disease  (`vocab-pair`)
4. Drug ↔ mechanism  (`term-def`)
5. 🔥 SUPER-SET  (`mixed`)

### `code`

Typical composition:

1. Concept ↔ definition  (`term-def`)
2. Function ↔ signature  (`vocab-pair`)
3. Formula ↔ result  (`formula-result`)
4. Pattern ↔ name  (`vocab-pair`)
5. 🔥 SUPER-SET  (`mixed`)

## Pair shape constraints

- `id` MUST be stable and globally unique within the section
  (e.g. `verb:spazzare`, `term:fibonacci`, `presente:io:spazzare`)
- `left` is what appears on the **left column** of the grid; `right` on
  the **right column**. For vocab-pair language sets we conventionally put
  English on left and target language on right.
- `hint` is optional. For `gender-pair` mode use `hint` to carry the gloss
  so the learner sees `scopa | la (broom)` style on flip.

## Self-check before emitting

- [ ] Every set has ≥ 5 pairs.
- [ ] Pair ids are unique within the section.
- [ ] `drawsFromSetIds` on super-set lists every other set id, in order.
- [ ] `lessonId` matches the lesson directory name.
- [ ] `domain` matches the lesson's domain.
- [ ] If `domain` is `code`/`medicine`, no language-only modes appear
  (`gender-pair`, `prep-pair`, `collocation`, `conjugation`).
- [ ] If `domain` is `language-it`, at least one `conjugation` set exists
  (presente at minimum).

## Refusal cases

- `domain === "language-de"` — refuse with v1.1 deferral message
- `keyVocab` totals fewer than 10 items across all chapters — emit only
  sets 1 + super, skip conjugation/gender (insufficient material)
