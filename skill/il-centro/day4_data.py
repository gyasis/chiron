#!/usr/bin/env python3
"""il centro di italia — Day 4. Data only (R-IC1).

Three sources: the chat log, a 34:48 recording (619 turns, Barbara 332 / Gyasi 287),
and the worksheet «ALESSANDRO E BARBARA: MATTINA» — an attribution exercise the lesson
works through live.

The spine is REGULAR vs IRREGULAR present tense. Her «+» marks the split itself:
mi svegli+o = stem + ending, the regular machine. Against that: esco, vado, faccio.
"""

RECORDING = "audio/registrazione/day4.mp3"

CHAPTERS = [
    ("sec-regolari", "I regolari — radice + desinenza", [
        ("d4-reg-01", "mi sveglio", "mi sveglio", "I wake up",
         "svegli- + -o. Her «+» marks exactly that seam: the stem never moves, the ending does."),
        ("d4-reg-02", "ti svegli", "ti svegli", "you wake up",
         "Same stem, ending -i. This is the whole regular pattern in two words."),
        ("d4-reg-03", "mi lavo", "mi lavo", "I wash",
         "lav- + -o. From the worksheet: «mi lavo la faccia con acqua fredda»."),
        ("d4-reg-04", "mi rilasso", "mi rilasso", "I relax", "rilass- + -o."),
        ("d4-reg-05", "ti organizzi", "ti organizzi", "you get organised",
         "organizz- + -i. Long stem, same two endings."),
        ("d4-reg-06", "mi metto una camicia", "mi metto una camicia", "I put on a shirt",
         "mettersi — an -ere verb, but the endings are just as regular: mett- + -o."),
        ("d4-reg-07", "l'errore", "l'errore", "the mistake",
         "l'errore → gli errori. What this whole lesson is about."),
    ]),
    ("sec-irregolari", "Gli irregolari — uscire, andare", [
        ("d4-irr-01", "esco", "esco", "I go out",
         "USCIRE is irregular: the stem itself changes, usc- → esc-. You cannot build it."),
        ("d4-irr-02", "tu esci", "tu esci", "you go out", "esc- again — still not usc-."),
        ("d4-irr-03", "lei esce, lui esce", "lei esce, lui esce", "she goes out, he goes out",
         "One form for lei AND lui. Italian doesn't mark the gender in the verb."),
        ("d4-irr-04", "noi usciamo la sera", "noi usciamo la sera", "we go out in the evening",
         "And here the stem SNAPS BACK: usc-iamo. Irregular in the singular, regular in noi/voi."),
        ("d4-irr-05", "voi uscite la sera?", "voi uscite la sera?", "do you (pl) go out evenings?",
         "usc-ite. Same snap-back."),
        ("d4-irr-06", "vado", "vado", "I go", "ANDARE: and- → vad-. Another stem you memorise."),
        ("d4-irr-07", "tu vai", "tu vai", "you go", ""),
        ("d4-irr-08", "loro vanno", "loro vanno", "they go",
         "vanno, not «vadono». On the tape you reached for the regular form first."),
        ("d4-irr-09", "io faccio molte domande", "io faccio molte domande", "I ask a lot of questions",
         "FARE: fac-cio. And it's <b>fare</b> una domanda — you MAKE a question, not ask one."),
    ]),
    ("sec-lei", "Lei — il formale", [
        ("d4-lei-01", "Lei esce oggi?", "Lei esce oggi?", "Are you going out today? (formal)",
         "Formal you takes the THIRD person form — identical to lei/lui esce."),
        ("d4-lei-02", "Lei è canadese?", "Lei è canadese?", "Are you Canadian? (formal)", ""),
        ("d4-lei-03", "No, sono statunitense", "No, sono statunitense", "No, I'm American",
         "<b>statunitense</b> is the precise word. <i>Americano</i> covers two continents."),
        ("d4-lei-04", "Lei è il medico di base?", "Lei è il medico di base?",
         "Are you the GP? (formal)", "<b>il medico di base</b> = the family doctor, the GP."),
        ("d4-lei-05", "preferisco parlare con sua madre", "preferisco parlare con sua madre",
         "I prefer to speak with her mother",
         "<b>sua</b> = his/her. <i>Tua</i> would be YOUR mother — the correction you got on the tape."),
    ]),
    ("sec-modali", "Voglio, devo, posso + infinito", [
        ("d4-mod-01", "voglio uscire la sera", "voglio uscire la sera", "I want to go out in the evening",
         "Modal + bare infinitive. Her «+» again: voglio + uscire."),
        ("d4-mod-02", "ma non posso, perché devo studiare", "ma non posso, perché devo studiare",
         "but I can't, because I have to study", "Three modals in one breath."),
        ("d4-mod-03", "voglio imparare", "voglio imparare", "I want to learn", ""),
        ("d4-mod-04", "devo parlare in italiano con lei", "devo parlare in italiano con lei",
         "I have to speak Italian with her", ""),
        ("d4-mod-05", "non voglio parlare con mia moglie",
         "non voglio parlare con mia moglie", "I don't want to speak with my wife",
         "<b>mia moglie</b> — no article before a single family member. Day 1's rule."),
        ("d4-mod-06", "voglio lavorare nella medicina", "voglio lavorare nella medicina",
         "I want to work in medicine", "in + la = nella."),
        ("d4-mod-07", "restiamo a casa", "restiamo a casa", "we stay at home",
         "<b>a casa</b>, no article — a fixed phrase."),
        ("d4-mod-08", "il fine settimana", "il fine settimana", "the weekend",
         "Masculine and invariable: i fine settimana."),
    ]),
    ("sec-lavoro", "La presentazione", [
        ("d4-lav-01", "oggi ho una presentazione", "oggi ho una presentazione",
         "today I have a presentation", ""),
        ("d4-lav-02", "fra 5 ore", "fra cinque ore", "in 5 hours",
         "<b>fra</b> (or <i>tra</i>) for time ahead. Not <i>in</i>."),
        ("d4-lav-03", "ci sono 6 persone nella riunione", "ci sono sei persone nella riunione",
         "there are 6 people in the meeting", "<b>ci sono</b> + plural — Day 2."),
        ("d4-lav-04", "spiegare i dati", "spiegare i dati", "to explain the data",
         "<b>i dati</b> is plural in Italian: i dati sono, never «the data is»."),
        ("d4-lav-05", "i numeri cambiano", "i numeri cambiano", "the numbers change", ""),
        ("d4-lav-06", "fare un compromesso", "fare un compromesso", "to make a compromise",
         "<b>fare</b> again — Italian makes compromises, questions, breakfast."),
        ("d4-lav-07", "la reputazione", "la reputazione", "the reputation", ""),
        ("d4-lav-08", "la voce", "la voce", "the voice",
         "From the tape — you said «la voz». It is <b>la voce</b>."),
    ]),
]

# The worksheet, recorded as data. `who` = how the lesson resolved it; None = not reached.
ESERCIZIO = {
    "title": "ALESSANDRO E BARBARA: MATTINA",
    "task": "Ogni frase: è la mattina di Alessandro o di Barbara?",
    "items": [
        ("Faccio stretching", None, 158),
        ("Faccio colazione", None, None),
        ("Mi addormento", None, None),
        ("Mi lavo la faccia con acqua fredda", None, 99),
        ("Mi lavo", None, 101),
        ("Mi metto i vestiti e le scarpe da corsa", "Alessandro", 225),
        ("Mi rilasso", None, 532),
        ("Mi sveglio in tempo", "Barbara", 598),
        ("Mi sveglio presto", "Alessandro", 220),
        ("Non mi trucco", None, 450),
        ("Prendo il treno", None, 520),
        ("Sono stanco", None, None),
        ("Vado alla stazione in bicicletta", None, None),
        ("Vado a correre al parco", None, 252),
    ],
}

ERRORI = [
    (431.0, "la voz", "la voce", "voz → voce",
     "Spanish leaking in. Italian is <strong>la voce</strong> — and it's feminine."),
    (1465.0, "tua madre", "sua madre", "tua → sua",
     "<em>Tua</em> madre is YOUR mother. Talking about someone else's, you need "
     "<strong>sua</strong> madre — his or her mother."),
    (746.0, "loro vadono", "loro vanno", "andare is irregular",
     "You built it from the regular pattern, which is the right instinct and the wrong verb. "
     "<strong>Andare</strong> has no stem you can build on: vado, vai, va, andiamo, andate, "
     "<strong>vanno</strong>."),
    (442.0, "mi proparo", "mi preparo", "prepar-, not propar-",
     "The stem is <strong>prepar-</strong>. Regular verbs only work if the stem is right."),
]

PEARLS = {
    "sec-regolari": ("pearl-regolari",
        "Un verbo <strong>regolare</strong> è una macchina: la <strong>radice</strong> non cambia "
        "mai, cambia solo la <strong>desinenza</strong>. <em>svegli-</em> + <em>-o</em> → "
        "<em>mi svegli<u>o</u></em>; <em>svegli-</em> + <em>-i</em> → <em>ti svegl<u>i</u></em>. "
        "Impara la radice una volta e hai tutte le persone.",
        "A regular verb is a machine: the STEM never changes, only the ENDING does. Learn the stem "
        "once and you have every person. That is what the + in her notes marks — the seam."),
    "sec-irregolari": ("pearl-irregolari",
        "Un verbo <strong>irregolare</strong> cambia la <strong>radice</strong>: "
        "<em>uscire</em> → <em>esco, esci, esce</em>. Ma attenzione: con <strong>noi</strong> e "
        "<strong>voi</strong> la radice torna normale — <em>usciamo, uscite</em>. "
        "Lo stesso con <em>andare</em>: <em>vado, vai, va</em> ma <em>andiamo, andate</em> — "
        "e poi <em>vanno</em>.",
        "An irregular verb changes its STEM: uscire → esco, esci, esce. But with NOI and VOI the "
        "stem snaps back to normal — usciamo, uscite. Same with andare: vado, vai, va, but "
        "andiamo, andate — then vanno."),
    "sec-lei": ("pearl-lei",
        "Il <strong>Lei</strong> formale usa la <strong>terza persona</strong>, identica a "
        "lei/lui: <em>Lei esce oggi?</em>, <em>Lei è il medico di base?</em>. "
        "Non esiste una forma speciale — si sposta solo la persona.",
        "Formal LEI uses the THIRD person, identical to she/he: Lei esce oggi? There is no special "
        "form — you just move the person."),
    "sec-modali": ("pearl-modali",
        "<strong>Volere, dovere, potere</strong> reggono l'<strong>infinito nudo</strong>: "
        "<em>voglio uscire</em>, <em>devo studiare</em>, <em>non posso venire</em>. "
        "Niente <em>di</em>, niente <em>a</em>. È la stessa struttura dell'inglese "
        "<em>I want to go</em>, ma senza il <em>to</em>.",
        "Volere, dovere and potere take a BARE infinitive: voglio uscire, devo studiare. "
        "No di, no a — and no 'to'."),
}

TRAP = ("<s>loro vadono</s> loro vanno",
        "Dalla registrazione. Hai costruito <em>vadono</em> dalla regola dei verbi regolari — "
        "istinto giusto, verbo sbagliato. <strong>Andare</strong> è irregolare: "
        "<em>vado, vai, va, andiamo, andate, <strong>vanno</strong></em>.",
        "From the recording. You built vadono from the regular pattern — right instinct, wrong "
        "verb. Andare is irregular: vado, vai, va, andiamo, andate, vanno.")

RECAP = [
    ("l'articolo LO", "lo spazzolino, lo stadio — s + consonant, and gli in the plural"),
    ("i riflessivi", "mi siedo, mi preparo — the pronoun in front of the verb"),
    ("sapere / conoscere", "conosco questo posto for a place; so parlare for a skill"),
]

CLOZE = [
    ("esco", "Io ___ la sera con gli amici.", "uscire, irregolare"),
    ("usciamo", "Noi ___ la sera.", "la radice torna"),
    ("vanno", "Loro ___ al parco.", "andare, irregolare"),
    ("esce", "Lei ___ oggi?", "formale = terza persona"),
    ("studiare", "Non posso, devo ___.", "modale + infinito"),
    ("sua", "Preferisco parlare con ___ madre.", "di lei, non di te"),
]

COLD_OPEN_IT = "Mi sveglio presto, mi lavo, mi metto i vestiti — poi esco."
COLD_OPEN_EN = "I wake up early, I wash, I put my clothes on — then I go out."

if __name__ == "__main__":
    n = sum(len(r) for _s, _t, r in CHAPTERS)
    done = sum(1 for _p, w, _t in ESERCIZIO["items"] if w)
    print(f"{n} terms · {len(CHAPTERS)} chapters · {len(PEARLS)} pearls · {len(ERRORI)} errori · "
          f"{len(CLOZE)} cloze · worksheet {done}/{len(ESERCIZIO['items'])} resolved")
