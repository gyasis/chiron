#!/usr/bin/env python3
"""pimsleur_deconstruct — break an Italian word, phrase or sentence into a Pimsleur-style backward build-up.

Pure code, no model calls. Given a target ("Vorrei imparare a parlare con i pazienti") it returns the ordered
utterances a Pimsleur teacher would say, each with a repeat count:

    full sentence x1 -> last word built from its end, one syllable per step -> the leftover start of the word
    -> the word joined to what follows -> ... -> full sentence again

The rules follow the build-up study of the owner's Pimsleur Italian course (the private notes live in
~/.chiron/refs/pimsleur/BUILDUP.md; nothing from the course is stored here):

  * A word is built from its END: the first piece is the final syllable, or the stressed syllable plus the
    final one for words of 3+ syllables stressed on the penultimate (cano <- americano, cosa <- qualcosa).
    The final syllable alone is used when it carries a palatal or digraph onset (sce, ci, gn...) or when it
    follows a doubled consonant (so <- adesso, be <- vorrebbe).
  * Each step adds exactly one syllable. Once the stressed syllable is reached the leftover start of the word
    is said ON ITS OWN, as one chunk (ca <- capisce, ameri <- americano), then the whole word. When the start
    of the word is already known from another word the chain runs on to the whole word.
  * Pieces are always whole Italian syllables, never a bare consonant, never a middle piece.
  * Elided articles come off first and go back on last (italiano -> l'italiano).
  * Phrases grow one chunk at a time; function words ride with the word they belong to (con i pazienti), and
    known words are never said alone. A new word at the FRONT (or a new clitic) grows forward instead.
  * Pieces are said twice at level <= 3 and once above; from level 6 builds are short (one or two pieces);
    at level 9+ (Unit II style) new words are isolated whole, without syllable pieces.

`pause_after(seconds)` is the measured response-pause law: 2.0 s + 1.66 x the length of the model utterance.

CLI:  pimsleur_deconstruct.py "io capisco l'italiano" [--level 1] [--known io,capisco] [--json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import asdict, dataclass, field

STRONG = set("aeoàèéòó")
VOWELS = set("aeiouàèéìíòóùú")
ACCENTED = set("àèéìíòóùú")
LIQUID_ONSET = set("pbtdcgfv")
DIGRAPH_ONSETS = ("gn", "gl", "ch", "gh", "sc")

# Proparoxytones (stress on the third syllable from the end). Default stress is penultimate, so these must be
# listed; callers can pass more through `stress_overrides`.
PROPAROXYTONES = {
    "sabato", "lettere", "veneto", "telefono", "medico", "medici", "simpatico", "utile", "facile", "difficile",
    "rapido", "camera", "macchina", "musica", "pagina", "numero", "subito", "unico", "ultimo", "piccolo",
    "parlano", "vogliono", "abito", "abitano", "lavorano", "studiano", "prendono", "vengono",
    "sindaco", "ospite", "termine", "gomito", "stomaco", "fegato", "diagnosi", "prognosi",
    "analisi", "sintomo", "sintomi", "cardiologo", "ottimo", "pessimo", "tavola", "zucchero",
}

# Words that ride with the word after them and are not said alone unless they are what is being taught.
FUNCTION_WORDS = {
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in", "con", "su", "per", "tra",
    "fra", "del", "dello", "della", "dei", "degli", "delle", "al", "allo", "alla", "ai", "agli", "alle", "dal",
    "dallo", "dalla", "dai", "dagli", "dalle", "nel", "nello", "nella", "nei", "negli", "nelle", "sul", "sullo",
    "sulla", "sui", "sugli", "sulle", "e", "ed", "o", "che", "mi", "ti", "ci", "vi", "si", "ne", "non",
    "mio", "mia", "miei", "mie", "tuo", "tua", "tuoi", "tue", "suo", "sua", "suoi", "sue", "nostro", "nostra",
    "vostro", "vostra", "loro",
}
# Clitics/particles: when one of these is NEW and sits at the front, the build runs forward from it.
FORWARD_STARTERS = {"mi", "ti", "ci", "vi", "si", "ne", "e", "ed", "a", "da", "anche", "lei", "tu", "io"}

ENCLITICS = ("gli", "la", "lo", "li", "le", "mi", "ti", "vi", "si", "ne")   # not ci: arrivederci stays whole


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s).replace("’", "'").replace("`", "'")
    return s.lower().strip()


def _is_vowel(ch: str) -> bool:
    return ch in VOWELS


def _valid_onset(cl: str) -> bool:
    """True when a consonant cluster can open an Italian syllable."""
    if len(cl) <= 1:
        return True
    if cl in DIGRAPH_ONSETS:
        return True
    if len(cl) == 2 and cl[0] in LIQUID_ONSET and cl[1] in "lr":
        return True
    return False


def _nuclei(word: str) -> list[tuple[int, int]]:
    """Spans of vowel nuclei. Two strong vowels side by side are a hiatus and split (pa|e|se)."""
    spans: list[tuple[int, int]] = []
    i, n = 0, len(word)
    while i < n:
        if not _is_vowel(word[i]):
            i += 1
            continue
        j = i + 1
        while j < n and _is_vowel(word[j]):
            if word[j - 1] in STRONG and word[j] in STRONG:
                break
            j += 1
        spans.append((i, j))
        i = j
    return spans


def syllabify(word: str) -> list[str]:
    """Italian syllables of one word (no spaces; apostrophes are split off by the caller)."""
    w = _norm(word)
    if not w:
        return []
    spans = _nuclei(w)
    if len(spans) <= 1:
        return [w]
    cuts = []
    for (_a0, a1), (b0, _b1) in zip(spans, spans[1:]):
        cl = w[a1:b0]
        if len(cl) <= 1:
            cuts.append(a1)
        elif cl[0] == cl[1] or cl[:2] == "cq":  # geminate: split in the middle (piaz|za, vor|reb|be)
            cuts.append(a1 + 1)
        elif _valid_onset(cl):                    # the whole cluster opens the next syllable (pa|sta, si|gno)
            cuts.append(a1)
        else:                                     # move consonants to the coda until the rest is a valid onset
            k = 1
            while k < len(cl) and not _valid_onset(cl[k:]):
                k += 1
            cuts.append(a1 + k)
    out, prev = [], 0
    for c in cuts:
        out.append(w[prev:c])
        prev = c
    out.append(w[prev:])
    return [s for s in out if s]


def stress(word: str, overrides: dict[str, int] | None = None) -> int:
    """Index of the stressed syllable."""
    w = _norm(word)
    syl = syllabify(w)
    n = len(syl)
    if overrides and w in overrides:
        return overrides[w]
    if n <= 1:
        return 0
    if any(ch in ACCENTED for ch in syl[-1]):
        return n - 1
    nucleus = "".join(ch for ch in syl[-1] if _is_vowel(ch))
    if len(nucleus) == 2 and nucleus[0] in "aeo" and nucleus[1] == "i":  # vorrei, farai, poi: falling diphthong
        return n - 1
    if w in PROPAROXYTONES and n >= 3:
        return n - 3
    return n - 2


def _onset(syll: str) -> str:
    i = 0
    while i < len(syll) and not _is_vowel(syll[i]):
        i += 1
    return syll[:i]


def _rime_start(syll: str) -> int:
    """Index where the main vowel of a syllable starts, past a glide or a spelling i (piaz -> az, gior -> or)."""
    i = 0
    while i < len(syll) and not _is_vowel(syll[i]):
        i += 1
    if i < len(syll) - 1 and syll[i] in "iu" and _is_vowel(syll[i + 1]):
        i += 1
    return i


def _final_starts_alone(syl: list[str]) -> bool:
    """Start at the bare final syllable (so <- adesso) instead of stressed+final (cosa <- qualcosa)."""
    last, prev = syl[-1], syl[-2]
    on = _onset(last)
    if on and not _is_vowel(prev[-1]) and prev[-1] == on[0]:   # follows a doubled consonant
        return True
    if on in DIGRAPH_ONSETS:
        return True
    nuc = [ch for ch in prev if _is_vowel(ch)]
    if len(nuc) >= 2 and nuc[0] in "iu" and _is_vowel(prev[-1]):  # follows an open glide syllable: lia|no -> no
        return True
    if on in ("c", "g") and last[len(on):len(on) + 1] in ("e", "i"):   # soft c/g: ci, ce, gi, ge
        return True
    return False


def split_elision(token: str) -> tuple[str, str]:
    """"l'italiano" -> ("l'", "italiano"); a token with no apostrophe returns ("", token)."""
    t = _norm(token)
    m = re.match(r"^([a-zà-ù]+')(.+)$", t)
    if m:
        return m.group(1), m.group(2)
    return "", t


def split_enclitic(word: str) -> tuple[str, str]:
    """conoscerla -> ("conoscere", "la"). Only infinitive stems in -r of 7+ letters, so perla/sorella stay whole."""
    w = _norm(word)
    if len(w) < 7:
        return w, ""
    for c in ENCLITICS:
        if w.endswith(c) and w[: -len(c)].endswith("r") and len(w) - len(c) >= 5:
            return w[: -len(c)] + "e", c
    return w, ""


@dataclass
class Piece:
    text: str
    reps: int
    kind: str                      # "whole" (the full target), "piece" (sub-word), "word", "chunk" (word group)
    syllables: list[str] = field(default_factory=list)


@dataclass
class Settings:
    level: int = 3                 # 1-8 behave like Unit I lessons 1-8; 9+ behave like Unit II
    known: set[str] = field(default_factory=set)
    teach: set[str] = field(default_factory=set)   # function words that ARE the new item (ti, da) stand alone
    words_only: bool = False                       # build from whole words and phrases, never syllable pieces
    stress_overrides: dict[str, int] = field(default_factory=dict)

    @property
    def unit2(self) -> bool:
        return self.level >= 9

    @property
    def piece_reps(self) -> int:
        return 2 if self.level <= 3 else 1

    @property
    def final_reps(self) -> int:
        return 2 if self.level <= 5 else 1


def wants_sub_build(word: str, cfg: Settings) -> bool:
    """Should this new word be built from syllables? (newness + length, fading with level)"""
    if cfg.unit2 or cfg.words_only:
        return False
    n = len(syllabify(word))
    if n >= 4:
        return True
    if n == 3:
        return True
    if n == 2:
        return cfg.level <= 2 or bool(re.search(r"sc[ei]|gn|zz|rr|zi", _norm(word)))
    return False


def _prefix_known(syl: list[str], k: int, cfg: Settings) -> bool:
    """Is the start of this word (syllables before k) already known from another word?"""
    pre = "".join(syl[:k])
    whole = "".join(syl)
    return len(pre) >= 2 and any(kw != whole and kw.startswith(pre) for kw in cfg.known)


def word_pieces(word: str, cfg: Settings, article: str = "", prefix_follows: bool = False) -> list[Piece]:
    """Build-up of ONE word. Returns pieces ending in the whole word (and article+word if elided).

    `prefix_follows`: a new word in front of this one is taught next and plays the role of a one-syllable
    leftover start (per favore: vore, favore, per), so the chain runs on to the whole word instead.
    """
    w = _norm(word)
    syl = syllabify(w)
    n = len(syl)
    reps = cfg.piece_reps
    if n == 1 or not wants_sub_build(w, cfg):
        out = [Piece(w, 2 if cfg.level <= 3 else 1, "word", syl)]
        if article:
            out.append(Piece(article + w, cfg.final_reps, "word", syl))
        return out

    s = stress(w, cfg.stress_overrides)
    chain: list[Piece] = []
    if n == 2:
        chain.append(Piece(syl[1], reps, "piece", [syl[1]]))
        first = syl[0]
        if s == 1:                                      # final stress (vorrei): the opening syllable alone
            chain.append(Piece(first, reps, "piece", [first]))
        elif not _is_vowel(first[-1]):                  # closed first syllable: gior|no -> orno, piaz|za -> azza
            r = _rime_start(first)
            if 0 < r < len(first):
                chain.append(Piece(first[r:] + syl[1], reps, "piece", [first[r:], syl[1]]))
        elif cfg.level <= 1:                            # the very first lesson: the opening syllable alone (scu)
            chain.append(Piece(first, reps, "piece", [first]))
    else:
        k = n - 1
        if s == n - 2 and not _final_starts_alone(syl):
            k = n - 2                                   # stressed + final: cano, cosa, gnore, zare
        short = cfg.level >= 6
        max_pieces = (2 if n >= 4 else 1) if short else n
        while k >= 1 and len(chain) < max_pieces:
            chain.append(Piece("".join(syl[k:]), reps, "piece", syl[k:]))
            if k <= s and not short and not (prefix_follows and k == 1) and not _prefix_known(syl, k, cfg):
                chain.append(Piece("".join(syl[:k]), reps, "piece", syl[:k]))   # leftover start: ca, ameri, vor
                break
            k -= 1
    if cfg.level >= 6:
        chain = chain[:2]
    out = chain + [Piece(w, cfg.final_reps, "word", syl)]
    if article:
        out.append(Piece(article + w, cfg.final_reps, "word", syl))
    return out


def is_small(token: str) -> bool:
    """A word too small to say on its own: a function word, or any word of one or two letters (è, ho, io, te)."""
    t = token.replace("'", "")
    return token in FUNCTION_WORDS or len(t) <= 2


def chunk_words(text: str, teach: set[str] | None = None, words_only: bool = False) -> list[str]:
    """Split a phrase into chunks: each content word carries the small words in front of it.

    Course style: function words ride forward; a function word listed in `teach` gets a chunk of its own.
    `words_only` (Ask drills): every small word (is_small) rides with its neighbour and `teach` is ignored,
    so no chunk is ever a lone small word; trailing small words join the chunk before them.
    """
    teach = set() if words_only else (teach or set())
    toks = [t for t in re.split(r"[\s,;:.!?¿¡\"“”()]+", _norm(text)) if t]
    chunks: list[str] = []
    pending: list[str] = []
    for t in toks:
        small = is_small(t) if words_only else t in FUNCTION_WORDS
        if small and t not in teach:
            pending.append(t)
            continue
        chunks.append(" ".join(pending + [t]))
        pending = []
    if pending:
        if chunks:
            chunks[-1] = chunks[-1] + " " + " ".join(pending)
        else:
            chunks.append(" ".join(pending))
    return chunks


def _head(chunk: str) -> str:
    """The content word of a chunk (its last token)."""
    return chunk.split()[-1]


def _is_known(chunk: str, cfg: Settings) -> bool:
    if chunk in cfg.teach:
        return False
    if chunk in cfg.known:
        return True
    head = _head(chunk)
    return head in cfg.known or split_elision(head)[1] in cfg.known


def _chunk_pieces(chunk: str, cfg: Settings, prefix_follows: bool = False) -> list[Piece]:
    """Pieces of one chunk: build its content word (unless known), then add the function words in front."""
    toks = chunk.split()
    head, lead = toks[-1], " ".join(toks[:-1])
    art, body = split_elision(head)
    stem, clitic = split_enclitic(body)
    if _is_known(chunk, cfg):
        out = [Piece(head, 1, "word", syllabify(body))]
    elif clitic and not art:                              # conoscerla: conoscere, la, conoscerla
        out = [Piece(stem, 1, "word", syllabify(stem)), Piece(clitic, 1, "word", [clitic]),
               Piece(body, cfg.final_reps, "word", syllabify(body))]
    else:
        out = word_pieces(body, cfg, article=art, prefix_follows=prefix_follows)
    if lead:
        out.append(Piece(chunk, 1, "chunk"))
    return out


def deconstruct(target: str, level: int = 3, known: set[str] | None = None, teach: set[str] | None = None,
                stress_overrides: dict[str, int] | None = None, words_only: bool = False) -> list[Piece]:
    """Ordered build-up for a word, phrase or sentence.

    `known` = words/chunks the learner already has; `teach` = function words that are the new item;
    `words_only` = whole words and phrases only (the Ask phrase drill), no syllable pieces.
    """
    cfg = Settings(level=level, known={_norm(k) for k in (known or set())},
                   teach={_norm(k) for k in (teach or set())}, words_only=words_only,
                   stress_overrides={_norm(k): v for k, v in (stress_overrides or {}).items()})
    full = " ".join(re.sub(r"[,;:.!?¿¡\"“”()]", " ", _norm(target)).split())
    chunks = chunk_words(full, cfg.teach, cfg.words_only)
    if not chunks:
        return []

    if len(chunks) == 1:
        pieces = _chunk_pieces(chunks[0], cfg)
        if len(pieces) > 1:
            pieces = [Piece(full, 1, "whole")] + pieces
        return _finish(pieces, full, cfg)

    new = [i for i, c in enumerate(chunks) if not _is_known(c, cfg)]
    out: list[Piece] = [Piece(full, 1, "whole")]
    first_new = new[0] if new else None

    forward = first_new is not None and first_new < len(chunks) - 1 and (
        len(new) == 1 or (first_new == 0 and _head(chunks[0]) in FORWARD_STARTERS)
    )
    if forward:
        # Forward: one new element at the front or in the middle (or a new clitic in front) -> teach it,
        # then grow to the right.
        out += _chunk_pieces(chunks[first_new], cfg)
        for j in range(first_new + 1, len(chunks)):
            if not _is_known(chunks[j], cfg):
                out += _chunk_pieces(chunks[j], cfg)
            out.append(Piece(" ".join(chunks[first_new:j + 1]), 1, "chunk"))
        return _finish(out, full, cfg)

    # Backward: build the last chunk, then attach earlier chunks one at a time; a new chunk is said alone first.
    out += _chunk_pieces(chunks[-1], cfg, prefix_follows=len(chunks) >= 2 and not _is_known(chunks[-2], cfg))
    for i in range(len(chunks) - 2, -1, -1):
        if not _is_known(chunks[i], cfg):
            out += _chunk_pieces(chunks[i], cfg, prefix_follows=i >= 1 and not _is_known(chunks[i - 1], cfg))
        out.append(Piece(" ".join(chunks[i:]), 1, "chunk"))
    return _finish(out, full, cfg)


def _finish(pieces: list[Piece], full: str, cfg: Settings) -> list[Piece]:
    """Merge immediate repeats and end the block on the full target with the closing repeat count.
    In words_only mode a lone small word is never kept as a step."""
    out: list[Piece] = []
    for p in pieces:
        if cfg.words_only and p.text != full and all(is_small(t) for t in p.text.split()):
            continue
        if out and out[-1].text == p.text:
            out[-1].reps = max(out[-1].reps, p.reps)
            continue
        out.append(p)
    if out and out[-1].text == full:
        out[-1].kind = "whole"
        out[-1].reps = max(out[-1].reps, cfg.final_reps)
    else:
        out.append(Piece(full, cfg.final_reps, "whole"))
    if len(out) == 2 and out[0].text == full:           # nothing to build: model the target whole
        out = [Piece(full, 2 if cfg.level <= 3 else 1, "whole")]
    return out


def pause_after(seconds: float, level: int = 3) -> float:
    """Response pause after a model utterance of `seconds` length (echo and recall follow the same law)."""
    if level >= 9:
        return round(1.85 + 1.35 * seconds, 2)
    return round(2.0 + 1.66 * seconds, 2)


def estimate_seconds(text: str) -> float:
    """Rough spoken length for previews only; real schedules use the baked clip's duration."""
    n = sum(len(syllabify(w)) for w in re.split(r"[\s']+", _norm(text)) if w)
    return round(0.12 + 0.17 * max(n, 1), 2)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("target")
    ap.add_argument("--level", type=int, default=3, help="1-8 = Unit I lesson style, 9+ = Unit II style")
    ap.add_argument("--known", default="", help="comma-separated words/chunks already learned")
    ap.add_argument("--teach", default="", help="comma-separated function words that are the new item (ti, da)")
    ap.add_argument("--words", action="store_true", help="whole words and phrases only, no syllable pieces")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    known = {k.strip() for k in a.known.split(",") if k.strip()}
    teach = {k.strip() for k in a.teach.split(",") if k.strip()}
    pieces = deconstruct(a.target, level=a.level, known=known, teach=teach, words_only=a.words)
    if a.json:
        print(json.dumps([asdict(p) | {"pause_s": pause_after(estimate_seconds(p.text), a.level)}
                          for p in pieces], ensure_ascii=False, indent=2))
        return 0
    total = 0.0
    for p in pieces:
        d = estimate_seconds(p.text)
        total += p.reps * (d + pause_after(d, a.level))
        syl = "·".join(p.syllables) if p.kind in ("piece", "word") else ""
        print(f"{p.kind:6} x{p.reps}  {p.text:<40} {syl}")
    print(f"~{total:.0f} s of drill (estimated)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
