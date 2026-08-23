#!/usr/bin/env python3
"""Embed the Anki cards so Chiron can match them by MEANING.

Anki's own search is literal. Asking it for `paziente` against the Italian decks
returns "Lei non è paziente come lei" — "she is not *patient*", the adjective —
and nothing clinical. A lesson about chest pain has to find "il male al petto"
without the words overlapping at all, which is precisely what an embedder is for.

EMBEDDER PARITY. Cards go through the SAME service the lesson corpus uses
(:8913, BAAI/bge-m3, 1024d). A different embedder would put cards and questions
in incomparable spaces and return confident nonsense, so the model name is
written into the index and checked at query time rather than assumed.

    build-anki-index.py                 rebuild from the configured decks
    build-anki-index.py --check         report what is indexed, embed nothing
    build-anki-index.py --decks "A,B"   index specific decks instead

    CHIRON_ANKI_URL     the MacBook's AnkiConnect (see ~/.chiron/anki.env)
    CHIRON_EMBED_URL    default http://127.0.0.1:8913
"""
import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import anki  # noqa: E402

OUT_DIR = os.path.expanduser("~/Documents/generated/chiron-library")
INDEX = os.path.join(OUT_DIR, "anki.index.json")
VECS = os.path.join(OUT_DIR, "anki.index.vec.bin")

EMBED_URL = os.environ.get("CHIRON_EMBED_URL", "http://127.0.0.1:8913").rstrip("/")
BATCH = int(os.environ.get("CHIRON_EMBED_BATCH", 32))

# The Italian decks. The 12,000-sentence decks are deliberately NOT here: they
# are a general-frequency corpus, and mixing them in would let "Tom è a letto
# con la febbre" outrank real ward language on a clinical question. Add them
# later behind their own scope if general practice is wanted.
DEFAULT_DECKS = [
    "Medical Italian",
    "il centro di italia",
    "Italiano",
    "Italian listening exercises with ITA / ENG text",
]


def embed(texts):
    body = json.dumps({"model": "BAAI/bge-m3", "input": texts, "input_type": "passage"}).encode()
    req = urllib.request.Request(f"{EMBED_URL}/api/embed", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.loads(r.read())
    return d["embeddings"], d.get("model", "?")


def quantise(vec):
    """L2-normalise then int8. Cosine becomes a dot product and the file is one
    byte per dimension — the same format the lesson corpus sidecar uses."""
    n = sum(v * v for v in vec) ** 0.5 or 1.0
    return bytes((max(-127, min(127, round(v / n * 127))) & 0xFF) for v in vec)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--decks", default=None)
    args = ap.parse_args()

    if args.check:
        if not os.path.exists(INDEX):
            print("no index yet")
            return 1
        m = json.load(open(INDEX))
        print(f"model:  {m['model']}  dim {m['dim']}")
        print(f"cards:  {len(m['cards']):,}  built {m['built']}")
        by = {}
        for c in m["cards"]:
            by[c["deck"].split("::")[0]] = by.get(c["deck"].split("::")[0], 0) + 1
        for k, v in sorted(by.items(), key=lambda kv: -kv[1]):
            print(f"   {v:6,}  {k}")
        return 0

    if not anki.reachable():
        print(f"Anki is not reachable at {anki.URL} — open Anki on the MacBook.", file=sys.stderr)
        return 2

    decks = [d.strip() for d in args.decks.split(",")] if args.decks else DEFAULT_DECKS
    cards = []
    for d in decks:
        got = anki.cards(f'deck:"{d}"')
        print(f"  {len(got):6,}  {d}")
        cards.extend(got)
    if not cards:
        print("no cards found", file=sys.stderr)
        return 1

    # Both sides go into the embedding. A question asked in English has to reach
    # an Italian card, and the English half is the only bridge to it.
    texts = [f"{c['front']} — {c['back']}" for c in cards]

    print(f"\nembedding {len(texts):,} cards via {EMBED_URL} …")
    t0 = time.time()
    blob = bytearray()
    dim = model = None
    for i in range(0, len(texts), BATCH):
        vs, model = embed(texts[i:i + BATCH])
        for v in vs:
            dim = dim or len(v)
            blob += quantise(v)
        done = min(i + BATCH, len(texts))
        rate = done / max(time.time() - t0, 1e-6)
        print(f"\r  {done}/{len(texts)}  {rate:.1f}/s  eta {(len(texts)-done)/max(rate,1e-6)/60:.1f}m   ",
              end="", flush=True)
    print()

    os.makedirs(OUT_DIR, exist_ok=True)
    open(VECS, "wb").write(bytes(blob))
    json.dump({
        "model": model, "dim": dim, "quantisation": "int8-l2norm",
        "built": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "decks": decks,
        "cards": [{k: c[k] for k in
                   ("cardId", "deck", "direction", "front", "back", "audio", "side")}
                  for c in cards],
    }, open(INDEX, "w"), ensure_ascii=False)

    mb = len(blob) / 1048576
    print(f"\n  {len(cards):,} cards · {model} · {dim}d · {mb:.1f} MB")
    print(f"  → {INDEX}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
