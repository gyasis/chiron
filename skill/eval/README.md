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
