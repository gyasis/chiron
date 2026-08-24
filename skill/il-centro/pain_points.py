#!/usr/bin/env python3
"""Isolate MY pain points from the recordings — Gyasi's turns only.

    python3 pain_points.py day3 day4

Barbara's turns are the model; they say nothing about what is hard. The learner's turns do.
Four signals, each a different kind of difficulty:

  ASKED      explicit help-seeking — "come si dice", "how do you say"     → vocabulary gap, known
  FELL BACK  English inside an Italian turn                               → vocabulary gap, unknown
  STALLED    filler and repetition ("eh… eh…", the same word 3x)          → retrieval too slow
  CORRECTED  her next turn repairs what you just said                     → a wrong rule, not a gap

The last is the most valuable and the rarest: it means you produced something confidently
and it was wrong, which is the only kind of error that survives untreated.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter

ASK = re.compile(r"\b(come si dice|come si scrive|how do (?:you|i) say|what'?s the word|"
                 r"what is (?:it|the)|non lo so|non so come|i don'?t know how)\b", re.I)
ENGLISH = re.compile(r"\b(the|and|but|because|what|how|when|with|about|something|"
                     r"like|okay|right|yeah|so|know|think|want|need|say|word|mean)\b", re.I)
ITALIAN = re.compile(r"\b(il|la|lo|gli|le|di|che|non|per|con|sono|ho|mi|ti|si|è|una|un)\b", re.I)
FILLER = re.compile(r"\b(eh+|ah+|uh+|um+|mmm+)\b", re.I)


def analyse(day: str) -> dict:
    L = json.load(open(f"{day}/transcript.named.json", encoding="utf-8"))
    mine = [l for l in L if l.get("who") == "Gyasi"]
    out = {"day": day, "turns": len(mine), "asked": [], "fell_back": [], "stalled": [],
           "corrected": []}

    for i, l in enumerate(L):
        if l.get("who") != "Gyasi":
            continue
        t = l["text"]
        w = t.lower().split()

        if ASK.search(t):
            out["asked"].append({"t": round(l["start"], 1), "text": t})

        # an Italian-tagged turn carrying English content words = reaching for a word you lack
        if l["lang"] == "it" and len(ENGLISH.findall(t)) >= 2 and ITALIAN.search(t):
            out["fell_back"].append({"t": round(l["start"], 1), "text": t})

        # stalling: filler, or the same content word repeated 3+ times in one turn
        rep = Counter(x for x in w if len(x) > 2)
        if len(FILLER.findall(t)) >= 2 or (rep and rep.most_common(1)[0][1] >= 3):
            out["stalled"].append({"t": round(l["start"], 1), "text": t})

        # her next turn repairs it
        if i + 1 < len(L):
            nxt = L[i + 1]
            if nxt.get("who") == "Barbara" and nxt["start"] - l["end"] < 4.0:
                A = set(re.findall(r"[a-zàèéìòóù']+", t.lower()))
                B = set(re.findall(r"[a-zàèéìòóù']+", nxt["text"].lower()))
                if len(A) >= 2 and B:
                    ov = len(A & B) / len(A | B)
                    if 0.15 < ov < 0.95:
                        out["corrected"].append({"t": round(l["start"], 1), "mine": t,
                                                 "hers": nxt["text"], "ov": round(ov, 2)})
    return out


def verbs_i_get_wrong(days: list[dict]) -> list[tuple[str, int]]:
    """Which VERBS show up in the corrected pairs — the lesson is about verbs, so name them."""
    VERBS = ("uscire esco esci esce usciamo uscite escono andare vado vai va andiamo andate vanno "
             "fare faccio fai fa facciamo fate fanno essere sono sei è siamo siete "
             "svegliarsi sveglio svegli lavarsi lavo prepararsi preparo preparo "
             "mettersi metto sapere so conoscere conosco ricordare ricordo "
             "volere voglio potere posso dovere devo stare stai sto").split()
    c = Counter()
    for d in days:
        for p in d["corrected"]:
            for v in VERBS:
                if re.search(rf"\b{v}\b", p["mine"], re.I) or re.search(rf"\b{v}\b", p["hers"], re.I):
                    c[v] += 1
    return c.most_common(12)


def main():
    days = [analyse(d) for d in (sys.argv[1:] or ["day3", "day4"])]
    tot = {k: sum(len(d[k]) for d in days) for k in ("asked", "fell_back", "stalled", "corrected")}
    turns = sum(d["turns"] for d in days)
    print(f"across {len(days)} recordings · {turns} of your turns\n")
    print(f"  {'ASKED for a word':22} {tot['asked']:3}   explicit — you knew you didn't know")
    print(f"  {'FELL BACK to English':22} {tot['fell_back']:3}   mid-sentence gap")
    print(f"  {'STALLED':22} {tot['stalled']:3}   retrieval too slow")
    print(f"  {'CORRECTED by her':22} {tot['corrected']:3}   confidently wrong — the ones that stick")

    print("\n— verbs appearing in your corrections —")
    for v, n in verbs_i_get_wrong(days):
        print(f"    {v:12} {n}")

    for d in days:
        print(f"\n=== {d['day']} — you asked outright ===")
        for a in d["asked"][:6]:
            print(f"  @{a['t']:.0f}s  {a['text'][:88]}")
        print(f"--- {d['day']} — corrected ---")
        for p in sorted(d["corrected"], key=lambda x: -x["ov"])[:6]:
            print(f"  @{p['t']:.0f}s  you: {p['mine'][:70]}")
            print(f"           her: {p['hers'][:70]}")

    json.dump(days, open("pain_points.json", "w"), ensure_ascii=False, indent=1)
    print("\n→ pain_points.json")


if __name__ == "__main__":
    main()
