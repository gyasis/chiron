#!/usr/bin/env python3
"""anki_link — for each lesson word, find a note that already teaches it in the real Anki collection (read-only).

A note COVERS a word when one of its fields, stripped of HTML/sound tags and punctuation, is the word itself,
optionally with an article ("il polso", "la caviglia", "l'albero"). A sentence that merely contains the word does
not count: sentence decks would otherwise "cover" every word in the language.

    anki_link.py WORDS.json OUT.json
WORDS.json: [{"id", "it", "en"}]       OUT.json: {"linked": {id: [note…]}, "new": [id…], "checked": n, "anki": url}
Exit 2 when Anki is unreachable (nothing is written), so a caller can tell "no card" from "could not look".
"""
import json, os, re, sys, unicodedata, urllib.request

ENV = os.path.expanduser("~/.chiron/anki.env")


def _env():
    url, key = os.environ.get("CHIRON_ANKI_URL"), os.environ.get("CHIRON_ANKI_KEY")
    if (not url or not key) and os.path.exists(ENV):
        for ln in open(ENV):
            k, _, v = ln.strip().partition("=")
            if k == "CHIRON_ANKI_URL" and not url: url = v.strip().strip('"')
            if k == "CHIRON_ANKI_KEY" and not key: key = v.strip().strip('"')
    return url or "http://127.0.0.1:8765", key


URL, KEY = _env()


def anki(action, **params):
    body = json.dumps({"action": action, "version": 6, "key": KEY, "params": params}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request(URL, body), timeout=30))
    if r.get("error"):
        raise RuntimeError(f"{action}: {r['error']}")
    return r["result"]


ARTICLE = re.compile(r"^(il|lo|la|i|gli|le|un|uno|una|l'|un')\s*", re.I)


def norm(s: str) -> str:
    s = re.sub(r"\[sound:[^\]]*\]|<[^>]+>|&nbsp;", " ", s or "")
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^\w' ]", " ", s).replace("’", "'")
    s = ARTICLE.sub("", " ".join(s.split()))
    return s.strip()


def main(words_path, out_path):
    words = json.load(open(words_path))
    try:
        anki("version")
    except Exception as ex:
        print(f"anki_link: Anki unreachable at {URL}: {ex}", file=sys.stderr); sys.exit(2)
    linked, new = {}, []
    for w in words:
        target = norm(w["it"])
        # search a stretch without punctuation (Anki matches it literally); the field comparison below stays exact
        word = max((p.strip() for p in re.split(r"[?!.,;:¿¡—–]", w["it"])), key=len)
        q = f'"{word}"' if " " in word else f'"w:{word}"'
        ids = anki("findNotes", query=q)
        if len(ids) > 400:   # a common word: an exact Front match first, so a card for it is never cut off
            ids = anki("findNotes", query=f'"Front:{word}*"') + ids[:400]
        hits = []
        for n in anki("notesInfo", notes=ids) if ids else []:
            fields = {k: v["value"] for k, v in n["fields"].items()}
            match = [k for k, v in fields.items() if norm(v) == target]
            if match:
                other = [norm(v)[:60] for k, v in fields.items() if k not in match and norm(v)]
                hits.append({"noteId": n["noteId"], "model": n["modelName"], "field": match[0],
                             "other": other[:2], "cards": n["cards"]})
        if hits:
            decks = anki("cardsInfo", cards=[c for h in hits for c in h["cards"]][:50])
            by_note = {}
            for c in decks:
                by_note.setdefault(c["note"], set()).add(c["deckName"])
            for h in hits:
                h["decks"] = sorted(by_note.get(h["noteId"], []))
            linked[w["id"]] = hits
        else:
            new.append(w["id"])
        print(f"  {w['it']:24s} {'LINKED ' + str(len(hits)) if hits else 'new'}  {hits[0]['decks'][:1] if hits else ''}", file=sys.stderr)
    json.dump({"anki": URL, "checked": len(words), "linked": linked, "new": new}, open(out_path, "w"), ensure_ascii=False, indent=1)
    print(f"anki_link: {len(words)} words, {len(linked)} already in Anki, {len(new)} new -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:3])
