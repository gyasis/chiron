#!/usr/bin/env python3
"""il centro di italia — Day 2. Data only (R-IC1).

(id, display, speak, english, why-note)  grouped by chapter.
`speak` differs where digits or notation must become words.
"""

CHAPTERS = [
    ("chapter-1", "Verbi riflessivi", [
        ("d2-rif-01", "svegliarsi", "svegliarsi", "to wake up",
         "The -si on the end IS the reflexive marker. Strip it, conjugate, and move the pronoun in front."),
        ("d2-rif-02", "mi sveglio", "mi sveglio", "I wake up",
         "mi sveglio, ti svegli, si sveglia. The pronoun goes BEFORE the verb, never attached."),
        ("d2-rif-03", "mi sveglio alle 6.15", "mi sveglio alle sei e un quarto",
         "I wake up at 6:15", "alle for the time — the same rule as Day 1."),
        ("d2-rif-04", "la mia routine", "la mia routine", "my routine",
         "Borrowed from French, invariable: la routine, le routine."),
        ("d2-rif-05", "connettersi", "connettersi", "to connect (oneself)",
         "Also reflexive. Note the double t: connettersi, mi connetto."),
        ("d2-rif-06", "mi connetto con gli USA", "mi connetto con gli USA",
         "I connect with the USA", "gli USA is masculine plural — gli, not i, before a vowel-ish sound."),
    ]),
    ("chapter-2", "Salute e medicina", [
        ("d2-med-01", "il futuro della medicina è digitale", "il futuro della medicina è digitale",
         "the future of medicine is digital", "di + la = della. digitale is one form for both genders."),
        ("d2-med-02", "non ci sono giovani medici italiani", "non ci sono giovani medici italiani",
         "there are no young Italian doctors",
         "ci sono for plural — c'è for singular. Adjectives follow: medici italiani."),
        ("d2-med-03", "un continente vecchio", "un continente vecchio", "an old continent",
         "vecchio keeps the hard k sound: VEK-kio."),
        ("d2-med-04", "le malattie", "le malattie", "illnesses, diseases",
         "la malattia → le malattie. Feminine -ia becomes -ie."),
        ("d2-med-05", "i bambini obesi", "i bambini obesi", "obese children",
         "obeso → obesi. The adjective agrees in gender AND number."),
        ("d2-med-06", "la salute", "la salute", "health",
         "Feminine despite the -e ending. Salute! is also what you say when someone sneezes."),
        ("d2-med-07", "le droghe illegali", "le droghe illegali", "illegal drugs",
         "la droga → le droghe — the h keeps the g hard."),
    ]),
    ("chapter-3", "Dieta e longevità", [
        ("d2-die-01", "la dieta mediterranea", "la dieta mediterranea", "the Mediterranean diet",
         "Adjective after the noun, agreeing: dieta mediterranea."),
        ("d2-die-02", "i legumi", "i legumi", "pulses, legumes",
         "FALSE FRIEND — not 'legumes' as in vegetables generally. Beans, lentils, chickpeas."),
        ("d2-die-03", "i carboidrati", "i carboidrati", "carbohydrates", "il carboidrato → i carboidrati."),
        ("d2-die-04", "il Cilento", "il Cilento", "the Cilento",
         "A region south of Salerno — where the Mediterranean diet was first described."),
        ("d2-die-05", "i centenari", "i centenari", "centenarians", "il centenario → i centenari."),
        ("d2-die-06", "gli over 100", "gli over cento", "the over-100s",
         "A live anglicism. Italian borrows 'over' and keeps it invariable."),
        ("d2-die-07", "il cibo locale", "il cibo locale", "local food",
         "locale is one form for both genders — il cibo locale, la cucina locale."),
        ("d2-die-08", "una comunità", "una comunità", "a community",
         "Ends in accented -à, so it NEVER changes: una comunità, due comunità."),
        ("d2-die-09", "Okinawa", "Okinawa", "Okinawa", "Another blue zone, alongside the Cilento."),
        ("d2-die-10", "la moringa", "la moringa", "moringa", "One of the imported 'superfood' trends."),
        ("d2-die-11", "l'açaí", "l'açaí", "açaí", "Borrowed from Portuguese; the accent keeps the stress final."),
        ("d2-die-12", "gustare il cibo", "gustare il cibo", "to savour food",
         "gustare is to taste with pleasure — not assaggiare, which is to sample."),
    ]),
    ("chapter-4", "Società ed economia", [
        ("d2-soc-01", "i soldi", "i soldi", "the money",
         "Always PLURAL in Italian: i soldi sono, never il soldo."),
        ("d2-soc-02", "l'energia", "l'energia", "the energy", "Feminine: l'energia, le energie."),
        ("d2-soc-03", "una regione ricca", "una regione ricca", "a rich region",
         "ricco → ricca. The double c stays hard before a."),
        ("d2-soc-04", "il sistema americano", "il sistema americano", "the American system",
         "il sistema ends in -a but is MASCULINE — like il regista on Day 1. i sistemi."),
        ("d2-soc-05", "lo status sociale", "lo status sociale", "social status",
         "lo before s+consonant — lo status, lo studente, lo sport."),
        ("d2-soc-06", "una società competitiva", "una società competitiva", "a competitive society",
         "società is invariable — la società, le società."),
        ("d2-soc-07", "l'idea è: più lavori e più hai successo",
         "l'idea è: più lavori e più hai successo",
         "the idea is: the more you work, the more successful you are",
         "più… più… — the correlative. No 'che' anywhere; just più + verb, e, più + verb."),
        ("d2-soc-08", "la qualità della vita", "la qualità della vita", "quality of life",
         "vita has NO accent. And qualità, ending in -à, never changes in the plural."),
        ("d2-soc-09", "le vacanze", "le vacanze", "the holidays",
         "Usually plural: andare in vacanza, but le vacanze estive."),
        ("d2-soc-10", "l'ossessione per la sicurezza", "l'ossessione per la sicurezza",
         "the obsession with safety", "ossessione takes PER, not 'con' or 'di'."),
        ("d2-soc-11", "l'educazione", "l'educazione", "upbringing, manners",
         "FALSE FRIEND — closer to manners/upbringing than schooling. Schooling is l'istruzione."),
    ]),
    ("chapter-5", "Abitudini e tempo", [
        ("d2-abi-01", "l'abitudine", "l'abitudine", "the habit",
         "Feminine: l'abitudine, le abitudini."),
        ("d2-abi-02", "il trend", "il trend", "the trend", "Borrowed and invariable: i trend."),
        ("d2-abi-03", "ci vuole tempo", "ci vuole tempo", "it takes time",
         "Impersonal ci vuole + singular; ci vogliono + plural. Ci vogliono due ore."),
        ("d2-abi-04", "in realtà", "in realtà", "actually, in fact",
         "FALSE FRIEND — it means 'actually', not 'in reality'."),
        ("d2-abi-05", "undici, dodici, tredici", "undici, dodici, tredici", "eleven, twelve, thirteen",
         "11–16 end in -dici. From 17 it flips: diciassette, diciotto, diciannove."),
        ("d2-abi-06", "un audio", "un audio", "an audio message",
         "Invariable: un audio, due audio. Mandare un audio = send a voice note."),
        ("d2-abi-07", "gli errori", "gli errori", "mistakes", "l'errore → gli errori. gli before a vowel."),
        ("d2-abi-08", "una richiesta", "una richiesta", "a request",
         "From chiedere. fare una richiesta = to make a request."),
    ]),
]

# Grammar pearls — ITALIAN body, English in data-en (skeleton reveal-EN contract)
PEARLS = {
    "chapter-1": ("pearl-riflessivi",
        "Un verbo <strong>riflessivo</strong> finisce in <em>-si</em>: <em>svegliarsi</em>, "
        "<em>connettersi</em>. Per coniugarlo si toglie il <em>-si</em> e il pronome va "
        "<strong>davanti</strong> al verbo: <em>mi sveglio, ti svegli, si sveglia, ci svegliamo</em>. "
        "Mai attaccato al verbo coniugato.",
        "A reflexive verb ends in -si: svegliarsi, connettersi. To conjugate it you drop the -si and "
        "the pronoun moves IN FRONT of the verb: mi sveglio, ti svegli, si sveglia, ci svegliamo. "
        "It is never attached to the conjugated verb."),
    "chapter-3": ("pearl-invariabili",
        "I nomi che finiscono in <strong>-à accentata</strong> non cambiano mai al plurale: "
        "<em>una comunità, due comunità</em>; <em>la qualità, le qualità</em>. "
        "L'articolo fa tutto il lavoro.",
        "Nouns ending in an accented -à never change in the plural: una comunità, due comunità; "
        "la qualità, le qualità. The article does all the work of showing number."),
    "chapter-4": ("pearl-piu-piu",
        "<strong>Più… più…</strong> è la costruzione correlativa: "
        "<em>più lavori e più hai successo</em>. Non serve <em>che</em>: solo "
        "<strong>più</strong> + verbo, <em>e</em>, <strong>più</strong> + verbo. "
        "Attenzione anche a <em>il sistema</em>: finisce in <em>-a</em> ma è <strong>maschile</strong>.",
        "Più… più… is the correlative construction: the more you work, the more successful you are. "
        "No 'che' is needed — just più + verb, e, più + verb. Also note il sistema: it ends in -a "
        "but is masculine, exactly like il regista."),
    "chapter-5": ("pearl-ci-vuole",
        "<strong>Ci vuole</strong> significa <em>occorre, serve</em>. Concorda con la cosa che serve: "
        "<em>ci vuole tempo</em> (singolare), ma <em>ci vogliono due ore</em> (plurale). "
        "Non è la persona a decidere il verbo, è la cosa.",
        "Ci vuole means 'it takes / one needs'. It agrees with the THING needed, not the person: "
        "ci vuole tempo (singular) but ci vogliono due ore (plural)."),
}

# The correction of the day (Day 1's was riunioni di lavoro)
TRAP = ("la qualità della <s>vità</s> vita",
        "Il transcript scrive <em>della vità</em>. La parola giusta è <strong>vita</strong>, "
        "senza accento. L'accento cade sulla <em>i</em> ma non si scrive.",
        "The transcript shows della vità. The word is vita, with no written accent — the stress "
        "falls on the i but Italian does not write it.")

# R-IC9 — what Day 1 said to go and study
RECAP = [
    ("riunioni di lavoro", "lavoro stays singular in this fixed phrase — lavori means roadworks"),
    ("la gente è / viaggia / era", "a singular verb, always — never sono or viaggiano"),
    ("al presente", "abito qui da tre anni — Italian keeps the present with da"),
]

ALL = [(pid, disp, speak, en, note, sid, title)
       for sid, title, rows in CHAPTERS for (pid, disp, speak, en, note) in rows]

if __name__ == "__main__":
    print(f"{len(ALL)} terms across {len(CHAPTERS)} chapters · {len(PEARLS)} pearls")
    for sid, t, rows in CHAPTERS:
        print(f"  {sid}  {t:24} {len(rows):2} terms"
              f"{'  + pearl' if sid in PEARLS else ''}")


CLOZE = [
    ("mi", "___ sveglio alle sei e un quarto.", "riflessivo"),
    ("ci", "___ vuole tempo.", "impersonale"),
    ("vita", "la qualit\u00e0 della ___", "senza accento"),
    ("soldi", "I ___ sono importanti.", "sempre plurale"),
    ("sono", "Non ci ___ giovani medici italiani.", "plurale"),
    ("pi\u00f9", "___ lavori e ___ hai successo.", "correlativo"),
]

COLD_OPEN_IT = "Mi sveglio alle sei e un quarto e mi connetto con gli USA."
COLD_OPEN_EN = "I wake up at six fifteen and connect with the USA."
