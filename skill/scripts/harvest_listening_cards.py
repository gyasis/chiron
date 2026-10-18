#!/usr/bin/env python3
"""harvest_listening_cards — per-lesson LISTENING CARDS from what a lesson already contains.

Ascolto drills what the learner is STUDYING, not random Anki sentences. This reads each lesson's own
material and writes pairs of (Italian, English) ready for an audio-only drill:

    <lesson dir>/listening-cards.json                       one lesson
    <library>/listening.index.json                          every harvested lesson, for /api/pool/lesson + lesson-first gather

Sources, strongest first (the first one to produce an Italian line wins, later ones only fill gaps):
    pimsleur   pimsleur.json items (kind phrase/question). `build` chunks and talk/exam prompts have NO English
               side, so they are skipped and counted — a translation is never invented.
    flashcard  .sr-card[data-card-type] in lesson.html + content.json srCards (term = it, meaning = en, example kept)
    vocab      .v-table rows (td.it | English | note)
    script     dialogue turns (.turn it + gloss / data-en) and strictly aligned it/en pairs in audio-scripts.json

Usage:
    harvest_listening_cards.py <lesson-id> [<lesson-id> ...]     id = path under ~/Documents/generated
    harvest_listening_cards.py --focus "Verb foundation"          every lesson whose chiron.json labels has the tag
    harvest_listening_cards.py --all [--dry-run]                  everything (use --dry-run first: counts only)
Idempotent: a lesson file / the index is rewritten only when its content hash changed. Stdlib + bs4/lxml.
"""
import argparse, hashlib, html, json, os, re, sys, unicodedata
from pathlib import Path

GEN = Path(os.environ.get("CHIRON_GEN", Path.home() / "Documents/generated"))
LIB = Path(os.environ.get("CHIRON_LIBRARY", GEN / "chiron-library"))
CARDS_F, INDEX_F = "listening-cards.json", "listening.index.json"
MIN_SENT, MAX_WORDS = 3, 20
SRC_RANK = {"pimsleur": 0, "flashcard": 1, "vocab": 2, "script": 3}

IT_STOP = set("il lo gli una di che è non per con sono ho hai ha del della dello dei delle al alla alle nel nella nei mi ti ci "
              "come più questo questa anche ma cosa dove quando perché io tu lui lei noi voi loro sì molto bene tutto tutti "
              "essere avere fare nel sul sulla dal dalla dalle degli hanno siamo siete ieri domani oggi sua suo mia mio".split())
EN_STOP = set("the an of to and is are was were you he she it we they on for with that this have has had did do my your what "
              "where how not at by from be been will would can could your his her our their there then than when who which".split())


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return s.replace("’", "'")


def toks(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", fold(s))


def card_id(it: str) -> str:
    return hashlib.sha1(" ".join(toks(it)).encode()).hexdigest()[:12]


def clean(s) -> str:
    s = html.unescape(re.sub(r"<[^>]+>", " ", str(s or "")))
    s = re.sub(r"\[[^\]]*\]", " ", s)                       # [pause], [sound:..]
    s = re.sub(r"\s+", " ", s).strip(" ​")
    return re.sub(r"\s+([.,;:!?])", r"\1", s)


def lang_score(text: str) -> tuple[int, int]:
    w = re.findall(r"[a-zà-ÿ']+", text.lower())
    return sum(x in IT_STOP for x in w), sum(x in EN_STOP for x in w)


def looks_it(text: str) -> bool:
    i, e = lang_score(text)
    if i == e:
        return bool(re.search(r"[àèéìòù]|'[aeiou]", text.lower())) and e == 0
    return i > e


def looks_en(text: str) -> bool:
    i, e = lang_score(text)
    return e > i


def kind_of(it: str) -> str:
    n = len(toks(it))
    if n <= 1:
        return "word"
    if n <= 5 and not re.search(r"[.?!]$", it.strip()):
        return "phrase"
    return "sentence" if n > 5 or re.search(r"[.?!]$", it.strip()) else "phrase"


def usable(it: str, en: str, sentence_only: bool = False) -> bool:
    n = len(toks(it))
    if not it or not en or not n or n > MAX_WORDS or len(toks(en)) > 40:
        return False
    if sentence_only and n < MIN_SENT:
        return False
    if re.search(r"_{2,}|\.\.\.|…|\{\{|\}\}", it + en):
        return False
    return bool(re.search(r"[A-Za-zÀ-ÿ]", it))


def lemma_of(it: str, en: str, note: str) -> str | None:
    """Verb lemma when the card says so: 'participle of andare', 'fare → fatto' matching a form in `it`."""
    m = re.search(r"(?:participle|past participle|participio(?: passato)?) (?:of|di) ([a-zà-ÿ]+(?:re|rsi))\b", f"{en} {note}", re.I)
    if m:
        return m.group(1).lower()
    for inf, form in re.findall(r"\b([a-zà-ÿ]+(?:re|rsi))\s*(?:→|->|=>)\s*([a-zà-ÿ]+)", note):
        if fold(form) in toks(it):
            return inf.lower()
    return None


class Lesson:
    def __init__(self, lid: str, d: Path):
        self.id, self.dir = lid, d
        meta = _json(d / "chiron.json") or {}
        self.labels = [str(x) for x in meta.get("labels", [])]
        t = clean(meta.get("title") or lid)
        self.title = re.sub(r"^Chiron\s*[·\-]\s*", "", t) or lid
        self.domain = meta.get("domain") or ""
        self.tags = list(dict.fromkeys(self.labels + ([self.domain] if self.domain else [])))
        self.cards: dict[str, dict] = {}
        self.skipped = {"no_en": 0, "not_italian": 0, "unusable": 0}
        self.raw = {"pimsleur": 0, "flashcard": 0, "vocab": 0, "script": 0}

    def add(self, source: str, it: str, en: str, ex_it: str = "", ex_en: str = "", note: str = "", sentence_only=False):
        it, en = clean(it), clean(en)
        ex_it, ex_en = clean(ex_it), clean(ex_en)
        if not it:
            return
        if not en:
            self.skipped["no_en"] += 1
            return
        if looks_en(it) and looks_it(en):                    # a card authored English-first
            it, en = en, it
        elif looks_en(it) and not looks_it(en) and len(toks(it)) >= 3:
            self.skipped["not_italian"] += 1                 # an English sentence on the "Italian" side
            return
        if not usable(it, en, sentence_only):
            self.skipped["unusable"] += 1
            return
        self.raw[source] += 1
        cid = card_id(it)
        old = self.cards.get(cid)
        if old:                                              # same Italian: keep the stronger source, fill the gaps
            for k, v in (("example_it", ex_it), ("example_en", ex_en)):
                if v and not old.get(k):
                    old[k] = v
            if not old.get("lemma"):
                lm = lemma_of(it, en, note)
                if lm:
                    old["lemma"] = lm
            return
        c = {"id": cid, "it": it, "en": en}
        # a note that explains ("Frase incoraggiante — ...", "avere + -ato", "fare → fatto") is not an example sentence
        if ex_it and MIN_SENT <= len(toks(ex_it)) <= MAX_WORDS and looks_it(ex_it) and not re.search(r" [—+→-] |→", ex_it):
            c["example_it"] = ex_it
            if ex_en and looks_en(ex_en):
                c["example_en"] = ex_en
        c.update(kind=kind_of(it), source=source, lesson=self.id, lesson_title=self.title, tags=self.tags)
        lm = lemma_of(it, en, note)
        if lm:
            c["lemma"] = lm
        self.cards[cid] = c

    # ---- sources -------------------------------------------------------------------------------------------
    def pimsleur(self):
        d = _json(self.dir / "pimsleur.json")
        for it in (d or {}).get("items", []):
            self.skipped["no_en"] += len(it.get("build") or [])      # chunks carry no English
            if it.get("kind") not in ("phrase", "question"):
                if it.get("kind") in ("talk", "exam"):
                    self.skipped["no_en"] += 1                       # `en` is an instruction, not a translation
                continue
            self.add("pimsleur", it.get("it", ""), it.get("en", ""), sentence_only=False)

    def html_sources(self):
        f = self.dir / "lesson.html"
        if not f.is_file():
            return
        from bs4 import BeautifulSoup
        try:
            soup = BeautifulSoup(f.read_text(errors="replace"), "lxml")
        except Exception as e:
            sys.stderr.write(f"[harvest] {f}: {type(e).__name__}: {e}\n")
            return
        for c in soup.select(".sr-card[data-card-type]"):
            front = c.select_one(".front")
            gloss = c.select_one(".sr-back-gloss")
            back = c.select_one(".back")
            en = gloss.get_text(" ") if gloss else (back.get_text(" ") if back else "")
            note = " ".join(x.get_text(" ") for x in c.select(".sr-back-note, .sr-back-example"))
            if front:
                self.add("flashcard", front.get_text(" "), en, ex_it=note if looks_it(note) else "", note=note)
        for tb in soup.select("table.v-table"):
            heads = [h.get_text(" ").strip().lower() for h in tb.select("th")]
            if len(heads) < 2 or "english" not in heads[1]:      # conjugation / form tables are not translations
                continue
            for tr in tb.select("tr"):
                tds = tr.find_all("td")
                if len(tds) < 2 or "it" not in (tds[0].get("class") or []):
                    continue
                note = tds[2].get_text(" ") if len(tds) > 2 else ""
                self.add("vocab", tds[0].get_text(" "), tds[1].get_text(" "), ex_it=note if looks_it(note) else "", note=note)
        for t in soup.select(".turn"):
            it = t.select_one(".what .it")
            gl = t.select_one(".what .gloss")
            en = gl.get_text(" ") if gl else (t.get("data-en") or "")
            if it:
                self.add("script", it.get_text(" "), en, sentence_only=True)

    def content_json(self):
        for c in (_json(self.dir / "content.json") or {}).get("srCards", []) or []:
            if isinstance(c, dict):
                self.add("flashcard", c.get("front", ""), c.get("back", ""))

    def audio_scripts(self):
        d = _json(self.dir / "audio-scripts.json")
        if not isinstance(d, dict):
            return
        lists = []
        for v in d.values():
            lists += list(v.values()) if isinstance(v, dict) else [v]
        done = lambda t: bool(re.search(r"[.?!][\"»”']?$", t.strip()))
        for lines in lists:
            if not isinstance(lines, list):
                continue
            for a, b in zip(lines, lines[1:]):
                if not (isinstance(a, dict) and isinstance(b, dict)) or a.get("lang") != "it" or b.get("lang") != "en":
                    continue
                it, en = clean(a.get("text")), clean(b.get("text"))
                # narration is English with Italian words dropped in: only a COMPLETE Italian sentence followed by a
                # COMPLETE English one counts, and each side must read as its own language
                if (len(toks(it)) >= MIN_SENT and len(toks(en)) >= MIN_SENT and done(it) and done(en)
                        and looks_it(it) and looks_en(en)):
                    self.add("script", it, en, sentence_only=True)

    def harvest(self) -> dict:
        self.pimsleur(); self.html_sources(); self.content_json(); self.audio_scripts()
        cards = sorted(self.cards.values(), key=lambda c: (SRC_RANK[c["source"]], c["it"].lower()))
        by_src, by_kind = {}, {}
        for c in cards:
            by_src[c["source"]] = by_src.get(c["source"], 0) + 1
            by_kind[c["kind"]] = by_kind.get(c["kind"], 0) + 1
        return {"version": 1, "lesson": self.id, "lesson_title": self.title, "tags": self.tags,
                "counts": {"cards": len(cards), "by_source": by_src, "by_kind": by_kind}, "skipped": self.skipped, "cards": cards}


def _json(p: Path):
    try:
        return json.loads(p.read_text())
    except FileNotFoundError:
        return None
    except Exception as e:
        sys.stderr.write(f"[harvest] {p}: {type(e).__name__}: {e}\n")
        return None


def _dump(d) -> str:
    return json.dumps(d, ensure_ascii=False, indent=1, sort_keys=False) + "\n"


def write_if_changed(p: Path, text: str) -> bool:
    try:
        if hashlib.sha1(p.read_bytes()).digest() == hashlib.sha1(text.encode()).digest():
            return False
    except FileNotFoundError:
        pass
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(text)
    tmp.replace(p)
    return True


# ---- lesson discovery ----------------------------------------------------------------------------------------

def resolve_dir(lid: str) -> Path | None:
    for d in (GEN / lid, LIB / "lessons" / lid):
        if (d / "lesson.html").is_file():
            return d
    return None


def all_lesson_ids() -> list[str]:
    ids, flat = [], set()
    for root, dirs, files in os.walk(GEN):
        rel = Path(root).relative_to(GEN)
        if rel.parts[:1] == ("chiron-library",):
            dirs[:] = []
            continue
        if "lesson.html" in files:
            ids.append(rel.as_posix())
            flat.update({rel.name, rel.as_posix().replace('/', '-')})
            dirs[:] = []
    for d in sorted((LIB / "lessons").glob("*/lesson.html")):
        if d.parent.name not in flat:
            ids.append(d.parent.name)
    return sorted(ids)


def focus_ids(tag: str) -> list[str]:
    want = fold(tag)
    out = []
    for lid in all_lesson_ids():
        d = resolve_dir(lid)
        if d and want in [fold(x) for x in (_json(d / "chiron.json") or {}).get("labels", [])]:
            out.append(lid)
    return out


def run(ids: list[str], dry: bool) -> list[dict]:
    index = _json(LIB / INDEX_F) or {}
    lessons, by_lesson = dict(index.get("lessons", {})), {}
    for c in index.get("cards", []):
        by_lesson.setdefault(c.get("lesson"), []).append(c)
    report = []
    for lid in ids:
        d = resolve_dir(lid)
        if not d:
            sys.stderr.write(f"[harvest] {lid}: no lesson.html under {GEN} or {LIB / 'lessons'}\n")
            report.append({"lesson": lid, "error": "not found"})
            continue
        out = Lesson(lid, d).harvest()
        changed = False if dry else write_if_changed(d / CARDS_F, _dump(out))
        lessons[lid] = {"count": out["counts"]["cards"], "title": out["lesson_title"], "tags": out["tags"], "dir": str(d)}
        by_lesson[lid] = out["cards"]
        report.append({"lesson": lid, "title": out["lesson_title"], **out["counts"], "skipped": out["skipped"], "rewritten": changed})
    if not dry:
        cards = [c for k in sorted(by_lesson) for c in by_lesson[k]]
        write_if_changed(LIB / INDEX_F, _dump({"version": 1, "lessons": dict(sorted(lessons.items())), "cards": cards}))
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("lessons", nargs="*", help="lesson ids (path under ~/Documents/generated)")
    ap.add_argument("--focus", help='a chiron.json label, e.g. "Verb foundation" or "Ordine exam"')
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="extract and count, write nothing")
    a = ap.parse_args(argv)
    ids = list(a.lessons)
    if a.focus:
        ids += focus_ids(a.focus)
    if a.all:
        ids += all_lesson_ids()
    ids = list(dict.fromkeys(ids))
    if not ids:
        ap.error("give lesson ids, --focus TAG or --all")
    rows = run(ids, a.dry_run)
    tot = sum(r.get("cards", 0) for r in rows)
    for r in rows:
        if "error" in r:
            print(f"{r['lesson']}: ERROR {r['error']}")
        else:
            print(f"{r['cards']:4d}  {r['lesson']}  {r['by_source']}  skipped={r['skipped']}{'' if r['rewritten'] or a.dry_run else '  (unchanged)'}")
    print(f"{len(rows)} lessons, {tot} cards{' (dry run: nothing written)' if a.dry_run else ''}")
    return 1 if any("error" in r for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
