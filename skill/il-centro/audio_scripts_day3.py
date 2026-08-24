#!/usr/bin/env python3
"""il centro di italia — Day 3 narration.

R-IC5: teach the language, never narrate the teaching. No teacher named, no notation.
R-IC9: opens on what Day 2 said to study.
Bilingual rule: every Italian phrase is its own it-segment, glossed by the NEXT en-segment.
"""

GAP_MS = {"word": 60, "clause": 400, "sentence": 900, "paragraph": 1800}
en = lambda t, g="sentence": {"lang": "en", "text": t, "gapAfter": g}
it = lambda t, g="clause": {"lang": "it", "text": t, "gapAfter": g}

SUMMARY = [
    en("Three things to carry from last time.", "clause"),
    it("mi sveglio", "clause"),
    en("I wake up — the reflexive pronoun goes in front.", "clause"),
    it("ci vuole tempo", "clause"),
    en("it takes time — it agrees with the thing needed.", "clause"),
    it("la qualità della vita", "clause"),
    en("quality of life — vita has no written accent.", "paragraph"),

    en("Now, four things from today.", "sentence"),
    en("One, the article.", "clause"),
    it("lo spazzolino", "clause"),
    en("the toothbrush. Before s plus a consonant the masculine article is lo, not il.", "sentence"),
    en("Two, more reflexives.", "clause"),
    it("Mi siedo alla scrivania.", "clause"),
    en("I sit at the desk.", "clause"),
    it("Ci sediamo al bar.", "clause"),
    en("We sit at the bar.", "sentence"),
    en("Three, remembering.", "clause"),
    it("Non ricordo il nome.", "clause"),
    en("I don't remember the name. But before a verb you need di —", "word"),
    it("non ricordo di prendere", "clause"),
    en("I don't remember to take.", "sentence"),
    en("And four, two verbs English keeps as one.", "clause"),
    it("Conosco questo posto.", "clause"),
    en("I know this place. Places and people take conoscere; facts take sapere.", "paragraph"),
]

SHORTENED = [
    en("Start with what carries over.", "clause"),
    it("mi sveglio", "clause"),
    en("the reflexive pronoun in front of the verb. Today that pattern does most of the work.",
       "paragraph"),

    en("First, an article rule that decides how a lot of words sound.", "sentence"),
    en("Before s plus a consonant, the masculine article is lo.", "clause"),
    it("lo spazzolino", "clause"),
    en("the toothbrush.", "word"),
    it("lo specchio", "clause"),
    en("the mirror.", "word"),
    it("lo stadio", "clause"),
    en("the stadium.", "sentence"),
    en("The test is s plus a consonant, not the letter s on its own — so it also catches", "word"),
    it("lo psicologo", "clause"),
    en("the psychologist, and", "word"),
    it("lo zucchero", "clause"),
    en("the sugar. Even borrowed words obey it:", "word"),
    it("lo standard", "clause"),
    en("the standard. In the plural they all take gli —", "word"),
    it("gli stadi", "clause"),
    en("the stadiums.", "paragraph"),

    en("Second, reflexive verbs, carrying straight on from last time.", "sentence"),
    it("Mi siedo alla scrivania.", "clause"),
    en("I sit at the desk — and there is alla again, a plus la.", "sentence"),
    it("Mi preparo per la lezione di italiano.", "clause"),
    en("I get ready for the Italian lesson.", "sentence"),
    it("Lei si alza alle otto.", "clause"),
    en("She gets up at eight.", "sentence"),
    it("Ti tagli i capelli?", "clause"),
    en("Are you getting your hair cut? It is reflexive because the hair is yours — "
       "Italian marks that and English does not.", "sentence"),
    it("Noi ci sediamo al bar e beviamo un caffè.", "clause"),
    en("We sit at the bar and drink a coffee.", "paragraph"),

    en("Some reflexives are reciprocal — the -si means one another, not oneself.", "sentence"),
    it("incontrarsi", "clause"),
    en("to meet each other.", "word"),
    it("Ci incontriamo in centro a Napoli.", "clause"),
    en("We meet in the centre of Naples.", "sentence"),
    it("occuparsi", "clause"),
    en("to deal with, to look after — and it takes di.", "clause"),
    it("Lei si occupa di appartamenti per i militari.", "clause"),
    en("She handles apartments for the military.", "paragraph"),

    en("Third, remembering, which splits in two.", "sentence"),
    it("Non ricordo il nome.", "clause"),
    en("I don't remember the name — a direct object, no pronoun.", "sentence"),
    it("Non mi ricordo.", "clause"),
    en("I don't remember — reflexive, standing alone. Both are correct.", "sentence"),
    en("But in front of a verb it needs di.", "clause"),
    it("Non ricordo di prendere le medicine.", "clause"),
    en("I don't remember to take the medicine.", "sentence"),
    it("Non ricordo niente.", "clause"),
    en("I don't remember anything — and that double negative is required, not optional.",
       "paragraph"),

    en("And two phrases worth having ready in every lesson.", "clause"),
    it("Non capisco.", "clause"),
    en("I don't understand.", "word"),
    it("Non ti seguo.", "clause"),
    en("I'm not following you — softer, because you're following the person rather than the words.",
       "paragraph"),

    en("Finally, the pair English collapses into one word.", "sentence"),
    it("Conosco questo posto.", "clause"),
    en("I know this place. Conoscere is for places and people you are acquainted with.", "sentence"),
    it("So parlare italiano.", "clause"),
    en("I know how to speak Italian. Sapere is for facts and abilities. "
       "Use sapere for a place and it will sound wrong.", "paragraph"),
]

SECTIONS = {
    "sec-lo": [
        en("One article rule changes how a whole set of words sounds.", "sentence"),
        en("The masculine article is normally il. But before s plus a consonant it becomes lo.",
           "clause"),
        it("lo spazzolino", "clause"),
        en("the toothbrush.", "word"),
        it("lo specchio", "clause"),
        en("the mirror.", "word"),
        it("lo stadio", "clause"),
        en("the stadium.", "sentence"),
        en("The trigger is s followed by another consonant — so it also covers", "word"),
        it("lo psicologo", "clause"),
        en("the psychologist, where the s is followed by p.", "sentence"),
        it("lo zucchero", "clause"),
        en("the sugar — z behaves the same way.", "sentence"),
        it("lo standard", "clause"),
        en("the standard. Borrowed words are not exempt: lo sport, lo staff.", "sentence"),
        en("In the plural every one of them takes gli.", "clause"),
        it("gli spazzolini, gli stadi", "clause"),
        en("the toothbrushes, the stadiums.", "paragraph"),
    ],
    "sec-riflessivi": [
        en("Reflexive verbs again, and now in the middle of ordinary sentences.", "sentence"),
        it("Mi siedo alla scrivania.", "clause"),
        en("I sit at the desk. Two things there: sedersi is reflexive, and alla is a plus la.",
           "sentence"),
        it("Mi preparo per la lezione di italiano.", "clause"),
        en("I get ready for the Italian lesson. Mi preparo has no tidy English equivalent — "
           "it is closer to I organise myself.", "sentence"),
        it("Lei si alza alle otto.", "clause"),
        en("She gets up at eight.", "sentence"),
        it("Ti tagli i capelli?", "clause"),
        en("Are you getting your hair cut?", "sentence"),
        it("Quando sei a Napoli ti siedi al bar o sei in piedi?", "clause"),
        en("When you're in Naples do you sit at the bar or stand? In piedi means standing.",
           "sentence"),
        it("Ci sediamo sul divano.", "clause"),
        en("We sit on the sofa — su plus il gives sul.", "paragraph"),
    ],
    "sec-incontrarsi": [
        en("Some reflexives are reciprocal: the -si means each other.", "sentence"),
        it("incontrarsi", "clause"),
        en("to meet one another.", "clause"),
        it("Mi incontro con amici a Napoli.", "clause"),
        en("I meet up with friends in Naples — and it keeps con.", "sentence"),
        it("Noi ci incontriamo in centro a Napoli.", "clause"),
        en("We meet in the centre of Naples. In centro takes no article.", "sentence"),
        it("occuparsi", "clause"),
        en("to deal with, to look after. It takes di, always.", "clause"),
        it("Lei si occupa di appartamenti per i militari.", "clause"),
        en("She handles apartments for the military.", "sentence"),
        en("And two reciprocal sign-offs.", "clause"),
        it("Ci vediamo domani!", "clause"),
        en("See you tomorrow.", "word"),
        it("Ci sentiamo domani!", "clause"),
        en("We'll speak tomorrow — use that one when the next contact is by phone.", "paragraph"),
    ],
    "sec-ricordare": [
        en("Remembering splits into two verbs in Italian.", "sentence"),
        it("Non ricordo il nome.", "clause"),
        en("I don't remember the name. Ricordare takes a direct object.", "sentence"),
        it("Non mi ricordo.", "clause"),
        en("I don't remember. Ricordarsi is the reflexive, and more colloquial. "
           "Both are correct.", "sentence"),
        it("Non ricordo niente.", "clause"),
        en("I don't remember anything. Italian requires the double negative — "
           "non and niente together.", "sentence"),
        en("The one that catches people: before a VERB you need di.", "clause"),
        it("Non ricordo di prendere le medicine.", "clause"),
        en("I don't remember to take the medicine.", "sentence"),
        it("Non capisco.", "clause"),
        en("I don't understand.", "word"),
        it("Non ti seguo.", "clause"),
        en("I'm not following you.", "sentence"),
        it("Seguimi!", "clause"),
        en("Follow me. Notice the pronoun is attached on the end — an imperative does that, "
           "where the present tense puts it in front.", "paragraph"),
    ],
    "sec-contesto": [
        en("Vocabulary from your own life, and the verb pair underneath it.", "sentence"),
        it("Conosco questo posto.", "clause"),
        en("I know this place. Conoscere is for places and people.", "sentence"),
        it("So parlare italiano.", "clause"),
        en("I know how to speak Italian. Sapere is for facts and abilities. "
           "English uses know for both; Italian will not.", "sentence"),
        it("una base NATO", "clause"),
        en("a NATO base.", "word"),
        it("l'aviazione", "clause"),
        en("the air force.", "sentence"),
        it("Lei si occupa di appartamenti per i militari.", "clause"),
        en("She handles apartments for the military.", "sentence"),
        it("la lingua quotidiana", "clause"),
        en("everyday language — quotidiano means daily.", "sentence"),
        it("prodotti con molto zucchero", "clause"),
        en("products with a lot of sugar.", "sentence"),
        it("Alla stessa ora, alle nove e cinquantacinque.", "clause"),
        en("Same time, nine fifty-five. Unchanged since the first lesson.", "paragraph"),
    ],
}

# The corrections, voiced: her form only. The attempt is NEVER spoken (R-IC5 / R-IC4b).
ERRORI = [
    en("From the recording — three things worth fixing.", "sentence"),
    en("For a place, use conoscere, not sapere.", "clause"),
    it("Conosco questa base.", "clause"),
    en("I know this base.", "sentence"),
    en("a plus la is never two words.", "clause"),
    it("alla distanza", "clause"),
    en("at a distance.", "sentence"),
    en("And locazione is a false friend — it means a lease, not a location.", "clause"),
    it("la posizione", "clause"),
    en("the position, the place.", "paragraph"),
]

SCRIPTS = {"summary": SUMMARY, "shortened": SHORTENED, "sections": SECTIONS, "errori": ERRORI}

if __name__ == "__main__":
    w = lambda s: sum(len(x["text"].split()) for x in s)
    print(f"summary   {len(SUMMARY):3} segs · {w(SUMMARY):4} words")
    print(f"shortened {len(SHORTENED):3} segs · {w(SHORTENED):4} words")
    print(f"errori    {len(ERRORI):3} segs · {w(ERRORI):4} words")
    t = len(SUMMARY) + len(SHORTENED) + len(ERRORI)
    for k, v in SECTIONS.items():
        print(f"  {k:18} {len(v):3} segs · {w(v):4} words"); t += len(v)
    print(f"TOTAL segments: {t}")
