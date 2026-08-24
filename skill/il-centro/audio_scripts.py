#!/usr/bin/env python3
"""Chiron-shape narration scripts — Italian lesson, 3 agosto 2026.

Mirrors <lessonDir>/audio-scripts.json:
    {"summary":[seg…], "shortened":[seg…], "sections":{"<domId>":[seg…]}}

CONTENT RULE: this is a LANGUAGE lesson, not a lesson about a lesson. Teach the Italian
and its subtleties — why a form is what it is, what a learner gets wrong, what a word
actually connotes. No commentary on how the teacher teaches, no notation, no shorthand.

BLOCKING bilingual rule (language-it): the medium is mostly English; EVERY Italian phrase
is its own {lang:"it"} segment and the very NEXT en segment glosses it — self-contained
with no screen. Both languages voiced by lucrezia_italian (she code-switches).

gapAfter → ms: word 60 · clause 400 · sentence 900 · paragraph 1800
"""

GAP_MS = {"word": 60, "clause": 400, "sentence": 900, "paragraph": 1800}


def en(t, g="sentence"):
    return {"lang": "en", "text": t, "gapAfter": g}


def it(t, g="clause"):
    return {"lang": "it", "text": t, "gapAfter": g}


# ── SUMMARY ≈ 160 words ───────────────────────────────────────────────────────
SUMMARY = [
    en("Four things to hold on to from this lesson.", "sentence"),
    en("One.", "word"),
    it("la gente", "clause"),
    en("means people, but it takes a singular verb.", "clause"),
    it("La gente è pazza.", "clause"),
    en("People are crazy. È, never sono. English will fight you on this one every time.",
       "sentence"),
    en("Two. Every hour of the clock is plural.", "clause"),
    it("Sono le quattro.", "clause"),
    en("It's four o'clock. Only one, noon and midnight take the singular.", "sentence"),
    en("Three. Italian keeps the present tense where English reaches for the past.", "clause"),
    it("Abito qui da tre anni.", "clause"),
    en("I've been living here for three years.", "sentence"),
    en("And four, states are things you have, not things you are.", "clause"),
    it("Non ha pazienza.", "clause"),
    en("He has no patience.", "clause"),
    it("Hai tempo?", "clause"),
    en("Do you have time?", "sentence"),
    en("One phrase to fix now:", "word"),
    it("riunioni di lavoro", "clause"),
    en("work meetings. Lavoro stays singular there — lavori means roadworks.", "paragraph"),
]

# ── SHORTENED ≈ 560 words · ONE flowing arc ───────────────────────────────────
SHORTENED = [
    en("This lesson covers everyday Italian, the clock, four grammar points, "
       "and the vocabulary of tourism and cinema.", "paragraph"),

    en("Start with nouns, because their endings carry the grammar.", "sentence"),
    it("la regola", "clause"),
    en("the rule. Feminine nouns ending in A take E in the plural —", "word"),
    it("le regole", "clause"),
    en("the rules. Masculine nouns ending in O take I —", "word"),
    it("il rischio, i rischi", "clause"),
    en("the risk, the risks.", "sentence"),
    en("Gender pairs often just swap the ending.", "clause"),
    it("l'attore, l'attrice", "clause"),
    en("the actor, the actress.", "sentence"),
    en("And to say more of something, use", "word"),
    it("più", "clause"),
    it("Devo studiare più italiano.", "clause"),
    en("I have to study more Italian.", "paragraph"),

    en("Now the Italian you'll use in any conversation.", "sentence"),
    it("Da quanto tempo abiti in Italia?", "clause"),
    en("How long have you been living in Italy? Here's the subtlety: Italian answers "
       "that in the present.", "clause"),
    it("Abito qui da tre anni.", "clause"),
    en("Literally, I live here since three years. Reaching for a past tense is the "
       "classic English mistake.", "sentence"),
    it("Hai tempo per scrivere una presentazione?", "clause"),
    en("Do you have time to write a presentation? Time is something you have. So is patience, "
       "hunger, thirst, fear, and being right.", "sentence"),
    it("Lei non ha pazienza.", "clause"),
    en("She has no patience.", "sentence"),
    it("Voglio praticare la pronuncia.", "clause"),
    en("I want to practise pronunciation. Volere and dovere take a bare infinitive — "
       "nothing goes between the two verbs.", "paragraph"),

    en("The clock. Every hour is plural, because you're really saying it is the hours four.",
       "sentence"),
    it("Adesso sono le quattro e trentasei di mattina.", "clause"),
    en("It's four thirty-six in the morning.", "clause"),
    it("Qui sono le tre di pomeriggio.", "clause"),
    en("Here it's three in the afternoon.", "sentence"),
    en("Three exceptions take the singular:", "word"),
    it("È l'una. È mezzogiorno. È mezzanotte.", "clause"),
    en("It's one, it's noon, it's midnight.", "sentence"),
    en("To say at a time, use alle.", "clause"),
    it("La prima riunione comincia alle nove.", "clause"),
    en("The first meeting starts at nine.", "paragraph"),

    en("Four grammar points worth real attention.", "sentence"),
    it("La gente", "clause"),
    en("people, is grammatically singular — a collective, like family or team.", "clause"),
    it("La gente viaggia a Sud.", "clause"),
    en("People travel south. Viaggia, not viaggiano. For a true plural, say", "word"),
    it("le persone", "clause"),
    en("and then the verb goes plural too.", "sentence"),
    en("Second, prepositions fuse with the article.", "clause"),
    it("nel fiume", "clause"),
    en("in the river.", "word"),
    it("nella fontana", "clause"),
    en("in the fountain. In plus il gives nel, in plus la gives nella.", "sentence"),
    en("Third, the imperfetto — the past tense for ongoing states.", "clause"),
    it("La gente era ottimista.", "clause"),
    en("People were optimistic. Not a single finished event, but how things simply were.",
       "sentence"),
    en("And fourth, no article before a single family member.", "clause"),
    it("mia moglie", "clause"),
    en("my wife — never la mia moglie.", "paragraph"),

    en("Two fields of vocabulary. Tourism first.", "sentence"),
    it("il turismo selvaggio", "clause"),
    en("Selvaggio means wild or savage, and applied to tourism it means unchecked, "
       "unregulated — it carries real disapproval.", "sentence"),
    it("Ferragosto", "clause"),
    en("the fifteenth of August, when Italy empties out for the coast.", "sentence"),
    it("Fare il bagno nella fontana di Trevi", "clause"),
    en("to bathe in the Trevi fountain. Notice you make the bath — fare — where English "
       "uses a verb of its own.", "paragraph"),

    en("Then cinema.", "clause"),
    it("il regista", "clause"),
    en("the film director. It is not a registrar, and although it ends in A it is masculine — "
       "il regista, i registi.", "sentence"),
    it("in bianco e nero", "clause"),
    en("in black and white, with no article.", "sentence"),
    en("And say a year as a single word:", "word"),
    it("millenovecentosessantadue", "clause"),
    en("nineteen sixty-two — never broken into pairs the way English does it.", "paragraph"),
]

# ── PER-SECTION ≈ 1 min each ──────────────────────────────────────────────────
SECTIONS = {
    # anchored to the page's opening section, whose examples are number and gender pairs
    "sec-shorthand": [
        en("Italian nouns carry their grammar in the ending, so the ending is worth "
           "hearing properly.", "sentence"),
        it("la regola", "clause"),
        en("the rule. Feminine, ending in A.", "clause"),
        it("le regole", "clause"),
        en("the rules — the A becomes E.", "sentence"),
        it("il rischio", "clause"),
        en("the risk. Masculine, ending in O.", "clause"),
        it("i rischi", "clause"),
        en("the risks — the O becomes I. And the article shifts with it: la becomes le, "
           "il becomes i.", "sentence"),
        en("Gender pairs work the same way.", "clause"),
        it("l'attore, l'attrice", "clause"),
        en("the actor, the actress.", "clause"),
        it("gli attori, le attrici", "clause"),
        en("the actors, the actresses.", "sentence"),
        en("One spelling trap lives here. The apostrophe in", "word"),
        it("un'attrice", "clause"),
        en("an actress, only appears before a feminine noun starting with a vowel. "
           "The masculine is", "word"),
        it("un attore", "clause"),
        en("with no apostrophe at all.", "sentence"),
        en("Finally, to say more of something:", "word"),
        it("più", "clause"),
        it("Devo studiare più italiano.", "clause"),
        en("I have to study more Italian.", "paragraph"),
    ],
    "sec-classe": [
        en("This is the Italian of an ordinary conversation.", "sentence"),
        it("Da quanto tempo abiti in Italia?", "clause"),
        en("How long have you been living in Italy?", "sentence"),
        en("The subtlety is in the tense. Italian stays in the present for something "
           "still going on.", "clause"),
        it("Abito qui da tre anni.", "clause"),
        en("I've been living here for three years — literally, I live here since three years. "
           "Say ho abitato and you've accidentally said you don't live there any more.",
           "sentence"),
        it("Hai tempo per scrivere una presentazione?", "clause"),
        en("Do you have time to write a presentation? Two things there: time is something "
           "you have, and per plus an infinitive means in order to.", "sentence"),
        it("Lei non ha pazienza.", "clause"),
        en("She has no patience. Italian has patience, hunger, thirst, sleep, fear, "
           "and reason — where English is hungry or is right.", "sentence"),
        it("Voglio praticare la pronuncia.", "clause"),
        en("I want to practise pronunciation. Volere and dovere take the infinitive bare.",
           "sentence"),
        it("Ci vediamo domani alla stessa ora, allo stesso posto.", "clause"),
        en("See you tomorrow, same time, same place — literally, we see each other. "
           "And a plus la gives alla, a plus lo gives allo.", "paragraph"),
    ],
    "sec-ora": [
        en("Telling the time in Italian rests on one idea: you are counting hours, "
           "and hours are plural.", "sentence"),
        it("Sono le quattro.", "clause"),
        en("It's four o'clock — literally, they are the four hours.", "sentence"),
        it("Adesso sono le quattro e trentasei di mattina.", "clause"),
        en("It's four thirty-six in the morning.", "clause"),
        it("Qui sono le tre di pomeriggio.", "clause"),
        en("Here it's three in the afternoon.", "sentence"),
        en("Three times take the singular, because there is only one of each:", "word"),
        it("È l'una.", "clause"),
        en("It's one o'clock.", "word"),
        it("È mezzogiorno.", "clause"),
        en("It's noon.", "word"),
        it("È mezzanotte.", "clause"),
        en("It's midnight.", "sentence"),
        en("To say at a time, the preposition fuses with the article and gives alle.", "clause"),
        it("La prima riunione comincia alle nove.", "clause"),
        en("The first meeting starts at nine.", "clause"),
        it("alle nove e cinquantacinque", "clause"),
        en("at nine fifty-five. For one o'clock it contracts to all'una.", "sentence"),
        en("And one fixed phrase to get right:", "word"),
        it("riunioni di lavoro", "clause"),
        en("work meetings. Lavoro stays singular and invariable there. Lavori, with an I, "
           "means roadworks.", "paragraph"),
    ],
    "sec-grammatica": [
        en("Four points that decide whether a sentence sounds Italian or translated.",
           "sentence"),
        en("The first is a collective noun.", "clause"),
        it("la gente", "clause"),
        en("means people, but grammatically it is one thing — like family, or team.", "clause"),
        it("La gente è pazza.", "clause"),
        en("People are crazy.", "word"),
        it("La gente viaggia a Sud.", "clause"),
        en("People travel south.", "word"),
        it("La gente era ottimista.", "clause"),
        en("People were optimistic. È, viaggia, era — all singular. If you want a genuine "
           "plural, use", "word"),
        it("le persone", "clause"),
        en("and the verb follows: le persone sono pazze.", "sentence"),
        en("Second, prepositions fuse with the definite article.", "clause"),
        it("nel fiume", "clause"),
        en("in the river.", "word"),
        it("nel lago", "clause"),
        en("in the lake.", "word"),
        it("nella fontana", "clause"),
        en("in the fountain. Same preposition, different article, one fused word.", "sentence"),
        en("Third, the imperfetto. Era is not a single finished event — it describes how "
           "things were, ongoing, in the background.", "sentence"),
        en("And fourth, drop the article before one family member.", "clause"),
        it("mia moglie", "clause"),
        en("my wife. Not la mia moglie — though the article comes back in the plural, "
           "and when the noun is modified.", "paragraph"),
    ],
    "sec-turismo": [
        en("The vocabulary of tourism, and what the words actually carry.", "sentence"),
        it("Il turismo è importante per l'Italia.", "clause"),
        en("Tourism is important for Italy.", "sentence"),
        it("il turismo selvaggio", "clause"),
        en("Selvaggio literally means wild or savage. Applied to tourism it means unchecked "
           "and unregulated — it is not neutral, it carries disapproval.", "sentence"),
        it("Ferragosto", "clause"),
        en("the fifteenth of August, the peak holiday, when much of the country closes "
           "and moves to the coast.", "sentence"),
        it("La gente a Nord viaggia a Sud.", "clause"),
        en("People in the north travel south — and remember, viaggia stays singular.",
           "sentence"),
        it("Fare il bagno nella fontana di Trevi", "clause"),
        en("to bathe in the Trevi fountain. Italian makes the bath — fare il bagno — where "
           "English has a verb of its own. Nuotare is to swim as a sport; this is going in "
           "the water.", "sentence"),
        it("Non c'è una regola.", "clause"),
        en("There's no rule. C'è for one thing, ci sono for several.", "paragraph"),
    ],
    "sec-cinema": [
        en("Cinema vocabulary, with two traps inside it.", "sentence"),
        it("il regista", "clause"),
        en("the film director. First trap: it is not a registrar. Second: it ends in A "
           "but it is masculine —", "word"),
        it("i registi", "clause"),
        en("the directors. A woman director is la regista, le registe. The ending tells you "
           "less than the article does.", "sentence"),
        it("in bianco e nero", "clause"),
        en("in black and white — no article, unlike English.", "sentence"),
        it("il film cult", "clause"),
        en("the cult film. Film is borrowed and invariable: un film, i film, never films.",
           "sentence"),
        it("Lui si innamora di Sofia Loren.", "clause"),
        en("He falls in love with Sofia Loren. The verb is reflexive and it takes di, "
           "not con — you fall in love of someone.", "sentence"),
        it("il boom economico", "clause"),
        en("the economic boom.", "clause"),
        it("la vita degli anni sessanta", "clause"),
        en("life in the sixties — di plus gli gives degli.", "sentence"),
        en("And a year is one word:", "word"),
        it("millenovecentosessantadue", "clause"),
        en("nineteen sixty-two.", "paragraph"),
    ],
    "sec-compiti": [
        en("Now build your own introduction, entirely in the present tense.", "sentence"),
        it("Abito in Italia da tre anni.", "clause"),
        en("I've been living in Italy for three years — present tense, with da.", "sentence"),
        it("Ogni giorno ho molte riunioni di lavoro.", "clause"),
        en("Every day I have a lot of work meetings — lavoro singular.", "sentence"),
        it("La prima riunione comincia alle nove.", "clause"),
        en("The first meeting starts at nine.", "sentence"),
        it("Devo studiare più italiano perché voglio parlare bene.", "clause"),
        en("I have to study more Italian because I want to speak well — both modals "
           "with a bare infinitive.", "sentence"),
        it("Mi piace guardare il cinema italiano in bianco e nero.", "clause"),
        en("I like watching Italian cinema in black and white. Mi piace for one thing "
           "or an action; mi piacciono for several.", "sentence"),
        it("Il mio film preferito è Il Sorpasso, del regista Dino Risi.", "clause"),
        en("My favourite film is Il Sorpasso, by the director Dino Risi.", "sentence"),
        en("Three things to check before you speak. Singular verb after la gente. "
           "Riunioni di lavoro, not lavori. And no article before mia moglie.", "paragraph"),
    ],
}

SCRIPTS = {"summary": SUMMARY, "shortened": SHORTENED, "sections": SECTIONS}

if __name__ == "__main__":
    def words(segs):
        return sum(len(s["text"].split()) for s in segs)
    print(f"summary   {len(SUMMARY):3} segs · {words(SUMMARY):4} words")
    print(f"shortened {len(SHORTENED):3} segs · {words(SHORTENED):4} words")
    tot = len(SUMMARY) + len(SHORTENED)
    for k, v in SECTIONS.items():
        print(f"  {k:16} {len(v):3} segs · {words(v):4} words")
        tot += len(v)
    print(f"TOTAL segments: {tot}")
