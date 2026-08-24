#!/usr/bin/env python3
"""il centro di italia — Day 4 narration.

R-IC5: teach the language, never narrate the teaching. No one is named in the audio.
R-IC9: opens on what Day 3 said to study.
Bilingual rule: every Italian phrase is its own it-segment, glossed by the NEXT en-segment.
"""

GAP_MS = {"word": 60, "clause": 400, "sentence": 900, "paragraph": 1800}
en = lambda t, g="sentence": {"lang": "en", "text": t, "gapAfter": g}
it = lambda t, g="clause": {"lang": "it", "text": t, "gapAfter": g}

SUMMARY = [
    en("Three things from last time.", "clause"),
    it("lo spazzolino", "clause"),
    en("the toothbrush — s plus a consonant takes lo.", "clause"),
    it("mi siedo", "clause"),
    en("I sit — the reflexive pronoun in front.", "clause"),
    it("Conosco questo posto.", "clause"),
    en("I know this place — conoscere for places, sapere for facts.", "paragraph"),

    en("Today is one idea with two halves: regular verbs, and the ones that refuse.", "sentence"),
    en("A regular verb is a machine. The stem never moves.", "clause"),
    it("mi sveglio", "clause"),
    en("I wake up.", "word"),
    it("ti svegli", "clause"),
    en("you wake up. Same stem, different ending.", "sentence"),
    en("An irregular verb changes the stem itself.", "clause"),
    it("esco", "clause"),
    en("I go out — from uscire, but there is no usc- left.", "sentence"),
    it("vado", "clause"),
    en("I go, from andare.", "sentence"),
    en("And the catch that gets everyone:", "word"),
    it("noi usciamo", "clause"),
    en("we go out — the stem snaps back to normal for noi and voi.", "paragraph"),
]

SHORTENED = [
    en("Everything today hangs on one distinction: which verbs you can build, "
       "and which you have to know.", "paragraph"),

    en("Start with the ones you can build.", "sentence"),
    en("A regular verb has a stem that never changes and an ending that does.", "clause"),
    it("mi sveglio", "clause"),
    en("I wake up.", "word"),
    it("ti svegli", "clause"),
    en("you wake up. The stem is svegli- in both; only the last letter moved.", "sentence"),
    it("mi lavo", "clause"),
    en("I wash.", "word"),
    it("mi rilasso", "clause"),
    en("I relax.", "word"),
    it("ti organizzi", "clause"),
    en("you get organised. Learn the stem once and every person follows.", "paragraph"),

    en("Now the ones that refuse.", "sentence"),
    it("uscire", "clause"),
    en("to go out. You would expect usc-o. What you get is", "word"),
    it("esco", "clause"),
    en("I go out.", "word"),
    it("tu esci", "clause"),
    en("you go out.", "word"),
    it("lei esce", "clause"),
    en("she goes out — and that same form covers he as well. "
       "Italian does not mark gender in the verb.", "sentence"),
    en("But here is the part worth memorising.", "clause"),
    it("noi usciamo", "clause"),
    en("we go out.", "word"),
    it("voi uscite", "clause"),
    en("you all go out. The stem snaps back to usc-. Irregular in the singular, "
       "regular in noi and voi.", "sentence"),
    it("io vado", "clause"),
    en("I go.", "word"),
    it("tu vai", "clause"),
    en("you go.", "word"),
    it("loro vanno", "clause"),
    en("they go — vanno, and there is no way to build that from andare. You know it or you don't.",
       "paragraph"),

    en("Third, the formal register.", "sentence"),
    it("Lei esce oggi?", "clause"),
    en("Are you going out today? Formal you takes the third person — the same form as she or he.",
       "sentence"),
    it("Lei è il medico di base?", "clause"),
    en("Are you the family doctor? Il medico di base is the GP.", "sentence"),
    it("Lei è canadese?", "clause"),
    en("Are you Canadian?", "clause"),
    it("No, sono statunitense.", "clause"),
    en("No, I'm American — and statunitense is the precise word, because americano covers "
       "two continents.", "paragraph"),

    en("Fourth, the modals, which take a bare infinitive.", "sentence"),
    it("Voglio uscire la sera.", "clause"),
    en("I want to go out in the evening.", "sentence"),
    it("Ma non posso, perché devo studiare.", "clause"),
    en("But I can't, because I have to study. Three modals, no preposition between any of them "
       "and its verb.", "sentence"),
    it("Voglio lavorare nella medicina.", "clause"),
    en("I want to work in medicine — in plus la gives nella.", "paragraph"),

    en("And the vocabulary of a working day.", "clause"),
    it("Oggi ho una presentazione fra cinque ore.", "clause"),
    en("Today I have a presentation in five hours — fra for time ahead.", "sentence"),
    it("Ci sono sei persone nella riunione.", "clause"),
    en("There are six people in the meeting.", "sentence"),
    it("spiegare i dati", "clause"),
    en("to explain the data — and i dati is plural in Italian, so the verb is plural too.",
       "sentence"),
    it("fare un compromesso", "clause"),
    en("to make a compromise. Italian makes compromises, questions and breakfast — all with fare.",
       "paragraph"),
]

SECTIONS = {
    "sec-regolari": [
        en("A regular verb is a machine with two parts.", "sentence"),
        en("The stem carries the meaning and never moves. The ending carries the person "
           "and does all the work.", "clause"),
        it("mi sveglio", "clause"),
        en("I wake up.", "word"),
        it("ti svegli", "clause"),
        en("you wake up. Svegli- in both — only the final vowel changed.", "sentence"),
        it("mi lavo", "clause"),
        en("I wash.", "word"),
        it("mi rilasso", "clause"),
        en("I relax.", "word"),
        it("ti organizzi", "clause"),
        en("you get organised — a long stem, but the same two endings.", "sentence"),
        it("mi metto una camicia", "clause"),
        en("I put on a shirt. A different verb family, and still regular: mett- plus -o.",
           "sentence"),
        en("Get the stem right and every person is free. Get it wrong and nothing works —",
           "word"),
        it("mi preparo", "clause"),
        en("I get ready. The stem is prepar-.", "paragraph"),
    ],
    "sec-irregolari": [
        en("An irregular verb changes the stem itself, so there is nothing to build from.",
           "sentence"),
        it("uscire", "clause"),
        en("to go out. You would expect usc-o.", "clause"),
        it("esco", "clause"),
        en("I go out.", "word"),
        it("tu esci", "clause"),
        en("you go out.", "word"),
        it("lei esce", "clause"),
        en("she goes out — and the same word covers he. The verb does not mark gender.",
           "sentence"),
        en("Then the twist worth memorising.", "clause"),
        it("noi usciamo", "clause"),
        en("we go out.", "word"),
        it("voi uscite", "clause"),
        en("you all go out. The stem comes back. Irregular in the singular, regular in the plural.",
           "sentence"),
        it("vado, tu vai, loro vanno", "clause"),
        en("I go, you go, they go. Andare does the same thing — vado and vanno share nothing "
           "with the infinitive.", "sentence"),
        it("Io faccio molte domande.", "clause"),
        en("I ask a lot of questions. Fare gives faccio — and note you MAKE a question in "
           "Italian, you do not ask one.", "paragraph"),
    ],
    "sec-lei": [
        en("The formal register, which you will need with a doctor or a landlord.", "sentence"),
        it("Lei esce oggi?", "clause"),
        en("Are you going out today? Formal Lei takes the THIRD person — literally the same form "
           "as she goes out.", "sentence"),
        en("There is no separate polite conjugation to learn. You just move the person.", "clause"),
        it("Lei è canadese?", "clause"),
        en("Are you Canadian?", "clause"),
        it("No, sono statunitense.", "clause"),
        en("No, I'm from the United States. Statunitense is the exact word — americano would "
           "cover two whole continents.", "sentence"),
        it("Lei è il medico di base?", "clause"),
        en("Are you the family doctor? Il medico di base is the GP, the first doctor you see.",
           "sentence"),
        it("Preferisco parlare con sua madre.", "clause"),
        en("I prefer to speak with her mother. Sua is his or hers — tua would make it your "
           "mother, which is a different conversation.", "paragraph"),
    ],
    "sec-modali": [
        en("Three verbs that hand straight over to another verb.", "sentence"),
        it("Voglio uscire la sera.", "clause"),
        en("I want to go out in the evening.", "sentence"),
        it("Ma non posso, perché devo studiare.", "clause"),
        en("But I can't, because I have to study.", "sentence"),
        en("Nothing goes between the modal and the infinitive — no di, no a, and no to.",
           "sentence"),
        it("Voglio imparare.", "clause"),
        en("I want to learn.", "word"),
        it("Devo parlare in italiano con lei.", "clause"),
        en("I have to speak Italian with her.", "sentence"),
        it("Non voglio parlare con mia moglie.", "clause"),
        en("I don't want to speak with my wife — and mia moglie takes no article, "
           "as on the first day.", "sentence"),
        it("Il fine settimana restiamo a casa.", "clause"),
        en("At the weekend we stay at home. A casa, no article — a fixed phrase.", "paragraph"),
    ],
    "sec-lavoro": [
        en("The language of a working day.", "sentence"),
        it("Oggi ho una presentazione.", "clause"),
        en("Today I have a presentation.", "word"),
        it("fra cinque ore", "clause"),
        en("in five hours. Fra, or tra, for time ahead — not in.", "sentence"),
        it("Ci sono sei persone nella riunione.", "clause"),
        en("There are six people in the meeting.", "sentence"),
        it("spiegare i dati", "clause"),
        en("to explain the data. I dati is plural, so everything agreeing with it is plural too.",
           "sentence"),
        it("I numeri cambiano.", "clause"),
        en("The numbers change.", "sentence"),
        it("fare un compromesso", "clause"),
        en("to make a compromise.", "word"),
        it("la reputazione", "clause"),
        en("the reputation.", "word"),
        it("la voce", "clause"),
        en("the voice.", "paragraph"),
    ],
}

ERRORI = [
    en("From the recording — four to fix.", "sentence"),
    en("Andare is irregular, so the regular pattern will betray you.", "clause"),
    it("loro vanno", "clause"),
    en("they go. Not vadono.", "sentence"),
    en("The stem of prepararsi is prepar-.", "clause"),
    it("mi preparo", "clause"),
    en("I get ready.", "sentence"),
    en("Talking about someone else's mother, use sua.", "clause"),
    it("sua madre", "clause"),
    en("her mother.", "sentence"),
    en("And the Italian for voice is not the Spanish one.", "clause"),
    it("la voce", "clause"),
    en("the voice.", "paragraph"),
]

SCRIPTS = {"summary": SUMMARY, "shortened": SHORTENED, "sections": SECTIONS, "errori": ERRORI}

if __name__ == "__main__":
    w = lambda s: sum(len(x["text"].split()) for x in s)
    t = 0
    for k in ("summary", "shortened", "errori"):
        print(f"{k:10} {len(SCRIPTS[k]):3} segs · {w(SCRIPTS[k]):4} words"); t += len(SCRIPTS[k])
    for k, v in SECTIONS.items():
        print(f"  {k:16} {len(v):3} segs · {w(v):4} words"); t += len(v)
    print(f"TOTAL segments: {t}")
