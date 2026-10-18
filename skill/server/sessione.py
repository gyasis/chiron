"""Sessione — search Anki, generate production / listening cards, and a chat tutor that routes to them.

    GET  /sessione                  the page (shell/sessione.html)
    POST /api/sessione/search       {query, k=40, decks?, literal?}  semantic U literal, Italian decks
    POST /api/sessione/tag          {cardIds, tag}
    POST /api/sessione/produce      {topic, n=8, level, focus?}      LLM -> "Chiron Produzione" notes + Lucrezia audio
    POST /api/sessione/quaderno     {lines, deck?}                   LLM-corrected lines -> "Chiron Ascolto" notes + audio
    POST /api/sessione/tutor        {message}                        intent router: produce|listen|lesson|explain
    GET  /api/sessione/deck?name=   cards of a deck, for drilling

Every failure names its cause: 503 when Anki / OmniVoice / the model is down, 400 on bad input.
The model is the mock-oral examiner path (Ollama Cloud, gemma4:31b -> deepseek fallback) with
think:false; _ollama() reports any emitted reasoning, which is logged here and surfaced in `usage`.
"""
import json, os, random, re, sys, time, unicodedata, urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

import anki
import fail_fast
import local_models
import mock_oral
import voice

SKILL = mock_oral.SKILL
SELF_URL = os.environ.get("CHIRON_SELF_URL", "http://127.0.0.1:8911")
ITALIAN_DECKS = ["Medical Italian", "il centro di italia", "Italiano",
                 "Italian listening exercises with ITA / ENG text", "chiron::Pimsleur", "Chiron"]
SEM_FLOOR = 0.30
SEM_BAND = 0.10          # semantic hits must score within this of the best hit

router = APIRouter()


def _log(stage: str, msg: str) -> None:
    sys.stderr.write(f"[sessione] {stage}: {msg}\n")


# ── LLM ───────────────────────────────────────────────────────────────────────

GATEWAY_URL = os.environ.get("CHIRON_SESSIONE_LLM_URL", "http://127.0.0.1:37400/v1").rstrip("/")
GATEWAY_MODEL = os.environ.get("CHIRON_SESSIONE_MODEL", "gpt-4o-mini")
SESSIONE_DEADLINE_S = float(os.environ.get("CHIRON_SESSIONE_DEADLINE_S") or 60)


def _gateway_is_governor() -> bool:
    """The gateway is the governor's ollama (…/llm/ollama/v1). Its /v1 path cannot carry num_ctx, so the
    call goes to the native /api/chat instead (the examiner path: num_ctx, lease check, think:false)."""
    return GATEWAY_URL.startswith(local_models.GOVERNOR.rstrip("/"))


def _gateway_json(system: str, user: str) -> tuple[dict, dict]:
    """Local LiteLLM gateway (OpenAI-compatible). gpt-4o-mini is a non-reasoning model:
    verified 2026-10-14 reasoning_tokens=0, ~1.4 s. Primary since Ollama Cloud hit its weekly cap."""
    if _gateway_is_governor():
        text, usage = mock_oral._ollama(GATEWAY_MODEL, system, user, "", local=True)
        return mock_oral.parse_json(text), usage
    payload = {"model": GATEWAY_MODEL, "temperature": 0.4,
               "response_format": {"type": "json_object"},
               "messages": [{"role": "system", "content": system},
                            {"role": "user", "content": user}]}
    # Thinking models (e.g. gemma4 on the Mac) need thinking OFF on /v1/chat/completions.
    # Set CHIRON_SESSIONE_REASONING_EFFORT="" to omit it for a gateway that rejects the field.
    effort = os.environ.get("CHIRON_SESSIONE_REASONING_EFFORT", "none")
    if effort:
        payload["reasoning_effort"] = effort
    body = json.dumps(payload).encode()
    req = urllib.request.Request(f"{GATEWAY_URL}/chat/completions", body, {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=fail_fast.attempt_timeout(90, fail_fast.modal_reserve())) as r:
        d = json.loads(r.read())
    usage = d.get("usage") or {}
    return json.loads(d["choices"][0]["message"]["content"]), usage


def llm_json(system: str, user: str, stage: str) -> dict:
    """One JSON object: local gateway first, then the examiner-path models (thinking off), then the Modal
    lane — all under ONE deadline (SESSIONE_DEADLINE_S; an enclosing action's scope wins). 503 if none works."""
    with fail_fast.scope(SESSIONE_DEADLINE_S, "sessione"):
        return _llm_json(system, user, stage)


def _llm_json(system: str, user: str, stage: str) -> dict:
    tried = []
    t = time.time()
    out_of_time = False
    try:
        out, usage = _gateway_json(system, user)
        rt = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens", 0)
        _log(stage, f"{GATEWAY_MODEL} ok {time.time() - t:.1f}s reasoning_tokens={rt}")
        return out
    except fail_fast.DeadlineExceeded as e:
        tried.append(f"gateway {GATEWAY_MODEL}: {e}"[:320])
        _log(stage, "FAILED " + tried[-1])
        out_of_time = True
    except Exception as e:
        tried.append(f"gateway {GATEWAY_MODEL}: {type(e).__name__}: {e}"[:320])
        _log(stage, "FAILED " + tried[-1])
    key = os.environ.get("OLLAMA_API_KEY", "")
    mock_oral.refresh_examiners()
    for k in [] if out_of_time else mock_oral.fallback_chain(mock_oral.default_examiner(), mock_oral.EXAMINERS):
        ex = mock_oral.EXAMINERS[k]
        if ex.get("local") and _gateway_is_governor() and ex["model"] == GATEWAY_MODEL:
            continue                                    # the gateway attempt above was this exact model
        t = time.time()
        try:
            if not key and not ex.get("local"):
                raise RuntimeError("OLLAMA_API_KEY not set")
            text, usage = mock_oral._ollama(ex["model"], system, user, key, ex.get("local", False))
            out = mock_oral.parse_json(text)
            _log(stage, f"{ex['model']} ok {time.time() - t:.1f}s thinking_chars={usage['thinking_chars']}")
            return out
        except fail_fast.DeadlineExceeded as e:
            tried.append(f"{k}: {e}"[:320])
            _log(stage, "FAILED " + tried[-1])
            break                                       # no time for another governor/cloud attempt
        except Exception as e:
            body = ""
            if hasattr(e, "read"):                      # HTTPError: the body says WHY (e.g. weekly usage limit)
                try:
                    body = " " + e.read()[:200].decode(errors="replace")
                except Exception:
                    pass
            tried.append(f"{k}: {type(e).__name__}: {e}{body}"[:320])
            _log(stage, "FAILED " + tried[-1])
    t = time.time()
    try:                                                # the one rung that is not the governor
        text, usage = fail_fast.modal_chat(system, user)
        out = mock_oral.parse_json(text)
        _log(stage, f"{fail_fast.MODAL_MODEL} ok {time.time() - t:.1f}s reasoning_chars={usage['reasoning_chars']}")
        return out
    except Exception as e:
        tried.append(f"modal: {type(e).__name__}: {e}"[:320])
        _log(stage, "FAILED " + tried[-1])
    raise HTTPException(503, "language model unavailable: " + " | ".join(tried))


def _guard(stage: str, fn, *a, **kw):
    """Run fn, mapping infrastructure failures to actionable 503s."""
    try:
        return fn(*a, **kw)
    except HTTPException:
        raise
    except anki.AnkiUnavailable as e:
        _log(stage, f"anki down: {e}")
        raise HTTPException(503, f"Anki is unreachable (open Anki on the MacBook): {e}")
    except voice.VoiceUnavailable as e:
        _log(stage, f"voice down: {e}")
        raise HTTPException(503, f"Lucrezia voice unavailable: {e}")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _log(stage, f"{type(e).__name__}: {e}")
        raise HTTPException(500, f"{stage} failed: {type(e).__name__}: {e}")


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40] or "topic"


# ── validation ────────────────────────────────────────────────────────────────

def validate_prod(raw) -> dict | None:
    """A clean production item, or None if the model's item is unusable."""
    if not isinstance(raw, dict):
        return None
    sit, ans = str(raw.get("situation_en") or "").strip(), str(raw.get("answer_it") or "").strip()
    bank = [str(w).strip() for w in (raw.get("word_bank") or []) if str(w).strip()]
    if not sit or not ans or len(bank) < 4:
        return None
    verbs = []
    for v in raw.get("verbs") or []:
        if isinstance(v, dict) and str(v.get("inf") or "").strip():
            verbs.append({"inf": str(v["inf"]).strip(), "form": str(v.get("form") or "").strip()})
    bank = list(dict.fromkeys(bank))[:8]
    random.shuffle(bank)
    return {"situation_en": sit, "word_bank": bank, "verbs": verbs, "answer_it": ans,
            "notes": str(raw.get("notes") or "").strip()}


def validate_quaderno(raw) -> dict | None:
    if not isinstance(raw, dict) or not str(raw.get("it") or "").strip():
        return None
    return {"it": str(raw["it"]).strip(), "en": str(raw.get("en") or "").strip(),
            "note": str(raw.get("note") or "").strip()}


# ── search / tag / deck ───────────────────────────────────────────────────────

_STOP = set("il lo la i gli le un uno una di da in con su per tra fra a al allo alla ai agli alle del dello della dei degli "
             "delle dal dalla dai nel nella nei sul sulla e o ma che non mi ti si ci vi è the of to and a an in on for with".split())


def _lit_query(query: str, decks: list[str], any_word: bool = False) -> str:
    """Anki search over the Italian decks. Filler words are dropped (an AND on 'al' found nothing useful);
    any_word=True ORs the content words, used when the all-words search comes back thin."""
    words = [w for w in re.findall(r"[\w'’]+", query) if len(w) > 1 and w.lower() not in _STOP] \
        or [w for w in re.findall(r"[\w'’]+", query) if len(w) > 1]
    deck_q = " or ".join('"deck:%s"' % d.replace('"', "") for d in decks)
    terms = ('"%s"' % w for w in words)
    return f"({deck_q}) " + (f"({' or '.join(terms)})" if any_word and len(words) > 1 else " ".join(terms))


def search(query: str, k: int = 40, decks: list[str] | None = None, literal: bool = True) -> list[dict]:
    query = (query or "").strip()
    if not query:
        raise ValueError("query is required")
    decks = decks or ITALIAN_DECKS
    lowd = [d.lower() for d in decks]
    inscope = lambda c: any(c["deck"].lower().startswith(d) for d in lowd)
    out, seen = [], set()

    def take(cs, via):
        for c in cs:
            if c["cardId"] in seen or not inscope(c):
                continue
            seen.add(c["cardId"])
            out.append({**c, "via": via})

    try:
        import cards as cardsmod
        raw = cardsmod.relevant(query, k=k, balance=False)
        # bge-m3 scores are compressed (2026-10-14, "segreto professionale": on-topic 0.50-0.58, noise 0.43-0.49),
        # so an absolute floor can't separate them; keep what is close to the best hit instead.
        top = max((c.get("score", 0) for c in raw), default=0)
        cut = max(SEM_FLOOR, top - SEM_BAND)
        sem = [c for c in raw if c.get("score", 0) >= cut]
        take(sem, "semantic")
    except Exception as e:                      # index missing / embed server down: literal still works
        _log("search", f"semantic skipped: {type(e).__name__}: {e}")
    if literal:
        words = re.findall(r"[\w'’]+", query)
        if words:
            before = len(out)
            take(anki.cards(_lit_query(query, decks), limit=k), "literal")
            if len(out) - before < 10:
                take(anki.cards(_lit_query(query, decks, any_word=True), limit=k), "literal-any")
    out = out[:k] if len(out) > k else out
    meta = anki.notes_for_cards([c["cardId"] for c in out])
    for c in out:
        c["tags"] = meta.get(c["cardId"], {}).get("tags", [])
    _log("search", f"{query!r} -> {len(out)} cards")
    return out


def tag(card_ids: list[int], tg: str) -> dict:
    tg = (tg or "").strip().replace(" ", "_")
    if not card_ids or not tg:
        raise ValueError("cardIds and tag are required")
    meta = anki.notes_for_cards(card_ids)
    nids = sorted({m["noteId"] for m in meta.values()})
    anki.add_tags(nids, tg)
    _log("tag", f"{tg} -> {len(nids)} notes")
    return {"ok": True, "tagged": len(nids)}


def _strip(html: str) -> str:
    return " ".join(anki.TAG.sub(" ", anki.SOUND.sub("", html or "")).replace("&nbsp;", " ").split())


def deck_cards(name: str) -> list[dict]:
    if not name:
        raise ValueError("name is required")
    ids = anki.invoke("findCards", query=f'"deck:{name}"') or []
    out = []
    for c in anki.invoke("cardsInfo", cards=ids) if ids else []:
        f = {k: v.get("value", "") for k, v in (c.get("fields") or {}).items()}
        m = anki.SOUND.search(f.get("Audio", "") or "")
        base = {"cardId": c["cardId"], "noteId": c.get("note"), "deck": c.get("deckName"),
                "due": c.get("due"), "interval": c.get("interval"), "tags": [], "model": c.get("modelName"),
                "audio": m.group(1) if m else None}
        if c.get("modelName") == anki.PROD_MODEL:
            out.append({**base, "kind": "produzione", "situation_en": _strip(f.get("Situazione")),
                        "word_bank": [_strip(x) for x in re.findall(r'<span class="chip">(.*?)</span>', f.get("Banca", ""))],
                        "verbs": _parse_verbs(_strip(f.get("Verbi"))), "answer_it": _strip(f.get("Risposta")),
                        "notes": _strip(f.get("Note")), "front": _strip(f.get("Situazione")),
                        "back": _strip(f.get("Risposta"))})
        elif c.get("modelName") == anki.LISTEN_MODEL:
            out.append({**base, "kind": "ascolto", "it": _strip(f.get("Italiano")), "en": _strip(f.get("English")),
                        "notes": _strip(f.get("Note")), "front": _strip(f.get("Italiano")),
                        "back": _strip(f.get("English"))})
        else:
            fr, au1 = anki._clean(anki._field(c.get("fields") or {}, anki.FRONT_KEYS))
            bk, au2 = anki._clean(anki._field(c.get("fields") or {}, anki.BACK_KEYS))
            out.append({**base, "kind": "basic", "front": fr, "back": bk, "audio": base["audio"] or au1 or au2})
    meta = anki.notes_for_cards([c["cardId"] for c in out]) if out else {}
    for c in out:
        c["tags"] = meta.get(c["cardId"], {}).get("tags", [])
    return out


def _parse_verbs(s: str) -> list[dict]:
    """'esaminare (passato prossimo, io); andare' -> [{inf, form}] — the stored Verbi field back into the API shape."""
    out = []
    for part in (s or "").split(";"):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(.*?)\s*\((.*)\)\s*$", part)
        out.append({"inf": m.group(1).strip(), "form": m.group(2).strip()} if m else {"inf": part, "form": ""})
    return out


# ── produce ───────────────────────────────────────────────────────────────────

PRODUCE_SYS = """Sei un tutor di italiano per un medico straniero che prepara l'esame di lingua all'Ordine dei Medici di Napoli. \
Crei esercizi di PRODUZIONE: una situazione in inglese, una banca di parole italiane, e la frase italiana corretta che il candidato deve costruire dicendola ad alta voce.

Se l'argomento è medico, le situazioni sono cliniche / da esame Ordine (anamnesi, pronto soccorso, consenso, istruzioni al paziente, colloquio con colleghi). Altrimenti sono di vita quotidiana.
Livello richiesto: {level}. Focus grammaticale: {focus}.

Rispondi SOLO con un oggetto JSON:
{{"items": [{{
 "situation_en": "la FRASE ESATTA in inglese da dire, in prima persona o rivolta a qualcuno, es. 'Tell the patient: I prescribed you an antibiotic yesterday.' — NON una descrizione vaga",
 "word_bank": ["5-8 parole italiane: quelle che servono + 2 distrattori plausibili dello STESSO campo (non parole assurde); per i verbi usa l'INFINITO"],
 "verbs": [{{"inf": "infinito", "form": "forma da usare, es. 'passato prossimo, io'"}}],
 "answer_it": "UNA frase italiana naturale come la direbbe un medico italiano (max 25 parole). NIENTE pronome soggetto ridondante ('Io ho…' → 'Ho…'). Articoli e preposizioni articolate corretti.",
 "notes": "un consiglio grammaticale in inglese, una riga, ESATTO e specifico per questa frase (es. 'arrivare takes essere: sono arrivato/a'). Non dire che tutti i verbi intransitivi vogliono essere."
}}]}}
REGISTRO: con pazienti, commissione e colleghi non conosciuti usa SEMPRE il Lei formale (es. 'Le ho prescritto…', 'L'ho visitata…', 'Si accomodi'), mai il tu. \
Ogni parola della banca deve essere italiano scritto correttamente (MAI parole inglesi). \
answer_it traduce ESATTAMENTE situation_en: stesso contenuto, nessuna frase o informazione aggiunta. \
Se c'è un accordo del participio (pronome diretto lo/la/li/le, verbi con essere) il consiglio lo spiega.
Genera esattamente {n} esercizi diversi tra loro, con verbi diversi (preferisci verbi irregolari frequenti quando il focus è un tempo verbale). Le parole nella banca (tranne i distrattori) devono permettere di costruire answer_it. Ricontrolla ogni answer_it: deve essere grammaticalmente perfetta."""


def produce(topic: str, n: int = 8, level: str = "A2-B1", focus: str | None = None,
            _extra_tags: list[str] | None = None) -> dict:
    topic = (topic or "").strip()
    if not topic:
        raise ValueError("topic is required")
    n = max(1, min(int(n or 8), 20))
    t0 = time.time()
    raw = llm_json(PRODUCE_SYS.format(level=level, focus=focus or "nessuno in particolare", n=n),
                   f"Argomento: {topic}", "produce")
    items = [v for v in (validate_prod(r) for r in (raw.get("items") or [])) if v][:n]
    _log("produce", f"{len(items)}/{n} valid items for {topic!r}")
    if not items:
        raise HTTPException(502, "the model returned no valid production items — try again or rephrase the topic")
    for i, it in enumerate(items):                      # voice first: a TTS outage adds nothing half-way
        it["voice"], it["speed"] = voice.pick(i, topic)  # rotate speakers + pace across the batch
        it["audio"] = voice.say(it["answer_it"], it["voice"], it["speed"])
    anki.ensure_models()
    tags = ["sessione", "produzione", slug(topic)] + (_extra_tags or [])
    added = dup = 0
    for it in items:
        fields = {"Situazione": it["situation_en"], "Banca": anki.chips(it["word_bank"]),
                  "Verbi": "; ".join(f"{v['inf']} ({v['form']})" if v["form"] else v["inf"] for v in it["verbs"]),
                  "Risposta": it["answer_it"], "Audio": f"[sound:{it['audio']}]", "Note": it["notes"]}
        res = anki.add_notes([{"fields": fields}], deck=anki.PROD_DECK, tags=tags + [f"voce::{it['voice']}"],
                             model=anki.PROD_MODEL)
        if res["noteIds"]:
            it["noteId"] = res["noteIds"][0]
            ci = anki.invoke("findCards", query=f"nid:{it['noteId']}") or []
            it["cardId"] = ci[0] if ci else None
            added += 1
        else:
            it["noteId"] = it["cardId"] = None
            dup += 1
    _log("produce", f"added={added} dup={dup} in {time.time() - t0:.0f}s")
    return {"items": items, "anki": {"added": added, "duplicates": dup, "deck": anki.PROD_DECK}}


# ── quaderno ──────────────────────────────────────────────────────────────────

QUADERNO_SYS = """Sei un tutor di italiano per un medico straniero. Ricevi UNA riga scritta dall'allievo: può essere italiano con errori, \
italiano corretto, o inglese da tradurre. Rispondi SOLO con un oggetto JSON:
{"it": "la frase in italiano corretto e naturale (mantieni il contenuto dell'allievo)",
 "en": "traduzione inglese", "note": "cosa hai corretto, in inglese, breve; stringa vuota se nulla"}"""


def quaderno(lines: list[str], deck: str | None = None, _extra_tags: list[str] | None = None) -> dict:
    lines = [l.strip() for l in (lines or []) if isinstance(l, str) and l.strip()]
    if not lines:
        raise ValueError("lines is required (non-empty list of strings)")
    deck = deck or anki.QUADERNO_DECK
    items = []
    for l in lines[:30]:
        v = validate_quaderno(llm_json(QUADERNO_SYS, l, "quaderno"))
        if v:
            items.append(v)
        else:
            _log("quaderno", f"invalid reply for {l!r}, skipped")
    if not items:
        raise HTTPException(502, "the model returned no usable lines")
    for i, it in enumerate(items):
        it["voice"], it["speed"] = voice.pick(i, "|".join(lines))
        it["audio"] = voice.say(it["it"], it["voice"], it["speed"])
    anki.ensure_models()
    added = dup = 0
    for it in items:
        fields = {"Audio": f"[sound:{it['audio']}]", "Italiano": it["it"], "English": it["en"], "Note": it["note"]}
        res = anki.add_notes([{"fields": fields}], deck=deck,
                             tags=["sessione", "quaderno", "audio::it", "audio::fronte", f"voce::{it['voice']}"]
                             + (_extra_tags or []), model=anki.LISTEN_MODEL)
        if res["noteIds"]:
            it["noteId"] = res["noteIds"][0]
            ci = anki.invoke("findCards", query=f"nid:{it['noteId']}") or []
            it["cardId"] = ci[0] if ci else None
            added += 1
        else:
            it["noteId"] = it["cardId"] = None
            dup += 1
    _log("quaderno", f"added={added} dup={dup}")
    return {"items": [{k: it[k] for k in ("noteId", "cardId", "it", "en", "audio", "note")} for it in items],
            "anki": {"added": added, "duplicates": dup, "deck": deck}}


# ── tutor ─────────────────────────────────────────────────────────────────────

INTENT_SYS = """Classifica la richiesta di un medico che studia italiano per l'esame dell'Ordine. Rispondi SOLO con JSON:
{"intent": "produce" | "listen" | "lesson" | "explain",
 "topic": "argomento in poche parole (italiano o inglese)",
 "focus": "punto grammaticale, o stringa vuota",
 "n": numero di elementi richiesti (default 8)}
produce = vuole esercizi/carte di produzione (costruire frasi, parlare). listen = vuole carte da ascoltare e ripetere, audio, dettato. \
lesson = vuole una lezione completa su un argomento. explain = vuole una spiegazione o risposta breve."""

LISTEN_SYS = """Scrivi {n} frasi italiane naturali e corrette per un medico che studia per l'esame dell'Ordine, sull'argomento dato. \
Livello A2-B1, max 20 parole, un solo concetto per frase. Rispondi SOLO con JSON: {{"sentences": ["...", ...]}}"""

EXPLAIN_SYS = """Sei un tutor di italiano per un medico straniero. Rispondi in inglese, breve (max 6 frasi), con 2-3 esempi italiani. \
Rispondi SOLO con JSON: {"answer": "..."}"""


def _post_json(url: str, body: dict, timeout: int = 60) -> dict:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    except urllib.error.HTTPError as e:
        raise HTTPException(e.code, f"{url}: {e.read()[:300].decode(errors='replace')}")
    except Exception as e:
        raise HTTPException(503, f"{url} unreachable: {type(e).__name__}: {e}")


def tutor(message: str) -> dict:
    message = (message or "").strip()
    if not message:
        raise ValueError("message is required")
    with fail_fast.scope(SESSIONE_DEADLINE_S, "sessione tutor"):   # intent + answer share one deadline
        return _tutor(message)


def _tutor(message: str) -> dict:
    r = llm_json(INTENT_SYS, message, "tutor.intent")
    intent = r.get("intent") if r.get("intent") in ("produce", "listen", "lesson", "explain") else "explain"
    topic = str(r.get("topic") or message).strip()
    try:
        n = int(r.get("n") or 8)
    except (TypeError, ValueError):
        n = 8
    _log("tutor", f"intent={intent} topic={topic!r} n={n}")
    if intent == "produce":
        return {"intent": intent, "topic": topic, **produce(topic, n=n, focus=r.get("focus") or None)}
    if intent == "listen":
        s = llm_json(LISTEN_SYS.format(n=min(n, 12)), f"Argomento: {topic}", "tutor.listen")
        sents = [x for x in (s.get("sentences") or []) if isinstance(x, str) and x.strip()]
        if not sents:
            raise HTTPException(502, "the model returned no sentences")
        return {"intent": intent, "topic": topic, **quaderno(sents, _extra_tags=[slug(topic)])}
    if intent == "lesson":
        res = _post_json(f"{SELF_URL}/generate", {"subject": topic, "domain": "language-it"})
        return {"intent": intent, "topic": topic, **res}
    a = llm_json(EXPLAIN_SYS, message, "tutor.explain")
    return {"intent": "explain", "topic": topic, "answer": str(a.get("answer") or "").strip()}


# ── routes (sync defs: FastAPI runs them in its threadpool, so slow TTS never blocks the loop) ──

@router.get("/sessione", response_class=HTMLResponse)
def page():
    return HTMLResponse((SKILL / "shell" / "sessione.html").read_text(),
                        headers={"Cache-Control": "no-cache, must-revalidate"})


@router.post("/api/sessione/search")
def api_search(b: dict):
    return {"cards": _guard("search", search, b.get("query"), int(b.get("k") or 40),
                            b.get("decks") or None, b.get("literal", True))}


@router.post("/api/sessione/tag")
def api_tag(b: dict):
    return _guard("tag", tag, b.get("cardIds") or [], b.get("tag"))


@router.post("/api/sessione/produce")
def api_produce(b: dict):
    return _guard("produce", produce, b.get("topic"), b.get("n") or 8, b.get("level") or "A2-B1", b.get("focus"))


@router.post("/api/sessione/quaderno")
def api_quaderno(b: dict):
    return _guard("quaderno", quaderno, b.get("lines"), b.get("deck"))


@router.post("/api/sessione/tutor")
def api_tutor(b: dict):
    return _guard("tutor", tutor, b.get("message"))


@router.get("/api/sessione/deck")
def api_deck(name: str = ""):
    return {"cards": _guard("deck", deck_cards, name)}
