#!/usr/bin/env python3
"""chiron-phrase-coach-chain — a phrase COACH for Ask's "Come si dice" mode.

The learner says what they mean in English. The chain does not hand back a translation: it builds the Italian
a native would say, then teaches the reusable pattern behind it and sets one practice sentence. When the next
turn is the learner's Italian attempt it coaches that attempt instead.

Importable: `await coach(messages)` -> {"content": markdown, "kind", "steps": [...], "total_ms"}.
The server (server/phrase_coach.py) calls it for POST /ask/phrase/api/chat.

A PromptChain of four function steps, sharing one per-call state:
  1 UNDERSTAND  (mistral, JSON)      classify the latest turn: new_request | attempt | question; for a new
                                     request extract the list of phrases (one per numbered entry), situation,
                                     listener, default register, nuance
  2 BUILD       (glm, JSON)          ONE call builds all N phrases: items[{it, register, variants, literal_trap}]
  3 CHECK       (mistral, JSON)      ONE call reviews all N. Flagged items only are re-asked of BUILD (once)
  4 TEACH/COACH (glm, markdown)      new_request -> per-phrase "How it's built" + pattern lesson; attempt ->
                                     coaching; question -> short answer. For new_request and attempt a DIAGRAM
                                     call (glm, JSON) annotates the Italian token by token; for new_request it
                                     runs concurrently with TEACH. A DIAGRAM failure drops the diagram, never the reply.
Steps 2 and 3 pass through for an attempt or a question.

Models go through the Atelier governor's Ollama route (/api/chat), the same hop mock_oral uses. glm runs with
thinking on (its dossier: think:false leaks reasoning into content), so no think flag is sent and only
`message.content` is read. mistral-large-3 has no thinking capability and gets no think flag either.
No token caps are sent. A reply whose done_reason is not "stop", or whose content is empty, is a failure.

Env: ATELIER_GOVERNOR ; CH_PHRASE_MODEL_THINK (glm tag) ; CH_PHRASE_MODEL_FAST (mistral tag) ; CH_PHRASE_READ_S.
"""
import asyncio, json, os, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from promptchain import PromptChain
import ledger   # shared chains/ledger.py — one full prompt/response record per model call
import obs      # shared chains/obs.py — phase markers (no-ops unless a run directory is set)
import httpx

SOURCE = "chain:2026-11-01_chiron-phrase-coach-chain"
GOVERNOR = os.environ.get("ATELIER_GOVERNOR", "http://localhost:8799/llm/ollama")
# Tags are checked against the governor's /api/show before first use; they are not resolved through
# chiron_models because that resolver maps bare cloud ids, while these are the governor's own tags.
MODEL_THINK = os.environ.get("CH_PHRASE_MODEL_THINK", "glm-5.3:cloud")                 # BUILD, TEACH, COACH
MODEL_FAST = os.environ.get("CH_PHRASE_MODEL_FAST", "mistral-large-3:675b-cloud")      # UNDERSTAND, CHECK
READ_S = float(os.environ.get("CH_PHRASE_READ_S", "170"))
HISTORY_TURNS = 8
REGISTERS = ("lei", "tu", "neutral")
KINDS = ("new_request", "attempt", "question")

_shown: dict[str, list] = {}     # tag -> capabilities, from /api/show


def log(msg: str) -> None:
    sys.stderr.write(f"[phrase-coach] {msg}\n")
    sys.stderr.flush()


class ModelReplyError(RuntimeError):
    """The model answered, but not with a usable completion (empty content or done_reason != stop)."""


# ── helpers copied from the sibling chains ───────────────────────────────────────

def extract_json(s):
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s.strip(), flags=re.M).strip()
    st = next((i for i, ch in enumerate(s) if ch in "{["), -1)
    if st < 0:
        return json.loads(s, strict=False)
    op = s[st]; cl = "}" if op == "{" else "]"; d = 0; ins = False; esc = False
    for i in range(st, len(s)):
        ch = s[i]
        if ins:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': ins = False
        else:
            if ch == '"': ins = True
            elif ch == op: d += 1
            elif ch == cl:
                d -= 1
                if d == 0:
                    return json.loads(s[st:i + 1], strict=False)
    return json.loads(s[st:], strict=False)


_FENCE = re.compile(r"```phrase[^\S\n]*\n([\s\S]*?)```", re.I)
_DFENCE = re.compile(r"```diagram[^\S\n]*\n([\s\S]*?)```", re.I)
_META = re.compile(r"```meta[^\S\n]*\n([\s\S]*?)```", re.I)
_SPEAK = re.compile(r"\[\[\s*SPEAK\s*\]\][\s\S]*?\[\[\s*/?\s*SPEAK\s*\]\]", re.I)


def phrase_block(text: str) -> dict | None:
    """The `phrase` JSON object in an earlier assistant reply, or None."""
    m = _FENCE.search(text or "")
    if not m:
        return None
    try:
        obj = json.loads(m.group(1))
        return obj if isinstance(obj, dict) else None
    except ValueError:
        return None


# ── governor transport ───────────────────────────────────────────────────────────

async def _ensure_model(client: httpx.AsyncClient, tag: str) -> None:
    """Confirm the governor knows the tag; a missing or unreadable tag is a loud failure, not a guess."""
    if tag in _shown:
        return
    r = await client.post(f"{GOVERNOR}/api/show", json={"model": tag})
    if r.status_code != 200:
        raise RuntimeError(f"governor /api/show for {tag}: HTTP {r.status_code} {r.text[:200]}")
    _shown[tag] = r.json().get("capabilities") or []
    log(f"{tag}: capabilities {_shown[tag]}")


async def _chat(tag: str, system: str, user: str) -> tuple[str, dict]:
    """One non-streamed /api/chat call. Returns (content, meta); raises ModelReplyError on a bad completion."""
    body = {"model": tag, "stream": False, "options": {"temperature": 0.4},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    t0 = time.time()
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=READ_S, write=30.0, pool=5.0)) as client:
        await _ensure_model(client, tag)
        r = await client.post(f"{GOVERNOR}/api/chat", json=body, headers={"X-Governor-Max-Seconds": str(int(READ_S))})
    if r.status_code != 200:
        raise RuntimeError(f"governor /api/chat for {tag}: HTTP {r.status_code} {r.text[:300]}")
    d = r.json()
    content = (d.get("message") or {}).get("content") or ""
    meta = {"model": tag, "done_reason": d.get("done_reason"), "latency_ms": int((time.time() - t0) * 1000),
            "thinking_chars": len((d.get("message") or {}).get("thinking") or ""),
            "tokens_in": d.get("prompt_eval_count"), "tokens_out": d.get("eval_count")}
    if meta["done_reason"] != "stop" or not content.strip():
        raise ModelReplyError(f"{tag}: done_reason={meta['done_reason']!r}, {len(content)} chars of content")
    return content, meta


class Run:
    """Per-call state shared by the four steps."""
    def __init__(self, messages: list[dict]):
        self.turns = [m for m in messages if m.get("role") in ("user", "assistant") and str(m.get("content") or "").strip()]
        if not self.turns or self.turns[-1]["role"] != "user":
            raise ValueError("coach() needs messages ending with a user turn")
        self.user = str(self.turns[-1]["content"]).strip()
        self.history = self.turns[:-1][-HISTORY_TURNS:]
        self.last_phrase = next((p for p in (phrase_block(t["content"]) for t in reversed(self.history)
                                             if t["role"] == "assistant") if p), None)
        self.steps: list[dict] = []
        self.understand = self.check = None
        self.items: list[dict] = []          # the built phrases (one dict per phrase, in the learner's order)
        self.diagram_error = None
        self.overrides: list[dict] = []
        self.content = ""
        self.t0 = time.time()

    def transcript(self) -> str:
        out = []
        for t in self.history:
            text = _DFENCE.sub("", _FENCE.sub("", _SPEAK.sub("", str(t["content"])))).strip()
            out.append(f"{'LEARNER' if t['role'] == 'user' else 'COACH'}: {text[:1200]}")
        return "\n\n".join(out) or "(no earlier turns)"


async def model_call(run: Run, step: str, tag: str, system: str, user: str) -> str:
    """One recorded model call: chain_call writes the ledger record; the step's model, latency and done_reason
    are kept on the run."""
    metas: list[dict] = []

    async def fn(_inp):
        text, meta = await _chat(tag, system, user)
        metas.append(meta)
        return text

    obs.phase(step, "start")
    try:
        text = await ledger.chain_call(SOURCE, {"name": tag}, system + "\n\n{input}", user, fn)
    finally:
        obs.phase(step, "end")
    m = metas[-1]
    run.steps.append({"step": step, **m})
    log(f"{step}: {tag} {m['latency_ms']} ms done_reason={m['done_reason']} thinking_chars={m['thinking_chars']}")
    return text


async def json_step(run: Run, step: str, tag: str, system: str, user: str, validate, max_repair: int = 3) -> dict:
    """Self-repair loop (the sibling chains' json_with_repair): re-prompt on a bad completion, bad JSON or a
    failed validator, feeding the problem back in. Raises after max_repair attempts."""
    cur, last_err = user, "no attempt made"
    for attempt in range(1, max_repair + 1):
        try:
            text = await model_call(run, step, tag, system, cur)
        except ModelReplyError as e:
            last_err = str(e)
            log(f"{step} attempt {attempt}: {last_err} — retrying")
            continue
        try:
            obj = extract_json(text)
        except Exception as e:
            last_err = f"invalid JSON ({e})"
            cur = user + f"\n\n## PREVIOUS INVALID JSON\n{e}\nReturn ONLY corrected valid JSON."
            log(f"{step} attempt {attempt}: {last_err}")
            continue
        issues = validate(obj)
        if issues:
            last_err = f"failed validation ({issues})"
            cur = user + f"\n\n## PROBLEMS\n{issues}\nReturn ONLY corrected valid JSON that fixes every problem above."
            log(f"{step} attempt {attempt}: {last_err}")
            continue
        return obj
    raise RuntimeError(f"{step}: no usable reply after {max_repair} attempts — {last_err}")


# ── prompts ──────────────────────────────────────────────────────────────────────

UNDERSTAND_SYS = """You route turns for an Italian phrase coach. The learner is an English speaker who needs to speak Italian in real situations.
Classify the LATEST learner turn:
- "new_request": they want to say something in Italian (usually written in English, e.g. "how do I say ...").
- "attempt": they wrote Italian in answer to the coach's last "Your turn" practice sentence (see LAST PRACTICE below).
- "question": a follow-up about the last phrase (why, what about another form, can I also say ...).
For a new_request also extract what is needed to build the sentences. Reply with ONLY a JSON object:
{"kind": "new_request|attempt|question", "meaning": "what they really mean, in English", "phrases": [{"en": "one phrase to say, in English, complete and self-contained", "situation": "where/when for this phrase, or empty"}], "situation": "where/when", "listener": "who they are speaking to", "register_default": "lei|tu|neutral", "register_reason": "one short reason", "nuance": "politeness, urgency or tone that matters, or empty"}
"phrases": ONE item for a single request. When the learner lists several (a numbered list, several separate questions, "these phrases"), one item per numbered entry or separate request, in their order, keeping each item's full wording. Never merge, drop, split or invent items.
For the other kinds the other fields may be empty strings and "phrases" an empty list."""

BUILD_SYS = """You write Italian the way a native speaker actually says it in a given situation. Never translate word for word: if the literal wording is not what Italians say, give what they say.
You are given N numbered phrases. Build ALL N in one answer. Reply with ONLY a JSON object:
{"items": [{"it": "the main sentence", "register": "lei|tu|neutral", "register_note": "one short line on why", "variants": [{"it": "...", "register": "lei|tu|neutral", "why": "..."}], "literal_trap": {"it": "the word-for-word version an English speaker would produce", "why": "why it sounds off or wrong"}}]}
"items" has exactly N entries, in the same order as the numbered phrases.
Rules:
- register is "lei" or "tu" only if the sentence contains an address form (Lei/tu verb endings, pronouns, imperatives, polite openers like "Scusi"/"Scusa"). A sentence with no address form is "neutral".
- variants: the other register's version only when it differs from the main sentence, plus at most one common alternative phrasing. An empty list is fine.
- Say what the learner asked for. Do not add openers, greetings or content they did not ask for.
- literal_trap.it must be what a literal translation would give, even if it is wrong."""

CHECK_SYS = """You are a strict native-speaker reviewer of Italian phrases built for an English-speaking learner. You review N numbered items in one go.
For each item judge: (1) is "it" what a native would really say in this situation, not a literal translation? (2) is the register label true (a sentence with no Lei/tu form is "neutral", and "lei" requires a Lei form)? (3) are the variants correct, and is each variant's register label true? (4) is literal_trap really the word-for-word version, and is its "why" right?
The register labels are a fixed vocabulary (lei, tu, neutral): never ask to rename or reword a label. Flag ONLY real errors: unnatural or wrong Italian, a false register label, a wrong variant, a wrong literal_trap. Do not request additions, extra variants, extra notes, openers the learner did not ask for, or stylistic preferences. If every item is acceptable, ok is true.
Reply with ONLY a JSON object: {"ok": true|false, "fixes": [{"item": <1-based item number>, "fix": "one concrete instruction for that item"}]}. "fixes" is empty when ok is true; list only items that have a real error."""

_BUILD_UP = """**How it's built**
3 to 5 numbered steps that build THIS sentence up from the English intent to the final Italian, each step showing the growing Italian fragment in bold followed by a plain-English reason. Step 1 picks the core (the verb or structure and why: a thing you do takes "fare"; an obligation takes dovere + infinitive; asking about a procedure takes impersonal "si" + verb). Then add each piece in Italian order and say why it goes there: question word first, then the verb, then the object with its article, then time or place, then a politeness opener such as "Scusi" and where it goes. The last step is the full sentence. Name each word by its dictionary form (lemma) exactly as a word-by-word grammar breakdown would, so the steps and that breakdown agree. Example shape:
1. **devo fare** ("I have to do"): an obligation is dovere + infinitive.
2. **devo fare la presa di servizio**: add the object with its article.
3. **dove e quando devo fare la presa di servizio?**: question words open the sentence.
4. **Scusi, dove e quando devo fare la presa di servizio?**: the polite opener goes first."""

TEACH_SYS = """You are a warm, concise Italian coach. You do not just translate: you teach the learner to build the sentences themselves.
You are given N phrases (N is at least 1). Write a reply in English with Italian phrases, in exactly this Markdown layout, nothing before or after it except the meta block:

FOR EACH PHRASE, in order (number the headings "1)", "2)" and so on only when N is more than 1):
**<the main Italian sentence>**
Register: <Lei (formal) | tu (informal) | neutral>. <short reason>
<Formal (Lei): ... or Informal (tu): ... , only if a different-register variant is given; skip otherwise>
""" + _BUILD_UP + """

THEN, once for all phrases:
**The pattern**
`<reusable frame with [slots]>` then 2-3 swaps showing the same frame in other situations (Italian, with a 2-4 word English gloss each). One shared pattern if the phrases really share one; otherwise one pattern per group of phrases that do, each named by the phrase numbers it covers.

**Why Italians say it this way**
1-2 lines (per pattern group when there are several).

**Watch out**
Only for a phrase that has a LITERAL TRAP: show the WRONG form and the RIGHT form as two different strings (wrong: the word-for-word version an English speaker would say; right: the main sentence), and say why the wrong one is off. Name the phrase number when N is more than 1. If no phrase has a trap, leave this whole section out.

**Your turn**
One new English sentence that needs the same pattern, for the learner to try in Italian.

Then end with a fenced block tagged meta holding ONLY this JSON (the system builds the spoken and data blocks from it, so do not write any [[SPEAK]] text yourself):
```meta
{"pattern": "the main frame, same as above", "slots": ["slot names"], "practice": "the Your-turn English sentence", "breakdown": [{"chunk": "Italian chunk", "gloss": "English gloss"}]}
```
Use the given sentences and registers exactly as provided. Every phrase MUST have its own "How it's built" section. 2 to 4 breakdown chunks (from the first phrase). Keep the reply tight: short steps, no repetition."""

COACH_SYS = """You are a warm, concise Italian coach marking a learner's attempt. The learner was asked to say a practice sentence in Italian, using a pattern from the last phrase.
Write in English with Italian phrases, in exactly this Markdown layout, nothing before or after it except the meta block:

**<what is right>** One or two lines on what they got right (be specific and encouraging).
**Corrections** Each error as a bullet: what they wrote -> what it should be, and why. If there are no errors, say so plainly. Correctness wins over encouragement: never call a wrong form right.
**Corrected sentence** the full correct Italian sentence in bold, with a Register line.
""" + _BUILD_UP.replace("this sentence", "the CORRECTED sentence, so the learner sees how it should have been constructed") + """
**Your turn** One new English sentence on the same pattern, slightly harder.

Then end with a fenced block tagged meta holding ONLY this JSON (the system builds the spoken and data blocks from it, so do not write any [[SPEAK]] text yourself):
```meta
{"corrected": "the corrected Italian sentence", "register": "lei|tu|neutral", "pattern": "the frame", "slots": ["slot names"], "practice": "the new Your-turn English sentence", "breakdown": [{"chunk": "Italian chunk", "gloss": "English gloss"}]}
```
A sentence with no Lei/tu form is "neutral". 2 to 4 breakdown chunks. Keep it short."""

ANSWER_SYS = """You are a warm, concise Italian coach. The learner asks a follow-up about the last phrase you taught. Answer in English with Italian examples, in at most 6 short lines. Do not repeat the whole lesson, and do not write any [[SPEAK]] text.
End with a fenced block tagged meta holding ONLY this JSON (the system builds the spoken block from it):
```meta
{"speak": "the main Italian example sentence of your answer, or an empty string if the answer has no new Italian sentence"}
```"""

DIAGRAM_SYS = """You are a grammar annotator for a BASIC student: assume zero prior grammar. For each given Italian sentence you produce an interlinear word-by-word breakdown. Parse EVERY word once, in order, including every function word (articles, prepositions, conjunctions, clitics such as "si", the pieces of a verb phrase). Never skip a word as obvious.
Reply with ONLY a JSON object: {"sentences": [one object per given sentence, in the same order]}. Each sentence object:
{"translation": "natural English", "literal": "word-order gloss, word for word", "mood": "declarative|interrogative|imperative|...", "registerNote": "formal address (Lei) / informal (tu) / neutral, in a few words", "tokens": [...], "phrases": [...], "tips": ["0-2 short gotchas or mnemonics"]}
token: {"surface": "the word exactly as written (keep apostrophes, drop sentence punctuation)", "lemma": "dictionary form: infinitive for verbs, masculine singular for nouns, adjectives and articles", "pos": "DET|NOUN|PROPN|ADJ|VERB|AUX|ADP|PRON|ADV|CCONJ|SCONJ|NUM", "layer": "articles|nouns|verbs|adverbs|preps|pronouns", "features": {"gender": "m", "number": "sg"}, "note": "plain-English beginner explanation, one or two short sentences"}
layer choice: articles = definite/indefinite articles; nouns = nouns, proper nouns AND adjectives (say which noun the adjective agrees with); verbs = every verb form including auxiliaries and infinitives; adverbs = adverbs and the question words dove, quando, come, quanto; preps = prepositions, articulated prepositions (del = di + il) AND conjunctions (e, o, ma, che); pronouns = personal, clitic (si, mi, ti, lo, ci), relative and interrogative pronouns (chi, che, cosa).
notes: verbs give infinitive, tense, mood, person and number, regular or irregular, the auxiliary if compound, whether reflexive or impersonal "si"; for dovere/potere/volere say they take an infinitive; articles give gender, number and any elision (un'); prepositions say what they govern; pronouns say what they replace and where they sit.
phrases: multi-word units taught as a unit (fixed expressions, collocations, verb phrases such as "fare la presa di servizio", articulated-preposition + noun): {"surface": "verbatim from the sentence", "type": "collocation|idiom|fixed-expression|verb-phrase", "literal": "word-order gloss", "meaning": "what it means as a unit", "note": "why it is idiomatic / when to reuse it"}. Use the same dictionary forms and the same analysis a teacher would give when explaining how the sentence is built. No HTML. Write every explanation in English."""

# ── deterministic register rule ──────────────────────────────────────────────────

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
_SENT = re.compile(r"[^.!?;:\n]+")
_LEI_CAPS = {"Lei", "La", "Le", "Sua", "Suo", "Suoi", "Sue", "Glielo", "Gliela"}
_LEI_LOWER = re.compile(r"(?<![^\W\d_])(?:scusi|senta|dica|può|potrebbe|saprebbe|vuole|vorrebbe|permetta|sa|si accomodi)(?![^\W\d_])")
_SI_GOVERNED = {"può", "potrebbe", "sa", "saprebbe", "vuole", "vorrebbe"}
_TU_WORDS = {"tu", "ti", "te", "tuo", "tua", "tuoi", "tue", "scusa", "senti", "dimmi", "puoi", "potresti", "sai",
             "sapresti", "vuoi", "vorresti", "hai", "sei", "fai", "vai", "devi", "permettimi"}
# "La ringrazio" / "Le chiedo": a capitalised La/Le opening a sentence is Lei only before one of these first-person
# verbs; before anything else it is the article ("La casa è grande").
_LEI_OPENER_VERBS = {"ringrazio", "prego", "chiedo", "domando", "saluto", "informo", "avviso", "disturbo", "auguro",
                     "ammiro", "stimo", "presento", "scrivo", "telefono", "richiamo", "contatto", "mando", "ricordo",
                     "consiglio", "spiego", "mostro", "dico", "do", "faccio", "devo", "posso", "vorrei"}
# "Dove le fa male?": lowercase "le" before one of these verbs is the formal indirect object but looks like the
# plural article, so the sentence is ambiguous (no label from the rule) unless another marker settles it.
_LE_CLITIC_VERBS = {"fa", "fanno", "dà", "dice", "serve", "piace", "dispiace", "passa", "può", "posso", "devo",
                    "vorrei", "spiego", "mostro", "chiedo", "ricordo", "consiglio", "faccio", "do", "dico", "fa'"}
_CLOCK_BEFORE = {"le", "alle", "dalle", "entro", "verso"}      # "sono le sei": six o'clock, not "tu sei"


def register_of(it: str):
    """The register an Italian sentence shows by explicit markers: "lei", "tu", "neutral" (no address form), or None
    when it is empty, mixed (both kinds of marker) or ambiguous (a lowercase clitic "le" before a verb, which is
    the formal "to you" but looks like the plural article)."""
    text = (it or "").replace("’", "'").replace("‘", "'").strip()
    if not text:
        return None
    lei = tu = ambiguous = False
    for sent in _SENT.findall(text):
        words = _WORD.findall(sent)
        low = [w.lower() for w in words]
        for i, w in enumerate(words):
            nxt = low[i + 1] if i + 1 < len(low) else ""
            if i == 0:
                if low[0] == "lei":
                    lei = True
                elif w in ("La", "Le") and nxt in _LEI_OPENER_VERBS:
                    lei = True
            elif w in _LEI_CAPS:
                lei = True
            if w == "le" and nxt in _LE_CLITIC_VERBS:
                ambiguous = True
            if len(w) >= 7 and low[i].endswith(("arla", "erla", "irla")):    # conoscerla, ringraziarla, conoscerLa
                lei = True
            if low[i] in _TU_WORDS and not (low[i] == "sei" and i and low[i - 1] in _CLOCK_BEFORE):
                tu = True
        lowered = sent.lower()
        for m in _LEI_LOWER.finditer(lowered):
            # impersonal/passive "si" governs the verb ("si può", "non si può"): not an address form
            if m.group(0) in _SI_GOVERNED and re.search(r"(?<![^\W\d_])si\s+(?:non\s+)?$", lowered[:m.start()]):
                continue
            lei = True
    if lei and tu:
        return None
    if lei:
        return "lei"
    if tu:
        return None if ambiguous else "tu"
    return None if ambiguous else "neutral"


_REG_PREFIX = {"lei": "Formal (Lei):", "tu": "Informal (tu):", "neutral": "Alternative (neutral):"}
_REG_NOTE = {"lei": "it contains a Lei form", "tu": "it contains a tu form",
             "neutral": "it has no Lei or tu form, so it suits any listener"}


def _line_label(line: str):
    low = line.lower()
    found = {k for k, pat in (("neutral", r"\bneutral\b"), ("lei", r"\blei\b|\bformal\b"), ("tu", r"\btu\b|\binformal\b"))
             if re.search(pat, low)}
    return found.pop() if len(found) == 1 else None


def apply_register_rule(it: str, label: str, what: str, overrides: list) -> str:
    """The rule's label when it has one, else the model's. A change is logged and recorded in `overrides`."""
    rule = register_of(it)
    if rule is None:
        log(f"[register] rule has no answer for {it!r}; keeping the model's {label!r}")
        return label
    if rule != label:
        log(f'[register] override {label}->{rule} for "{it}"')
        overrides.append({"what": what, "it": it, "model": label, "rule": rule})
    return rule


def correct_build_registers(build: dict, overrides: list) -> None:
    """Fix the main sentence's and each variant's register label from the rule, refresh the note when the label
    changed, and drop variants that repeat the main sentence or one another."""
    n0 = len(overrides)
    build["register"] = apply_register_rule(build["it"], build["register"], "main", overrides)
    if len(overrides) > n0:
        build["register_note"] = _REG_NOTE[build["register"]]
    seen = {_norm(build["it"])}
    keep = []
    for v in build["variants"]:
        v["register"] = apply_register_rule(v["it"], v["register"], "variant", overrides)
        if _norm(v["it"]) in seen:
            log(f"[register] dropped variant that repeats an earlier sentence: {v['it']!r}")
            continue
        seen.add(_norm(v["it"]))
        keep.append(v)
    build["variants"] = keep


def fix_register_lines(body: str, label: str, note: str | None, variants: list, main_it: str) -> str:
    """Make the rendered Register line and the variant lines agree with the corrected labels: a line whose stated
    register differs is rewritten, a variant line that repeats the main sentence is removed."""
    out = []
    for line in body.split("\n"):
        plain = line.strip()
        if re.match(r"^Register\s*:", plain):
            first = re.match(r"^Register\s*:\s*([A-Za-z]+)", plain).group(1).lower()
            stated = {"neutral": "neutral", "lei": "lei", "formal": "lei", "tu": "tu", "informal": "tu"}.get(first) or _line_label(plain)
            if stated != label:
                log(f"[register] rewrote the Register line to {label!r}")
                line = f"Register: {label if label == 'neutral' else ('Lei (formal)' if label == 'lei' else 'tu (informal)')}." + (f" {note}" if note else "")
        else:
            m = re.match(r"^(Formal \(Lei\)|Informal \(tu\)|Neutral|Alternative \(neutral\))\s*:\s*(.+)$", plain)
            if m:
                rest = _norm(m.group(2))
                if _norm(main_it) and _norm(main_it) in rest and not any(_norm(v["it"]) in rest for v in variants):
                    log("[register] removed a variant line that repeats the main sentence")
                    continue
                for v in variants:
                    if _norm(v["it"]) and _norm(v["it"]) in rest and _line_label(m.group(1)) != v["register"]:
                        log(f"[register] rewrote a variant line to {v['register']!r}")
                        line = f"{_REG_PREFIX[v['register']]} {m.group(2)}"
                        break
        out.append(line)
    return "\n".join(out)


# ── steps ────────────────────────────────────────────────────────────────────────

def _norm_items(o):
    """The list of built items in a BUILD reply: {"items": [...]}, or a single bare item."""
    if isinstance(o, dict) and isinstance(o.get("items"), list):
        return o["items"]
    if isinstance(o, dict) and str(o.get("it") or "").strip():
        return [o]
    return None


def _valid_understand(o):
    if not isinstance(o, dict) or o.get("kind") not in KINDS:
        return f'"kind" must be one of {list(KINDS)}'
    if o["kind"] == "new_request":
        if not str(o.get("meaning") or "").strip():
            return '"meaning" is required for a new_request'
        if o.get("register_default") not in REGISTERS:
            return '"register_default" must be lei|tu|neutral'
        ph = o.get("phrases")
        if ph is not None and (not isinstance(ph, list) or not all(isinstance(p, dict) and str(p.get("en") or "").strip() for p in ph)):
            return '"phrases" must be a list of {"en": ..., "situation": ...}'
    return None


def phrases_of(u: dict) -> list[dict]:
    """The phrases to build: the UNDERSTAND list, else the single meaning."""
    ph = [{"en": str(p["en"]).strip(), "situation": str(p.get("situation") or "").strip()} for p in (u.get("phrases") or [])]
    return ph or [{"en": str(u.get("meaning") or "").strip(), "situation": str(u.get("situation") or "").strip()}]


def _valid_one(o):
    if not isinstance(o, dict) or not str(o.get("it") or "").strip():
        return '"it" is required'
    if o.get("register") not in REGISTERS:
        return '"register" must be lei|tu|neutral'
    if not isinstance(o.get("variants"), list):
        return '"variants" must be a list'
    for v in o["variants"]:
        if not isinstance(v, dict) or not str(v.get("it") or "").strip() or v.get("register") not in REGISTERS:
            return 'each variant needs "it" and a register of lei|tu|neutral'
    if not isinstance(o.get("literal_trap"), dict) or not str(o["literal_trap"].get("it") or "").strip():
        return '"literal_trap" needs an "it"'
    return None


def _valid_items(n: int):
    def validate(o):
        items = _norm_items(o)
        if items is None:
            return 'return {"items": [ ... ]}'
        if len(items) != n:
            return f'"items" needs exactly {n} entries, in the order of the numbered phrases; got {len(items)}'
        for i, it in enumerate(items, 1):
            issue = _valid_one(it)
            if issue:
                return f"items[{i}]: {issue}"
        return None
    return validate


def _valid_check(o):
    if not isinstance(o, dict) or not isinstance(o.get("ok"), bool) or not isinstance(o.get("fixes", []), list):
        return 'need {"ok": bool, "fixes": [{"item": n, "fix": "..."}]}'
    return None


def _flagged(check: dict, n: int) -> dict[int, list[str]]:
    """item index -> reviewer fixes. A fix without a usable item number applies to every item."""
    if check.get("ok"):
        return {}
    out: dict[int, list[str]] = {}
    for f in check.get("fixes") or []:
        text = str(f.get("fix") if isinstance(f, dict) else f).strip()
        if not text:
            continue
        k = f.get("item") if isinstance(f, dict) else None
        if isinstance(k, int) and not isinstance(k, bool) and 1 <= k <= n:
            out.setdefault(k - 1, []).append(text)
        else:
            for i in range(n):
                out.setdefault(i, []).append(text)
    return out


def _understand_user(run: Run) -> str:
    lp = run.last_phrase
    practice = (lp or {}).get("practice") or "(none — there is no open practice sentence)"
    return (f"EARLIER TURNS:\n{run.transcript()}\n\nLAST PRACTICE (English sentence the learner was asked to say in Italian): "
            f"{practice}\n\nLATEST LEARNER TURN:\n{run.user}")


def _build_user(run: Run, phrases: list, fixes: dict | None = None, only: list | None = None) -> str:
    u = run.understand
    idx = only if only is not None else list(range(len(phrases)))
    lines = "\n".join(f"{j}. {phrases[i]['en']}" + (f" (situation: {phrases[i]['situation']})" if phrases[i]["situation"] else "")
                      for j, i in enumerate(idx, 1))
    text = (f"Overall meaning: {u.get('meaning')}\nSituation: {u.get('situation') or 'unspecified'}\n"
            f"Listener: {u.get('listener') or 'unspecified'}\nDefault register: {u.get('register_default')} "
            f"({u.get('register_reason') or 'no reason given'})\nNuance: {u.get('nuance') or 'none'}\n"
            f"Learner's own words: {run.user}\n\nN = {len(idx)}. PHRASES TO BUILD:\n{lines}")
    if fixes:
        text += "\n\n## REVIEWER FIXES (apply every one)\n" + "\n".join(
            f"- phrase {j}: {f}" for j, i in enumerate(idx, 1) for f in fixes.get(i, [])) + \
            f"\n\nPrevious attempt:\n{json.dumps({'items': [run.items[i] for i in idx]}, ensure_ascii=False)}"
    return text


async def step_understand(run: Run) -> str:
    run.understand = await json_step(run, "understand", MODEL_FAST, UNDERSTAND_SYS, _understand_user(run), _valid_understand)
    log(f"understand: kind={run.understand['kind']}"
        + (f" phrases={len(phrases_of(run.understand))}" if run.understand["kind"] == "new_request" else ""))
    return run.understand["kind"]


async def step_build(run: Run, _prev: str) -> str:
    if run.understand["kind"] != "new_request":
        return _prev
    phrases = phrases_of(run.understand)
    o = await json_step(run, "build", MODEL_THINK, BUILD_SYS, _build_user(run, phrases), _valid_items(len(phrases)))
    run.items = _norm_items(o)
    return json.dumps(run.items, ensure_ascii=False)


async def step_check(run: Run, _prev: str) -> str:
    if run.understand["kind"] != "new_request":
        return _prev
    phrases = phrases_of(run.understand)
    numbered = json.dumps({"items": [{"item": i, **it} for i, it in enumerate(run.items, 1)]}, ensure_ascii=False)
    user = (f"Situation: {run.understand.get('situation')}; listener: {run.understand.get('listener')}; "
            f"meaning: {run.understand.get('meaning')}\n\nN = {len(run.items)} ITEMS UNDER REVIEW:\n{numbered}")
    run.check = await json_step(run, "check", MODEL_FAST, CHECK_SYS, user, _valid_check)
    flagged = _flagged(run.check, len(run.items))
    if flagged:
        only = sorted(flagged)
        log(f"check: fixes for item(s) {[i + 1 for i in only]} — re-asking build for those only, once: {flagged}")
        new = await json_step(run, "build_fix", MODEL_THINK, BUILD_SYS, _build_user(run, phrases, flagged, only),
                              _valid_items(len(only)))
        for i, it in zip(only, _norm_items(new)):
            run.items[i] = it
    else:
        log("check: ok")
    for it in run.items:
        correct_build_registers(it, run.overrides)
    run.steps.append({"step": "register", "model": "rule", "done_reason": "n/a", "latency_ms": 0,
                      "thinking_chars": 0, "overrides": list(run.overrides)})
    return json.dumps(run.items, ensure_ascii=False)


def _split_meta(text: str) -> tuple[str, dict]:
    """(reply body without the meta block, the parsed meta object). Raises ValueError when meta is unusable."""
    m = _META.search(text)
    if not m:
        raise ValueError("no meta block in reply")
    meta = extract_json(m.group(1))
    if not isinstance(meta, dict):
        raise ValueError("meta block is not an object")
    return (text[:m.start()] + text[m.end():]).strip(), meta


def _norm(t: str) -> str:
    return re.sub(r"[^\w]+", " ", t.lower()).strip()


_WATCH = re.compile(r"\*\*Watch out\*\*[\s\S]*?(?=\n\s*\*\*|\Z)")
_FRAG = re.compile(r"\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\"([^\"]+)\"|«([^»]+)»")
_HOW = re.compile(r"\*\*How it[’']s built\*\*")


def drop_same_string_watch_out(body: str, correct: str, trap: str) -> str:
    """Remove the Watch out section when it contrasts a form with itself: the literal trap equals the correct
    sentence, or the section quotes only one distinct Italian string. Logged when it fires."""
    m = _WATCH.search(body)
    if not m:
        return body
    frags = [_norm("".join(g)) for g in _FRAG.findall(m.group(0).split("**", 2)[2])]
    frags = [f for f in frags if len(f.split()) >= 2]
    if _norm(trap) == _norm(correct) or (len(frags) >= 2 and len(set(frags)) == 1):
        log(f"teach: Watch out section contrasts a form with itself ({correct!r}) — dropped")
        return (body[:m.start()] + body[m.end():]).replace("\n\n\n", "\n\n").strip()
    return body


def check_built(body: str, n: int) -> None:
    """Every phrase must carry its own "How it's built" section of 3+ numbered steps; else the reply is asked again."""
    parts = _HOW.split(body)
    if len(parts) - 1 != n:
        raise ValueError(f'the reply has {len(parts) - 1} "How it\'s built" sections, it needs exactly {n} (one per phrase)')
    for k, sec in enumerate(parts[1:], 1):
        sec = sec.split("\n**", 1)[0]
        if len(re.findall(r"(?m)^\s*\d+[.)]\s", sec)) < 3:
            raise ValueError(f'the "How it\'s built" section of phrase {k} needs 3 to 5 numbered steps')


def _json_fence(obj) -> str:
    """JSON for a fenced block: a backtick inside a string is written as \\u0060 so model text cannot close the fence."""
    return json.dumps(obj, ensure_ascii=False).replace("`", "\\u0060")


def _tail(speak: str, data: dict, diagram: dict | None = None, related: dict | None = None) -> str:
    """The spoken block and the machine-readable blocks (phrase, diagram, related), built here so they are always well-formed."""
    spoken = speak.replace("[[", "").replace("]]", "").strip()
    out = f"\n\n[[SPEAK]]{spoken}[[/SPEAK]]\n\n```phrase\n{_json_fence(data)}\n```"
    if diagram:
        out += f"\n\n```diagram\n{_json_fence(diagram)}\n```"
    if related:
        out += f"\n\n```related\n{_json_fence(related)}\n```"
    return out


async def _markdown_step(run: Run, step: str, system: str, user: str, need: tuple, check=None) -> tuple[str, dict]:
    """TEACH/COACH call; the reply must carry a meta block with the `need` keys (and pass `check`), else it is asked again (twice at most)."""
    cur, err = user, "no attempt made"
    for attempt in range(1, 3):
        try:
            text = await model_call(run, step, MODEL_THINK, system, cur)
            body, meta = _split_meta(text)
            missing = [k for k in need if not meta.get(k)]
            if missing:
                raise ValueError(f"meta block lacks {missing}")
            body = _SPEAK.sub("", _DFENCE.sub("", _FENCE.sub("", body))).strip()
            if check:
                check(body)
            return body, meta
        except (ModelReplyError, ValueError) as e:
            err = str(e)
            log(f"{step} attempt {attempt}: {err} — retrying")
            cur = user + f"\n\n## PREVIOUS REPLY WAS UNUSABLE\n{err}\nFollow the layout exactly and end with the meta block."
    raise RuntimeError(f"{step}: no usable reply — {err}")


def fix_registers_per_item(body: str, items: list) -> str:
    """fix_register_lines for one phrase, or for each numbered phrase block ("**1)** ...") before the pattern section."""
    if len(items) == 1:
        it = items[0]
        return fix_register_lines(body, it["register"], it.get("register_note"), it["variants"], it["it"])
    head, sep, rest = body.partition("**The pattern**")
    segs = re.split(r"(?m)^(?=\*\*\d+\))", head)
    if len(segs) - 1 != len(items):
        log(f"[register] reply has {len(segs) - 1} numbered phrase blocks for {len(items)} items; register lines left as written")
        return body
    fixed = [fix_register_lines(s, it["register"], it.get("register_note"), it["variants"], it["it"]) for s, it in zip(segs[1:], items)]
    return segs[0] + "".join(fixed) + sep + rest


# ── DIAGRAM: the AnnotatedPassage (lib/schemas/widget-spec.ts) built from the sentences ─────────

AP_LAYERS = [("articles", "Articles", True), ("nouns", "Nouns", True), ("verbs", "Verbs", True), ("adverbs", "Adverbs", True),
             ("preps", "Prepositions", True), ("pronouns", "Pronouns", True), ("phrases", "Phrases", True),
             ("translation", "Translation", True), ("literal", "Word for word", False)]
AP_TOKEN_LAYERS = {"articles", "nouns", "verbs", "adverbs", "preps", "pronouns"}


def _ap_norm(t: str) -> str:
    return str(t).replace("’", "'").replace("‘", "'").lower()


def _nonempty(v) -> bool:
    return isinstance(v, str) and bool(v.strip())


def validate_sentences(o, texts: list[str]):
    """Shape check of the model's DIAGRAM reply against the zod ApSentence/ApToken/ApPhrase required fields.
    Returns an issues string (fed back to the model for repair) or None."""
    if not isinstance(o, dict) or not isinstance(o.get("sentences"), list):
        return 'return {"sentences": [ ... ]}'
    ss = o["sentences"]
    if len(ss) != len(texts):
        return f'"sentences" needs exactly {len(texts)} entries, one per given sentence in order; got {len(ss)}'
    issues = []
    for i, (s, text) in enumerate(zip(ss, texts), 1):
        p = f"sentences[{i}]"
        if not isinstance(s, dict):
            issues.append(f"{p}: must be an object"); continue
        if not _nonempty(s.get("translation")):
            issues.append(f"{p}.translation: required")
        toks = s.get("tokens")
        if not isinstance(toks, list) or not toks:
            issues.append(f"{p}.tokens: need at least one token"); continue
        for j, t in enumerate(toks, 1):
            q = f"{p}.tokens[{j}]"
            if not isinstance(t, dict):
                issues.append(f"{q}: must be an object"); continue
            if not _nonempty(t.get("surface")):
                issues.append(f"{q}.surface: required")
            elif _ap_norm(t["surface"]).strip() not in _ap_norm(text):
                issues.append(f'{q}.surface "{t["surface"]}" does not occur in the sentence')
            if not _nonempty(t.get("pos")):
                issues.append(f"{q}.pos: required")
            if t.get("layer") not in AP_TOKEN_LAYERS:
                issues.append(f"{q}.layer: must be one of {sorted(AP_TOKEN_LAYERS)}")
            if not _nonempty(t.get("note")):
                issues.append(f"{q}.note: required")
            if "lemma" in t and t["lemma"] is not None and not isinstance(t["lemma"], str):
                issues.append(f"{q}.lemma: must be a string")
            f = t.get("features")
            if f is not None and not (isinstance(f, dict) and all(isinstance(v, (str, int, float, bool)) for v in f.values())):
                issues.append(f"{q}.features: must be an object of strings, numbers or booleans")
        for j, ph in enumerate(s.get("phrases") or [], 1):
            q = f"{p}.phrases[{j}]"
            if not isinstance(ph, dict) or not all(_nonempty(ph.get(k)) for k in ("surface", "type", "meaning")):
                issues.append(f"{q}: needs surface, type and meaning")
        if not isinstance(s.get("tips", []), list) or not all(isinstance(x, str) for x in s.get("tips", [])):
            issues.append(f"{p}.tips: must be a list of strings")
    return "; ".join(issues[:6]) or None


def assemble_passage(sents: list, texts: list[str]) -> dict:
    """The AnnotatedPassage document: layers and ids come from code, the sentences from the model."""
    out = []
    for i, (s, text) in enumerate(zip(sents, texts), 1):
        sent = {"idx": i, "text": text, "translation": s["translation"].strip(), "tokens": s["tokens"],
                "phrases": s.get("phrases") or [], "tips": [t for t in s.get("tips") or [] if str(t).strip()]}
        for k in ("literal", "mood", "registerNote"):
            if _nonempty(s.get(k)):
                sent[k] = s[k].strip()
        out.append(sent)
    return {"type": "annotated-passage", "id": "ap-coach", "language": "it", "domain": None, "genre": "dialogue-script",
            "layers": [{"key": k, "label": lab, "defaultOn": on} for k, lab, on in AP_LAYERS],
            "sentences": out, "anomalies": []}


def validate_annotated_passage(doc) -> list[str]:
    """Mirror of AnnotatedPassageSchema's required fields (lib/schemas/widget-spec.ts). Python mirror, not zod via node:
    the schema is TypeScript, and running it needs a build step this chain does not otherwise have."""
    if not isinstance(doc, dict):
        return ["document must be an object"]
    iss = []
    if doc.get("type") != "annotated-passage": iss.append("type must be 'annotated-passage'")
    if not _nonempty(doc.get("id")): iss.append("id required")
    if doc.get("language") not in ("it", "de"): iss.append("language must be it|de")
    if doc.get("domain") is not None and not isinstance(doc["domain"], str): iss.append("domain must be a string or null")
    if doc.get("genre") not in ("narrative", "expository", "exam-question", "dialogue-script"): iss.append("genre invalid")
    ly = doc.get("layers")
    if not isinstance(ly, list) or not ly or not all(isinstance(l, dict) and _nonempty(l.get("key")) and _nonempty(l.get("label"))
                                                      and isinstance(l.get("defaultOn"), bool) for l in ly):
        iss.append("layers: non-empty list of {key,label,defaultOn:bool}")
    ss = doc.get("sentences")
    if not isinstance(ss, list) or not ss:
        iss.append("sentences: non-empty list")
    else:
        for s in ss:
            if not (isinstance(s, dict) and isinstance(s.get("idx"), int) and not isinstance(s["idx"], bool) and s["idx"] >= 1
                    and _nonempty(s.get("text")) and isinstance(s.get("translation"), str)
                    and isinstance(s.get("tokens"), list) and s["tokens"]
                    and isinstance(s.get("phrases", []), list) and isinstance(s.get("tips", []), list)):
                iss.append(f"sentence {s.get('idx') if isinstance(s, dict) else '?'} is malformed")
                continue
            for t in s["tokens"]:
                if not (isinstance(t, dict) and isinstance(t.get("surface"), str) and isinstance(t.get("pos"), str)
                        and t.get("layer") in AP_TOKEN_LAYERS and isinstance(t.get("note"), str)):
                    iss.append(f"sentence {s['idx']}: a token is malformed"); break
    if not isinstance(doc.get("anomalies", []), list): iss.append("anomalies must be a list")
    return iss


async def step_diagram(run: Run, texts: list[str]) -> dict | None:
    """DIAGRAM call. Any failure is logged and returns None: the reply goes out without a diagram."""
    t0 = time.time()
    user = "SENTENCES (annotate each, in this order):\n" + "\n".join(f"{i}. {t}" for i, t in enumerate(texts, 1))
    try:
        o = await json_step(run, "diagram", MODEL_THINK, DIAGRAM_SYS, user, lambda x: validate_sentences(x, texts), max_repair=2)
        doc = assemble_passage(o["sentences"], texts)
        bad = validate_annotated_passage(doc)
        if bad:
            raise ValueError(f"assembled passage invalid: {bad}")
        return doc
    except Exception as e:
        run.diagram_error = f"{type(e).__name__}: {e}"[:400]
        log(f"diagram FAILED, reply goes out without it: {run.diagram_error}")
        run.steps.append({"step": "diagram", "model": MODEL_THINK, "done_reason": "failed", "thinking_chars": 0,
                          "latency_ms": int((time.time() - t0) * 1000), "error": run.diagram_error})
        return None


# ── RELATED: study topics from the diagram, lessons from the library ─────────────────────────

MODALS = {"dovere", "potere", "volere", "sapere"}
INTERROG = {"dove", "quando", "come", "perché", "chi", "quanto", "quale", "cosa"}
ARTICULATED = {"del", "dello", "della", "dell'", "dei", "degli", "delle", "al", "allo", "alla", "all'", "ai", "agli", "alle",
               "dal", "dallo", "dalla", "dall'", "dai", "dagli", "dalle", "nel", "nello", "nella", "nell'", "nei", "negli", "nelle",
               "sul", "sullo", "sulla", "sull'", "sui", "sugli", "sulle", "col", "coi"}
RELATED = None     # set by the server: fn(topics) -> {"lessons": [...], "missing": [...]}; None = no lookup wired


def study_topics(doc: dict) -> list[dict]:
    """Study topics from the DIAGRAM tokens (lemma, pos, features, notes) and phrases: constructions first, then verb
    lemmas, then vocabulary. Each topic is {topic, kind, query}; `query` is the text the library search runs."""
    cons: dict[str, str] = {}
    verbs: dict[str, str] = {}
    vocab: dict[str, str] = {}
    interrog: list[str] = []
    for s in doc.get("sentences") or []:
        toks = s.get("tokens") or []
        note_rn = _ap_norm(s.get("registerNote") or "")
        if re.search(r"\blei\b|formal|polite|cortesia", note_rn) and "informal" not in note_rn.replace("not informal", ""):
            cons.setdefault("forma di cortesia (Lei)", "Lei forma di cortesia formale")
        for i, t in enumerate(toks):
            surf = _ap_norm(t.get("surface") or "")
            lemma = _ap_norm(t.get("lemma") or surf)
            feats = " ".join(str(v).lower() for v in (t.get("features") or {}).values())
            note = _ap_norm(t.get("note") or "")
            layer, pos = t.get("layer"), str(t.get("pos") or "").upper()
            if layer == "verbs" and pos == "VERB" and re.search(r"(are|ere|ire|rre|arsi|ersi|irsi)$", lemma) and lemma not in ("essere", "avere"):
                verbs.setdefault(lemma, f"verbo {lemma} {surf}")
            if layer == "verbs" and lemma in MODALS:
                nxt = next((u for u in toks[i + 1:i + 3] if u.get("layer") == "verbs"), None)
                if nxt and (re.search(r"(are|ere|ire|rre|arsi|ersi|irsi)$", _ap_norm(nxt.get("surface") or ""))
                            or "infinit" in " ".join(str(v).lower() for v in (nxt.get("features") or {}).values())):
                    cons.setdefault(f"{lemma} + infinito", f"{lemma} infinito verbi modali {surf}")
            if lemma == "si" and ("impersonal" in note or "imperson" in feats):
                cons.setdefault("si impersonale", "si impersonale")
            if layer == "preps" and ("articulated" in note or "articulated" in feats or surf in ARTICULATED):
                cons.setdefault("preposizioni articolate", "preposizioni articolate")
            if lemma in INTERROG and layer in ("adverbs", "pronouns"):
                interrog.append(lemma)
            if "passato prossimo" in feats or "passato prossimo" in note or "present perfect" in feats:
                cons.setdefault("passato prossimo", "passato prossimo")
            if "condizionale" in feats or "conditional" in feats:
                cons.setdefault("condizionale", "condizionale")
            if re.search(r"\bfuturo\b|\bfuture\b", feats):
                cons.setdefault("futuro semplice", "futuro semplice")
        for ph in s.get("phrases") or []:
            if str(ph.get("type")) in ("collocation", "idiom", "fixed-expression") and len(vocab) < 4:
                vocab.setdefault(_ap_norm(ph["surface"]).strip(), _ap_norm(ph["surface"]).strip())
    if interrog:
        uniq = list(dict.fromkeys(interrog))[:3]
        cons.setdefault(f"interrogativi ({', '.join(uniq)})", "interrogativi " + " ".join(uniq) + " domande")
    return ([{"topic": k, "kind": "construction", "query": q} for k, q in cons.items()]
            + [{"topic": k, "kind": "verb", "query": q} for k, q in list(verbs.items())[:6]]
            + [{"topic": k, "kind": "vocabulary", "query": q} for k, q in vocab.items()])


async def step_related(run: Run, doc: dict | None) -> dict | None:
    """Study-more lookup. Needs the diagram's lemmas; any failure is logged and the section is simply left out."""
    if doc is None or RELATED is None:
        return None
    t0 = time.time()
    try:
        topics = study_topics(doc)
        res = await asyncio.to_thread(RELATED, topics) if topics else None
        run.steps.append({"step": "related", "model": "bm25", "done_reason": "stop", "thinking_chars": 0,
                          "latency_ms": int((time.time() - t0) * 1000), "topics": [t["topic"] for t in topics]})
        if res and (res.get("lessons") or res.get("missing")):
            return {"lessons": res.get("lessons") or [], "missing": res.get("missing") or []}
        return None
    except Exception as e:
        log(f"related FAILED, reply goes out without it: {type(e).__name__}: {e}")
        run.steps.append({"step": "related", "model": "bm25", "done_reason": "failed", "thinking_chars": 0,
                          "latency_ms": int((time.time() - t0) * 1000), "error": str(e)[:300]})
        return None


async def _diagram_related(run: Run, texts: list[str]) -> tuple[dict | None, dict | None]:
    doc = await step_diagram(run, texts)
    return doc, await step_related(run, doc)


# ── TEACH / COACH / ANSWER ───────────────────────────────────────────────────────

def _teach_user(run: Run) -> str:
    phrases = phrases_of(run.understand)
    parts = []
    for k, (b, ph) in enumerate(zip(run.items, phrases), 1):
        same = _norm(b["literal_trap"]["it"]) == _norm(b["it"])
        trap = ("LITERAL TRAP: none — the literal version is not different from the main sentence: " + ("leave the Watch out section out." if len(run.items) == 1 else "leave this phrase out of the Watch out section.")
                if same else f"LITERAL TRAP: {json.dumps(b['literal_trap'], ensure_ascii=False)}")
        parts.append((f"PHRASE {k} (English: {ph['en']})\n" if len(run.items) > 1 else "")
                     + f"MAIN SENTENCE (use exactly): {b['it']}\nREGISTER (use exactly): {b['register']} — {b.get('register_note') or ''}\n"
                       f"VARIANTS: {json.dumps(b['variants'], ensure_ascii=False)}\n{trap}")
    return (f"N = {len(run.items)}\n\n" + "\n\n".join(parts)
            + f"\n\nThe learner's intent: {run.understand.get('meaning')} (situation: {run.understand.get('situation')})")


async def _teach_new(run: Run) -> tuple[str, dict]:
    n = len(run.items)
    body, meta = await _markdown_step(run, "teach", TEACH_SYS, _teach_user(run), ("pattern", "practice"),
                                      check=lambda b: check_built(b, n))
    if n == 1:
        body = drop_same_string_watch_out(body, run.items[0]["it"], run.items[0]["literal_trap"]["it"])
    return fix_registers_per_item(body, run.items), meta


async def step_teach(run: Run, _prev: str) -> str:
    kind = run.understand["kind"]
    if kind == "question":
        lp = json.dumps(run.last_phrase, ensure_ascii=False) if run.last_phrase else "(none)"
        user = f"LAST PHRASE (data): {lp}\n\nEARLIER TURNS:\n{run.transcript()}\n\nLEARNER ASKS:\n{run.user}"
        text = await model_call(run, "answer", MODEL_THINK, ANSWER_SYS, user)
        try:
            body, meta = _split_meta(text)
        except ValueError as e:
            log(f"answer: {e}; speaking the last phrase instead")
            body, meta = text, {}
        body = _SPEAK.sub("", _DFENCE.sub("", _FENCE.sub("", body))).strip()
        speak = str(meta.get("speak") or "").strip() or str((run.last_phrase or {}).get("it") or "").strip()
        if not speak:
            log("answer: no Italian sentence to speak (no new example, no earlier phrase) — reply has no SPEAK block")
        run.content = body + (f"\n\n[[SPEAK]]{speak.replace('[[', '').replace(']]', '')}[[/SPEAK]]" if speak else "")
        return run.content
    if kind == "attempt":
        lp = run.last_phrase or {}
        user = (f"PRACTICE SENTENCE (English): {lp.get('practice') or '(unknown; infer it from the earlier turns)'}\n"
                f"PATTERN TAUGHT: {lp.get('pattern') or '(unknown)'} with slots {lp.get('slots') or []}\n"
                f"EARLIER TURNS:\n{run.transcript()}\n\nLEARNER'S ITALIAN ATTEMPT:\n{run.user}")
        body, meta = await _markdown_step(run, "coach", COACH_SYS, user, ("corrected", "practice"), check=lambda b: check_built(b, 1))
        reg = meta.get("register") if meta.get("register") in REGISTERS else "neutral"
        reg = apply_register_rule(meta["corrected"], reg, "corrected", run.overrides)
        body = fix_register_lines(body, reg, _REG_NOTE[reg], [], meta["corrected"])
        # the corrected sentence only exists once COACH has answered, so its diagram follows it
        doc, rel = await _diagram_related(run, [meta["corrected"]])
        data = {"it": meta["corrected"], "en_intent": lp.get("practice") or "", "register": reg, "variants": [],
                "breakdown": meta.get("breakdown") or [], "pattern": meta.get("pattern") or lp.get("pattern") or "",
                "slots": meta.get("slots") or [], "practice": meta["practice"],
                "items": [{"it": meta["corrected"], "en": lp.get("practice") or "", "register": reg, "variants": []}]}
        run.content = body + _tail(meta["corrected"], data, doc, rel)
        return run.content
    texts = [b["it"] for b in run.items]
    teach = asyncio.ensure_future(_teach_new(run))
    side = asyncio.ensure_future(_diagram_related(run, texts))
    try:
        (body, meta), (doc, rel) = await asyncio.gather(teach, side)
    except BaseException:
        for t in (teach, side):
            t.cancel()
        raise
    phrases = phrases_of(run.understand)
    first = run.items[0]
    data = {"it": first["it"], "en_intent": run.understand.get("meaning") or run.user if len(texts) == 1
            else "; ".join(p["en"] for p in phrases),
            "register": first["register"], "variants": [{"it": v["it"], "register": v["register"]} for v in first["variants"]],
            "breakdown": meta.get("breakdown") or [], "pattern": meta["pattern"], "slots": meta.get("slots") or [],
            "practice": meta["practice"],
            "items": [{"it": b["it"], "en": p["en"], "register": b["register"],
                       "variants": [{"it": v["it"], "register": v["register"]} for v in b["variants"]]}
                      for b, p in zip(run.items, phrases)]}
    run.content = body + _tail(" ".join(texts), data, doc, rel)
    return run.content


# ── entry point ──────────────────────────────────────────────────────────────────

async def coach(messages: list[dict], session_id: str | None = None) -> dict:
    """Run the chain over an Ollama-style message list (system turns are ignored; the prompts live here)."""
    run = Run(messages)

    async def s1(_x): return await step_understand(run)
    async def s2(x): return await step_build(run, x)
    async def s3(x): return await step_check(run, x)
    async def s4(x): return await step_teach(run, x)

    chain = PromptChain(models=[], instructions=[s1, s2, s3, s4], verbose=False)
    with ledger.context(session_id=session_id, run_id=ledger.new_run_id()):
        await chain.process_prompt_async(run.user)
    return {"content": run.content, "kind": run.understand["kind"], "steps": run.steps, "register_overrides": run.overrides,
            "diagram_error": run.diagram_error, "total_ms": int((time.time() - run.t0) * 1000)}


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "How do I say I'm here for my specialization?"
    out = asyncio.run(coach([{"role": "user", "content": q}]))
    print(out["content"])
    print(json.dumps({"kind": out["kind"], "steps": out["steps"], "total_ms": out["total_ms"]}, indent=1))
