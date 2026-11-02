"""test_pimsleur_deconstruct — build-up sequences checked against the Pimsleur Italian build-up study.

Run: python3 -m pytest skill/scripts/test_pimsleur_deconstruct.py -q
"""
import pytest

from pimsleur_deconstruct import deconstruct, pause_after, stress, syllabify


def seq(target, level=3, known=(), teach=()):
    return [p.text for p in deconstruct(target, level=level, known=set(known), teach=set(teach))]


@pytest.mark.parametrize("word,syl", [
    ("scusi", ["scu", "si"]),
    ("capisce", ["ca", "pi", "sce"]),
    ("signorina", ["si", "gno", "ri", "na"]),
    ("italiano", ["i", "ta", "lia", "no"]),
    ("americano", ["a", "me", "ri", "ca", "no"]),
    ("arrivederci", ["ar", "ri", "ve", "der", "ci"]),
    ("piazza", ["piaz", "za"]),
    ("vorrebbe", ["vor", "reb", "be"]),
    ("ristorante", ["ris", "to", "ran", "te"]),
    ("comprare", ["com", "pra", "re"]),
    ("giorno", ["gior", "no"]),
    ("voglio", ["vo", "glio"]),
])
def test_syllabify(word, syl):
    assert syllabify(word) == syl


@pytest.mark.parametrize("word,idx", [
    ("capisce", 1), ("americano", 3), ("vorrei", 1), ("città", 1), ("sabato", 0), ("scusi", 0),
])
def test_stress(word, idx):
    assert stress(word) == idx


# Sequences as heard in the course (whole form first, then pieces, then whole form).
@pytest.mark.parametrize("target,level,known,expected", [
    ("capisce", 1, (), ["capisce", "sce", "pisce", "ca", "capisce"]),
    ("signore", 1, (), ["signore", "gnore", "si", "signore"]),
    ("americano", 1, (), ["americano", "cano", "ameri", "americano"]),
    ("capisco", 1, ("capisce",), ["capisco", "sco", "pisco", "capisco"]),
    ("signorina", 1, ("signore",), ["signorina", "rina", "gnorina", "signorina"]),
    ("scusi", 1, (), ["scusi", "si", "scu", "scusi"]),
    ("grazie", 2, (), ["grazie", "zie", "grazie"]),
    ("bene", 2, (), ["bene", "ne", "bene"]),
    ("giorno", 2, (), ["giorno", "no", "orno", "giorno"]),
    ("la piazza", 4, (), ["la piazza", "za", "azza", "piazza", "la piazza"]),
    ("qualcosa", 5, (), ["qualcosa", "cosa", "qual", "qualcosa"]),
    ("vorrebbe", 5, (), ["vorrebbe", "be", "rebbe", "vor", "vorrebbe"]),
    ("adesso", 6, (), ["adesso", "so", "adesso"]),
    ("pranzare", 8, (), ["pranzare", "zare", "pranzare"]),
    ("al ristorante", 7, (), ["al ristorante", "rante", "torante", "ristorante", "al ristorante"]),
    ("lei capisce", 1, ("capisce",), ["lei capisce", "lei", "lei capisce"]),
])
def test_course_sequences(target, level, known, expected):
    assert seq(target, level, known) == expected


def test_elided_article_comes_off_first_and_back_last():
    s = seq("l'italiano", 1)
    assert s[0] == "l'italiano" and s[-2:] == ["italiano", "l'italiano"]
    assert s[1] == "no"


def test_pieces_are_never_bare_consonants_or_infixes():
    for w in ["specializzazione", "arrivederci", "imparare", "pazienti", "ristorante", "americano"]:
        word = w
        for p in deconstruct(w, level=1):
            if p.kind != "piece":
                continue
            assert any(ch in "aeiouàèéìòù" for ch in p.text), p.text
            assert word.endswith(p.text) or word.startswith(p.text), (w, p.text)


def test_suffix_chain_grows_one_syllable_per_step():
    pieces = [p for p in deconstruct("signorina", 1, {"signore"}) if p.kind == "piece"]
    lens = [len(p.syllables) for p in pieces]
    assert lens == sorted(lens) and all(b - a == 1 for a, b in zip(lens, lens[1:]))


def test_sentence_builds_backward_and_ends_on_the_whole():
    s = seq("Vorrei imparare a parlare con i pazienti", 3)
    full = "vorrei imparare a parlare con i pazienti"
    assert s[0] == full and s[-1] == full
    assert s[1:4] == ["zienti", "pazienti", "con i pazienti"]
    assert s.index("a parlare con i pazienti") < s.index("imparare a parlare con i pazienti")
    # function words ride with their word, never alone
    assert "con" not in s and "i" not in s and "a" not in s


def test_known_words_are_not_rebuilt():
    s = seq("io capisco l'italiano", 1, ("io", "capisco", "italiano"))
    assert "sco" not in s and "no" not in s


def test_new_word_in_front_grows_forward():
    assert seq("ti piace viaggiare", 11, ("piace", "viaggiare"), ("ti",)) == ["ti piace viaggiare", "ti", "ti piace",
                                                                       "ti piace viaggiare"]


def test_enclitic_is_detached():
    s = seq("piacere di conoscerla", 30, ("piacere",))
    assert s[1:4] == ["conoscere", "la", "conoscerla"]


def test_repeat_counts_fade_with_level():
    early = {p.text: p.reps for p in deconstruct("capisce", 1)}
    late = {p.text: p.reps for p in deconstruct("capisce", 4)}
    assert early["sce"] == 2 and late["sce"] == 1


def test_monosyllable_is_modelled_whole():
    assert seq("sì", 1) == ["sì"]


def test_pause_law():
    assert pause_after(0.4) == pytest.approx(2.66)
    assert pause_after(1.0, level=9) == pytest.approx(3.2)


def test_words_only_never_splits_a_word():
    s = seq_w("Vorrei imparare a parlare con i pazienti")
    assert s == ["vorrei imparare a parlare con i pazienti", "pazienti", "con i pazienti", "parlare", "a parlare",
                 "a parlare con i pazienti", "imparare", "imparare a parlare con i pazienti", "vorrei",
                 "vorrei imparare a parlare con i pazienti"]


def seq_w(target, level=3):
    return [p.text for p in deconstruct(target, level=level, words_only=True)]
