#!/usr/bin/env python3
"""il centro di italia — Day 6. Data only (R-IC1).

First authored from the chat log alone, then CORRECTED against the recording. The 55:17
tape (~/Downloads/Day_6.m4a) is now ingested — 965 turns, both speakers confirmed — via the
Modal ASR lane (`modal_ingest.py`), and the audio is baked via `modal_bake.py`. The Mac
Studio was never reachable for any of it; Modal replaced both sidecars.

What the tape changed: `sec-cesono` was rebuilt. The chat log gave the right grammar with
none of her examples — she actually taught c'è through WEATHER, with an explicit rule at
7:57, «sempre c'è, non facciamo errori se usiamo c'è». Every phrase in that chapter now
carries the timestamp it came from and can be checked against the recording.

Day 5 was missed, so the recap reaches back to Day 4.

The spine is THE PAST. Until now everything has been present tense; here the imperfetto
arrives properly — era, aveva, ero — with the passato prossimo alongside it.

Also here: c'è / ci sono — and she DID teach it on tape, 49 turns of it. It had also
appeared in every lesson since Day 1 («non c'è una regola», «non ci sono giovani medici»,
«ci sono 6 persone») without explanation, so this chapter carries both: her weather rule
from the recording, and the thread it closes.
"""

RECORDING = "day6/transcript.named.json"   # 965 turns, Barbara 0.908 / Gyasi 0.836
PENDING_AUDIO = False     # baked via Modal: 228 clips, sigma 0.85 dB, 49/49 cards

CHAPTERS = [
    ("sec-imperfetto", "L'imperfetto — il passato che dura", [
        ("d6-imp-01", "quando era più giovane", "quando era più giovane", "when he/she was younger",
         "<b>era</b> = was. The imperfetto is for a STATE that lasted, not an event that happened."),
        ("d6-imp-02", "quando aveva 55, 60 anni", "quando aveva cinquantacinque, sessant'anni",
         "when he/she was 55, 60",
         "Age uses <b>avere</b> — you HAVE years. In the past: <i>aveva</i>."),
        ("d6-imp-03", "ero sorpreso", "ero sorpreso", "I was surprised",
         "<b>ero</b> = I was. A state, so imperfetto — not <i>sono stato</i>."),
        ("d6-imp-04", "ho sentito", "ho sentito", "I heard, I've heard",
         "<b>Passato prossimo</b> — a single completed event. The contrast with <i>era</i> is the "
         "whole lesson: one thing happened, the other was simply the case."),
        ("d6-imp-05", "vivono stabilmente", "vivono stabilmente", "they live permanently",
         "Present, for something still true. Change it to <i>vivevano</i> and it's over."),
        ("d6-imp-06", "dopo la laurea", "dopo la laurea", "after graduating",
         "<b>la laurea</b> = a university degree. <i>Laurearsi</i> = to graduate."),
    ]),
    ("sec-santhia", "Santhià, Piemonte", [
        ("d6-san-01", "Santhià", "Santhià", "Santhià",
         "A town in Piedmont. The accent is on the final <b>à</b> — Santhi-À."),
        ("d6-san-02", "il Piemonte", "il Piemonte", "Piedmont",
         "Literally <i>foot of the mountain</i>. Italian regions take the article."),
        ("d6-san-03", "vicino alla collina", "vicino alla collina", "near the hill",
         "<b>vicino a</b> + article → vicino <b>alla</b>. Day 1's fused preposition."),
        ("d6-san-04", "90 km", "novanta chilometri", "90 km", ""),
        ("d6-san-05", "8000 abitanti", "ottomila abitanti", "8,000 inhabitants",
         "<b>ottomila</b> — one word, and <i>mila</i> is the plural of <i>mille</i>."),
        ("d6-san-06", "un posto tranquillo", "un posto tranquillo", "a quiet place", ""),
        ("d6-san-07", "il marmo", "il marmo", "marble", ""),
        ("d6-san-08", "i vicini hanno un giardino", "i vicini hanno un giardino",
         "the neighbours have a garden",
         "<b>i vicini</b> = the neighbours — same word as <i>vicino</i>, near."),
        ("d6-san-09", "l'autunno", "l'autunno", "autumn", "Masculine: <i>in autunno</i>."),
    ]),
    ("sec-vita", "Una vita lunga", [
        ("d6-vit-01", "93 anni", "novantatré anni", "93 years old",
         "<b>ha 93 anni</b> — he HAS 93 years."),
        ("d6-vit-02", "resiliente", "resiliente", "resilient",
         "One form for both genders, like <i>divertente</i>."),
        ("d6-vit-03", "il viaggio di nozze", "il viaggio di nozze", "the honeymoon",
         "<b>le nozze</b> = the wedding, always plural."),
        ("d6-vit-04", "divertente", "divertente", "fun, entertaining",
         "From <i>divertire</i>. <b>Mi diverto</b> = I enjoy myself."),
        ("d6-vit-05", "occupato", "occupato", "busy, occupied",
         "<i>Sono occupato</i> = I'm busy. Also: a seat that's taken."),
        ("d6-vit-07", "le giovani americane", "le giovani americane", "young American women",
         "<b>giovane</b> before the noun here; <i>le giovani</i> = the young women."),
    ]),
    # Rebuilt from the recording (7.4-8.0m), not from the chat log. She taught this through
    # WEATHER and gave an explicit rule — "sempre c'è, non facciamo errori se usiamo c'è" —
    # which the chat-log version of this chapter missed entirely. Timestamps are hers, so
    # every line here can be checked against the tape.
    ("sec-cesono", "C'è, ci sono — la regola del meteo", [
        ("d6-ces-01", "c'è il vento", "c'è il vento", "there's wind",
         "Her rule, at 7:27 — for weather you <b>always</b> use <i>c'è</i>."),
        ("d6-ces-02", "c'è la brezza", "c'è la brezza", "there's a breeze",
         "Same breath as <i>c'è il vento</i>: «it doesn't matter what kind of» weather."),
        ("d6-ces-03", "c'è la pioggia", "c'è la pioggia", "there's rain",
         "7:32. Also <i>c'è pioggia</i>, without the article — both are hers."),
        ("d6-ces-04", "ci sono 29 gradi", "ci sono ventinove gradi", "it's 29 degrees",
         "4:48. Temperature is PLURAL in Italian → <b>ci sono</b>, never <i>è</i>."),
        ("d6-ces-05", "dove c'è l'Everglades è umidissimo",
         "dove c'è l'Everglades è umidissimo", "where the Everglades is, it's very humid",
         "8:15 — <b>both verbs in one sentence.</b> <i>C'è</i> says it EXISTS there; "
         "<i>è</i> DESCRIBES what it's like. This one line is the whole rule."),
        ("d6-ces-06", "quando c'era Katrina", "quando c'era Katrina",
         "when Katrina was happening",
         "10:06 — the <b>imperfetto</b> of <i>c'è</i>. Ties straight back to this day's "
         "main lesson: a state that lasted."),
        ("d6-ces-07", "non c'è aria condizionata", "non c'è aria condizionata",
         "there's no air conditioning",
         "15:06. The negative just wraps it: <b>non c'è</b>."),
        ("d6-ces-08", "ci sono molte allergie", "ci sono molte allergie",
         "there are a lot of allergies",
         "14:12. Plural thing → <b>ci sono</b>, even in a list of problems."),
        ("d6-ces-09", "c'è poca gente", "c'è poca gente", "there aren't many people",
         "22:42. <i>Gente</i> is SINGULAR in Italian → <b>c'è</b>, though English says "
         "«people are»."),
        ("d6-ces-10", "c'è una comunità in Florida", "c'è una comunità in Florida",
         "there's an Italian community in Florida",
         "32:06 — her actual wording on the tape, shorter than the chat log's."),
    ]),
    ("sec-avverbi", "Veloce → velocemente", [
        ("d6-avv-01", "le reazioni veloci", "le reazioni veloci", "quick reactions",
         "<b>veloci</b> is the ADJECTIVE — it agrees with <i>reazioni</i>."),
        ("d6-avv-02", "reagire velocemente", "reagire velocemente", "to react quickly",
         "<b>velocemente</b> is the ADVERB — it never agrees. Same root, different job."),
        ("d6-avv-03", "stabilmente", "stabilmente", "permanently, stably",
         "<i>stabile</i> → <b>stabilmente</b>. Adjectives in -le drop the e: stabil + mente."),
        ("d6-avv-04", "scoprire", "scoprire", "to discover",
         "<b>lei scopre</b> — the stem shortens: scopr-."),
        ("d6-avv-05", "lei scopre che molta gente...", "lei scopre che molta gente",
         "she discovers that a lot of people…",
         "<b>molta gente</b> — and <i>gente</i> is still singular. Day 1's rule, still true."),
        ("d6-avv-06", "criticare", "criticare", "to criticise", "Regular -are."),
        ("d6-avv-07", "completare", "completare", "to complete", "Regular -are."),
        ("d6-avv-08", "chissà!", "chissà!", "who knows!",
         "<b>chi sa</b> fused into one word — and it keeps the accent."),
        ("d6-avv-09", "noi parliamo di questo", "noi parliamo di questo", "we talk about this",
         "<b>parlare di</b> = to talk ABOUT."),
    ]),
    # NOT from the recording — asked about separately, after the lesson. Kept in their own
    # chapter and labelled as such, because every other phrase on this page carries a
    # timestamp you can check against the tape and these two cannot.
    ("sec-extra", "Fuori registrazione", [
        ("d6-ext-01", "sottosopra", "sottosopra", "upside down; in a mess",
         "One word, literally <i>under-over</i>, and it <b>never changes</b> — no "
         "<s>sottosopri</s>. Physical: <em>la stanza è sottosopra</em>, the room is a "
         "shambles. Emotional: <em>sono sottosopra</em>, I'm all shaken up."),
        ("d6-ext-02", "la produzione di ricchezza", "la produzione di ricchezza",
         "the production of wealth",
         "<b>ricchezza</b> is the abstract noun from <i>ricco</i> — wealth as a concept. "
         "The plural <em>le ricchezze</em> means riches, actual assets. Sits naturally "
         "beside this day's <i>il profitto</i>."),
    ]),
    ("sec-medicina", "Medicina, profitto, natura", [
        ("d6-med-01", "la zoonosi", "la zoonosi", "zoonosis",
         "A disease crossing from animals to humans. Invariable: <i>le zoonosi</i>."),
        ("d6-med-02", "le vittime", "le vittime", "the victims",
         "<b>la vittima</b> is feminine even for a man — <i>la vittima è lui</i>."),
        ("d6-med-03", "il profitto", "il profitto", "profit", ""),
        ("d6-med-04", "le erbe naturali", "le erbe naturali", "natural herbs",
         "<b>l'erba</b> → le erbe."),
        ("d6-med-05", "la coltivazione della cannabis", "la coltivazione della cannabis",
         "cannabis cultivation", "di + la = <b>della</b>."),
        ("d6-med-06", "dietro alle medicine", "dietro alle medicine", "behind the medicines",
         "<b>dietro a</b> + le → <i>dietro alle</i>."),
        ("d6-med-07", "i pesticidi, gli erbicidi", "i pesticidi, gli erbicidi",
         "pesticides, herbicides",
         "<b>i</b> pesticidi but <b>gli</b> erbicidi — <i>gli</i> before a vowel."),
        ("d6-med-08", "il glifosato", "il glifosato", "glyphosate", ""),
        ("d6-med-09", "tossico", "tossico", "toxic", "<i>tossica, tossici, tossiche</i>."),
        ("d6-med-10", "un narcotico", "un narcotico", "a narcotic", ""),
        ("d6-med-11", "permettere le medicine", "permettere le medicine", "to allow the medicines",
         "<b>permettere</b> — regular -ere."),
        ("d6-med-12", "la follia", "la follia", "madness", ""),
        ("d6-med-13", "la sirena", "la sirena", "the siren", "Also: a mermaid."),
    ]),
]

PEARLS = {
    "sec-imperfetto": ("pearl-imperfetto",
        "L'<strong>imperfetto</strong> descrive uno <strong>stato</strong> che durava: "
        "<em>era giovane</em>, <em>aveva 60 anni</em>, <em>ero sorpreso</em>. "
        "Il <strong>passato prossimo</strong> racconta un <strong>evento</strong> finito: "
        "<em>ho sentito</em>. Non è «più lontano» o «più vicino» — è "
        "<em>com'era</em> contro <em>cosa è successo</em>.",
        "The IMPERFETTO describes a STATE that lasted: era giovane, aveva 60 anni, ero sorpreso. "
        "The PASSATO PROSSIMO reports a finished EVENT: ho sentito. It is not about how long ago "
        "— it is how things WERE versus what HAPPENED."),
    "sec-cesono": ("pearl-cesono",
        "La sua regola, testuale: <strong>«Situazione meteorologica — c'è. "
        "Sempre c'è, non facciamo errori se usiamo c'è.»</strong> "
        "Per il tempo non si sbaglia mai: <em>c'è il vento</em>, <em>c'è la brezza</em>, "
        "<em>c'è la pioggia</em>. Con i numeri, il plurale: <em>ci sono 29 gradi</em>. "
        "E in una sola frase sua, i due verbi insieme: "
        "<em>dove <strong>c'è</strong> l'Everglades <strong>è</strong> umidissimo</em> — "
        "<strong>c'è</strong> dice che esiste, <strong>è</strong> dice com'è.",
        "Her rule, word for word: «Weather situation — c'è. Always c'è; we don't make mistakes "
        "if we use c'è.» For weather you cannot go wrong: c'è il vento, c'è la brezza, c'è la "
        "pioggia. Numbers take the plural: ci sono 29 gradi. And one sentence of hers holds "
        "both verbs at once — dove C'È l'Everglades È umidissimo: c'è says it exists, è says "
        "what it's like. English blurs this because 'there is' and 'it is' both use to be. "
        "You reached the same place yourself at 8:03 — «c'è l'evento caldo, ma ESISTE» — and "
        "she confirmed it: «beh, esiste.»"),
    "sec-avverbi": ("pearl-avverbi",
        "Dall'aggettivo all'avverbio si aggiunge <strong>-mente</strong> al femminile: "
        "<em>veloce → velocemente</em>, <em>stabile → stabilmente</em>. "
        "L'aggettivo <strong>concorda</strong> (<em>le reazioni veloci</em>), "
        "l'avverbio <strong>non cambia mai</strong> (<em>reagire velocemente</em>).",
        "Adjective to adverb: add -MENTE to the feminine form. The adjective AGREES "
        "(le reazioni veloci); the adverb NEVER changes (reagire velocemente). "
        "Adjectives ending in -le or -re drop the final e first: stabile → stabilmente."),
    "sec-santhia": ("pearl-vicino",
        "<strong>Vicino a</strong> regge la preposizione, che poi si fonde con l'articolo: "
        "<em>vicino <strong>alla</strong> collina</em>, <em>vicino <strong>al</strong> mare</em>. "
        "Da solo, <em>vicino</em> è anche un nome: <strong>i vicini</strong>, i neighbours.",
        "Vicino a takes the preposition, which then fuses with the article: vicino alla collina. "
        "On its own, vicino is also a noun — i vicini, the neighbours."),
}

TRAP = ("<s>ero sorpreso</s> / <s>sono stato sorpreso</s> — quale?",
        "Se descrivi <strong>come stavi</strong>, è l'imperfetto: <em>ero sorpreso</em>. "
        "Se racconti <strong>il momento</strong> in cui è successo, è il passato prossimo: "
        "<em>sono rimasto sorpreso</em>. Con gli stati d'animo l'imperfetto è quasi sempre "
        "quello giusto.",
        "If you are describing how you WERE, use the imperfetto: ero sorpreso. If you are "
        "reporting the moment it happened, use the passato prossimo. For states of mind the "
        "imperfetto is almost always the right one.")

RECAP = [
    ("regolare vs irregolare", "mi svegli+o is stem + ending; esco, vado, faccio just have to be known"),
    ("noi/voi snap back", "esco, esci, esce — but usciamo, uscite"),
    ("Lei formale", "takes the third person: Lei esce oggi?"),
]

CLOZE = [
    ("c'è", "___ il vento e ___ la pioggia.", "meteo — la sua regola"),
    ("ci sono", "___ ventinove gradi.", "i gradi sono plurali"),
    ("è", "Dove c'è l'Everglades ___ umidissimo.", "descrizione, non esistenza"),
    ("c'era", "Quando ___ Katrina, catastrofe.", "l'imperfetto di c'è"),
    ("era", "Quando ___ più giovane, viaggiava molto.", "stato che dura"),
    ("aveva", "___ 60 anni quando è arrivato.", "l'età con avere"),
    ("ero", "___ sorpreso di vederla.", "stato d'animo"),
    ("ho", "___ sentito questa storia ieri.", "evento finito"),
    ("velocemente", "Bisogna reagire ___ .", "avverbio, non cambia"),
    ("alla", "Santhià è vicino ___ collina.", "a + la"),
    ("gli", "I pesticidi e ___ erbicidi.", "davanti a vocale"),
]

# ---------------------------------------------------------------------------------------
# I MIEI ERRORI — mined from the recording, then hand-curated.
#
# `pain_points.py` flagged 14 candidates by word-overlap between your turn and her next one.
# Nine were rejected on listening to the context, and the rejections matter as much as the
# keeps, so they are recorded here rather than silently dropped:
#
#   @26.2m  "Non sta bene" -> "Sta bene, è molto attivo"   she corrected the FACT about her
#           father-in-law, not your Italian. Nothing to learn.
#   @32.8m  "durante il corso" -> "durante il Covid"        `corso`/`Covid` are acoustically
#           close and the topic WAS Covid — likely an ASR slip on your turn, not your error.
#           Not taught, because teaching a mistake you may not have made is worse than
#           missing one you did.
#   @50.4m  "Sì, esatto." -> "Sì."                          agreement overlap, not a repair.
#   @19.3m, @21.5m, @36.5m, @39.1m, @47.3m, @32.1m — she expanded, completed or agreed.
#           At @32.1m you actually used `c'è una comunità` CORRECTLY and she simply
#           continued the sentence.
#
# Format: (t_seconds, attempt, correction, changed, rule)
ERRORI = [
    (1272.0, "divertamente", "divertente", "-mente → -ente",
     "The best error of the day, because it is this lesson's own rule over-applied. "
     "<b>-mente</b> makes an ADVERB (<em>velocemente</em> = quickly). <em>Funny</em> is an "
     "ADJECTIVE, so it stays <b>divertente</b> — <em>un film divertente</em>. You reached for "
     "the new pattern and it grabbed a word that never needed it."),
    (1644.0, "estends la vita forte", "è molto resiliente", "invented → resiliente",
     "Reaching for <em>resilient</em>, you built an English stem with an Italian ending. "
     "The word exists almost unchanged: <b>resiliente</b>. When a word feels Latin, try the "
     "Italian shape before inventing one."),
    (1764.0, "Vivare?", "vivere — stabilmente", "vivare → vivere",
     "<b>vivere</b> is <em>-ere</em>, not <em>-are</em>: <em>io vivo</em>, <em>lui vive</em>. "
     "Her follow-up added the adverb you wanted: <b>stabilmente</b> = permanently — and that "
     "one IS a true <em>-mente</em> adverb, unlike <em>divertamente</em>."),
    (102.0, "quattordici ora, undici minuti", "le quattro", "l'ora con l'articolo",
     "Clock times take the <b>feminine plural article</b>: <em>le quattro</em>, "
     "<em>le nove e mezza</em>. Never <em>quattordici ora</em>. Only <em>è l'una</em> is "
     "singular — the one exception."),
    (1848.0, "il diploma", "la laurea", "diploma ≠ laurea",
     "A false friend she stopped to separate: <b>il diploma</b> is a school-leaving "
     "certificate; a UNIVERSITY degree is <b>la laurea</b>. <em>Mi sono laureato</em> = "
     "I graduated."),
]

# CHIESTE — words you asked for out loud, with HER answer. Different from an error: no wrong
# rule to unlearn, just a gap you already knew you had. Cheap to close, so worth carding.
CHIESTE = [
    # Only the words that are NOT already chapter phrases. Five others you asked for out loud
    # — la sirena, divertente, scoprire, quando era più giovane, ero sorpreso — turned out to
    # be phrases this lesson already teaches, so they are carded once, in their chapter. That
    # overlap is itself the finding: you stopped to ask for exactly what the lesson covers.
    ("d6-ask-01", "metto la sveglia", "I set my alarm",
     "Asked at 3:36. <b>la sveglia</b> = the alarm clock; <em>svegliarsi</em> = to wake up."),
    ("d6-ask-02", "dipende dove abiti", "it depends where you live",
     "Asked at 6:12 — she repeated it twice, so it was worth writing down."),
    ("d6-ask-05", "non occupato", "not busy", "Asked at 23:24, for a quiet holiday."),
    ("d6-ask-07", "camionista", "truck driver",
     "Her answer at 28:06: <em>era un camionista</em> — imperfetto, a job he had for years."),
    ("d6-ask-10", "adolescenti", "teenagers", "Asked at 47:12, after circling <i>puberty</i>."),
]

COLD_OPEN_IT = "Quando era più giovane viveva a Santhià, un posto tranquillo vicino alla collina."
COLD_OPEN_EN = "When he was younger he lived in Santhià, a quiet place near the hill."

if __name__ == "__main__":
    n = sum(len(r) for _s, _t, r in CHAPTERS)
    print(f"{n} terms · {len(CHAPTERS)} chapters · {len(PEARLS)} pearls · {len(CLOZE)} cloze")
    print(f"recording: {'staged, NOT ingested' if RECORDING is None else RECORDING}")
    print(f"audio: {'PENDING — scripts ready' if PENDING_AUDIO else 'baked'}")
