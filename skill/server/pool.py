"""Pool — words missed in Match Madness become LISTENING drills: up to N example sentences per word, with audio.

Method: Jeremiah "How to Learn Words FAST" — audio-only front, grade on comprehension only, listen-loop.

    POST /api/pool/weak    {device, words:[{it,en,wrong,hesitations,seen,mastered,flavour}]}  merge into state/pool/weak.json
    GET  /api/pool/weak    ?limit=                 ranked by wrong*2+hesitations desc, recent first, mastered excluded
    POST /api/pool/gather  {words:[{it,en?}], cap=5, dry?}     -> {items:[{word:{it,en,audio}, sentences:[...], sources, short}]}
    POST /api/pool/more    {word:{it,en?}, add=5}              the next batch for one word, never repeating
    GET  /ascolto          the drill page (shell/ascolto.html)

Sentence sources, in priority order, until the cap is met:
  1 anki   existing cards in the Italian decks (reused first; the cardId is returned so grades write to that card)
  2 baby   Baby S01 transcript lines -> ffmpeg clip -> new `Chiron Ascolto` note in Chiron::Pool
  3 mm     Match Madness corpora (data/*.json frasi) -> OmniVoice -> new note
  4 gen    LLM writes an easy A2-B1 sentence (thinking OFF, via sessione.llm_json) -> OmniVoice -> new note
Every note used or created is tagged pool::it::audio + pool::word::<slug>; new ones also pool::new.
`dry:true` reads Anki only: no tagging, no notes, no TTS, no media.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, threading, time, unicodedata
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

import anki
import sessione
import voice

SKILL = sessione.SKILL
STATE = SKILL / "server" / "state" / "pool"
WEAK_F, GATHERED_F, WORDS_F = STATE / "weak.json", STATE / "gathered.json", STATE / "words.json"
POOL_DECK = "Chiron::Pool"
BABY_ROOT = Path(os.environ.get("CHIRON_LIBRARY", Path.home() / "Documents/generated/chiron-library")) / "lessons"
MM_DATA = Path(os.environ.get("CHIRON_MM_DATA", Path.home() / "Documents/code/match-madness/data"))
DEFAULT_CAP = 5
MIN_WORDS, MAX_WORDS = 3, 25            # a "sentence" for this drill: not a fragment, not a paragraph
ANKI_ROOTS = ["italian 15 000 sentences easier to hardest pt2", "Italian listening exercises with ITA / ENG text",
              "Medical Italian", "il centro di italia", "chiron"]
ANKI_SCAN = 400                         # max notes read per word (a stem like "pa" could match thousands)

router = APIRouter()
_lock = threading.RLock()               # state files
_tts = threading.Lock()                 # OmniVoice on the Mac takes ONE request at a time


def _log(stage: str, msg: str) -> None:
    sys.stderr.write(f"[pool] {stage}: {msg}\n")


# ── text helpers ──────────────────────────────────────────────────────────────

def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return s.replace("’", "'")


def tokens(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", fold(s))


def slug(word: str) -> str:
    return "-".join(tokens(word))[:40] or "word"


def tid(text: str) -> str:
    """Stable id of a sentence: its folded tokens. The same sentence from two sources is one sentence."""
    return hashlib.sha1(" ".join(tokens(text)).encode()).hexdigest()[:14]


def _stem(w: str) -> str:
    for suf in ("are", "ere", "ire"):
        if w.endswith(suf) and len(w) - 3 >= 4:
            return w[:-3]
    if w[-1:] in "aeiou" and len(w) >= 5:
        return w[:-1]
    return w


def match_kind(word: str, text: str) -> str | None:
    """'exact' if `word` occurs as whole word(s) in `text`; 'stem' if the last word only differs by a simple
    inflection (shared stem, <=3-4 extra letters); else None. Accent- and case-folded."""
    wt, tt = tokens(word), tokens(text)
    if not wt or len(tt) < len(wt):
        return None
    k, last = len(wt), wt[-1]
    stem = _stem(last)
    stem_ok = len(stem) >= 4
    best = None
    for i in range(len(tt) - k + 1):
        if tt[i:i + k - 1] != wt[:-1]:
            continue
        t = tt[i + k - 1]
        if t == last:
            return "exact"
        if stem_ok and t.startswith(stem) and len(t) <= len(last) + 4:
            best = "stem"
    return best


def sentence_ok(text: str) -> bool:
    return MIN_WORDS <= len(tokens(text)) <= MAX_WORDS


# ── Anki: field mapping ───────────────────────────────────────────────────────

# model -> (italian field, english field, audio field). A rule per MODEL, never "Front/Back": the 15k deck alone
# holds five note types, and subs2srs stores the Italian line in `Reading` and the English in `Meaning`.
FIELD_MAP = {
    "hirasawa_yui-9e1ef": ("sentence", "english translation", "audio"),
    "Basic-a8344": ("sentence", "translation", "Front"),
    "z italian sentences deck": ("sentence", "sentence english", "audio"),
    "0 Neri's Sentences (Read)": ("Sentence", "Sentence (English)", "[1]"),
    "0 Neri's Sentences (Speak)": ("Sentence", "Sentence (English)", "[1]"),
    "subs2srs": ("Reading", "Meaning", "Audio"),
    anki.LISTEN_MODEL: ("Italiano", "English", "Audio"),
}
BASIC_MODELS = ("Basic", "Basic (and reversed card)")   # Front/Back, direction told by where the [sound:] sits
DIFFICULTY_KEYS = ("frequency ranks", "freq ranks", "difficulty index")


def _val(note: dict, name: str) -> str:
    return (note.get("fields", {}).get(name) or {}).get("value", "") or ""


def _nums(s: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", s or "")]


def extract(note: dict) -> dict | None:
    """One note -> {it, en, audio, difficulty} or None (no audio, no Italian, or a model we do not map)."""
    model = note.get("modelName", "")
    if model in FIELD_MAP:
        f_it, f_en, f_au = FIELD_MAP[model]
        it_raw, en_raw, au_raw = _val(note, f_it), _val(note, f_en), _val(note, f_au)
    elif model in BASIC_MODELS:
        front, back = _val(note, "Front"), _val(note, "Back")
        if anki.SOUND.search(front):
            it_raw, en_raw, au_raw = front, back, front
        elif anki.SOUND.search(back):          # chiron::Pimsleur: English front, Italian + audio back
            it_raw, en_raw, au_raw = back, front, back
        else:
            return None
    else:
        return None
    m = anki.SOUND.search(au_raw)
    if not m:
        return None
    it = " ".join(anki.TAG.sub("", anki.SOUND.sub("", it_raw.replace("<br>", " / ").replace("<br/>", " / "))).split())
    en = anki._clean(re.split(r"<br\s*/?>", en_raw)[0])[0]      # first line only: il centro appends teacher notes
    it = re.sub(r"(\s*/\s*)+$", "", it).strip()
    if not it or not en:
        return None
    diff = 0
    for k in DIFFICULTY_KEYS:
        n = _nums(_val(note, k))
        if n:
            diff = max(n)
            break
    return {"it": it, "en": en, "audio": m.group(1), "difficulty": diff}


def rank_key(kind: str, nwords: int, difficulty: int) -> tuple:
    """Exact before inflected; shorter (easier) first; then rarer-word rank / difficulty index."""
    return (0 if kind == "exact" else 1, min(nwords, 14) // 3, difficulty, nwords)


def anki_query(word: str) -> str:
    """Substring search on the stem, in the TYPED spelling (Anki does not fold accents); whole-word filtering is ours."""
    raws = re.sub(r"[^\w' ]", " ", word.strip().lower()).split()
    if not raws:
        raise ValueError("empty word")
    last_toks = tokens(raws[-1]) or [raws[-1]]
    stem_len = len(_stem(last_toks[-1]))
    last = raws[-1][:stem_len] if stem_len >= 4 else raws[-1]
    roots = " or ".join(f'"deck:{r}"' for r in ANKI_ROOTS)
    return f'({roots}) "{" ".join(raws[:-1] + [last])}"'


def anki_candidates(word: str, exclude: set[str]) -> list[dict]:
    """Ranked, de-duplicated existing sentences for `word`. Read-only."""
    ids = anki.invoke("findNotes", query=anki_query(word)) or []
    if not ids:
        return []
    out, seen = [], set(exclude)
    for n in anki.invoke("notesInfo", notes=ids[:ANKI_SCAN]) or []:
        if not n:
            continue
        x = extract(n)
        if not x or not sentence_ok(x["it"]):
            continue
        kind = match_kind(word, x["it"])
        t = tid(x["it"])
        if not kind or t in seen:
            continue
        seen.add(t)
        x.update(id=t, noteId=int(n["noteId"]), tags=n.get("tags", []), kind=kind,
                 key=rank_key(kind, len(tokens(x["it"])), x["difficulty"]))
        out.append(x)
    out.sort(key=lambda c: c["key"])
    return out


def _source_label(tags: list[str], deck: str, note_text: str) -> tuple[str, str]:
    """(source, label) for an Anki-hosted sentence."""
    t = " ".join(tags)
    if "pool::src::baby" in t:
        return "baby", "Baby S01" + (re.search(r"E\d\d", note_text or "").group(0) if re.search(r"E\d\d", note_text or "") else "")
    if "pool::src::gen" in t:
        return "gen", "Generata · LLM"
    if "pool::src::mm" in t:
        return "mm", "Match Madness"
    return "anki", "Anki · " + (deck.split("::")[-1] if deck else "")


CLIP_RE = re.compile(r"clip=([\w.-]+)\|([\d.]+)\|([\d.]+)")


def finish_anki(cands: list[dict], word: str, tag: bool) -> list[dict]:
    """Attach cardId + deck, tag the notes, shape for the API."""
    if not cands:
        return []
    nids = [c["noteId"] for c in cands]
    cards = anki.invoke("cardsInfo", cards=anki.invoke("findCards", query="nid:" + ",".join(map(str, nids)))) or []
    first = {}
    for c in sorted(cards, key=lambda c: c.get("ord", 0)):
        first.setdefault(int(c["note"]), c)
    notes = {int(n["noteId"]): n for n in (anki.invoke("notesInfo", notes=nids) or []) if n}
    out = []
    for c in cands:
        card = first.get(c["noteId"])
        if not card:
            continue
        note_text = _val(notes.get(c["noteId"], {}), "Note")
        source, label = _source_label(c["tags"], card.get("deckName", ""), note_text)
        s = {"id": c["id"], "it": c["it"], "en": c["en"], "audio": c["audio"], "source": source, "label": label,
             "deck": card.get("deckName", ""), "cardId": int(card["cardId"]), "noteId": c["noteId"], "match": c["kind"]}
        m = CLIP_RE.search(note_text)
        if m:
            s["clip"] = {"slug": m.group(1), "start": float(m.group(2)), "end": float(m.group(3)),
                         "path": f"chiron-library/lessons/{m.group(1)}/episode.mp4"}
        out.append(s)
    if tag and out:
        anki.add_tags([s["noteId"] for s in out], ["pool::it::audio", f"pool::word::{slug(word)}"])
    return out


# ── Baby S01 ──────────────────────────────────────────────────────────────────

_baby: list[dict] | None = None


def baby_lines() -> list[dict]:
    global _baby
    if _baby is None:
        rows = []
        for ep in sorted(BABY_ROOT.glob("chiron-baby-s01e0*")):
            tj = ep / "transcript.json"
            if not tj.is_file() or ep.name.endswith(".chiron"):
                continue
            try:
                d = json.loads(tj.read_text())
            except Exception as e:
                _log("baby", f"{tj}: {type(e).__name__}: {e}")
                continue
            for sc in d.get("scenes", []):
                for ln in sc.get("lines", []):
                    it, en = (ln.get("italian_text") or "").strip(), (ln.get("en_gloss") or "").strip()
                    if it and en and sentence_ok(it) and ln.get("end", 0) > ln.get("start", 0):
                        rows.append({"slug": ep.name, "start": float(ln["start"]), "end": float(ln["end"]),
                                     "who": ln.get("character", ""), "it": it, "en": en})
        _baby = rows
        _log("baby", f"indexed {len(rows)} lines")
    return _baby


def baby_candidates(word: str, exclude: set[str]) -> list[dict]:
    out, seen = [], set(exclude)
    for r in baby_lines():
        kind = match_kind(word, r["it"])
        t = tid(r["it"])
        if kind and t not in seen:
            seen.add(t)
            out.append({**r, "id": t, "kind": kind, "key": rank_key(kind, len(tokens(r["it"])), 0)})
    out.sort(key=lambda c: c["key"])
    return out


def cut_clip(slug_: str, start: float, end: float) -> str:
    """ffmpeg-cut a Baby line to a mono mp3, loudness-normalised with tts-normalize (never ffmpeg loudnorm)."""
    name = f"chiron_baby_{slug_[-6:]}_{int(start * 1000)}.mp3"
    path = voice.CACHE / name
    if not path.exists():
        voice.CACHE.mkdir(parents=True, exist_ok=True)
        src = BABY_ROOT / slug_ / "episode.mp4"
        ss = max(start - 0.2, 0.0)
        with tempfile.TemporaryDirectory() as d:
            raw, norm = Path(d, "raw.wav"), Path(d, "norm.wav")
            voice._run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{ss:.3f}", "-i", str(src),
                        "-t", f"{end + 0.2 - ss:.3f}", "-vn", "-ac", "1", "-ar", "24000", str(raw)])
            tool = shutil.which("tts-normalize") or str(Path.home() / ".local/bin/tts-normalize")
            voice._run([sys.executable, tool, str(raw), str(norm), "-16"])
            tmp = path.with_suffix(".tmp.mp3")
            voice._run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(norm), "-ac", "1", "-b:a", "64k", str(tmp)])
            tmp.replace(path)
    anki.store_media(name, path.read_bytes())
    return name


# ── Match Madness corpora ─────────────────────────────────────────────────────

_mm: list[dict] | None = None


def mm_pairs() -> list[dict]:
    global _mm
    if _mm is None:
        rows = []
        for f in sorted(MM_DATA.glob("*.json")):
            try:
                d = json.loads(f.read_text())
            except Exception as e:
                _log("mm", f"{f.name}: {type(e).__name__}: {e}")
                continue
            for p in d.get("pairs", []) if isinstance(d, dict) else []:
                it, en = (p.get("it") or "").strip(), (p.get("en") or "").strip()
                rows.append({"it": it, "en": en, "file": f.stem, "mode": p.get("mode", "")})
        _mm = rows
        _log("mm", f"indexed {len(rows)} pairs from {MM_DATA}")
    return _mm


def mm_candidates(word: str, exclude: set[str]) -> list[dict]:
    out, seen = [], set(exclude)
    for r in mm_pairs():
        if not r["en"] or not sentence_ok(r["it"]):
            continue
        kind = match_kind(word, r["it"])
        t = tid(r["it"])
        if kind and t not in seen:
            seen.add(t)
            out.append({**r, "id": t, "kind": kind, "key": rank_key(kind, len(tokens(r["it"])), 0)})
    out.sort(key=lambda c: c["key"])
    return out


def mm_translation(word: str) -> str:
    """English for a single word/term from the lessico corpora (exact folded match)."""
    w = " ".join(tokens(word))
    for r in mm_pairs():
        if r["en"] and " ".join(tokens(r["it"])) == w:
            return r["en"]
    return ""


# ── LLM ───────────────────────────────────────────────────────────────────────

GEN_SYS = """Sei un tutor di italiano per un medico straniero (livello A2-B1). Scrivi frasi italiane brevi, naturali e corrette \
(5-12 parole) che contengono la parola data. Frasi facili, quotidiane o cliniche, tutte diverse tra loro. \
Rispondi SOLO con un oggetto JSON: {"sentences": [{"it": "...", "en": "traduzione inglese"}]}"""

WORD_SYS = """Traduci la parola o espressione italiana in inglese (breve, senso medico/quotidiano). \
Rispondi SOLO con JSON: {"en": "..."}"""


def generate(word: str, n: int, avoid: list[str]) -> list[dict]:
    user = (f"Parola: {word}\nNumero di frasi: {n}\n"
            + ("Non ripetere queste frasi:\n" + "\n".join(avoid[:12]) if avoid else ""))
    raw = sessione.llm_json(GEN_SYS, user, "pool-gen")
    out = []
    for s in (raw.get("sentences") if isinstance(raw, dict) else None) or []:
        if isinstance(s, dict) and str(s.get("it") or "").strip() and str(s.get("en") or "").strip():
            it = str(s["it"]).strip()
            if match_kind(word, it) and sentence_ok(it):
                out.append({"it": it, "en": str(s["en"]).strip(), "id": tid(it), "kind": match_kind(word, it)})
    return out


def word_en(word: str, given: str = "", known: str = "", dry: bool = False) -> str:
    """English for the word: caller > weak store > MM lessico > cached > LLM (one tiny call)."""
    en = (given or known or mm_translation(word)).strip()
    if en:
        return en
    with _lock:
        cache = _load(WORDS_F)
    if cache.get(fold(word)):
        return cache[fold(word)]
    if dry:
        return ""
    try:
        en = str(sessione.llm_json(WORD_SYS, word, "pool-word").get("en") or "").strip()
    except HTTPException as e:
        _log("word_en", f"no translation for {word!r}: {e.detail}")
        return ""
    if en:
        with _lock:
            cache = _load(WORDS_F)
            cache[fold(word)] = en
            _save(WORDS_F, cache)
    return en


# ── notes ─────────────────────────────────────────────────────────────────────

def make_note(it: str, en: str, audio: str, word: str, src: str, note: str) -> tuple[int, int]:
    """Create (or find, when it already exists) the `Chiron Ascolto` note; returns (noteId, cardId)."""
    anki.ensure_models()
    tags = ["pool::it::audio", f"pool::word::{slug(word)}", "pool::new", f"pool::src::{src}"]
    fields = {"Audio": f"[sound:{audio}]", "Italiano": it, "English": en, "Note": note}
    res = anki.add_notes([{"fields": fields}], deck=POOL_DECK, tags=tags, model=anki.LISTEN_MODEL)
    if res["noteIds"]:
        nid = int(res["noteIds"][0])
    else:                                     # duplicate in the pool deck: reuse it and attach this word's tag
        found = anki.invoke("findNotes", query=f'"deck:{POOL_DECK}" "Italiano:{it.replace(chr(34), "")}"') or []
        if not found:
            raise RuntimeError(f"note for {it!r} was refused as a duplicate but cannot be found")
        nid = int(found[0])
        anki.add_tags([nid], ["pool::it::audio", f"pool::word::{slug(word)}"])
    cards = anki.invoke("findCards", query=f"nid:{nid}") or []
    if not cards:
        raise RuntimeError(f"note {nid} has no card")
    return nid, int(cards[0])


def _sentence(c: dict, source: str, label: str, nid: int, cid: int, audio: str, clip: dict | None = None) -> dict:
    s = {"id": c["id"], "it": c["it"], "en": c["en"], "audio": audio, "source": source, "label": label,
         "deck": POOL_DECK, "cardId": cid, "noteId": nid, "match": c["kind"]}
    if clip:
        s["clip"] = clip
    return s


# ── state ─────────────────────────────────────────────────────────────────────

def _load(p: Path) -> dict:
    try:
        return json.loads(p.read_text())
    except FileNotFoundError:
        return {}
    except Exception as e:                    # a corrupt state file must not be silently replaced with {}
        raise RuntimeError(f"{p} is unreadable: {type(e).__name__}: {e}")


def _save(p: Path, d: dict) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    tmp.replace(p)


def merge_weak(device: str, words: list[dict]) -> dict:
    now = time.time()
    n = 0
    with _lock:
        store = _load(WEAK_F)
        for w in words or []:
            it = str((w or {}).get("it") or "").strip()
            if not it:
                continue
            old = store.get(slug(it), {})
            store[slug(it)] = {
                "it": it, "en": str(w.get("en") or old.get("en") or ""),
                "wrong": int(w.get("wrong") or 0), "hesitations": int(w.get("hesitations") or 0),
                "seen": int(w.get("seen") or 0), "mastered": bool(w.get("mastered")),
                "flavour": str(w.get("flavour") or old.get("flavour") or ""),
                "device": device or old.get("device", ""), "last_seen": now,
            }
            n += 1
        _save(WEAK_F, store)
    return {"ok": True, "stored": n}


def weak_ranked(limit: int = 20) -> list[dict]:
    with _lock:
        store = _load(WEAK_F)
    rows = [w for w in store.values() if not w.get("mastered")]
    rows.sort(key=lambda w: (-(w.get("wrong", 0) * 2 + w.get("hesitations", 0)), -w.get("last_seen", 0)))
    return rows[:limit]


def _gathered(word: str) -> set[str]:
    with _lock:
        return set(_load(GATHERED_F).get(slug(word), []))


def _remember(word: str, ids: list[str], reset: bool) -> None:
    with _lock:
        g = _load(GATHERED_F)
        g[slug(word)] = ids if reset else list(dict.fromkeys(g.get(slug(word), []) + ids))
        _save(GATHERED_F, g)


# ── gather ────────────────────────────────────────────────────────────────────

def fill(word: str, n: int, exclude: set[str], dry: bool, warn: list[str] | None = None) -> tuple[list[dict], dict, int]:
    """Up to `n` sentences for `word`, source by source. -> (sentences, counts per source, still short)."""
    warn = [] if warn is None else warn
    got: list[dict] = []
    counts = {"anki": 0, "baby": 0, "mm": 0, "gen": 0}
    seen = set(exclude)

    def add(items: list[dict], src_key: str | None = None):
        for s in items:
            seen.add(s["id"])
            got.append(s)
            counts[src_key or s["source"]] = counts.get(src_key or s["source"], 0) + 1

    # 1. existing Anki cards (this includes earlier pool notes: reuse before create)
    cands = anki_candidates(word, seen)[:n]
    add(finish_anki(cands, word, tag=not dry))
    if dry:
        return got, counts, max(n - len(got), 0)

    def room():
        return n - len(got)

    # 2. Baby clips
    for c in baby_candidates(word, seen):
        if room() <= 0:
            break
        try:
            with _tts:
                audio = cut_clip(c["slug"], c["start"], c["end"])
            ep = re.search(r"s01e\d\d", c["slug"]).group(0).upper()
            clip = {"slug": c["slug"], "start": c["start"], "end": c["end"],
                    "path": f"chiron-library/lessons/{c['slug']}/episode.mp4"}
            note = f"Baby {ep} · {c['who']} · {c['start']:.1f}s | clip={c['slug']}|{c['start']}|{c['end']}"
            nid, cid = make_note(c["it"], c["en"], audio, word, "baby", note)
            add([_sentence(c, "baby", f"Baby {ep[:3]}{ep[3:]}", nid, cid, audio, clip)])
        except Exception as e:
            _log("baby", f"{word!r} {c['it'][:40]!r}: {type(e).__name__}: {e}")
    # 3. Match Madness corpora
    for c in mm_candidates(word, seen):
        if room() <= 0:
            break
        try:
            with _tts:
                v, sp = voice.pick(len(got), word)
                audio = voice.say(c["it"], v, sp)
            nid, cid = make_note(c["it"], c["en"], audio, word, "mm", f"Match Madness · {c['file']}")
            add([_sentence(c, "mm", f"Match Madness · {c['file']}", nid, cid, audio)])
        except Exception as e:
            _log("mm", f"{word!r} {c['it'][:40]!r}: {type(e).__name__}: {e}")
    # 4. generate
    if room() > 0:
        try:
            gen = generate(word, room() + 1, [s["it"] for s in got])
        except HTTPException as e:               # model down: keep what Anki/Baby/MM gave, report the gap
            _log("gen", f"{word!r}: model unavailable, returning {len(got)}/{n}: {str(e.detail)[:200]}")
            warn.append(f"generation unavailable: {str(e.detail)[:200]}")
            gen = []
        for c in gen[:room() + 1]:
            if room() <= 0:
                break
            if c["id"] in seen:
                continue
            try:
                with _tts:
                    v, sp = voice.pick(len(got), word)
                    audio = voice.say(c["it"], v, sp)
                nid, cid = make_note(c["it"], c["en"], audio, word, "gen", "Generata · LLM A2-B1")
                add([_sentence(c, "gen", "Generata · LLM", nid, cid, audio)])
            except Exception as e:
                _log("gen", f"{word!r} {c['it'][:40]!r}: {type(e).__name__}: {e}")
    return got, counts, max(room(), 0)


def gather_word(w: dict, cap: int, more: bool = False, dry: bool = False) -> dict:
    it = str(w.get("it") or "").strip()
    if not it:
        raise ValueError("word.it is required")
    cap = max(1, min(int(cap or DEFAULT_CAP), 20))
    with _lock:
        weak_en = (_load(WEAK_F).get(slug(it)) or {}).get("en", "")
    exclude = _gathered(it) if more else set()
    warn: list[str] = []
    sents, counts, short = fill(it, cap, exclude, dry, warn)
    en = word_en(it, w.get("en") or "", weak_en, dry)
    audio = None
    if not dry:
        with _tts:
            audio = voice.say(it)
        _remember(it, [s["id"] for s in sents], reset=not more)
    _log("gather", f"{it!r} more={more} dry={dry} got={len(sents)}/{cap} {counts}")
    return {"word": {"it": it, "en": en, "audio": audio}, "sentences": sents, "sources": counts, "short": short, "warnings": warn}


# ── routes ────────────────────────────────────────────────────────────────────

@router.get("/ascolto", response_class=HTMLResponse)
def page():
    return HTMLResponse((SKILL / "shell" / "ascolto.html").read_text(),
                        headers={"Cache-Control": "no-cache, must-revalidate"})


@router.post("/api/pool/weak")
def api_weak_post(b: dict):
    if not isinstance(b.get("words"), list):
        raise HTTPException(400, "words must be a list")
    return sessione._guard("pool-weak", merge_weak, str(b.get("device") or ""), b["words"])


@router.get("/api/pool/weak")
def api_weak_get(limit: int = 20):
    return {"words": sessione._guard("pool-weak", weak_ranked, max(1, min(limit, 200)))}


@router.post("/api/pool/gather")
def api_gather(b: dict):
    words = b.get("words")
    if not isinstance(words, list) or not words:
        raise HTTPException(400, "words must be a non-empty list of {it, en?}")
    cap, dry = b.get("cap", DEFAULT_CAP), bool(b.get("dry"))
    return {"items": [sessione._guard("pool-gather", gather_word, w if isinstance(w, dict) else {"it": w}, cap, False, dry)
                      for w in words[:12]]}


@router.post("/api/pool/more")
def api_more(b: dict):
    w = b.get("word")
    if not isinstance(w, dict):
        raise HTTPException(400, "word must be {it, en?}")
    return sessione._guard("pool-more", gather_word, w, b.get("add", DEFAULT_CAP), True, bool(b.get("dry")))
