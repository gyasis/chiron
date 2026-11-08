#!/usr/bin/env python3
"""chiron-phrase-coach-chain — a phrase COACH for Ask's "Come si dice" mode.

The learner says what they mean in English. The chain does not hand back a translation: it builds the Italian
a native would say, then teaches the reusable pattern behind it and sets one practice sentence. When the next
turn is the learner's Italian attempt it coaches that attempt instead.

Importable: `await coach(messages)` -> {"content": markdown, "kind", "steps": [...], "total_ms"}.
The server (server/phrase_coach.py) calls it for POST /ask/phrase/api/chat.

Streaming: coach_stream() is an async generator that yields the reply section by section as each is ready (every phrase
runs its own BUILD -> CHECK pipeline concurrently; its Italian line is emitted first, then the "How it's built" sections
in order, then the shared teaching, then SPEAK and the hidden blocks last); coach() folds it for stream:false and the tests.

Steps, sharing one per-call state:
  1 UNDERSTAND  (mistral, JSON)      classify the latest turn: new_request | attempt | question | drill; for a new
                                     request extract the list of phrases (one per numbered entry), situation,
                                     listener, default register, nuance
  2 BUILD       (glm, JSON)          ONE call builds all N phrases: items[{it, register, variants, literal_trap}]
  3 CHECK       (mistral, JSON)      ONE call reviews all N. Flagged items only are re-asked of BUILD (once)
  4 TEACH/COACH (glm, markdown)      new_request -> per-phrase "How it's built" + pattern lesson; attempt ->
                                     coaching; question -> short answer. For new_request and attempt a DIAGRAM
                                     call (glm, JSON) annotates the Italian token by token; for new_request it
                                     runs concurrently with TEACH. A DIAGRAM failure drops the diagram, never the reply.
Steps 2 and 3 pass through for an attempt or a question. A drill makes no TEACH call: the reply is one line plus a
fenced `drill` block the page recognises, and the page opens its live drill.

Models go through the Atelier governor's Ollama route (/api/chat), the same hop mock_oral uses. glm runs with
thinking on (its dossier: think:false leaks reasoning into content), so no think flag is sent and only
`message.content` is read. mistral-large-3 has no thinking capability and gets no think flag either.
No token caps are sent. A reply whose done_reason is not "stop", or whose content is empty, is a failure.

Env: ATELIER_GOVERNOR ; CH_PHRASE_MODEL_THINK (glm tag) ; CH_PHRASE_MODEL_FAST (mistral tag) ; CH_PHRASE_READ_S.
"""
import asyncio, json, os, re, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import ledger   # shared chains/ledger.py — one full prompt/response record per model call
import obs      # shared chains/obs.py — phase markers (no-ops unless a run directory is set)
import httpx

SOURCE = "chain:2026-11-01_chiron-phrase-coach-chain"
GOVERNOR = os.environ.get("ATELIER_GOVERNOR", "http://localhost:8799/llm/ollama")
# Tags are checked against the governor's /api/show before first use; they are not resolved through
# chiron_models because that resolver maps bare cloud ids, while these are the governor's own tags.
MODEL_THINK = os.environ.get("CH_PHRASE_MODEL_THINK", "glm-5.3:cloud")                 # BUILD, TEACH, COACH
MODEL_FAST = os.environ.get("CH_PHRASE_MODEL_FAST", "mistral-large-3:675b-cloud")      # UNDERSTAND, CHECK
MODEL_STRUCT = os.environ.get("CH_PHRASE_MODEL_STRUCT", MODEL_FAST)                    # HOW-IT'S-BUILT, DIAGRAM (structure, no thinking)
READ_S = float(os.environ.get("CH_PHRASE_READ_S", "170"))
HISTORY_TURNS = 8
REGISTERS = ("lei", "tu", "neutral")
KINDS = ("new_request", "vocab", "attempt", "question", "drill", "lesson", "clarify")
CLARIFY_OPTIONS = ("vocab", "new_request", "lesson", "question")

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
_DRILLFENCE = re.compile(r"```drill[^\S\n]*\n([\s\S]*?)```", re.I)
_CHOICEFENCE = re.compile(r"```choices[^\S\n]*\n([\s\S]*?)```", re.I)
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
        self.q: asyncio.Queue = asyncio.Queue()      # sections of the reply, in order; None ends the stream
        self.parts: list[str] = []
        self.first_text_ms = None
        self.understand = self.check = None
        self.items: list[dict] = []          # the built phrases (one dict per phrase, in the learner's order)
        self.diagram_error = None
        self.overrides: list[dict] = []
        self.content = ""
        self.t0 = time.time()

    def emit(self, text: str) -> None:
        """Append one section to the reply and hand it to the stream. The reply only ever grows at its end."""
        if not text:
            return
        if self.first_text_ms is None:
            self.first_text_ms = int((time.time() - self.t0) * 1000)
        self.parts.append(text)
        self.q.put_nowait(text)

    def transcript(self) -> str:
        out = []
        for t in self.history:
            text = _CHOICEFENCE.sub("", _DRILLFENCE.sub("", _DFENCE.sub("", _FENCE.sub("", _SPEAK.sub("", str(t["content"])))))).strip()
            out.append(f"{'LEARNER' if t['role'] == 'user' else 'COACH'}: {text[:1200]}")
        return "\n\n".join(out) or "(no earlier turns)"


def ledger_step(step: str) -> str:
    """The ledger's step name: the step without its phrase number ("how-built 2" -> "how_built", "diagram 1.2" -> "diagram")."""
    return re.sub(r"[\s\d.]+$", "", step).replace("-", "_").replace(" ", "_")


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
        text = await ledger.chain_call(SOURCE, {"name": tag}, system + "\n\n{input}", user, fn, step=ledger_step(step))
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
- "vocab": they want WORDS, not sentences: "what's the verb for give", "list the Italian verbs for give, bring, take", "the word for stethoscope", "how do you say 'to put'", a bare list of English words. The answer is a short word list, so do not turn the words into phrases.
- "lesson": they want a full saved lesson or course on a topic ("make me a lesson on the passato prossimo", "teach me everything about hospital shifts").
- "clarify": you cannot tell which of these they want (for example a topic name alone, "hospital words and phrases", or a request that fits both "vocab" and "new_request"). Do not guess: the coach asks them.
- "drill": they name Pimsleur and ask to play or drill the phrases with it ("do these as pimsleur", "pimsleur live", "drill me with pimsleur"). Without the word Pimsleur it is never a drill: "quiz me", "test me", "let's practise" are a "question" and the coach practises with them in the conversation. Asking for a saved lesson or season is NOT a drill: that is a "new_request" or a "question".
For a new_request also extract what is needed to build the sentences. Reply with ONLY a JSON object:
{"kind": "new_request|vocab|attempt|question|drill|lesson|clarify", "meaning": "what they really mean, in English", "phrases": [{"en": "one phrase to say, in English, complete and self-contained", "situation": "where/when for this phrase, or empty"}], "situation": "where/when", "listener": "who they are speaking to", "register_default": "lei|tu|neutral", "register_reason": "one short reason", "nuance": "politeness, urgency or tone that matters, or empty"}
"phrases": ONE item for a single request. When the learner lists several (a numbered list, several separate questions, "these phrases"), one item per numbered entry or separate request, in their order, keeping each item's full wording. Never merge, drop, split or invent items.
For a "clarify" also add "clarify_question" (one short question to the learner, in English) and "options": 2 or 3 of "vocab", "new_request", "lesson", "question", the readings you are choosing between.
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

TEACH_ITEM_SYS = """You are a warm, concise Italian coach. You do not just translate: you teach the learner to build the sentence themselves.
You are given ONE phrase whose Italian sentence and register are already written elsewhere. Write only this section, in English with Italian, nothing before or after it:

""" + _BUILD_UP + """

Use the given sentence exactly. Keep it tight. Reply with ONLY the section, starting with the line **How it's built**, then the numbered steps. The bold fragment of the LAST step is the given sentence, character for character."""

TEACH_SHARED_SYS = """You are a warm, concise Italian coach. You teach the learner to build sentences themselves.
You are given N phrases (N is at least 1). Each phrase already has its Italian sentence, its register line and its "How it's built" steps, written elsewhere: do NOT write those. Write only the shared teaching below, in English with Italian phrases, in exactly this Markdown layout, nothing before or after it except the meta block:

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
Use the given sentences and registers exactly as provided. 2 to 4 breakdown chunks (from the first phrase). Keep the reply tight."""

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
Reply with ONLY one JSON object, no prose and no Markdown fence: {"sentences": [one object per given sentence, in the same order]}. The "surface" values of the tokens, joined in order, must spell the sentence exactly (apostrophes kept, sentence punctuation dropped); never skip, merge, split or add a word. Each sentence object:
{"translation": "natural English", "literal": "word-order gloss, word for word", "mood": "declarative|interrogative|imperative|...", "registerNote": "formal address (Lei) / informal (tu) / neutral, in a few words", "tokens": [...], "phrases": [...], "tips": ["0-2 short gotchas or mnemonics"]}
token: {"surface": "the word exactly as written (keep apostrophes, drop sentence punctuation)", "lemma": "dictionary form: infinitive for verbs, masculine singular for nouns, adjectives and articles", "pos": "DET|NOUN|PROPN|ADJ|VERB|AUX|ADP|PRON|ADV|CCONJ|SCONJ|NUM", "layer": "articles|nouns|verbs|adverbs|preps|pronouns", "features": {"gender": "m", "number": "sg"}, "note": "plain-English beginner explanation, one or two short sentences"}
"layer" is REQUIRED and must be exactly one of the six words articles, nouns, verbs, adverbs, preps, pronouns, never anything else (not "conjunctions", "adjectives", "determiners"): DET -> articles; NOUN, PROPN, ADJ, NUM -> nouns; VERB, AUX -> verbs; ADV -> adverbs; ADP, CCONJ, SCONJ -> preps; PRON -> pronouns. "features" values are single strings. layer choice: articles = definite/indefinite articles; nouns = nouns, proper nouns AND adjectives (say which noun the adjective agrees with); verbs = every verb form including auxiliaries and infinitives; adverbs = adverbs and the question words dove, quando, come, quanto; preps = prepositions, articulated prepositions (del = di + il) AND conjunctions (e, o, ma, che); pronouns = personal, clitic (si, mi, ti, lo, ci), relative and interrogative pronouns (chi, che, cosa).
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
    if o["kind"] == "clarify":
        if not str(o.get("clarify_question") or "").strip():
            return '"clarify_question" is required for a clarify'
        opts = o.get("options")
        if not isinstance(opts, list) or len(set(opts)) < 2 or not set(opts) <= set(CLARIFY_OPTIONS):
            return f'"options" must list 2 or 3 of {list(CLARIFY_OPTIONS)}'
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


def _build_user(run: Run, phrases: list, k: int, fixes: list | None = None, prev: dict | None = None) -> str:
    """The BUILD prompt for ONE phrase (index k); the other phrases ride along as context only."""
    u = run.understand
    p = phrases[k]
    text = (f"Overall meaning: {u.get('meaning')}\nSituation: {u.get('situation') or 'unspecified'}\n"
            f"Listener: {u.get('listener') or 'unspecified'}\nDefault register: {u.get('register_default')} "
            f"({u.get('register_reason') or 'no reason given'})\nNuance: {u.get('nuance') or 'none'}\n"
            f"Learner's own words: {run.user}")
    others = "\n".join(f"- {q['en']}" for i, q in enumerate(phrases) if i != k)
    if others:
        text += f"\n\nOTHER PHRASES IN THE SAME MESSAGE (context only, do not build them; keep register and wording consistent with them):\n{others}"
    text += f"\n\nN = 1. PHRASES TO BUILD:\n1. {p['en']}" + (f" (situation: {p['situation']})" if p["situation"] else "")
    if fixes:
        text += "\n\n## REVIEWER FIXES (apply every one)\n" + "\n".join(f"- phrase 1: {f}" for f in fixes) + \
                f"\n\nPrevious attempt:\n{json.dumps({'items': [prev]}, ensure_ascii=False)}"
    return text


_PIMS_NAME = re.compile(r"\bp[iy]m+p?[sz]\s?l[eua]{1,3}y?e?r?s?\b", re.I)


# A leading keyword names the reply the learner wants and overrides the classifier ("words: give, bring").
_KEYWORD = re.compile(r"^\s*(words?|vocab(?:ulary)?|phrases?|say|lesson)\s*[:\-–—]\s*", re.I)
_KEYWORD_KIND = {"word": "vocab", "words": "vocab", "vocab": "vocab", "vocabulary": "vocab",
                 "phrase": "new_request", "phrases": "new_request", "say": "new_request", "lesson": "lesson"}
# A request for words, recognised without the model: "the verbs for", "what's the word for", "list the words".
_WORD_ASK = re.compile(r"\b(?:verbs?|words?|nouns?|adjectives?|vocab\w*)\s+(?:for|meaning|that mean)\b"
                       r"|\bwhat(?:'s|\s+is|\s+are)\s+the\s+(?:italian\s+)?(?:words?|verbs?|nouns?)\b", re.I)


def keyword_kind(text: str) -> tuple[str | None, str]:
    """(the kind a leading keyword names, the text without it); (None, text) when there is no keyword."""
    m = _KEYWORD.match(text or "")
    if not m:
        return None, text
    return _KEYWORD_KIND[m.group(1).lower()], text[m.end():].strip()


async def step_understand(run: Run) -> str:
    forced, rest = keyword_kind(run.user)
    if forced:
        log(f"understand: keyword -> {forced}")
        run.user = rest or run.user
    if forced in ("vocab", "lesson"):
        run.understand = {"kind": forced, "meaning": run.user}
        return forced
    run.understand = await json_step(run, "understand", MODEL_FAST, UNDERSTAND_SYS, _understand_user(run), _valid_understand)
    if forced == "new_request" and run.understand["kind"] != "new_request":
        log(f"understand: classified {run.understand['kind']}, keyword says new_request")
        run.understand.update(kind="new_request", meaning=run.understand.get("meaning") or run.user,
                              register_default=run.understand.get("register_default") if run.understand.get("register_default") in REGISTERS else "neutral")
    if not forced and run.understand["kind"] == "new_request" and _WORD_ASK.search(run.user):
        log("understand: new_request that asks for words -> vocab")
        run.understand["kind"] = "vocab"
    if run.understand["kind"] == "drill" and not _PIMS_NAME.search(run.user):
        log("understand: drill without the Pimsleur name -> question (the coach practises in the conversation)")
        run.understand["kind"] = "question"
    log(f"understand: kind={run.understand['kind']}"
        + (f" phrases={len(phrases_of(run.understand))}" if run.understand["kind"] == "new_request" else ""))
    return run.understand["kind"]


async def build_check_one(run: Run, phrases: list, k: int) -> dict:
    """BUILD then CHECK for one phrase, in its own pipeline so the phrases do not wait for each other. A flagged item is
    rebuilt once, alone. The register rule has the last word on the labels."""
    n, tag = len(phrases), (f" {k + 1}" if len(phrases) > 1 else "")
    o = await json_step(run, f"build{tag}", MODEL_THINK, BUILD_SYS, _build_user(run, phrases, k), _valid_items(1))
    item = _norm_items(o)[0]
    user = (f"Situation: {run.understand.get('situation')}; listener: {run.understand.get('listener')}; "
            f"meaning: {phrases[k]['en']}\n\nN = 1 ITEMS UNDER REVIEW:\n"
            f"{json.dumps({'items': [{'item': 1, **item}]}, ensure_ascii=False)}")
    chk = await json_step(run, f"check{tag}", MODEL_FAST, CHECK_SYS, user, _valid_check)
    fixes = _flagged(chk, 1).get(0)
    if fixes:
        log(f"check{tag}: {fixes} — re-asking build for this phrase only, once")
        o = await json_step(run, f"build_fix{tag}", MODEL_THINK, BUILD_SYS, _build_user(run, phrases, k, fixes, item), _valid_items(1))
        item = _norm_items(o)[0]
    correct_build_registers(item, run.overrides)
    return item


_REG_NAME = {"lei": "Lei (formal)", "tu": "tu (informal)", "neutral": "neutral"}


def header_block(k: int, n: int, it: dict) -> str:
    """The Italian sentence, its register line and its variants, written by code from the built item (no model call)."""
    lines = [f"**{k + 1}) {it['it']}**" if n > 1 else f"**{it['it']}**",
             f"Register: {_REG_NAME[it['register']]}." + (f" {it['register_note']}" if it.get("register_note") else "")]
    for v in it["variants"]:
        lines.append(f"{_REG_PREFIX[v['register']]} {v['it']}" + (f" — {v['why']}" if v.get("why") else ""))
    return "\n".join(lines) + "\n\n"


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
_HOW = re.compile(r"\*\*How it[’']s built[^*\n]*\*\*")


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


def check_built(body: str, n: int, min_steps: int = 3) -> None:
    """Every phrase must carry its own "How it's built" section of `min_steps`+ numbered steps; else the reply is asked
    again. A one- or two-word answer has nothing to build up, so its caller asks for one step."""
    parts = _HOW.split(body)
    if len(parts) - 1 != n:
        raise ValueError(f'the reply has {len(parts) - 1} "How it\'s built" sections, it needs exactly {n} (one per phrase)')
    for k, sec in enumerate(parts[1:], 1):
        sec = sec.split("\n**", 1)[0]
        if len(re.findall(r"(?m)^\s*\d+[.)]\s", sec)) < min_steps:
            raise ValueError(f'the "How it\'s built" section of phrase {k} needs {min_steps} to 5 numbered steps')


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


async def _markdown_step(run: Run, step: str, system: str, user: str, need: tuple, check=None, with_meta: bool = True,
                         tag: str | None = None) -> tuple[str, dict]:
    """TEACH/COACH call; the reply must carry a meta block with the `need` keys (and pass `check`), else it is asked again (twice at most)."""
    cur, err = user, "no attempt made"
    for attempt in range(1, 3):
        try:
            text = await model_call(run, step, tag or MODEL_THINK, system, cur)
            body, meta = _split_meta(text) if with_meta else (text.strip(), {})
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


# ── DIAGRAM: the AnnotatedPassage (lib/schemas/widget-spec.ts) built from the sentences ─────────

AP_LAYERS = [("articles", "Articles", True), ("nouns", "Nouns", True), ("verbs", "Verbs", True), ("adverbs", "Adverbs", True),
             ("preps", "Prepositions", True), ("pronouns", "Pronouns", True), ("phrases", "Phrases", True),
             ("translation", "Translation", True), ("literal", "Word for word", False)]
AP_TOKEN_LAYERS = {"articles", "nouns", "verbs", "adverbs", "preps", "pronouns"}


def _ap_norm(t: str) -> str:
    return str(t).replace("’", "'").replace("‘", "'").lower()


_LETTERS = re.compile(r"[\W_]+")


def covers(surfaces: list[str], sentence: str) -> bool:
    """The tokens, joined, spell the sentence once whitespace, punctuation and case are ignored."""
    return _LETTERS.sub("", _ap_norm("".join(surfaces))) == _LETTERS.sub("", _ap_norm(sentence))


POS_LAYER = {"DET": "articles", "NOUN": "nouns", "PROPN": "nouns", "ADJ": "nouns", "NUM": "nouns", "VERB": "verbs", "AUX": "verbs",
             "ADV": "adverbs", "ADP": "preps", "CCONJ": "preps", "SCONJ": "preps", "PRON": "pronouns"}


def normalize_sentences(o) -> int:
    """Mechanical repairs of the DIAGRAM reply, in place: a token whose layer is not one of the six is given the layer its
    part of speech maps to, and a feature whose value is not a scalar is written as a string. Returns how many tokens changed
    (logged by the caller). A token whose pos is unknown is left for the validator."""
    n = 0
    for s in (o.get("sentences") if isinstance(o, dict) else None) or []:
        for t in (s.get("tokens") if isinstance(s, dict) else None) or []:
            if not isinstance(t, dict):
                continue
            pos = str(t.get("pos") or "").upper()
            if t.get("layer") not in AP_TOKEN_LAYERS and pos in POS_LAYER:
                t["layer"] = POS_LAYER[pos]; n += 1
            f = t.get("features")
            if isinstance(f, dict) and not all(isinstance(v, (str, int, float, bool)) for v in f.values()):
                t["features"] = {k: v if isinstance(v, (str, int, float, bool)) else ", ".join(map(str, v)) if isinstance(v, list) else str(v)
                                 for k, v in f.items()}; n += 1
    return n


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
        if all(isinstance(t, dict) and _nonempty(t.get("surface")) for t in toks) and not covers([t["surface"] for t in toks], text):
            issues.append(f'{p}.tokens: the surfaces, joined in order, must spell exactly "{text}": parse every word once, skip none, add none')
        for j, t in enumerate(toks, 1):
            q = f"{p}.tokens[{j}]"
            if not isinstance(t, dict):
                issues.append(f"{q}: must be an object"); continue
            if not _nonempty(t.get("surface")):
                issues.append(f"{q}.surface: required")
            elif _ap_norm(t["surface"]).strip(" .,;:!?«»\"'") not in _ap_norm(text):
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


_SENT_SPLIT = re.compile(r"(?<=[.?!])\s+")


def merge_sentences(parts: list[dict]) -> dict:
    """One ApSentence from the annotations of an item's sub-sentences, in order."""
    if len(parts) == 1:
        return parts[0]
    out = {"translation": " ".join(p["translation"].strip() for p in parts),
           "tokens": [t for p in parts for t in p["tokens"]],
           "phrases": [x for p in parts for x in (p.get("phrases") or [])],
           "tips": [x for p in parts for x in (p.get("tips") or [])][:3]}
    for k, sep in (("literal", " "), ("mood", " / "), ("registerNote", " ")):
        vals = [p[k].strip() for p in parts if _nonempty(p.get(k))]
        if vals:
            out[k] = sep.join(dict.fromkeys(vals)) if k != "literal" else sep.join(vals)
    return out


def _fixed_validate(step: str, o, sent: str):
    n = normalize_sentences(o)
    if n:
        log(f"{step}: {n} token field(s) repaired by rule (layer from pos / scalar features)")
    return validate_sentences(o, [sent])


async def diagram_item(run: Run, text: str, k: int, n: int) -> dict:
    """The annotation of ONE phrase: one call per Italian sentence in it, run concurrently, merged into one ApSentence.
    One call per sentence is the finest split there is (a sentence is the unit the model parses in one pass); a phrase
    that holds three sentences costs three calls. Raises when a sentence cannot be annotated."""
    subs = [x for x in _SENT_SPLIT.split(text.strip()) if x] or [text]

    async def one(j: int, sent: str):
        user = f"SENTENCES (annotate each, in this order):\n1. {sent}"
        step = "diagram" if n == 1 and len(subs) == 1 else f"diagram {k + 1}.{j}"
        o = await json_step(run, step, MODEL_STRUCT, DIAGRAM_SYS, user, lambda x: _fixed_validate(step, x, sent), max_repair=2)
        return o["sentences"][0]
    return merge_sentences(list(await asyncio.gather(*[one(j, s) for j, s in enumerate(subs, 1)])))


def finish_diagram(run: Run, results: list, texts: list[str], t0: float) -> dict | None:
    """The AnnotatedPassage from every phrase's annotation, or None (logged, recorded) when any of them failed."""
    for r in results:
        if isinstance(r, asyncio.CancelledError):
            raise r
    errs = [r for r in results if isinstance(r, BaseException)]
    try:
        if errs and len(errs) == len(results):
            raise errs[0]
        for r, t in zip(results, texts):
            if isinstance(r, BaseException):
                log(f"diagram dropped for {t!r}: {type(r).__name__}: {r}"[:400])
        keep = [(r, t) for r, t in zip(results, texts) if not isinstance(r, BaseException)]
        doc = assemble_passage([r for r, _ in keep], [t for _, t in keep])
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
    """DIAGRAM then RELATED for sentences that are already final (the COACH path's corrected sentence)."""
    t0 = time.time()
    res = await asyncio.gather(*[diagram_item(run, t, k, len(texts)) for k, t in enumerate(texts)], return_exceptions=True)
    doc = finish_diagram(run, list(res), texts, t0)
    return doc, await step_related(run, doc)


# ── TEACH / COACH / ANSWER ───────────────────────────────────────────────────────

def _teach_user(run: Run) -> str:
    phrases = phrases_of(run.understand)
    parts = []
    for k, (b, ph) in enumerate(zip(run.items, phrases), 1):
        same = _norm(b["literal_trap"]["it"]) == _norm(b["it"])
        trap = ("LITERAL TRAP: none — the literal version is not different from the main sentence: "
                + ("leave the Watch out section out." if len(run.items) == 1 else "leave this phrase out of the Watch out section.")
                if same else f"LITERAL TRAP: {json.dumps(b['literal_trap'], ensure_ascii=False)}")
        parts.append((f"PHRASE {k} (English: {ph['en']})\n" if len(run.items) > 1 else "")
                     + f"MAIN SENTENCE (use exactly): {b['it']}\nREGISTER (use exactly): {b['register']} — {b.get('register_note') or ''}\n"
                       f"VARIANTS: {json.dumps(b['variants'], ensure_ascii=False)}\n{trap}")
    return (f"N = {len(run.items)}\n\n" + "\n\n".join(parts)
            + f"\n\nThe learner's intent: {run.understand.get('meaning')} (situation: {run.understand.get('situation')})")


def _item_user(run: Run, phrases: list, k: int, it: dict) -> str:
    return (f"PHRASE (English): {phrases[k]['en']}\nMAIN SENTENCE (use exactly): {it['it']}\n"
            f"REGISTER (use exactly): {it['register']} — {it.get('register_note') or ''}")


_STEP = re.compile(r"(?m)^(\s*)(\d+)([.)])\s.*$")


def pin_last_step(steps: str, sentence: str) -> str:
    """The last numbered step must show the BUILD sentence exactly. When its bold fragment differs, the step is replaced
    by one that does, and the swap is logged."""
    last = None
    for last in _STEP.finditer(steps):
        pass
    if last is None:
        return steps
    frags = re.findall(r"\*\*([^*]+)\*\*", last.group(0))
    if frags and _norm(frags[0]) == _norm(sentence) and frags[0].strip() == sentence.strip():
        return steps
    log(f"how-built: last step {frags[0] if frags else last.group(0)!r} != BUILD sentence {sentence!r} — replaced")
    new = f"{last.group(1)}{last.group(2)}{last.group(3)} **{sentence}**: the full sentence."
    return steps[:last.start()] + new + steps[last.end():]


async def teach_item(run: Run, phrases: list, k: int, it: dict) -> str:
    """The "How it's built" section of one phrase, headed so a numbered list of phrases stays readable."""
    n = len(phrases)
    head = f"**How it's built · {k + 1}) {it['it']}**" if n > 1 else "**How it's built**"
    least = 1 if len(it["it"].split()) <= 2 else 3
    try:
        body, _ = await _markdown_step(run, f"how-built {k + 1}" if n > 1 else "how-built", TEACH_ITEM_SYS,
                                       _item_user(run, phrases, k, it), (), check=lambda b: check_built(b, 1, least),
                                       with_meta=False, tag=MODEL_STRUCT)
    except RuntimeError as e:          # one missing section must not cost the learner the rest of the reply
        log(f"how-built {k + 1}: left out — {e}")
        return f"{head}\n_This section could not be written; the rest of the reply is complete._\n\n"
    steps = pin_last_step(_HOW.sub("", body, count=1).strip(), it["it"])
    return f"{head}\n{steps}\n\n"


async def teach_shared(run: Run) -> tuple[str, dict]:
    """Pattern, why, watch out and your turn for all phrases, plus the meta block."""
    body, meta = await _markdown_step(run, "teach", TEACH_SHARED_SYS, _teach_user(run), ("pattern", "practice"))
    if len(run.items) == 1:
        body = drop_same_string_watch_out(body, run.items[0]["it"], run.items[0]["literal_trap"]["it"])
    return body + "\n", meta


async def _new_request(run: Run) -> None:
    """Every phrase runs its own BUILD -> CHECK pipeline concurrently; its Italian and register line are emitted as soon as it
    (and every earlier phrase) is done, then the How-it's-built sections in order, then the shared teaching, then the
    hidden blocks. The reply text only ever grows at its end, so it can be streamed."""
    phrases = phrases_of(run.understand)
    n = len(phrases)
    run.items = [None] * n
    hdr = [asyncio.Event() for _ in range(n)]
    how: list = [None] * n
    diag: list = [None] * n
    t_diag = time.time()

    async def item(k: int) -> None:
        it = await build_check_one(run, phrases, k)
        run.items[k] = it
        how[k] = asyncio.ensure_future(teach_item(run, phrases, k, it))                 # started now, emitted in order
        diag[k] = asyncio.ensure_future(diagram_item(run, it["it"], k, n))
        if k:
            await hdr[k - 1].wait()
        run.emit(header_block(k, n, it))
        hdr[k].set()

    tasks = [asyncio.ensure_future(item(k)) for k in range(n)]
    shared = None
    try:
        await asyncio.gather(*tasks)
        run.steps.append({"step": "register", "model": "rule", "done_reason": "n/a", "latency_ms": 0,
                          "thinking_chars": 0, "overrides": list(run.overrides)})
        shared = asyncio.ensure_future(teach_shared(run))
        for f in how:
            run.emit(await f)
        body, meta = await shared
        run.emit(body)
        texts = [b["it"] for b in run.items]
        doc = finish_diagram(run, list(await asyncio.gather(*diag, return_exceptions=True)), texts, t_diag)
        rel = await step_related(run, doc)
    finally:
        for t in [*tasks, *how, *diag, shared]:
            if t is not None and not t.done():
                t.cancel()
    first = run.items[0]
    var = lambda b: [{"it": v["it"], "register": v["register"]} for v in b["variants"]]
    data = {"it": first["it"], "en_intent": (run.understand.get("meaning") or run.user) if n == 1 else "; ".join(p["en"] for p in phrases),
            "register": first["register"], "variants": var(first), "breakdown": meta.get("breakdown") or [],
            "pattern": meta["pattern"], "slots": meta.get("slots") or [], "practice": meta["practice"],
            "items": [{"it": b["it"], "en": p["en"], "register": b["register"], "variants": var(b)} for b, p in zip(run.items, phrases)]}
    run.emit(_tail(" ".join(texts), data, doc, rel))


async def _attempt(run: Run) -> None:
    lp = run.last_phrase or {}
    user = (f"PRACTICE SENTENCE (English): {lp.get('practice') or '(unknown; infer it from the earlier turns)'}\n"
            f"PATTERN TAUGHT: {lp.get('pattern') or '(unknown)'} with slots {lp.get('slots') or []}\n"
            f"EARLIER TURNS:\n{run.transcript()}\n\nLEARNER'S ITALIAN ATTEMPT:\n{run.user}")
    body, meta = await _markdown_step(run, "coach", COACH_SYS, user, ("corrected", "practice"), check=lambda b: check_built(b, 1))
    reg = meta.get("register") if meta.get("register") in REGISTERS else "neutral"
    reg = apply_register_rule(meta["corrected"], reg, "corrected", run.overrides)
    run.emit(fix_register_lines(body, reg, _REG_NOTE[reg], [], meta["corrected"]) + "\n")
    # the corrected sentence only exists once COACH has answered, so its diagram follows it
    doc, rel = await _diagram_related(run, [meta["corrected"]])
    data = {"it": meta["corrected"], "en_intent": lp.get("practice") or "", "register": reg, "variants": [],
            "breakdown": meta.get("breakdown") or [], "pattern": meta.get("pattern") or lp.get("pattern") or "",
            "slots": meta.get("slots") or [], "practice": meta["practice"],
            "items": [{"it": meta["corrected"], "en": lp.get("practice") or "", "register": reg, "variants": []}]}
    run.emit(_tail(meta["corrected"], data, doc, rel))


async def _question(run: Run) -> None:
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
    run.emit(body + (f"\n\n[[SPEAK]]{speak.replace('[[', '').replace(']]', '')}[[/SPEAK]]" if speak else ""))


async def _drill(run: Run) -> None:
    """The learner asked to practise the phrases aloud. The page owns the phrases and the player; this only signals it."""
    run.emit("Opening a live drill with your phrases.\n\n```drill\n" + _json_fence({"action": "open"}) + "\n```")


VOCAB_SYS = """You are a concise Italian vocabulary coach for an English speaker. The learner asked for Italian WORDS, not sentences.
Give one entry per word they asked for, in their order; when they ask for "the verbs for X", give the verb an Italian speaker would really use for X (and at most one common alternative in "note").
Reply with ONLY a JSON object:
{"words": [{"en": "the English word as they asked", "it": "the Italian dictionary form (infinitive for a verb, singular with its article for a noun: il letto, la flebo)", "pos": "verb|noun|adjective|adverb|expression", "note": "one short line that matters for use: irregular forms, gender, a common alternative and when it fits; or empty", "example_it": "one short natural Italian sentence using it", "example_en": "its English meaning"}]}"""


def _valid_vocab(o):
    w = o.get("words") if isinstance(o, dict) else None
    if not isinstance(w, list) or not w:
        return '"words" must be a non-empty list'
    for i, e in enumerate(w, 1):
        if not isinstance(e, dict) or not all(str(e.get(k) or "").strip() for k in ("en", "it", "example_it")):
            return f'words[{i}] needs "en", "it" and "example_it"'
    return None


async def _vocab(run: Run) -> None:
    """A word list: each Italian word with a use note and one example sentence. The example sentences are the reply's
    phrases, so the basket, cards and drill get whole sentences rather than single words."""
    o = await json_step(run, "vocab", MODEL_STRUCT, VOCAB_SYS, f"EARLIER TURNS:\n{run.transcript()}\n\nLEARNER ASKS:\n{run.user}", _valid_vocab)
    words = o["words"]
    out = []
    for k, w in enumerate(words, 1):
        pos = f" · {w['pos']}" if str(w.get("pos") or "").strip() else ""
        lines = [f"**{k}) {w['it']}** — {w['en']}{pos}"]
        if str(w.get("note") or "").strip():
            lines.append(str(w["note"]).strip())
        lines.append(f"*{w['example_it']}*" + (f" — {w['example_en']}" if str(w.get("example_en") or "").strip() else ""))
        out.append("\n".join(lines))
    run.emit("\n\n".join(out) + "\n\n_Want any of these built into a full phrase? Ask for it, or start with **phrase:**._")
    items = [{"it": w["example_it"], "en": str(w.get("example_en") or w["en"]), "register": "neutral", "variants": []} for w in words]
    data = {"it": ", ".join(w["it"] for w in words), "en_intent": run.user, "register": "neutral", "variants": [],
            "words": [{"it": w["it"], "en": w["en"], "pos": w.get("pos") or "", "note": w.get("note") or ""} for w in words],
            "items": items}
    run.emit(_tail("\n".join(f"{w['it']}. {w['example_it']}" for w in words), data))


async def _lesson(run: Run) -> None:
    """A full lesson is generated by the lesson generator, which costs a model run: the coach points at it, never starts it."""
    topic = str(run.understand.get("meaning") or run.user).strip()
    run.emit(f"That sounds like a full lesson on **{topic}**, not a phrase. Tap **📘 Make a lesson from this** below "
             "to generate it, or ask me for the words or a phrase first.")


_CLARIFY_LABEL = {"vocab": "Just the words", "new_request": "Build full phrases", "lesson": "Make a full lesson",
                  "question": "Explain it"}
_CLARIFY_PREFIX = {"vocab": "words: ", "new_request": "phrase: ", "lesson": "lesson: ", "question": ""}


async def _clarify(run: Run) -> None:
    """The classifier could not tell what the learner wants: ask, with one button per reading. A button sends the
    question again with its keyword, so the answer is not classified a second time."""
    opts = list(dict.fromkeys(run.understand["options"]))[:3]
    choices = [{"label": _CLARIFY_LABEL[o], "send": _CLARIFY_PREFIX[o] + run.user} for o in opts]
    run.emit(str(run.understand["clarify_question"]).strip() + "\n\n"
             + "\n".join(f"- **{c['label']}**" for c in choices)
             + "\n\n_Tip: start a message with **words:**, **phrase:** or **lesson:** to choose directly._"
             + "\n\n```choices\n" + _json_fence({"choices": choices}) + "\n```")


# ── entry points ─────────────────────────────────────────────────────────────────

async def _pipeline(run: Run, session_id: str | None) -> None:
    try:
        with ledger.context(session_id=session_id, run_id=ledger.new_run_id()):
            kind = await step_understand(run)
            await {"new_request": _new_request, "vocab": _vocab, "attempt": _attempt, "question": _question, "drill": _drill,
                   "lesson": _lesson, "clarify": _clarify}[kind](run)
    finally:
        run.q.put_nowait(None)


async def coach_stream(messages: list[dict], session_id: str | None = None):
    """Async generator over the reply: yields ("text", chunk) as each section of the answer is ready, then ("done", result).
    The text only ever grows at its end. A failed run raises from the generator after the chunks already yielded;
    cancelling the consumer cancels the run."""
    run = Run(messages)
    task = asyncio.ensure_future(_pipeline(run, session_id))
    try:
        while True:
            chunk = await run.q.get()
            if chunk is None:
                break
            yield ("text", chunk)
        await task                                       # re-raises the run's failure
        yield ("done", {"content": "".join(run.parts), "kind": run.understand["kind"], "steps": run.steps,
                        "register_overrides": run.overrides, "diagram_error": run.diagram_error,
                        "first_text_ms": run.first_text_ms, "total_ms": int((time.time() - run.t0) * 1000)})
    finally:
        if not task.done():
            task.cancel()


async def coach(messages: list[dict], session_id: str | None = None) -> dict:
    """The whole reply at once (stream:false and the tests): coach_stream folded."""
    async for kind, val in coach_stream(messages, session_id):
        if kind == "done":
            return val


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "How do I say I'm here for my specialization?"
    out = asyncio.run(coach([{"role": "user", "content": q}]))
    print(out["content"])
    print(json.dumps({"kind": out["kind"], "steps": out["steps"], "first_text_ms": out["first_text_ms"], "total_ms": out["total_ms"]}, indent=1))
