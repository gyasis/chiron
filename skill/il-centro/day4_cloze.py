#!/usr/bin/env python3
"""The real Day-4 assignment: the cloze dialogue from pages 2–3 of the worksheet.

Every blank is a verb, and between them they cover the whole lesson: regular -are/-ere/-ire,
the reflexives, and the three irregulars (essere, fare, andare, uscire, stare).
`(line, verb, answer, note)` — note only where the form is worth a word.
"""

DIALOGUE = [
    ("BARB", "Ciao Alessandro, come [1] (stare)?", [("1", "stare", "stai", "irregolare")]),
    ("ALE", "Ciao Barbara, buongiorno, come [2] (andare)?", [("2", "andare", "va", "irregolare")]),
    ("BARB", "[3] (andare) bene, sempre di corsa, e tu come [4] (stare)?",
     [("3", "andare", "Va", ""), ("4", "stare", "stai", "")]),
    ("ALE", "Mamma mia, [5] (essere) già così stanco!", [("5", "essere", "sono", "irregolare")]),
    ("BARB", "Così stanco e [6] (essere) solo le 9.30?",
     [("6", "essere", "sono", "le 9.30 è plurale → sono")]),
    ("ALE", "Ultimamente è così la mattina, sempre così.", []),
    ("BARB", "Ma cosa [7] (fare) la mattina, scusa?", [("7", "fare", "fai", "irregolare")]),
    ("ALE", "Guarda, in questo periodo ho preso l'abitudine di fare un po' di sport "
            "prima di andare a scuola.", []),
    ("BARB", "E cosa [8] (fare)? Come [9] (organizzarsi)?",
     [("8", "fare", "fai", ""), ("9", "organizzarsi", "ti organizzi", "riflessivo, regolare")]),
    ("ALE", "Ultimamente [10] (svegliarsi) presto, verso le 6, [11] (lavarsi) la faccia con "
            "dell'acqua fredda, [12] (mettersi) subito i vestiti e le scarpe da corsa, "
            "[13] (fare) un po' di stretching e [14] (andare) subito a correre al parco.",
     [("10", "svegliarsi", "mi sveglio", "regolare"), ("11", "lavarsi", "mi lavo", "regolare"),
      ("12", "mettersi", "mi metto", "regolare"), ("13", "fare", "faccio", "irregolare"),
      ("14", "andare", "vado", "irregolare")]),
    ("BARB", "E poi [15] (uscire)?", [("15", "uscire", "esci", "irregolare — non «usci»")]),
    ("ALE", "Sì, sì, [16] (fare) una piccola corsa, circa 30 minuti.",
     [("16", "fare", "faccio", "")]),
    ("BARB", "Wow, che bravo!", []),
    ("ALE", "Ma sì, niente di eccezionale.", []),
    ("BARB", "Eh… io anche [17] (fare) le stesse cose. [18] (svegliarsi) presto, [19] (lavarsi), "
             "[20] (fare) colazione, [21] (prepararsi), non [22] (truccarsi) perché "
             "[23] (andare) alla stazione in bicicletta.",
     [("17", "fare", "faccio", ""), ("18", "svegliarsi", "Mi sveglio", ""),
      ("19", "lavarsi", "mi lavo", ""), ("20", "fare", "faccio", "fare colazione"),
      ("21", "prepararsi", "mi preparo", "prepar-, non propar-"),
      ("22", "truccarsi", "mi trucco", "non mi trucco = I don't wear make-up"),
      ("23", "andare", "vado", "")]),
    ("ALE", "Ah, complimenti!", []),
    ("BARB", "Anch'io [24] (essere) sportiva, ma per andare alla stazione. [25] (prendere) il "
             "treno e finalmente sul treno [26] (rilassarsi) e qualche volta [27] (addormentarsi).",
     [("24", "essere", "sono", ""), ("25", "prendere", "Prendo", "regolare -ere"),
      ("26", "rilassarsi", "mi rilasso", "regolare"),
      ("27", "addormentarsi", "mi addormento", "regolare")]),
    ("ALE", "Speriamo che [28] (svegliarsi) in tempo.",
     [("28", "svegliarsi", "ti svegli", "dopo «speriamo che» il congiuntivo — qui identico")]),
    ("BARB", "Sì, certo, [29] (svegliarsi) sempre in tempo e [30] (arrivare) finalmente a Milano.",
     [("29", "svegliarsi", "mi sveglio", ""), ("30", "arrivare", "arrivo", "regolare -are")]),
    ("ALE", "Fantastico!", []),
    ("BARB", "Buona giornata allora!", []),
    ("ALE", "Anche a te, buone lezioni!", []),
    ("BARB", "Grazie!", []),
]

# Words you asked for out loud during the two recordings (pain_points: ASKED)
CHIESTE = [
    ("d4-ask-01", "basso", "low", "You asked at 13:20 on Day 3. Also: <i>in basso</i> = down below."),
    ("d4-ask-02", "il divano", "the couch", "Asked at 27:42, Day 3 — and it turned up again in "
     "<i>ci sediamo sul divano</i>."),
    ("d4-ask-03", "il trucco", "the make-up", "Asked at 7:30, Day 4. The verb is "
     "<b>truccarsi</b> — <i>non mi trucco</i>."),
    ("d4-ask-04", "finito", "finished, complete", "Asked at 27:38, Day 4. <i>Ho finito</i> = I've "
     "finished; <i>è finita</i> = it's over."),
    ("d4-ask-05", "formale", "formal", "Asked at 13:49, Day 4 — the register behind <i>Lei</i>."),
]

if __name__ == "__main__":
    blanks = sum(len(b) for _w, _l, b in DIALOGUE)
    verbs = sorted({v for _w, _l, b in DIALOGUE for _n, v, _a, _x in b})
    print(f"{len(DIALOGUE)} lines · {blanks} blanks · {len(verbs)} distinct verbs")
    print("  " + ", ".join(verbs))
    print(f"{len(CHIESTE)} words you asked for")
