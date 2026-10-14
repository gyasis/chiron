#!/usr/bin/env python3
"""tag-italian-audio — tag Italian Anki notes audio::it / audio::fronte / audio::retro / audio::manca, and report the phrases with no audio.

    tag-italian-audio.py --dry-run     (default) counts per deck root, changes nothing
    tag-italian-audio.py --apply       addTags in batches of <=500 notes (idempotent)
    tag-italian-audio.py --report      write ~/Documents/generated/ordine-audio-gaps.{md,json}
                                       (exam-relevant audio::manca notes, ranked for voicing)

Audio is detected with the regex search "re:\\[sound:" (the glob "*[sound:*" returns 0).
Side is judged from the first card's rendered question vs answer. Reads
CHIRON_ANKI_URL / CHIRON_ANKI_KEY (source ~/.chiron/anki.env); never prints the key.
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import anki  # noqa: E402

anki.TIMEOUT = float(os.environ.get("CHIRON_ANKI_TIMEOUT", 120))

ROOTS = ["Medical Italian", "il centro di italia", "Italiano",
         "Italian listening exercises with ITA / ENG text", "chiron",
         "italian 15 000 sentences"]            # prefix: matches every "italian 15 000 sentences*" deck
BATCH = 500
SOUND_Q = r'"re:\[sound:"'
TAGS = ["audio::it", "audio::fronte", "audio::retro", "audio::manca"]
OUT = os.path.expanduser("~/Documents/generated")
STRIP = re.compile(r"<[^>]+>")
SOUND = re.compile(r"\[sound:[^\]]*\]")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def chunks(xs, n=BATCH):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def roots_decks():
    """Map each configured root to the real deck names under it (case-insensitive)."""
    names = anki.invoke("deckNames")
    out = {}
    for r in ROOTS:
        rl = r.casefold()
        if r == "italian 15 000 sentences":
            out[r] = sorted(n for n in names if n.casefold().startswith(rl))
        else:
            out[r] = sorted(n for n in names if n.casefold() == rl or n.casefold().startswith(rl + "::"))
    # 'chiron' and 'Chiron' are one deck to Anki (case-insensitive); keep as one root.
    return out


def deck_q(decks):
    return " or ".join(f'deck:"{d}"' for d in decks) if len(decks) > 1 else f'deck:"{decks[0]}"'


def find(q):
    return anki.invoke("findNotes", query=q)


def sides(note_ids):
    """note -> set of 'fronte'/'retro', judged from each note's first card."""
    res = {}
    for ch in chunks(note_ids, 200):
        infos = anki.invoke("notesInfo", notes=ch)
        first = {i["noteId"]: i["cards"][0] for i in infos if i.get("cards")}
        cinfo = anki.invoke("cardsInfo", cards=list(first.values()))
        by_card = {c["cardId"]: c for c in cinfo}
        for nid, cid in first.items():
            c = by_card.get(cid, {})
            q = c.get("question", "")
            a = c.get("answer", "")
            a = re.split(r'<hr id=["\']?answer["\']?>', a, maxsplit=1)[-1]
            # AnkiConnect renders audio as [anki:play:q:N] (question side) / [anki:play:a:N]
            # (answer side), not [sound:...] — matching only [sound: put every note on "retro".
            s = set()
            if "[sound:" in q or "[anki:play:q:" in q:
                s.add("fronte")
            if "[sound:" in a or "[anki:play:a:" in a:
                s.add("retro")
            res[nid] = s or {"retro"}
        log(f"  sides {min(len(res), len(note_ids))}/{len(note_ids)}")
    return res


def count_tag(tag, dq):
    return len(find(f'({dq}) tag:{tag}'))


def run(apply):
    table = []
    for root, decks in roots_decks().items():
        if not decks:
            log(f"{root}: no such deck, skipped")
            continue
        dq = deck_q(decks)
        allids = find(dq)
        audio = set(find(f'({dq}) {SOUND_Q}'))
        manca = [n for n in allids if n not in audio]
        before = {t: count_tag(t, dq) for t in TAGS}
        row = {"root": root, "decks": len(decks), "notes": len(allids), "it": len(audio),
               "manca": len(manca), "before": before}
        log(f"{root}: {len(allids)} notes, {len(audio)} with audio, {len(manca)} without")
        sd = sides(sorted(audio)) if audio else {}
        fr = [n for n, s in sd.items() if "fronte" in s]
        rt = [n for n, s in sd.items() if "retro" in s]
        row.update(fronte=len(fr), retro=len(rt))
        if apply:
            for tag, ids in (("audio::it", sorted(audio)), ("audio::fronte", fr),
                             ("audio::retro", rt), ("audio::manca", manca)):
                for ch in chunks(ids):
                    anki.invoke("addTags", notes=ch, tags=tag)
                log(f"  tagged {len(ids)} {tag}")
            # audio gained since a previous run: drop a stale manca tag
            for ch in chunks(sorted(audio)):
                anki.invoke("removeTags", notes=ch, tags="audio::manca")
            row["after"] = {t: count_tag(t, dq) for t in TAGS}
        table.append(row)
    print(f"\n{'root':50} {'notes':>7} {'it':>7} {'fronte':>7} {'retro':>7} {'manca':>7}")
    for r in table:
        print(f"{r['root'][:50]:50} {r['notes']:7} {r['it']:7} {r['fronte']:7} {r['retro']:7} {r['manca']:7}")
        if apply:
            ok = (r["after"]["audio::it"] == r["it"] and r["after"]["audio::manca"] == r["manca"]
                  and r["after"]["audio::fronte"] == r["fronte"] and r["after"]["audio::retro"] == r["retro"])
            print(f"   before {tuple(r['before'].values())} -> after {tuple(r['after'].values())}  verify={'OK' if ok else 'MISMATCH'}")
    return 0


# ---------------------------------------------------------------- report
EXAM_ROOTS = ("Medical Italian", "il centro di italia", "chiron")
PRIORITY_DECK = [("esame medico", 30), ("ricoveri", 28), ("istruzioni", 26), ("necessit", 26)]
IT_WORDS = set("il lo la le gli un una di che è e non per con sono ho hai ha del della dei delle al alla nel nella "
               "si mi ti ci come più questo sta stai può devo deve dolore avere essere fare".split())


def clean(html):
    return re.sub(r"\s+", " ", STRIP.sub(" ", SOUND.sub("", html)).replace("&nbsp;", " ")).strip()


def italianness(t):
    w = re.findall(r"[a-zàèéìòù']+", t.lower())
    return sum(x in IT_WORDS for x in w) / (len(w) or 1)


def score(deck, it, words):
    s, dl = 10, deck.casefold()
    for k, v in PRIORITY_DECK:
        if k in dl:
            s += v
            break
    if "verbi irregolari" in dl:
        s += 24
    if dl.startswith("medical italian"):
        s += 8
    if words <= 8:
        s += 14
    elif words <= 15:
        s += 8
    return s


def report():
    decks = [d for d in anki.invoke("deckNames")
             if any(d.casefold() == r.casefold() or d.casefold().startswith(r.casefold() + "::") for r in EXAM_ROOTS)
             or d.casefold().startswith("italiano::verbi irregolari")]
    ids = find(f'({deck_q(decks)}) tag:audio::manca')
    log(f"{len(ids)} audio::manca notes in {len(decks)} exam decks")
    items = []
    for ch in chunks(ids, 200):
        infos = anki.invoke("notesInfo", notes=ch)
        cards = {i["noteId"]: i["cards"][0] for i in infos if i.get("cards")}
        ci = {c["cardId"]: c for c in anki.invoke("cardsInfo", cards=list(cards.values()))}
        for n in infos:
            c = ci.get(cards.get(n["noteId"]), {})
            f = [clean(v["value"]) for v in sorted(n["fields"].values(), key=lambda v: v["order"])]
            f = [x for x in f if x]
            if not f:
                continue
            a, b = f[0], (f[1] if len(f) > 1 else "")
            if b and italianness(b) > italianness(a):
                a, b = b, a
            w = len(a.split())
            items.append({"deck": c.get("deckName", ""), "noteId": n["noteId"], "italian": a,
                          "english": b, "words": w, "priority": score(c.get("deckName", ""), a, w)})
    items.sort(key=lambda x: (-x["priority"], x["words"], x["noteId"]))
    os.makedirs(OUT, exist_ok=True)
    top = items[:150]
    json.dump({"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "total": len(items),
               "tts_sec_per_phrase": 6, "top150": top, "all": items},
              open(f"{OUT}/ordine-audio-gaps.json", "w"), ensure_ascii=False, indent=1)
    L = ["# Ordine dei Medici - phrases with NO audio", "",
         f"{len(items)} audio::manca notes in exam decks. TTS estimate at ~6 s/phrase on OmniVoice (Lucrezia): "
         f"top 150 = {150*6/60:.0f} min; all = {len(items)*6/3600:.1f} h.", "",
         "## Top 150 to voice first", "", "| # | pri | deck | noteId | Italiano | English |", "|---|---|---|---|---|---|"]
    for i, x in enumerate(top, 1):
        L.append(f"| {i} | {x['priority']} | {x['deck']} | {x['noteId']} | {x['italian']} | {x['english']} |".replace("\n", " "))
    L += ["", "## Remaining by deck", ""]
    cnt = {}
    for x in items:
        cnt[x["deck"]] = cnt.get(x["deck"], 0) + 1
    L += [f"- {d}: {n}" for d, n in sorted(cnt.items(), key=lambda kv: -kv[1])]
    open(f"{OUT}/ordine-audio-gaps.md", "w").write("\n".join(L) + "\n")
    log(f"wrote {OUT}/ordine-audio-gaps.md/.json")
    return 0


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    g.add_argument("--report", action="store_true")
    a = ap.parse_args()
    try:
        return report() if a.report else run(a.apply)
    except anki.AnkiUnavailable as e:
        print(f"Anki unreachable: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
