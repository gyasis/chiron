#!/usr/bin/env python3
"""il centro di italia — Day 3. Data only (R-IC1).

Two sources for the first time: the chat log AND a 45-minute recording (Day3.m4a,
701 turns, Barbara 445 / Gyasi 256). The recording is what makes ERRORI real — those
pairs are lifted from the tape, not invented.
"""

RECORDING = "audio/registrazione/day3.mp3"      # optional field; Days 1–2 have none

CHAPTERS = [
    ("sec-lo", "L'articolo LO", [
        ("d3-lo-01", "lo spazzolino", "lo spazzolino", "the toothbrush",
         "s + consonant takes LO, never IL. Her rule on the tape: «perché la parola comincia con SP»."),
        ("d3-lo-02", "lo specchio", "lo specchio", "the mirror", "sp- → lo."),
        ("d3-lo-03", "lo stadio", "lo stadio", "the stadium", "st- → lo."),
        ("d3-lo-04", "lo psicologo", "lo psicologo", "the psychologist",
         "ps- counts too — the test is s+consonant, not the letter s alone."),
        ("d3-lo-05", "lo standard", "lo standard", "the standard",
         "Even a borrowed word obeys it: lo standard, lo sport, lo staff."),
        ("d3-lo-06", "lo zucchero", "lo zucchero", "the sugar",
         "z- takes LO as well — from «prodotti con molto zucchero»."),
    ]),
    ("sec-riflessivi", "I riflessivi, continuati", [
        ("d3-rif-01", "mi siedo alla scrivania", "mi siedo alla scrivania", "I sit at the desk",
         "sedersi. And alla = a + la — Day 1's rule, still working."),
        ("d3-rif-02", "mi preparo per la lezione di italiano",
         "mi preparo per la lezione di italiano", "I get ready for the Italian lesson",
         "prepararsi. She noted mi preparo has no clean English equivalent."),
        ("d3-rif-03", "lei si alza alle 8.00", "lei si alza alle otto", "she gets up at 8:00",
         "alzarsi, third person: si alza. alle for the hour — Day 1."),
        ("d3-rif-04", "ti tagli i capelli?", "ti tagli i capelli?", "are you getting your hair cut?",
         "tagliarsi. Reflexive because it is YOUR hair — Italian marks that, English doesn't."),
        ("d3-rif-05", "quando sei a Napoli ti siedi al bar o sei in piedi?",
         "quando sei a Napoli ti siedi al bar o sei in piedi?",
         "when you're in Naples do you sit at the bar or stand?",
         "in piedi = standing. The everyday Neapolitan question."),
        ("d3-rif-06", "noi ci sediamo al bar e beviamo un caffè",
         "noi ci sediamo al bar e beviamo un caffè", "we sit at the bar and drink a coffee",
         "ci sediamo — first person plural. The pronoun still comes first."),
        ("d3-rif-07", "ci sediamo sul divano", "ci sediamo sul divano", "we sit on the sofa",
         "su + il = sul. Another fused preposition."),
    ]),
    ("sec-incontrarsi", "Incontrarsi, occuparsi", [
        ("d3-inc-01", "incontrarsi", "incontrarsi", "to meet (each other)",
         "Reciprocal: the -si means one another, not oneself."),
        ("d3-inc-02", "mi incontro con amici a Napoli", "mi incontro con amici a Napoli",
         "I meet up with friends in Naples", "mi incontro CON — the preposition stays."),
        ("d3-inc-03", "noi ci incontriamo in centro a Napoli",
         "noi ci incontriamo in centro a Napoli", "we meet in the centre of Naples",
         "ci incontriamo — reciprocal plural. in centro, no article."),
        ("d3-inc-04", "occuparsi", "occuparsi", "to deal with, to look after",
         "Takes DI: occuparsi di qualcosa."),
        ("d3-inc-05", "lei si occupa di appartamenti per i militari",
         "lei si occupa di appartamenti per i militari",
         "she handles apartments for the military", "si occupa DI — never occuparsi a/con."),
        ("d3-inc-06", "ci vediamo domani!", "ci vediamo domani!", "see you tomorrow!",
         "Day 1's sign-off, still the standard."),
        ("d3-inc-07", "ci sentiamo domani!", "ci sentiamo domani!", "we'll speak tomorrow!",
         "sentirsi = to hear one another. Use it when the next contact is by phone or message."),
    ]),
    ("sec-ricordare", "Ricordare o ricordarsi", [
        ("d3-ric-01", "non ricordo il nome", "non ricordo il nome", "I don't remember the name",
         "ricordare + direct object — no pronoun needed."),
        ("d3-ric-02", "non mi ricordo", "non mi ricordo", "I don't remember",
         "ricordarsi, standing alone. Both forms are correct; the reflexive is more colloquial."),
        ("d3-ric-03", "non ricordo niente", "non ricordo niente", "I don't remember anything",
         "The double negative is REQUIRED: non … niente."),
        ("d3-ric-04", "non ricordo di prendere le medicine",
         "non ricordo di prendere le medicine", "I don't remember to take the medicine",
         "Before a verb it needs DI: ricordare DI + infinito. Her note: «non ricordo + di + prendere»."),
        ("d3-ric-05", "non capisco", "non capisco", "I don't understand",
         "The one to have ready in every lesson."),
        ("d3-ric-06", "non ti seguo", "non ti seguo", "I'm not following you",
         "Softer than non capisco — you're following the person, not the words."),
        ("d3-ric-07", "seguimi!", "seguimi!", "follow me!",
         "Imperative with the pronoun ATTACHED — the opposite of the present tense."),
    ]),
    ("sec-contesto", "La tua vita qui", [
        ("d3-con-01", "conosco questo posto", "conosco questo posto", "I know this place",
         "CONOSCERE for places and people; SAPERE for facts. See the correction below."),
        ("d3-con-02", "una base NATO", "una base NATO", "a NATO base", "Ghedi, Aviano."),
        ("d3-con-03", "l'aviazione", "l'aviazione", "the air force", "Feminine: l'aviazione."),
        ("d3-con-04", "la lingua quotidiana", "la lingua quotidiana", "everyday language",
         "quotidiano = daily — what she is actually teaching you."),
        ("d3-con-05", "una lista", "una lista", "a list", ""),
        ("d3-con-06", "i neuroni", "i neuroni", "the neurons", "il neurone → i neuroni."),
        ("d3-con-07", "prodotti con molto zucchero", "prodotti con molto zucchero",
         "products with a lot of sugar", "molto agrees with nothing here — it modifies zucchero."),
        ("d3-con-08", "alla stessa ora, alle 9.55", "alla stessa ora, alle nove e cinquantacinque",
         "at the same time, at 9:55", "Unchanged since Day 1."),
    ]),
]

# ── I MIEI ERRORI — lifted from the tape (R-IC4b). attempt is NEVER voiced.
ERRORI = [
    (1916.0, "lo so a questa base", "conosco questa base",
     "sapere → conoscere",
     "SAPERE is for facts and how-to: <em>so parlare italiano</em>. CONOSCERE is for places and "
     "people you are acquainted with: <em>conosco questa base</em>. A base is a place, so it takes "
     "conoscere."),
    (1858.0, "basso, distanza", "alla distanza",
     "a + la = alla",
     "Day 1's fused preposition, and it caught you again in speech. <em>a</em> + <em>la</em> is "
     "never two words — it is <strong>alla</strong>."),
    (1812.0, "posizione o locazione", "la posizione",
     "locazione is a false friend",
     "<em>Locazione</em> means a rental/lease, not a location. For a place use "
     "<strong>la posizione</strong> or <strong>il posto</strong>."),
]

PEARLS = {
    "sec-lo": ("pearl-lo",
        "Davanti a <strong>s + consonante</strong> l'articolo maschile è <strong>lo</strong>, "
        "non <em>il</em>: <em>lo spazzolino, lo specchio, lo stadio, lo standard</em>. "
        "Vale anche per <strong>ps-</strong> (<em>lo psicologo</em>), <strong>z-</strong> "
        "(<em>lo zucchero</em>), <strong>gn-</strong> e <strong>y-</strong>. Al plurale: "
        "<strong>gli</strong> — <em>gli spazzolini, gli stadi</em>.",
        "Before s + consonant the masculine article is LO, not IL: lo spazzolino, lo specchio, "
        "lo stadio, lo standard. The same holds for ps-, z-, gn- and y-. The plural is GLI: "
        "gli spazzolini, gli stadi."),
    "sec-riflessivi": ("pearl-riflessivi-2",
        "Il pronome riflessivo va <strong>davanti</strong> al verbo coniugato — "
        "<em>mi siedo, ti siedi, si siede, ci sediamo</em> — ma si <strong>attacca</strong> "
        "all'infinito e all'imperativo: <em>sedersi</em>, <em>seguimi!</em>. "
        "Stessa regola, due posizioni.",
        "The reflexive pronoun goes IN FRONT of a conjugated verb — mi siedo, ti siedi, si siede — "
        "but ATTACHES to an infinitive and an imperative: sedersi, seguimi. One rule, two positions."),
    "sec-ricordare": ("pearl-ricordare",
        "<strong>Ricordare</strong> regge un oggetto diretto: <em>non ricordo il nome</em>. "
        "<strong>Ricordarsi</strong> è riflessivo: <em>non mi ricordo</em>. "
        "Davanti a un <strong>verbo</strong> serve <strong>di</strong>: "
        "<em>ricordare di prendere</em>.",
        "Ricordare takes a direct object: non ricordo il nome. Ricordarsi is reflexive: non mi "
        "ricordo. Before a VERB you need DI: ricordare di prendere."),
    "sec-contesto": ("pearl-sapere-conoscere",
        "<strong>Sapere</strong> = i fatti e le capacità: <em>so parlare italiano</em>, "
        "<em>non so dove</em>. <strong>Conoscere</strong> = luoghi e persone: "
        "<em>conosco questo posto</em>, <em>conosco Barbara</em>. In inglese sono un verbo solo, "
        "in italiano no.",
        "Sapere is for facts and abilities: so parlare italiano. Conoscere is for places and "
        "people: conosco questo posto. English has one verb for both; Italian does not."),
}

TRAP = ("<s>lo so</s> conosco questa base",
        "Dalla registrazione. <em>Sapere</em> non si usa per un luogo: si dice "
        "<strong>conosco questa base</strong>. Regola: fatti → sapere, posti e persone → conoscere.",
        "From the recording. Sapere is not used for a place — say conosco questa base. "
        "Facts take sapere; places and people take conoscere.")

RECAP = [
    ("i verbi riflessivi", "mi sveglio, mi connetto — the pronoun goes in front. Today: mi siedo, mi preparo"),
    ("ci vuole tempo", "it agrees with the thing needed: ci vuole tempo, ci vogliono due ore"),
    ("la qualità della vita", "vita has no written accent — but qualità, società, comunità keep theirs"),
]

CLOZE = [
    ("lo", "___ spazzolino, ___ specchio, ___ stadio.", "s + consonante"),
    ("mi", "___ siedo alla scrivania.", "riflessivo"),
    ("alla", "Mi siedo ___ scrivania.", "a + la"),
    ("di", "Non ricordo ___ prendere le medicine.", "prima di un verbo"),
    ("conosco", "___ questo posto.", "luogo, non fatto"),
    ("ci", "Noi ___ incontriamo in centro a Napoli.", "reciproco"),
]

COLD_OPEN_IT = "Mi preparo, mi siedo alla scrivania, e aspetto la lezione di italiano."
COLD_OPEN_EN = "I get ready, I sit at the desk, and I wait for the Italian lesson."

if __name__ == "__main__":
    n = sum(len(r) for _s, _t, r in CHAPTERS)
    print(f"{n} terms · {len(CHAPTERS)} chapters · {len(PEARLS)} pearls · "
          f"{len(ERRORI)} errori · {len(CLOZE)} cloze")
