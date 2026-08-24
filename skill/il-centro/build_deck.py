#!/usr/bin/env python3
"""Build the Barbara Cavallaro lesson deck: write TSV, then push via AnkiConnect."""

import json
import os
import sys
import urllib.request

DECK = "Italiano::Barbara 2026-08-03"
MODEL = "Basic (and reversed card)"
LESSON_TAG = "lezione-2026-08-03"
ENDPOINT = "http://127.0.0.1:8765"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
TSV_PATH = os.path.join(OUT_DIR, "barbara-2026-08-03.tsv")

# (Italian, English + usage note, thread tag)
NOTES = [
    # --- classe: the language of the lesson itself ---
    ("Da quanto tempo abiti in Italia?",
     "How long have you been living in Italy?<br><i>da + PRESENT tense — Italian says \"abito da tre anni\", not a past tense.</i>", "classe"),
    ("Hai tempo per scrivere una presentazione?",
     "Do you have time to write a presentation?<br><i>avere tempo; per + infinito = \"to / in order to\".</i>", "classe"),
    ("Voglio praticare la pronuncia.",
     "I want to practise pronunciation.<br><i>volere + infinito, no preposition between them.</i>", "classe"),
    ("domandare",
     "to ask (a question)<br><i>chiedere covers asking a question AND asking for something; fare una domanda is the everyday phrase.</i>", "classe"),
    ("un consiglio",
     "a piece of advice, a tip<br><i>Countable in Italian: i consigli. dare un consiglio = to give advice.</i>", "classe"),
    ("una presentazione al presente",
     "a presentation in the present tense<br><i>Your homework: topic = la mia vita in Italia.</i>", "classe"),
    ("la mia vita in Italia",
     "my life in Italy<br><i>The homework topic she assigned.</i>", "classe"),
    ("Ci vediamo domani alla stessa ora, allo stesso posto.",
     "See you tomorrow, same time, same place.<br><i>ci vediamo = we see each other. a+la=alla, a+lo=allo.</i>", "classe"),
    ("alle 9.55",
     "at 9:55<br><i>\"At\" a time = alle. Italian writes times with a period, not a colon.</i>", "classe"),

    # --- tempo: telling the time ---
    ("Adesso sono le 4.36 di mattina.",
     "It's 4:36 in the morning now.<br><i>sono le + number for every hour except 1, noon and midnight.</i>", "tempo"),
    ("Qui sono le 15.00 di pomeriggio.",
     "Here it's 3 in the afternoon.<br><i>di mattina / di pomeriggio / di sera / di notte.</i>", "tempo"),
    ("La prima riunione comincia alle 9.00.",
     "The first meeting starts at 9:00.<br><i>cominciare alle + hour.</i>", "tempo"),
    ("Ho molte riunioni di lavoro.",
     "I have a lot of work meetings.<br><i>NOTE: di lavoro stays SINGULAR in this fixed phrase (the log shows \"di lavori\" — that means roadworks).</i>", "tempo"),
    ("Sono le due. / È l'una.",
     "It's two o'clock. / It's one o'clock.<br><i>The three singular exceptions: è l'una, è mezzogiorno, è mezzanotte.</i>", "tempo"),

    # --- grammatica ---
    ("La gente è pazza.",
     "People are crazy.<br><i>la gente is grammatically SINGULAR — è, never sono. Use le persone for a real plural.</i>", "grammatica"),
    ("La gente a Nord viaggia a Sud.",
     "People in the North travel to the South.<br><i>Singular verb again: viaggia, not viaggiano.</i>", "grammatica"),
    ("La gente era ottimista.",
     "People were optimistic.<br><i>Imperfetto era = was / used to be. Still singular agreement.</i>", "grammatica"),
    ("Non c'è una regola.",
     "There's no rule.<br><i>c'è + singular, ci sono + plural.</i>", "grammatica"),
    ("la regola / le regole",
     "the rule / the rules<br><i>Feminine -a becomes -e in the plural.</i>", "grammatica"),
    ("Devo studiare più italiano.",
     "I have to study more Italian.<br><i>Her shorthand was \"studiare + italiano\" — the + means più. dovere + infinito.</i>", "grammatica"),
    ("Lei non ha pazienza.",
     "She has no patience.<br><i>avere pazienza — you HAVE the state. Same family: avere fame, sete, sonno, ragione, paura.</i>", "grammatica"),
    ("Lui si innamora di Sofia Loren.",
     "He falls in love with Sofia Loren.<br><i>innamorarsi DI, never con.</i>", "grammatica"),
    ("Mi piace guardare il cinema italiano.",
     "I like watching Italian cinema.<br><i>mi piace + infinito. Plural things take mi piacciono.</i>", "grammatica"),
    ("fare il bagno",
     "to take a dip, to go for a swim<br><i>Uses fare. nuotare = to swim as an activity/sport.</i>", "grammatica"),
    ("nel fiume",
     "in the river<br><i>in + il = nel. il fiume.</i>", "grammatica"),
    ("nel lago",
     "in the lake<br><i>in + il = nel. il lago.</i>", "grammatica"),
    ("nella fontana",
     "in the fountain<br><i>in + la = nella. la fontana.</i>", "grammatica"),
    ("la vita degli anni '60",
     "life in the '60s<br><i>di + gli = degli.</i>", "grammatica"),
    ("la generazione di mia moglie",
     "my wife's generation<br><i>NO article before a singular unmodified family member: mia moglie, not la mia moglie.</i>", "grammatica"),
    ("un'attrice internazionale",
     "an international actress<br><i>un' with apostrophe only before a FEMININE vowel-initial noun. Masculine is un attore, no apostrophe.</i>", "grammatica"),

    # --- turismo ---
    ("Il turismo è importante per l'Italia.",
     "Tourism is important for Italy.", "turismo"),
    ("un fenomeno italiano",
     "an Italian phenomenon<br><i>il fenomeno → i fenomeni.</i>", "turismo"),
    ("il turismo selvaggio",
     "unchecked / \"wild\" mass tourism<br><i>selvaggio = wild, savage, unregulated. A loaded phrase in current Italian debate.</i>", "turismo"),
    ("Ferragosto",
     "15 August — Italy's peak national holiday<br><i>The country empties out and heads for the coast; explains the whole August exodus.</i>", "turismo"),
    ("il governo",
     "the government", "turismo"),
    ("il rischio",
     "the risk<br><i>Plural i rischi.</i>", "turismo"),
    ("Fare il bagno nella fontana di Trevi",
     "To bathe in the Trevi Fountain<br><i>The notorious tourist offence — it carries a fine.</i>", "turismo"),
    ("a Nord / a Sud",
     "in the North / to the South<br><i>Also al Nord / al Sud.</i>", "turismo"),

    # --- cinema ---
    ("in bianco e nero",
     "in black and white<br><i>No article.</i>", "cinema"),
    ("il regista",
     "the film director<br><i>FALSE FRIEND — not \"registrar\". Masculine despite the -a: il regista → i registi; la regista → le registe.</i>", "cinema"),
    ("l'attore / l'attrice",
     "the actor / the actress<br><i>Plural: gli attori / le attrici.</i>", "cinema"),
    ("Il Sorpasso",
     "\"The Overtaking\" (1962) — passing another car<br><i>Dir. Dino Risi, starring Vittorio Gassman. A road movie set over the deserted Ferragosto weekend.</i>", "cinema"),
    ("Dino Risi",
     "the director of Il Sorpasso<br><i>Her note \"Dino Risi &lt; il regista\" = \"who is the director\".</i>", "cinema"),
    ("Vittorio Gassman",
     "the lead actor of Il Sorpasso", "cinema"),
    ("1962",
     "millenovecentosessantadue<br><i>Italian says the year as ONE word, never split into pairs like English.</i>", "cinema"),
    ("il boom economico",
     "the economic boom<br><i>Italy's postwar miracle of the 1950s–60s.</i>", "cinema"),
    ("il film cult della Dolce Vita",
     "the cult film La Dolce Vita<br><i>Fellini, 1960 — the Trevi Fountain scene. il film is invariable: i film.</i>", "cinema"),
    ("Ieri, Oggi, Domani",
     "\"Yesterday, Today, Tomorrow\" (1963)<br><i>De Sica, with Sofia Loren and Marcello Mastroianni.</i>", "cinema"),
]


def invoke(action, **params):
    payload = json.dumps({"action": action, "version": 6, "params": params}).encode()
    req = urllib.request.Request(ENDPOINT, data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        resp = json.load(r)
    if resp.get("error"):
        raise RuntimeError(f"{action}: {resp['error']}")
    return resp["result"]


def write_tsv():
    with open(TSV_PATH, "w", encoding="utf-8") as f:
        f.write("#separator:tab\n#html:true\n#notetype:Basic (and reversed card)\n")
        f.write(f"#deck:{DECK}\n#tags column:3\n")
        for front, back, tag in NOTES:
            f.write(f"{front}\t{back}\tbarbara {LESSON_TAG} {tag}\n")
    print(f"TSV: {TSV_PATH} ({len(NOTES)} notes)")


def main():
    write_tsv()

    existing = invoke("findNotes", query=f'tag:{LESSON_TAG}')
    if existing:
        print(f"ABORT: {len(existing)} notes already tagged {LESSON_TAG}. "
              f"Deck already pushed — nothing to do.")
        return 0

    invoke("createDeck", deck=DECK)

    payload = [{
        "deckName": DECK,
        "modelName": MODEL,
        "fields": {"Front": front, "Back": back},
        "options": {"allowDuplicate": False},
        "tags": ["barbara", LESSON_TAG, tag],
    } for front, back, tag in NOTES]

    ids = invoke("addNotes", notes=payload)
    added = [i for i in ids if i]
    skipped = [NOTES[i][0] for i, v in enumerate(ids) if not v]

    print(f"Added:   {len(added)} notes -> {len(added) * 2} cards")
    print(f"Skipped: {len(skipped)}")
    for s in skipped:
        print(f"  - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
