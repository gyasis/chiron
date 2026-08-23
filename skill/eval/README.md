# Retrieval eval sets

Hand-written questions with the passage that genuinely answers each one. Run:

    node skill/scripts/eval-retrieval.mjs --gold skill/eval/eval-gold.medical-italian.json

## Why the questions are written this way

Each carries a `kind`, because the AVERAGE hides the decision:

| kind    | what it tests                | why it exists |
|---------|------------------------------|---------------|
| `cross` | English question, Italian passage | the case keyword search cannot do |
| `para`  | Italian, deliberately reworded    | control — lexical but not copied |
| `syn`   | needs a synonym to match          | the case embeddings should win |

Questions are **paraphrased on purpose**. Reusing a passage's own wording makes
BM25 win by construction and produces an eval that flatters whatever is already
shipping.

## Baseline — BM25, 2026-08-19, 30 questions, medical-italian (229 passages)

    overall   hit@6 50.0%   MRR 0.309   recall 53.3%
      cross   hit@6 25.0%   (12 questions)  <- the weakness
      para    hit@6 64.3%   (14)
      syn     hit@6 75.0%   ( 4, too few to conclude)

The split is the point: BM25 answers a reworded Italian question well and an
English-to-Italian question badly. It always returns SOMETHING — it is right a
quarter of the time. That is the gap dense retrieval has to close, and 25% is
the number to beat.

An earlier heading-as-query proxy put BM25 at 17.5%, which badly understated it.
Proxies are for smoke-testing plumbing, not for deciding anything.


## medicine — 29 questions, 20,169 passages (95% of the corpus)

The set that answers "does it actually understand?". Most questions describe a
concept WITHOUT ever using its name — the way you ask when the term will not
come to you.

    overall  hit@6 20.7%   MRR 0.126
      sem    hit@6 13.0%   (23)  concept described, term never used
      term   hit@6 75.0%   ( 4)  the real term IS used -- control
      cross  hit@6  0.0%   ( 2)  EN question -> Italian SSM lesson

**Keyword search does not understand; it matches vocabulary.** Same index, same
k, same day — the only variable is whether the question contains the passage's
words. Knowing the term: 3 hits in 4. Only able to describe the idea: 1 in 8.

Examples of the `sem` phrasing, and what they target:

    "A newborn is throwing up green -- how quickly does this need surgery?"
        -> bilious vomiting / Ladd's procedure   (never says bilious, malrotation, Ladd)
    "What chemical change to a protein makes the immune system attack joints?"
        -> citrullination / PAD / neoantigens    (never says citrullination)
    "A child sitting forward, drooling, breathing noisily"
        -> stridor + tripod position -> airway   (never says stridor or tripod)

`term` and `cross` are too small (n=4, n=2) to quote precisely; the 13% rests on
23 questions and is the number to stand behind.

### Corpus hygiene finding
Writing this set surfaced NEAR-DUPLICATE lessons — e.g.
`inflammatory-arthropathies-systematic` and
`rheumatology-inflammatory-arthropathies-systematic` both cover citrullination.
Near-identical passages compete in retrieval and split the ranking between them.
Worth an audit independent of any retrieval change.


## cross — 24 questions, English question -> Italian SSM lesson

The cross-lingual set. English clinical terms against Italian-titled SSM
lessons, with every `medicine-*` section of the right lesson accepted: the
clinical explanation is split across them, so pinning one is arbitrary.

    bm25   hit@6 45.8%   MRR 0.251
    dense  hit@6 87.5%   MRR 0.611     <- bge-m3
    hybrid hit@6 87.5%   MRR 0.433

Dense finds the right lesson 7 times in 8, and ranks it far higher (MRR 0.611 vs
0.251). Hybrid ties on hit@6 but loses half the MRR, because RRF drags a
correct top-1 down to blend with a worse ranking.

### The "cross-lingual is 0%" result was a LABELLING BUG, not a retrieval one

For a long time this row read 0% on n=2, and it was reported that way. Both gold
targets were wrong:

  * `ssm2022-054#overview-1` — Lucrezia's greeting ("Buongiorno, Gyasi — guarda
    chi e tornato"), not medulloblastoma content.
  * `ssm2019-044#breakdown-1` — ENGLISH meta-text about the grammar widget
    ("The stem, dissected. Toggle the layers"). Nothing about lung volumes.

No retriever passes those. Both are corrected to the `medicine-*` sections.

**The lesson: n=2 is not a measurement.** It was flagged as untested every time
it was quoted, and it should not have been quoted at all until the labels were
inspected. A tiny slice with a bad key looks exactly like a real failure — and
it survived several reports before anyone looked at what it was actually asking.

SSM lesson anatomy, for anyone writing gold against them:

    overview-*    the exam stem + Lucrezia framing
    breakdown-*   word-by-word Italian grammar (mostly NOT clinical content)
    medicine-*    the clinical explanation   <- target these
    question      the answer options
    closing       sign-off

---

## 2026-08-23 — coverage extended to all four domains (83 → 129 questions)

`language-it` (748 passages) and `video-it` (166) had **no eval at all**. That was the
real gap, not the question count: `language-it` is the domain where the production
failure happened — Ask claimed the irregular-verb lessons did not exist — and nothing
in the harness would have caught it.

| domain | n | bm25 hit@6 | dense hit@6 | hybrid hit@6 |
|---|---|---|---|---|
| medicine | 29 | 20.7% | 41.4% | 31.0% |
| medical-italian | 30 | see above | — | — |
| cross-lingual | 24 | — | 87.5% | — |
| **language-it** | **30** | **56.7%** | **93.3%** | 80.0% |
| **video-it** | **16** | **56.3%** | 68.8% | **75.0%** |

Two things worth reading carefully:

- **language-it independently corroborates that hybrid drags a strong channel down.**
  Dense 93.3% → hybrid 80.0%. That was first measured on medicine and could have been a
  quirk of one domain; it is not. RRF rewards agreement, so fusing a strong channel with
  a weak one costs points. The page is dense-only-with-BM25-fallback for this reason.
- **video-it is the one domain where hybrid WINS** (75.0% vs dense 68.8%). At n=16 a
  single question is 6.25 points, so this is a lead to test, **not** a finding to act on.
  Plausible mechanism: scene passages are short and idiom-dense, which is the regime
  where lexical matching contributes something dense misses. Needs ~40 questions before
  anyone changes routing over it.

### Two harness traps fixed while running this

1. **The default embed URL pointed at ollama `:11434`.** ollama cannot serve bge-m3 on
   this GPU (NaN → silent CPU fallback), which is why `:8913` exists. Left as it was,
   the harness failed all 30 queries and printed `dense 0%` — which reads as a verdict
   on the model rather than a wiring mistake. Default is now `:8913`.
2. **`--vmodel` silently picked a different sidecar.** Both `bge-m3` and
   `multilingual-e5-small` sidecars exist; without `--vmodel` the harness loaded the
   384-dim e5 vectors while the service served 1024-dim bge-m3. Pass
   `--vmodel BAAI/bge-m3` (or whatever the pointer manifest names) explicitly.

### Gold quality

All 46 new labels were machine-checked (ids resolve, no duplicates, no placeholders) and
a sample was read against the passage text. **One was wrong** and was corrected: the
spegnere-conjugation question pointed at a past-participle passage
(`…parte-2-altri-20#chapter-3-2`) instead of the `-g-` rule at `#chapter-7-2`. This is
the same failure that once produced a fake cross-lingual 0% — a bad label is
indistinguishable from a retrieval miss, so labels get verified, not trusted.
