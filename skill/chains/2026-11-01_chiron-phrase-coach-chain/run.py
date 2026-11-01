#!/usr/bin/env python3
"""chiron-phrase-coach-chain — a phrase COACH for Ask's "Come si dice" mode.

The learner says what they mean in English. The chain does not hand back a translation: it builds the Italian
a native would say, then teaches the reusable pattern behind it and sets one practice sentence. When the next
turn is the learner's Italian attempt it coaches that attempt instead.

Importable: `await coach(messages)` -> {"content": markdown, "kind", "steps": [...], "total_ms"}.
The server (server/phrase_coach.py) calls it for POST /ask/phrase/api/chat.

A PromptChain of four function steps, sharing one per-call state:
  1 UNDERSTAND  (mistral, JSON)      classify the latest turn: new_request | attempt | question; for a new
                                     request extract meaning, situation, listener, default register, nuance
  2 BUILD       (glm, JSON)          the native sentence, register, variants, the literal trap
  3 CHECK       (mistral, JSON)      critic: natural? register label true? A failed check re-asks BUILD once
  4 TEACH/COACH (glm, markdown)      new_request -> pattern lesson; attempt -> coaching; question -> short answer
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
        self.understand = self.build = self.check = None
        self.overrides: list[dict] = []
        self.content = ""
        self.t0 = time.time()

    def transcript(self) -> str:
        out = []
        for t in self.history:
            text = _FENCE.sub("", _SPEAK.sub("", str(t["content"]))).strip()
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
For a new_request also extract what is needed to build the sentence. Reply with ONLY a JSON object:
{"kind": "new_request|attempt|question", "meaning": "what they really mean, in English", "situation": "where/when", "listener": "who they are speaking to", "register_default": "lei|tu|neutral", "register_reason": "one short reason", "nuance": "politeness, urgency or tone that matters, or empty"}
For the other kinds the other fields may be empty strings."""

BUILD_SYS = """You write Italian the way a native speaker actually says it in a given situation. Never translate word for word: if the literal wording is not what Italians say, give what they say.
Reply with ONLY a JSON object:
{"it": "the main sentence", "register": "lei|tu|neutral", "register_note": "one short line on why", "variants": [{"it": "...", "register": "lei|tu|neutral", "why": "..."}], "literal_trap": {"it": "the word-for-word version an English speaker would produce", "why": "why it sounds off or wrong"}}
Rules:
- register is "lei" or "tu" only if the sentence contains an address form (Lei/tu verb endings, pronouns, imperatives, polite openers like "Scusi"/"Scusa"). A sentence with no address form is "neutral".
- variants: the other register's version only when it differs from the main sentence, plus at most one common alternative phrasing. An empty list is fine.
- Say what the learner asked for. Do not add openers, greetings or content they did not ask for.
- literal_trap.it must be what a literal translation would give, even if it is wrong."""

CHECK_SYS = """You are a strict native-speaker reviewer of an Italian phrase built for an English-speaking learner.
Judge: (1) is "it" what a native would really say in this situation, not a literal translation? (2) is the register label true (a sentence with no Lei/tu form is "neutral", and "lei" requires a Lei form)? (3) are the variants correct, and is each variant's register label true? (4) is literal_trap really the word-for-word version, and is its "why" right?
The register labels are a fixed vocabulary (lei, tu, neutral): never ask to rename or reword a label. Flag ONLY real errors: unnatural or wrong Italian, a false register label, a wrong variant, a wrong literal_trap. Do not request additions, extra variants, extra notes, openers the learner did not ask for, or stylistic preferences. If the phrase is acceptable, ok is true.
Reply with ONLY a JSON object: {"ok": true|false, "fixes": ["one concrete instruction per real error"]}. "fixes" is empty when ok is true."""

TEACH_SYS = """You are a warm, concise Italian coach. You do not just translate: you teach the learner to build the sentence themselves.
Write a reply in English with Italian phrases, in exactly this Markdown layout, nothing before or after it except the meta block:

**<the main Italian sentence>**
Register: <Lei (formal) | tu (informal) | neutral>. <short reason>
<Formal (Lei): ... or Informal (tu): ... , only if a different-register variant is given; skip otherwise>

**The pattern**
`<reusable frame with [slots]>` then 2-3 swaps showing the same frame in other situations (Italian, with a 2-4 word English gloss each).

**Why Italians say it this way**
1-2 lines.

**Watch out**
The literal trap: show the WRONG form and the RIGHT form as two different strings (wrong: the word-for-word version an English speaker would say; right: the main sentence), and say why the wrong one is off. If the wrong form is not different from the right one, leave this whole section out.

**Your turn**
One new English sentence that needs the same pattern, for the learner to try in Italian.

Then end with a fenced block tagged meta holding ONLY this JSON (the system builds the spoken and data blocks from it, so do not write any [[SPEAK]] text yourself):
```meta
{"pattern": "the frame, same as above", "slots": ["slot names"], "practice": "the Your-turn English sentence", "breakdown": [{"chunk": "Italian chunk", "gloss": "English gloss"}]}
```
Use the given sentence and register exactly as provided. 2 to 4 breakdown chunks. Keep the whole reply short."""

COACH_SYS = """You are a warm, concise Italian coach marking a learner's attempt. The learner was asked to say a practice sentence in Italian, using a pattern from the last phrase.
Write in English with Italian phrases, in exactly this Markdown layout, nothing before or after it except the meta block:

**<what is right>** One or two lines on what they got right (be specific and encouraging).
**Corrections** Each error as a bullet: what they wrote -> what it should be, and why. If there are no errors, say so plainly. Correctness wins over encouragement: never call a wrong form right.
**Corrected sentence** the full correct Italian sentence in bold, with a Register line.
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

def _valid_understand(o):
    if not isinstance(o, dict) or o.get("kind") not in KINDS:
        return f'"kind" must be one of {list(KINDS)}'
    if o["kind"] == "new_request":
        if not str(o.get("meaning") or "").strip():
            return '"meaning" is required for a new_request'
        if o.get("register_default") not in REGISTERS:
            return '"register_default" must be lei|tu|neutral'
    return None


def _valid_build(o):
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


def _valid_check(o):
    if not isinstance(o, dict) or not isinstance(o.get("ok"), bool) or not isinstance(o.get("fixes", []), list):
        return 'need {"ok": bool, "fixes": [..]}'
    return None


def _understand_user(run: Run) -> str:
    lp = run.last_phrase
    practice = (lp or {}).get("practice") or "(none — there is no open practice sentence)"
    return (f"EARLIER TURNS:\n{run.transcript()}\n\nLAST PRACTICE (English sentence the learner was asked to say in Italian): "
            f"{practice}\n\nLATEST LEARNER TURN:\n{run.user}")


def _build_user(run: Run, fixes: list | None = None) -> str:
    u = run.understand
    text = (f"Meaning: {u.get('meaning')}\nSituation: {u.get('situation') or 'unspecified'}\n"
            f"Listener: {u.get('listener') or 'unspecified'}\nDefault register: {u.get('register_default')} "
            f"({u.get('register_reason') or 'no reason given'})\nNuance: {u.get('nuance') or 'none'}\n"
            f"Learner's own words: {run.user}")
    if fixes:
        text += "\n\n## REVIEWER FIXES (apply every one)\n" + "\n".join(f"- {f}" for f in fixes) + \
                f"\n\nPrevious attempt:\n{json.dumps(run.build, ensure_ascii=False)}"
    return text


async def step_understand(run: Run) -> str:
    run.understand = await json_step(run, "understand", MODEL_FAST, UNDERSTAND_SYS, _understand_user(run), _valid_understand)
    log(f"understand: kind={run.understand['kind']}")
    return run.understand["kind"]


async def step_build(run: Run, _prev: str) -> str:
    if run.understand["kind"] != "new_request":
        return _prev
    run.build = await json_step(run, "build", MODEL_THINK, BUILD_SYS, _build_user(run), _valid_build)
    return json.dumps(run.build, ensure_ascii=False)


async def step_check(run: Run, _prev: str) -> str:
    if run.understand["kind"] != "new_request":
        return _prev
    user = (f"Situation: {run.understand.get('situation')}; listener: {run.understand.get('listener')}; "
            f"meaning: {run.understand.get('meaning')}\n\nPHRASE UNDER REVIEW:\n{json.dumps(run.build, ensure_ascii=False)}")
    run.check = await json_step(run, "check", MODEL_FAST, CHECK_SYS, user, _valid_check)
    fixes = [str(f) for f in run.check.get("fixes") or [] if str(f).strip()]
    if not run.check["ok"] and fixes:
        log(f"check: {len(fixes)} fix(es) — re-asking build once: {fixes}")
        run.build = await json_step(run, "build_fix", MODEL_THINK, BUILD_SYS, _build_user(run, fixes), _valid_build)
    else:
        log("check: ok")
    correct_build_registers(run.build, run.overrides)
    run.steps.append({"step": "register", "model": "rule", "done_reason": "n/a", "latency_ms": 0,
                      "thinking_chars": 0, "overrides": list(run.overrides)})
    return json.dumps(run.build, ensure_ascii=False)


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


def _tail(it: str, data: dict) -> str:
    """The spoken block and the machine-readable phrase block, built here so both are always well-formed."""
    spoken = it.replace("[[", "").replace("]]", "").strip()
    return f"\n\n[[SPEAK]]{spoken}[[/SPEAK]]\n\n```phrase\n{json.dumps(data, ensure_ascii=False)}\n```"


async def _markdown_step(run: Run, step: str, system: str, user: str, need: tuple) -> tuple[str, dict]:
    """TEACH/COACH call; the reply must carry a meta block with the `need` keys, else it is asked again (twice at most)."""
    cur, err = user, "no attempt made"
    for attempt in range(1, 3):
        try:
            text = await model_call(run, step, MODEL_THINK, system, cur)
            body, meta = _split_meta(text)
            missing = [k for k in need if not meta.get(k)]
            if missing:
                raise ValueError(f"meta block lacks {missing}")
            return _SPEAK.sub("", _FENCE.sub("", body)).strip(), meta
        except (ModelReplyError, ValueError) as e:
            err = str(e)
            log(f"{step} attempt {attempt}: {err} — retrying")
            cur = user + f"\n\n## PREVIOUS REPLY WAS UNUSABLE\n{err}\nFollow the layout exactly and end with the meta block."
    raise RuntimeError(f"{step}: no usable reply — {err}")


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
        body = _SPEAK.sub("", _FENCE.sub("", body)).strip()
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
        body, meta = await _markdown_step(run, "coach", COACH_SYS, user, ("corrected", "practice"))
        reg = meta.get("register") if meta.get("register") in REGISTERS else "neutral"
        reg = apply_register_rule(meta["corrected"], reg, "corrected", run.overrides)
        body = fix_register_lines(body, reg, _REG_NOTE[reg], [], meta["corrected"])
        data = {"it": meta["corrected"], "en_intent": lp.get("practice") or "", "register": reg, "variants": [],
                "breakdown": meta.get("breakdown") or [], "pattern": meta.get("pattern") or lp.get("pattern") or "",
                "slots": meta.get("slots") or [], "practice": meta["practice"]}
        run.content = body + _tail(meta["corrected"], data)
        return run.content
    b = run.build
    user = (f"MAIN SENTENCE (use exactly): {b['it']}\nREGISTER (use exactly): {b['register']} — {b.get('register_note') or ''}\n"
            f"VARIANTS: {json.dumps(b['variants'], ensure_ascii=False)}\nLITERAL TRAP: {json.dumps(b['literal_trap'], ensure_ascii=False)}\n"
            f"The learner's intent: {run.understand.get('meaning')} (situation: {run.understand.get('situation')})")
    if _norm(b["literal_trap"]["it"]) == _norm(b["it"]):
        user += "\n\nThe literal trap is not different from the main sentence: leave the Watch out section out."
    body, meta = await _markdown_step(run, "teach", TEACH_SYS, user, ("pattern", "practice"))
    body = drop_same_string_watch_out(body, b["it"], b["literal_trap"]["it"])
    body = fix_register_lines(body, b["register"], b.get("register_note"), b["variants"], b["it"])
    data = {"it": b["it"], "en_intent": run.understand.get("meaning") or run.user, "register": b["register"],
            "variants": [{"it": v["it"], "register": v["register"]} for v in b["variants"]],
            "breakdown": meta.get("breakdown") or [], "pattern": meta["pattern"], "slots": meta.get("slots") or [],
            "practice": meta["practice"]}
    run.content = body + _tail(b["it"], data)
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
            "total_ms": int((time.time() - run.t0) * 1000)}


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "How do I say I'm here for my specialization?"
    out = asyncio.run(coach([{"role": "user", "content": q}]))
    print(out["content"])
    print(json.dumps({"kind": out["kind"], "steps": out["steps"], "total_ms": out["total_ms"]}, indent=1))
