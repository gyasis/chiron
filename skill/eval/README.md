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
