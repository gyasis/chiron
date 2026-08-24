#!/usr/bin/env python3
"""il centro di italia — Day 6 narration. WRITTEN, NOT YET BAKED.

The fleet (whisper/pyannote/omnivoice/Modal) was unreachable when Day 6 was built, so this
file is the deliverable: complete, on-spec, and ready for `bake_day.py 6` the moment the
sidecars answer again.

R-IC5: teach the language, never narrate the teaching. Nobody is named in the audio.
R-IC9: opens on Day 4 — Day 5 was missed, so the thread picks up from there.
Bilingual rule: every Italian phrase is its own it-segment, glossed by the NEXT en-segment.
Targets: summary ~160w · shortened 300–650w · each section ~150w.
"""

GAP_MS = {"word": 60, "clause": 400, "sentence": 900, "paragraph": 1800}
en = lambda t, g="sentence": {"lang": "en", "text": t, "gapAfter": g}
it = lambda t, g="clause": {"lang": "it", "text": t, "gapAfter": g}

SUMMARY = [
    en("Picking the thread back up.", "clause"),
    it("mi sveglio", "clause"),
    en("I wake up — stem plus ending, the regular machine.", "clause"),
    it("esco", "clause"),
    en("I go out — irregular, and no way to build it.", "paragraph"),

    en("Today the language finally moves into the past, and it does it with two tenses "
       "that do different jobs.", "sentence"),
    it("Quando era più giovane.", "clause"),
    en("When he was younger. That is the imperfetto — a state that lasted.", "sentence"),
    it("Aveva sessant'anni.", "clause"),
    en("He was sixty — and notice age uses avere, you HAVE years.", "sentence"),
    it("Ero sorpreso.", "clause"),
    en("I was surprised.", "sentence"),
    en("Against that, one finished event:", "word"),
    it("Ho sentito.", "clause"),
    en("I heard. The difference is not how long ago — it is how things WERE against what "
       "HAPPENED.", "sentence"),
    en("And the pair that has been in every lesson without ever being explained:", "clause"),
    it("C'è una comunità.", "clause"),
    en("There is a community — existence.", "word"),
    it("Il posto è tranquillo.", "clause"),
    en("The place is quiet — description. English uses to be for both; Italian does not.",
       "sentence"),
    en("And one small machine worth having:", "word"),
    it("velocemente", "clause"),
    en("quickly. Any adjective plus -mente becomes an adverb, and adverbs never agree.",
       "paragraph"),
]

SHORTENED = [
    en("Everything so far has been the present. Today the past arrives, in two pieces.",
       "paragraph"),

    en("The first is the imperfetto, and it describes how things were.", "sentence"),
    it("Quando era più giovane.", "clause"),
    en("When he was younger.", "word"),
    it("Quando aveva cinquantacinque, sessant'anni.", "clause"),
    en("When he was fifty-five, sixty. Age takes avere in Italian — you have your years — "
       "so in the past it is aveva.", "sentence"),
    it("Ero sorpreso.", "clause"),
    en("I was surprised. A state of mind, so the imperfetto.", "sentence"),
    en("Now the other one.", "clause"),
    it("Ho sentito.", "clause"),
    en("I heard, or I have heard. That is the passato prossimo, and it reports a single "
       "finished event.", "sentence"),
    en("The choice is not about distance in time. It is whether you are describing how things "
       "stood, or reporting that something happened.", "paragraph"),

    en("Second, a small machine that turns adjectives into adverbs.", "sentence"),
    it("le reazioni veloci", "clause"),
    en("quick reactions — veloci is the adjective, and it agrees with reazioni.", "sentence"),
    it("reagire velocemente", "clause"),
    en("to react quickly — velocemente is the adverb, and it never changes at all.", "sentence"),
    en("Add -mente to the feminine form and you have it. When the adjective ends in -le, "
       "drop the e first.", "clause"),
    it("stabilmente", "clause"),
    en("permanently, from stabile.", "paragraph"),

    en("Third, a place.", "clause"),
    it("Santhià, in Piemonte.", "clause"),
    en("Santhià, in Piedmont — and the stress falls on that final a.", "sentence"),
    it("un posto tranquillo vicino alla collina", "clause"),
    en("a quiet place near the hill. Vicino takes a, and a plus la gives alla.", "sentence"),
    it("ottomila abitanti", "clause"),
    en("eight thousand inhabitants — ottomila, one word.", "sentence"),
    it("I vicini hanno un giardino.", "clause"),
    en("The neighbours have a garden. Same word as near — i vicini are the ones nearby.",
       "paragraph"),

    en("And the conversation itself: medicine, profit and what grows.", "sentence"),
    it("le erbe naturali", "clause"),
    en("natural herbs.", "word"),
    it("la coltivazione della cannabis", "clause"),
    en("cannabis cultivation.", "sentence"),
    it("i pesticidi, gli erbicidi", "clause"),
    en("pesticides, herbicides — and note the article changes: i pesticidi, but gli erbicidi, "
       "because the word starts with a vowel.", "sentence"),
    it("il glifosato", "clause"),
    en("glyphosate.", "word"),
    it("tossico", "clause"),
    en("toxic.", "sentence"),
    it("Lei scopre che molta gente...", "clause"),
    en("She discovers that a lot of people — and gente is still singular, as it has been "
       "since the first lesson.", "sentence"),
    it("Chissà!", "clause"),
    en("Who knows. Chi sa, fused into one word.", "paragraph"),
]

SECTIONS = {
    "sec-imperfetto": [
        en("Two past tenses, doing two different jobs.", "sentence"),
        en("The imperfetto describes a state — how things were, with no beginning or end "
           "in view.", "clause"),
        it("Quando era più giovane.", "clause"),
        en("When he was younger.", "word"),
        it("Quando aveva sessant'anni.", "clause"),
        en("When he was sixty. Age takes avere, so the past of that is aveva.", "sentence"),
        it("Ero sorpreso.", "clause"),
        en("I was surprised.", "sentence"),
        en("The passato prossimo reports one finished event.", "clause"),
        it("Ho sentito.", "clause"),
        en("I heard.", "sentence"),
        en("Put them together and the shape appears: the imperfetto is the background, "
           "the passato prossimo is the thing that happened against it.", "sentence"),
        it("vivono stabilmente", "clause"),
        en("they live there permanently — present, because it is still true. "
           "Change it to vivevano and you have said it is over.", "sentence"),
        it("dopo la laurea", "clause"),
        en("after graduating — la laurea is a university degree.", "paragraph"),
    ],
    "sec-santhia": [
        en("A small town, and the prepositions that come with describing one.", "sentence"),
        it("Santhià", "clause"),
        en("Santhià — the stress is on the final a, and the accent tells you so.", "sentence"),
        it("il Piemonte", "clause"),
        en("Piedmont, literally the foot of the mountain. Italian regions take the article.",
           "sentence"),
        it("vicino alla collina", "clause"),
        en("near the hill. Vicino needs a, and a plus la gives alla.", "sentence"),
        it("novanta chilometri", "clause"),
        en("ninety kilometres.", "word"),
        it("ottomila abitanti", "clause"),
        en("eight thousand inhabitants — ottomila is one word, and mila is the plural of mille.",
           "sentence"),
        it("un posto tranquillo", "clause"),
        en("a quiet place.", "word"),
        it("il marmo", "clause"),
        en("marble.", "sentence"),
        it("I vicini hanno un giardino.", "clause"),
        en("The neighbours have a garden.", "word"),
        it("l'autunno", "clause"),
        en("autumn.", "paragraph"),
    ],
    "sec-vita": [
        en("A long life, described.", "sentence"),
        it("novantatré anni", "clause"),
        en("ninety-three years old — and again, he HAS ninety-three years.", "sentence"),
        it("resiliente", "clause"),
        en("resilient. One form for both genders.", "sentence"),
        it("il viaggio di nozze", "clause"),
        en("the honeymoon. Le nozze, the wedding, is always plural.", "sentence"),
        it("divertente", "clause"),
        en("fun, entertaining — from divertire.", "word"),
        it("occupato", "clause"),
        en("busy.", "sentence"),
        it("C'è una comunità di italiani in Florida.", "clause"),
        en("There's an Italian community in Florida. C'è for one thing, and comunità never "
           "changes.", "sentence"),
        it("le giovani americane", "clause"),
        en("young American women.", "paragraph"),
    ],
    "sec-cesono": [
        # Rebuilt from the tape (7:24-8:15). She taught this through WEATHER and stated an
        # explicit rule; the earlier version of this section was inferred from the chat log
        # and taught the right grammar with none of her actual examples. R-IC5: her rule is
        # voiced, she is never named.
        {"lang": "en", "text": "This pair came up as a rule, and the rule is about the weather.", "gapAfter": "sentence"},
        {"lang": "it", "text": "Situazione meteorologica: c'è.", "gapAfter": "clause"},
        {"lang": "en", "text": "Weather situation — c'è. And then the promise: always c'è, and you won't make a mistake.", "gapAfter": "sentence"},
        {"lang": "it", "text": "C'è il vento.", "gapAfter": "word"},
        {"lang": "it", "text": "C'è la brezza.", "gapAfter": "word"},
        {"lang": "it", "text": "C'è la pioggia.", "gapAfter": "sentence"},
        {"lang": "en", "text": "There's wind, there's a breeze, there's rain. It doesn't matter which kind of weather — the frame never changes.", "gapAfter": "sentence"},
        {"lang": "en", "text": "Numbers behave differently, because in Italian degrees are plural.", "gapAfter": "clause"},
        {"lang": "it", "text": "Ci sono ventinove gradi.", "gapAfter": "clause"},
        {"lang": "en", "text": "It's twenty-nine degrees. The verb agrees with the thing that exists, so plural takes ci sono.", "gapAfter": "sentence"},
        {"lang": "en", "text": "Now the sentence that holds the whole distinction, both verbs at once.", "gapAfter": "clause"},
        {"lang": "it", "text": "Dove c'è l'Everglades è umidissimo.", "gapAfter": "sentence"},
        {"lang": "en", "text": "Where the Everglades is, it's extremely humid. C'è says the thing EXISTS there. È says what it is LIKE. English blurs them, because to be does both jobs.", "gapAfter": "sentence"},
        {"lang": "en", "text": "And it has a past, which is this lesson's main tense.", "gapAfter": "clause"},
        {"lang": "it", "text": "Quando c'era Katrina.", "gapAfter": "clause"},
        {"lang": "en", "text": "When Katrina was happening — c'era, the imperfetto of c'è. A state that lasted.", "gapAfter": "sentence"},
        {"lang": "it", "text": "Non c'è aria condizionata.", "gapAfter": "clause"},
        {"lang": "en", "text": "There's no air conditioning. The negative just wraps around it.", "gapAfter": "sentence"},
        {"lang": "it", "text": "C'è poca gente.", "gapAfter": "clause"},
        {"lang": "en", "text": "There aren't many people. Careful here — gente is singular in Italian, so it takes c'è even though English says people ARE.", "gapAfter": "paragraph"},
    ],
    "sec-avverbi": [
        en("One rule turns almost any adjective into an adverb.", "sentence"),
        it("le reazioni veloci", "clause"),
        en("quick reactions. Veloci is the adjective and it agrees with the noun.", "sentence"),
        it("reagire velocemente", "clause"),
        en("to react quickly. Velocemente is the adverb, and it never agrees with anything.",
           "sentence"),
        en("Take the feminine form of the adjective and add -mente. If it ends in -le or -re, "
           "drop that final e first.", "clause"),
        it("stabilmente", "clause"),
        en("permanently, from stabile.", "sentence"),
        it("scoprire", "clause"),
        en("to discover.", "word"),
        it("Lei scopre.", "clause"),
        en("She discovers — the stem shortens to scopr-.", "sentence"),
        it("criticare", "clause"),
        en("to criticise.", "word"),
        it("completare", "clause"),
        en("to complete.", "sentence"),
        it("Noi parliamo di questo.", "clause"),
        en("We talk about this — parlare takes di.", "sentence"),
        it("Chissà!", "clause"),
        en("Who knows.", "paragraph"),
    ],
    # Not from the tape — see day6_data.sec-extra. Voiced anyway so the chapter has the same
    # section control as every other one; a heading with no play button reads as broken.
    "sec-extra": [
        {"lang": "en", "text": "Two words from outside the lesson, added because you asked about them.", "gapAfter": "sentence"},
        {"lang": "it", "text": "sottosopra", "gapAfter": "clause"},
        {"lang": "en", "text": "Upside down, or in a mess. Literally under-over, written as one word, and it never changes form.", "gapAfter": "clause"},
        {"lang": "it", "text": "la stanza è sottosopra", "gapAfter": "clause"},
        {"lang": "en", "text": "The room is a shambles. It works for people too:", "gapAfter": "clause"},
        {"lang": "it", "text": "sono sottosopra", "gapAfter": "clause"},
        {"lang": "en", "text": "I'm all shaken up.", "gapAfter": "sentence"},
        {"lang": "it", "text": "la produzione di ricchezza", "gapAfter": "clause"},
        {"lang": "en", "text": "The production of wealth. Ricchezza is the abstract noun from ricco — wealth as an idea.", "gapAfter": "clause"},
        {"lang": "it", "text": "le ricchezze", "gapAfter": "clause"},
        {"lang": "en", "text": "riches — actual assets, when you make it plural.", "gapAfter": "paragraph"},
    ],
    "sec-medicina": [
        en("The subject of the conversation, and the vocabulary it needs.", "sentence"),
        it("la zoonosi", "clause"),
        en("zoonosis — a disease that crosses from animals to people. Invariable: le zoonosi.",
           "sentence"),
        it("le vittime", "clause"),
        en("the victims. La vittima is feminine even when it is a man.", "sentence"),
        it("il profitto", "clause"),
        en("profit.", "word"),
        it("dietro alle medicine", "clause"),
        en("behind the medicines — dietro a, plus le, gives alle.", "sentence"),
        it("le erbe naturali", "clause"),
        en("natural herbs.", "word"),
        it("la coltivazione della cannabis", "clause"),
        en("cannabis cultivation.", "sentence"),
        it("i pesticidi, gli erbicidi", "clause"),
        en("pesticides, herbicides — i before a consonant, gli before a vowel.", "sentence"),
        it("il glifosato", "clause"),
        en("glyphosate.", "word"),
        it("tossico", "clause"),
        en("toxic.", "word"),
        it("un narcotico", "clause"),
        en("a narcotic.", "sentence"),
        it("la follia", "clause"),
        en("madness.", "paragraph"),
    ],
}

SCRIPTS = {"summary": SUMMARY, "shortened": SHORTENED, "sections": SECTIONS}

if __name__ == "__main__":
    w = lambda s: sum(len(x["text"].split()) for x in s)
    t = len(SUMMARY) + len(SHORTENED)
    print(f"summary   {len(SUMMARY):3} segs · {w(SUMMARY):4} words")
    print(f"shortened {len(SHORTENED):3} segs · {w(SHORTENED):4} words")
    for k, v in SECTIONS.items():
        print(f"  {k:18} {len(v):3} segs · {w(v):4} words"); t += len(v)
    print(f"TOTAL segments ready to bake: {t}")

# I MIEI ERRORI — R-IC5 / R-IC4b: ONLY the correct form is ever voiced. The attempt is named
# in English but never spoken in Italian, because hearing your own error read back in a
# confident, fluent voice is how it gets reinforced instead of removed.
ERRORI = [
    {"lang": "en", "text": "From the recording — five things worth fixing, and the first one is this lesson biting back.", "gapAfter": "sentence"},
    {"lang": "en", "text": "Funny is an adjective, so it never takes the -mente ending. It stays:", "gapAfter": "clause"},
    {"lang": "it", "text": "divertente", "gapAfter": "clause"},
    {"lang": "en", "text": "A funny film — un film divertente. The -mente rule makes adverbs, and this word never needed one.", "gapAfter": "sentence"},
    {"lang": "en", "text": "For resilient, the Italian is almost the same word:", "gapAfter": "clause"},
    {"lang": "it", "text": "è molto resiliente", "gapAfter": "clause"},
    {"lang": "en", "text": "he's very resilient. When a word feels Latin, try the Italian shape before inventing one.", "gapAfter": "sentence"},
    {"lang": "en", "text": "To live is an -ere verb, not -are:", "gapAfter": "clause"},
    # "vivere" alone came back as a 44-byte empty wav — bare infinitives do this. Given a
    # carrier in the same breath it synthesizes fine, and it reads better anyway.
    {"lang": "it", "text": "vivere, io vivo", "gapAfter": "clause"},
    {"lang": "en", "text": "and permanently, which IS a real -mente adverb:", "gapAfter": "clause"},
    {"lang": "it", "text": "stabilmente", "gapAfter": "sentence"},
    {"lang": "en", "text": "Clock times take the feminine plural article.", "gapAfter": "clause"},
    {"lang": "it", "text": "le quattro", "gapAfter": "word"},
    {"lang": "it", "text": "le nove e mezza", "gapAfter": "clause"},
    {"lang": "en", "text": "Four o'clock, half past nine. Only one o'clock is singular — è l'una.", "gapAfter": "sentence"},
    {"lang": "en", "text": "And a false friend she stopped to separate. A school certificate is il diploma, but a university degree is:", "gapAfter": "clause"},
    {"lang": "it", "text": "la laurea", "gapAfter": "word"},
    {"lang": "it", "text": "mi sono laureato", "gapAfter": "clause"},
    {"lang": "en", "text": "the degree, and I graduated.", "gapAfter": "paragraph"},
]
