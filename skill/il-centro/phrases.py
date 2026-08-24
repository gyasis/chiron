#!/usr/bin/env python3
"""Canonical phrase manifest for the Barbara 2026-08-03 lesson.

One entry per clip. `display` is what appears on the page / Anki card; `speak` is what
Lucrezia actually says (separators become pauses, digits become words). `anki` marks the
48 phrases that map 1:1 onto the existing Anki notes so audio can be attached by Front.
"""

# id, display, speak, anki
PHRASES = [
    # ---------- the 48 Anki fronts ----------
    ("classe-01", "Da quanto tempo abiti in Italia?", "Da quanto tempo abiti in Italia?", True),
    ("classe-02", "Hai tempo per scrivere una presentazione?", "Hai tempo per scrivere una presentazione?", True),
    ("classe-03", "Voglio praticare la pronuncia.", "Voglio praticare la pronuncia.", True),
    ("classe-04", "domandare", "domandare", True),
    ("classe-05", "un consiglio", "un consiglio", True),
    ("classe-06", "una presentazione al presente", "una presentazione al presente", True),
    ("classe-07", "la mia vita in Italia", "la mia vita in Italia", True),
    ("classe-08", "Ci vediamo domani alla stessa ora, allo stesso posto.",
     "Ci vediamo domani alla stessa ora, allo stesso posto.", True),
    ("classe-09", "alle 9.55", "alle nove e cinquantacinque", True),

    ("tempo-01", "Adesso sono le 4.36 di mattina.",
     "Adesso sono le quattro e trentasei di mattina.", True),
    ("tempo-02", "Qui sono le 15.00 di pomeriggio.",
     "Qui sono le quindici, le tre di pomeriggio.", True),
    ("tempo-03", "La prima riunione comincia alle 9.00.",
     "La prima riunione comincia alle nove.", True),
    ("tempo-04", "Ho molte riunioni di lavoro.", "Ho molte riunioni di lavoro.", True),
    ("tempo-05", "Sono le due. / È l'una.", "Sono le due. È l'una.", True),

    ("gram-01", "La gente è pazza.", "La gente è pazza.", True),
    ("gram-02", "La gente a Nord viaggia a Sud.", "La gente a Nord viaggia a Sud.", True),
    ("gram-03", "La gente era ottimista.", "La gente era ottimista.", True),
    ("gram-04", "Non c'è una regola.", "Non c'è una regola.", True),
    ("gram-05", "la regola / le regole", "la regola, le regole", True),
    ("gram-06", "Devo studiare più italiano.", "Devo studiare più italiano.", True),
    ("gram-07", "Lei non ha pazienza.", "Lei non ha pazienza.", True),
    ("gram-08", "Lui si innamora di Sofia Loren.", "Lui si innamora di Sofia Loren.", True),
    ("gram-09", "Mi piace guardare il cinema italiano.", "Mi piace guardare il cinema italiano.", True),
    ("gram-10", "fare il bagno", "fare il bagno", True),
    ("gram-11", "nel fiume", "nel fiume", True),
    ("gram-12", "nel lago", "nel lago", True),
    ("gram-13", "nella fontana", "nella fontana", True),
    ("gram-14", "la vita degli anni '60", "la vita degli anni sessanta", True),
    ("gram-15", "la generazione di mia moglie", "la generazione di mia moglie", True),
    ("gram-16", "un'attrice internazionale", "un'attrice internazionale", True),

    ("tur-01", "Il turismo è importante per l'Italia.", "Il turismo è importante per l'Italia.", True),
    ("tur-02", "un fenomeno italiano", "un fenomeno italiano", True),
    ("tur-03", "il turismo selvaggio", "il turismo selvaggio", True),
    ("tur-04", "Ferragosto", "Ferragosto", True),
    ("tur-05", "il governo", "il governo", True),
    ("tur-06", "il rischio", "il rischio", True),
    ("tur-07", "Fare il bagno nella fontana di Trevi",
     "Fare il bagno nella fontana di Trevi.", True),
    ("tur-08", "a Nord / a Sud", "a Nord, a Sud", True),

    ("cin-01", "in bianco e nero", "in bianco e nero", True),
    ("cin-02", "il regista", "il regista", True),
    ("cin-03", "l'attore / l'attrice", "l'attore, l'attrice", True),
    ("cin-04", "Il Sorpasso", "Il Sorpasso", True),
    ("cin-05", "Dino Risi", "Dino Risi", True),
    ("cin-06", "Vittorio Gassman", "Vittorio Gassman", True),
    ("cin-07", "1962", "millenovecentosessantadue", True),
    ("cin-08", "il boom economico", "il boom economico", True),
    ("cin-09", "il film cult della Dolce Vita", "il film cult della Dolce Vita", True),
    ("cin-10", "Ieri, Oggi, Domani", "Ieri, Oggi, Domani", True),

    # ---------- inline examples on the page (not Anki notes) ----------
    ("ex-01", "la regola < le regole", "la regola, le regole", False),
    ("ex-02", "l'attore < l'attrice", "l'attore, l'attrice", False),
    ("ex-03", "Dino Risi < il regista", "Dino Risi, il regista", False),
    ("ex-04", "devo studiare + italiano", "devo studiare più italiano", False),
    ("ex-05", "mi piace+ guardare", "mi piace più guardare", False),
    ("ex-06", "le persone sono pazze", "le persone sono pazze", False),
    ("ex-07", "abito qui da tre anni", "abito qui da tre anni", False),
    ("ex-08", "fare una domanda", "fare una domanda", False),
    ("ex-09", "È mezzogiorno. / È mezzanotte.", "È mezzogiorno. È mezzanotte.", False),
    ("ex-10", "di mattina · di pomeriggio · di sera · di notte",
     "di mattina, di pomeriggio, di sera, di notte", False),
    ("ex-11", "alle 9.00 · alle 9.55 · alla stessa ora",
     "alle nove, alle nove e cinquantacinque, alla stessa ora", False),
    ("ex-12", "i registi / le registe", "i registi, le registe", False),
    ("ex-13", "gli attori / le attrici", "gli attori, le attrici", False),
    ("ex-14", "i fenomeni", "i fenomeni", False),
    ("ex-15", "i rischi", "i rischi", False),
    ("ex-16", "i consigli", "i consigli", False),
    ("ex-17", "lavori in corso", "lavori in corso", False),
    ("ex-18", "orario di lavoro", "orario di lavoro", False),
    ("ex-19", "avere fame, sete, sonno, ragione, paura",
     "avere fame, avere sete, avere sonno, avere ragione, avere paura", False),
    ("ex-20", "un attore", "un attore", False),

    # ---------- the homework scaffold ----------
    ("sca-01", "Abito in Italia da tre anni.", "Abito in Italia da tre anni.", False),
    ("sca-02", "Ogni giorno ho molte riunioni di lavoro.",
     "Ogni giorno ho molte riunioni di lavoro.", False),
    ("sca-03", "Devo studiare più italiano perché voglio parlare bene.",
     "Devo studiare più italiano perché voglio parlare bene.", False),
    ("sca-04", "Mi piace guardare il cinema italiano in bianco e nero.",
     "Mi piace guardare il cinema italiano in bianco e nero.", False),
    ("sca-05", "Il mio film preferito è Il Sorpasso, del regista Dino Risi.",
     "Il mio film preferito è Il Sorpasso, del regista Dino Risi.", False),
]

VOICE = "lucrezia_italian"
LANG = "it"
SLUG = "barbara-2026-08-03"

if __name__ == "__main__":
    n_anki = sum(1 for p in PHRASES if p[3])
    print(f"{len(PHRASES)} clips total · {n_anki} map to Anki notes · {len(PHRASES)-n_anki} page-only")
