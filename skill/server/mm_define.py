"""mm_define — Match Madness "Il compito": define the words and phrases the decks do not have.

    POST /api/mm/define   {terms:[str,...], lang_hint?: "it"|"en"}
        -> {items:[{term, it, en, kind:'word'|'phrase'|'verb-form', lemma?, note?} | {term, error}], model, thinking_chars}

The phone previews every item and the human says OK before anything is saved, so this only PROPOSES a pair.
One batched call for the whole list, ONE total deadline (CHIRON_MM_DEFINE_DEADLINE_S, 20 s), and a bad or missing
item becomes a per-term {term, error} instead of failing the batch. A dead model is a 503 that names the cause.

The model is whatever Sessione is configured with (sessione._gateway_json: the governed local lane, thinking off,
no output cap). Nothing is chosen here. Thinking is measured, not assumed: `thinking_chars` is what the call emitted.
"""
import os, re, sys, time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import fail_fast
import sessione

router = APIRouter()

DEADLINE_S = float(os.environ.get("CHIRON_MM_DEFINE_DEADLINE_S") or 20)
MAX_TERMS, MAX_TERM_CHARS = 40, 200
KINDS = ("word", "phrase", "verb-form")

SYSTEM = """You are an Italian-English dictionary for an English speaker learning Italian.
You get a numbered list of terms. A term may be Italian or English, a single word or a whole phrase.
For EACH term give the pair a flashcard needs: `it` the natural Italian, `en` the natural English.
- Italian term -> keep it (fix obvious spelling/accents), give its English.
- English term -> give the natural Italian.
- A conjugated or inflected form ("ho detto", "vado") -> kind "verb-form", give the infinitive in `lemma`.
- `kind` is "word" for one lexical item, "phrase" for anything longer, "verb-form" as above.
- `note` is optional: ONE short learner tip (gender, irregularity, register) only if it truly helps; otherwise omit it.
- Keep `it` and `en` short and literal. Never invent a meaning: if you do not know the term, set `error` to why.
Reply with ONE JSON object and nothing else:
{"items":[{"i":0,"term":"<as given>","it":"...","en":"...","kind":"word","lemma":"...","note":"..."}]}
One item per input number, same `i`."""


class DefineIn(BaseModel):
    terms: list[str]
    lang_hint: str | None = None


def _log(msg: str) -> None:
    sys.stderr.write(f"[mm-define] {msg}\n")


def _clean_terms(raw: list[str]) -> list[str]:
    seen, out = set(), []
    for t in raw:
        t = re.sub(r"\s+", " ", str(t or "")).strip()
        if not t or t.lower() in seen:
            continue
        if len(t) > MAX_TERM_CHARS:
            raise HTTPException(400, f"term too long ({len(t)} > {MAX_TERM_CHARS} chars): {t[:40]}…")
        seen.add(t.lower()); out.append(t)
    if not out:
        raise HTTPException(400, "terms is empty")
    if len(out) > MAX_TERMS:
        raise HTTPException(400, f"too many terms ({len(out)} > {MAX_TERMS}) — send fewer per call")
    return out


def _validate(terms: list[str], reply: dict) -> list[dict]:
    """One result per INPUT term, in input order. Anything the model skipped, garbled or refused is that term's error."""
    got = {}
    for it in (reply.get("items") if isinstance(reply, dict) else None) or []:
        if isinstance(it, dict) and isinstance(it.get("i"), int) and 0 <= it["i"] < len(terms):
            got.setdefault(it["i"], it)
    out = []
    for i, term in enumerate(terms):
        r = got.get(i)
        if r is None:
            out.append({"term": term, "error": "the model returned nothing for this term"}); continue
        if r.get("error"):
            out.append({"term": term, "error": str(r["error"])[:200]}); continue
        it, en = (str(r.get(k) or "").strip() for k in ("it", "en"))
        if not it or not en:
            out.append({"term": term, "error": "the model returned an incomplete pair"}); continue
        kind = r.get("kind") if r.get("kind") in KINDS else ("word" if len(term.split()) == 1 else "phrase")
        item = {"term": term, "it": it, "en": en, "kind": kind}
        for k in ("lemma", "note"):
            v = str(r.get(k) or "").strip()
            if v:
                item[k] = v[:240]
        out.append(item)
    return out


def define(terms: list[str], lang_hint: str | None = None) -> dict:
    hint = {"it": "All terms are Italian.", "en": "All terms are English."}.get(lang_hint or "", "")
    user = (hint + "\n" if hint else "") + "\n".join(f"{i}. {t}" for i, t in enumerate(terms))
    t0 = time.time()
    try:
        with fail_fast.scope(DEADLINE_S, "mm-define"):
            reply, usage = sessione._gateway_json(SYSTEM, user)
    except fail_fast.DeadlineExceeded as e:
        raise HTTPException(503, f"the model did not answer in {DEADLINE_S:.0f}s ({e})")
    except Exception as e:
        raise HTTPException(503, f"the model is unreachable: {type(e).__name__}: {e}"[:300])
    thinking = int(usage.get("thinking_chars") or 0)
    _log(f"{len(terms)} terms ok {time.time() - t0:.1f}s model={sessione.GATEWAY_MODEL} thinking_chars={thinking}")
    return {"items": _validate(terms, reply), "model": sessione.GATEWAY_MODEL, "thinking_chars": thinking}


@router.post("/api/mm/define")
def api_define(body: DefineIn):
    return define(_clean_terms(body.terms), body.lang_hint)
