"""
Chiron lesson TUTOR as a PromptChain — the "eco-lite, lighter than a full lesson" in-page helper.

Adapted from the SSM tutor (ssm_essame/specializzando/knowledge/tutor_chain.py). The ONE difference
that matters: SSM grounds a turn by a question-id; a Chiron LESSON page has rich on-screen prose, so
we ground on what the learner is actually reading — the CURRENT SECTION TEXT + their SELECTION/highlight
passed from the page. Harrison's is still pulled ONLY on a genuinely deep turn (classifier router) and
then dropped — never carried into the running context.

  A CLASSIFIER (fast cloud model) routes each turn:
    SIMPLE  → one answer call grounded on the section (model answers from section + its knowledge)
    COMPLEX → draft (section + knowledge) + harrison-search(topic) → synthesize the two

Runs HOST-side (needs harrison-search + keys + the governor; the Docker backend reaches none of them).
Static orchestration — a Callable/classifier decides control flow, never the answering model. (R-PC1)
"""
from __future__ import annotations
import sys
import json, os, re, subprocess, urllib.request
from promptchain.utils.promptchaining import PromptChain
from promptchain.utils.agentic_step_processor import AgenticStepProcessor

AGENT_MODEL = os.environ.get("TUTOR_AGENT_MODEL", "gemini/gemini-flash-latest")
MAX_HISTORY_TURNS = int(os.environ.get("TUTOR_MAX_TURNS", "8"))

def _window(history: list[dict]) -> list[dict]:
    """Keep the dialogue tight over a long session: last N turns verbatim; older collapse to a recap."""
    h = [m for m in history if (m.get("content") or "").strip()]
    if len(h) <= MAX_HISTORY_TURNS:
        return h
    older, recent = h[:-MAX_HISTORY_TURNS], h[-MAX_HISTORY_TURNS:]
    topics = "; ".join((m.get("content") or "")[:50] for m in older if m.get("role") == "user")[:400]
    return [{"role": "user", "content": f"[earlier in this session we discussed: {topics}]"}] + recent

GEMINI_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""
GEMINI_MODEL = os.environ.get("TUTOR_GEMINI_MODEL", "gemini-flash-latest")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
OLLAMA_KEY = os.environ.get("OLLAMA_API_KEY", "")
OLLAMA_CLOUD = "https://ollama.com/api/chat"
GOVERNOR = os.environ.get("ATELIER_GOVERNOR", "http://192.168.0.159:8799/llm/ollama")

# ── SWITCHABLE model registry (pick in the lesson; passed per request) ─────────────
# spec = 'cloud:<model>' (Ollama Cloud, fast) | 'gemini' (direct API) | 'governor:<model>' (Mac, local)
MODELS = {
    "gemma4":     {"label": "Gemma 4 31B · cloud (fast, default)", "spec": "cloud:gemma4:31b"},
    "gemini3":    {"label": "Gemini 3 Flash · cloud",             "spec": "cloud:gemini-3-flash-preview"},
    "deepseek":   {"label": "DeepSeek V4 Flash · cloud",          "spec": "cloud:deepseek-v4-flash"},
    "gptoss":     {"label": "GPT-OSS 120B · cloud",               "spec": "cloud:gpt-oss:120b"},
    "gemini_api": {"label": "Gemini Flash · direct API",          "spec": "gemini"},
    "qwen_local": {"label": "Qwen3 32B · Mac (local)",            "spec": "governor:qwen3:32b"},
    "gemma_local":{"label": "Gemma3 27B · Mac (local)",           "spec": "governor:gemma3:27b"},
    "agent":      {"label": "Deep agent · tool-calling (slower)", "spec": "agent"},
}
DEFAULT_MODEL = os.environ.get("TUTOR_DEFAULT_MODEL", "gemma4")
CLASSIFY_SPEC = os.environ.get("TUTOR_CLASSIFY", "cloud:deepseek-v4-flash")
FALLBACKS = ["cloud:gemini-3-flash-preview", "cloud:gemma4:31b", "gemini", "cloud:deepseek-v4-flash"]

DEEP = re.compile(r"\b(why|how does|how do|mechanism|pathophysiolog|differential|compare|contrast|"
                  r"cause|etiolog|treat|treatment|manage|management|first.line|dose|deeper|in depth|"
                  r"in detail|expand|tell me more|more detail|explain the|walk me|reason|criteria|threshold|"
                  # full-picture asks — these want the WHOLE pathway, not a page-skim (the 'testosterone
                  # metabolism in detail' miss: 'in detail'/'metabolism'/'pathway' weren't matched)
                  r"metabolis|metabolic|pathway|biosynthes|synthesis|breakdown|cascade|axis|physiolog|"
                  r"biochem|full|complete|entire|end.to.end|from start|soup to nuts|everything about)\b", re.I)
# WEB signals → the answer likely lives past a 2022 textbook (recent guidelines/drugs/trials/epi) → hypersearch
RECENT = re.compile(r"\b(latest|recent|newest|current|updated|2023|2024|2025|2026|guideline|guidelines|"
                    r"new drug|newly approved|approval|fda|ema|aifa|trial|trials|study|studies|meta.?analysis|"
                    r"this year|nowadays|state of the art|cutting edge|as of)\b", re.I)

# ── raw per-provider callers (verbatim from the SSM tutor) ──────────────────────
def _gemini(system: str, history: list[dict], user: str) -> str:
    contents = []
    for m in history[-10:]:
        role = "model" if m.get("role") == "assistant" else "user"
        if (m.get("content") or "").strip(): contents.append({"role": role, "parts": [{"text": m["content"]}]})
    if user: contents.append({"role": "user", "parts": [{"text": user}]})
    body = {"contents": contents, "systemInstruction": {"parts": [{"text": system}]},
            "generationConfig": {"temperature": 0.3}}
    req = urllib.request.Request(GEMINI_URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY})
    d = json.loads(urllib.request.urlopen(req, timeout=90).read())
    return d["candidates"][0]["content"]["parts"][0]["text"].strip()

def _ollama_chat(url: str, model: str, headers: dict, system: str, history: list[dict], user: str) -> str:
    msgs = [{"role": "system", "content": system}] if system else []
    for m in history[-10:]:
        r = "assistant" if m.get("role") == "assistant" else "user"
        if (m.get("content") or "").strip(): msgs.append({"role": r, "content": m["content"]})
    if user: msgs.append({"role": "user", "content": user})
    body = json.dumps({"model": model, "stream": False, "options": {"temperature": 0.3}, "messages": msgs}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", **headers})
    c = json.loads(urllib.request.urlopen(req, timeout=140).read())["message"]["content"].strip()
    if not c: raise RuntimeError("empty response")
    return c

def _call(spec: str, system: str, history: list[dict], user: str) -> str:
    prov, _, model = spec.partition(":")
    if prov == "cloud":    return _ollama_chat(OLLAMA_CLOUD, model, {"Authorization": "Bearer " + OLLAMA_KEY}, system, history, user)
    if prov == "governor": return _ollama_chat(GOVERNOR + "/api/chat", model or "gemma3:27b", {}, system, history, user)
    return _gemini(system, history, user)

# The last thing that went wrong on the answer path, per provider spec. The
# fallback chain used to swallow every exception and return a generic string, so
# "the tutor is unavailable" was unfalsifiable: a timeout, a rotated key and an
# oversized payload all looked identical, and nothing was logged. That is the
# opposite of the project's observability rule, and it is what made the deep/web
# path undiagnosable — it fails while the quick/page path answers fine.
LAST_ERRORS: list[tuple[str, str]] = []


def _answer(spec: str, system: str, history: list[dict], user: str) -> str:
    errs: list[tuple[str, str]] = []
    for s in [spec] + [f for f in FALLBACKS if f != spec]:
        try:
            r = _call(s, system, history, user)
            if r:
                return r
            errs.append((s, "empty response"))
        except Exception as e:
            errs.append((s, f"{type(e).__name__}: {e}"))
    LAST_ERRORS[:] = errs
    for s, e in errs:
        sys.stderr.write(f"[tutor] {s} failed — {e}\n")
    sys.stderr.flush()
    # Same user-facing text; the detail goes to the log and to LAST_ERRORS so the
    # caller can surface WHICH provider failed and why.
    return "(the tutor is unavailable right now — check the model / keys)"

# HARD = a question one lookup can't satisfy: multi-hop, cross-domain, or a full biochemical/physiologic
# network the lesson will never contain. These earn the AGENT (multi-step reason + repeated retrieval).
HARD = re.compile(r"\b(metabolis|metabolic|biosynthes|biochem|pathway|cascade|axis|feedback loop|"
                  r"end.to.end|from (creation|synthesis|start)|full picture|entire (pathway|process)|"
                  r"how .* relate|tie .* together|integrate|synthesi[sz]e|compare .* and .* and|"
                  r"upstream|downstream|rate.limiting)\b", re.I)


def _route(user: str) -> str:
    """4-way router — TWO dimensions: (1) is it answerable here, (2) how HARD is it. That picks how much
    machinery to spend: quick (page+model) · textbook (one Harrison's lookup) · web (one hypersearch) ·
    agent (DIFFICULT → multi-step reasoning with BOTH tools, branching searches until it's answered)."""
    if len(user) < 40 and not DEEP.search(user) and not RECENT.search(user) and not HARD.search(user):
        return "quick"
    if HARD.search(user) and (DEEP.search(user) or len(user) > 55):
        return "agent"                                     # hard + wants depth → escalate to the agent
    if RECENT.search(user):
        return "web"                                       # obvious "latest/2024/guideline" → web
    try:
        sysc = ("Classify a medical learner's question about a lesson they're reading. Reply EXACTLY one word.\n"
                "QUICK = a definition/clarification a strong model answers directly in a line or two.\n"
                "TEXTBOOK = needs authoritative internal-medicine depth — criteria, thresholds, mechanism, dosing, "
                "differential, OR the learner is asking for MORE THAN THE SECTION COVERS: a full/complete pathway, "
                "the whole metabolism or biosynthesis, upstream/downstream biology, or a broader topic the section "
                "only touches. Anything asking to 'explain in detail', 'walk me through', or for the entire picture "
                "is TEXTBOOK, never QUICK (pull Harrison's).\n"
                "WEB = needs CURRENT info likely beyond a 2022 textbook — recent guidelines, newly-approved drugs, "
                "recent trials, current epidemiology, or a non-internal-medicine fact (search the web).\n"
                "AGENT = a genuinely DIFFICULT question that ONE lookup cannot satisfy — a full biochemical or "
                "physiologic pathway/network, multi-hop reasoning ('why does X cause Y via Z'), cross-domain "
                "synthesis, or anything needing SEVERAL different searches combined. Prefer AGENT over TEXTBOOK "
                "whenever the answer must be assembled from multiple lookups rather than recalled from one.")
        out = _call(CLASSIFY_SPEC, sysc, [], user).upper()
        if "AGENT" in out: return "agent"
        if "WEB" in out: return "web"
        if "TEXTBOOK" in out or "COMPLEX" in out: return "textbook"
        return "quick"
    except Exception:
        if HARD.search(user) and DEEP.search(user): return "agent"
        if RECENT.search(user): return "web"
        return "textbook" if DEEP.search(user) or len(user) > 160 else "quick"

SUGGEST_SPEC = os.environ.get("TUTOR_SUGGEST", CLASSIFY_SPEC)   # fast/cheap — suggestions must not slow the answer

def suggestions(question: str, answer: str, lang: str = "en", n: int = 4) -> list:
    """Propose the learner's NEXT questions along the path they're on — deeper mechanism, a clinical
    correlation, a contrast, or the next step in the pathway. Cheap, fast model, best-effort: returns []
    on ANY failure so it can never break or delay the actual answer."""
    try:
        sysc = (f"You propose a medical learner's NEXT questions. Given their question and the tutor's answer, "
                f"return exactly {n} SHORT follow-up questions (max ~9 words each) they would most plausibly ask "
                f"NEXT along this line of enquiry. Vary the angles — go deeper on a mechanism, jump to a clinical "
                f"correlation, contrast with an alternative, or advance to the next step in the pathway. Never "
                f"repeat what the answer already covered. Write them in {'Italian' if lang == 'it' else 'English'}. "
                f"Return ONLY a JSON array of {n} strings — no prose, no markdown.")
        raw = _call(SUGGEST_SPEC, sysc, [], f"Question: {question}\n\nAnswer:\n{answer[:1800]}").strip()
        m = re.search(r"\[.*\]", raw, re.S)
        arr = json.loads(m.group(0)) if m else []
        return [str(s).strip()[:90] for s in arr if str(s).strip()][:n]
    except Exception:
        return []


DECOMPOSE_SPEC = os.environ.get("TUTOR_DECOMPOSE", "cloud:gemma4:31b")

def decompose(note: str, question: str = "", concept: str = "", lang: str = "en") -> dict:
    """🧬 THE SPINE — break a dense note at its REAL teaching seams, and name the discriminators.

    Not arbitrary chunking: the seams are where the reasoning actually turns (e.g. a bilious-vomiting
    note breaks into: the pylorus checkpoint → mechanical → functional → chemical → and the rule that
    bilious EXCLUDES gastric outlet obstruction). Everything downstream hangs off this: cards per-topic
    beat cards from a blob, MCQs can target ONE discriminator each, a lesson gets a real syllabus.

    Discriminators are first-class: the "definitely-not-it" boundaries are what make recognition happen
    under exam pressure — they matter more than the prose. Returns {} on any failure (never fatal)."""
    if not (note or "").strip():
        return {}
    try:
        sysc = (
            "You break a dense medical explanation into its REAL teaching seams — the places where the "
            "reasoning actually turns — not arbitrary chunks. Return ONLY JSON:\n"
            '{"topics":[{"title":"<5-9 words>","seam":"<why this is its own teachable unit, 1 line>",'
            '"key_facts":["<high-yield fact>", "..."]}],'
            '"discriminators":[{"rule":"<the discriminating RULE, one line>",'
            '"not_it":"<what it is definitively NOT, and why>"}]}\n'
            "RULES: 3-6 topics. Order them so each builds on the last (anatomy/checkpoint first, then "
            "mechanisms, then clinical). DISCRIMINATORS ARE THE POINT — extract every rule of the form "
            "'X effectively excludes Y' or 'X means the lesion is above/below Z'; these are what make "
            "recognition possible under exam pressure. Never invent facts absent from the note. "
            + ("Write in Italian. " if lang == "it" else "")
        )
        usr = (f"Concept: {concept}\n" if concept else "") + \
              (f"The learner asked: {question}\n\n" if question else "") + f"Explanation:\n{note[:6000]}"
        raw = _call(DECOMPOSE_SPEC, sysc, [], usr).strip()
        m = re.search(r"\{.*\}", raw, re.S)
        d = json.loads(m.group(0)) if m else {}
        d["topics"] = (d.get("topics") or [])[:6]
        d["discriminators"] = (d.get("discriminators") or [])[:6]
        return d if d.get("topics") else {}
    except Exception:
        return {}


def cards(topics: list, discriminators: list, concept: str = "", lang: str = "en", n: int = 6) -> list:
    """🎴 Cards OFF THE SPINE — the generator that actually stops you re-running the session.

    Cards the RULES, not the essay. A card per discriminator (the 'X excludes Y' boundaries that make
    recognition possible under exam pressure) comes FIRST; per-topic mechanism cards fill the rest.
    Returns [{front, back, card_type, concept_id}] — [] on any failure (never fatal)."""
    if not topics and not discriminators:
        return []
    try:
        sysc = (
            f"You write spaced-repetition cards for a doctor sitting a medical specialty exam. "
            f"Return ONLY a JSON array of at most {n} cards: "
            '[{"front":"<question>","back":"<answer>","card_type":"discriminator|mechanism|fact",'
            '"concept_id":"<short slug>"}]\n'
            "RULES — this is the whole point:\n"
            "1. EVERY discriminator gets its OWN card first, card_type='discriminator'. Phrase it so the "
            "learner must RECALL the boundary, e.g. front: 'Bilious vomiting — where is the obstruction, "
            "and what does it exclude?'\n"
            "2. Never card the prose. Card the rule, the mechanism, or the discriminating feature.\n"
            "3. The front must be answerable from memory in one breath; the back is tight and high-yield.\n"
            "4. No card may restate its own answer in the front. No trivia.\n"
            + ("Write the cards in Italian. " if lang == "it" else "")
        )
        usr = (f"Concept: {concept}\n\nDISCRIMINATORS (one card each, first):\n"
               + json.dumps(discriminators, ensure_ascii=False)
               + "\n\nTOPICS:\n" + json.dumps(topics, ensure_ascii=False))
        raw = _call(DECOMPOSE_SPEC, sysc, [], usr).strip()
        m = re.search(r"\[.*\]", raw, re.S)
        arr = json.loads(m.group(0)) if m else []
        out = []
        for c in arr[:n]:
            f, b = str(c.get("front", "")).strip(), str(c.get("back", "")).strip()
            if f and b:
                out.append({"front": f[:400], "back": b[:1200],
                            "card_type": (c.get("card_type") or "fact")[:24],
                            "concept_id": (c.get("concept_id") or concept or "")[:80]})
        return out
    except Exception:
        return []


def mcqs(topics: list, discriminators: list, concept: str = "", lang: str = "en", n: int = 4) -> list:
    """❓ MCQs OFF THE SPINE — exam-shaped recall, one discriminator per item.

    THE DESIGN: a discriminator's `not_it` IS the distractor. "Bilious vomiting excludes gastric
    obstruction (not pyloric stenosis)" becomes a vignette whose most tempting wrong answer is pyloric
    stenosis. A distractor isn't filler — it's the test: it catches the learner who pattern-matched
    instead of reasoned. Every option carries a why_wrong so the post-answer feedback can name the trap.
    Returns [] on any failure (never fatal)."""
    if not topics and not discriminators:
        return []
    try:
        sysc = (
            f"You write exam items for a doctor sitting a medical specialty exam (SSM/USMLE style). "
            f"Return ONLY a JSON array of at most {n} items:\n"
            '[{"stem":"<a short clinical vignette ending in a question>",'
            '"options":{"a":"…","b":"…","c":"…","d":"…"},"correct":"<a|b|c|d>",'
            '"why_wrong":{"a":"<why this is wrong / what trap it is>","b":"…","c":"…","d":"…"},'
            '"discriminator":"<the rule this item tests>"}]\n'
            "RULES — this is the whole point:\n"
            "1. ONE item per DISCRIMINATOR. The item must fail anyone who does not know that rule.\n"
            "2. THE DISTRACTORS ARE THE TEST: build the most tempting wrong option directly from the "
            "discriminator's 'not_it' — the thing a learner who pattern-matched would grab. Never use "
            "filler options.\n"
            "3. why_wrong for the CORRECT option explains why it IS right; for the others, name the "
            "specific misconception it catches.\n"
            "4. Vignette style: age, presentation, key finding — then the question. No giveaways in the stem.\n"
            + ("Write in Italian. " if lang == "it" else "")
        )
        usr = (f"Concept: {concept}\n\nDISCRIMINATORS (one item each — their 'not_it' becomes the "
               f"tempting distractor):\n" + json.dumps(discriminators, ensure_ascii=False)
               + "\n\nTOPICS:\n" + json.dumps(topics, ensure_ascii=False))
        raw = _call(DECOMPOSE_SPEC, sysc, [], usr).strip()
        m = re.search(r"\[.*\]", raw, re.S)
        arr = json.loads(m.group(0)) if m else []
        out = []
        for q in arr[:n]:
            stem, opts, corr = str(q.get("stem", "")).strip(), q.get("options") or {}, str(q.get("correct", "")).strip().lower()
            if stem and len(opts) >= 3 and corr in opts:
                out.append({"stem": stem[:900], "options": {k: str(v)[:220] for k, v in opts.items()},
                            "correct": corr, "why_wrong": q.get("why_wrong") or {},
                            "discriminator": str(q.get("discriminator", ""))[:220]})
        return out
    except Exception:
        return []


def train_path(topics: list, discriminators: list, concept: str = "", lang: str = "en") -> dict:
    """🎓 TRAIN ME — the seam-by-seam drill: micro-teach each topic, then a drill question with why-wrong.
    Sits between a card (atom) and a full lesson (heavy) — the 'I just learned something dense, drill me
    NOW' size. A bounded, deterministic path over the topic worklist (NOT agentic; house rule R-PC2).
    Returns {steps:[{topic, teach, drill:{q, answer, why}}], closer} — {} on failure."""
    if not topics:
        return {}
    try:
        sysc = (
            "You build a short guided drill for a doctor who just learned something dense. For the given "
            "ordered topics, return ONLY JSON:\n"
            '{"steps":[{"topic":"<title>","teach":"<2-3 tight sentences that make the seam click>",'
            '"drill":{"q":"<one recall/application question>","answer":"<the answer>",'
            '"why":"<why it matters / the trap it guards against>"}}],'
            '"closer":"<one sentence tying the discriminators together>"}\n'
            "RULES: one step per topic, IN ORDER (each builds on the last). teach is not the essay — it is "
            "the minimum that makes the reasoning turn. The drill question must be answerable from the teach. "
            "Fold the discriminators into the closer so the learner leaves with the 'definitely-not-it' rules.\n"
            + ("Write in Italian. " if lang == "it" else "")
        )
        usr = (f"Concept: {concept}\n\nTOPICS (in order):\n" + json.dumps(topics, ensure_ascii=False)
               + "\n\nDISCRIMINATORS (fold into the closer):\n" + json.dumps(discriminators, ensure_ascii=False))
        raw = _call(DECOMPOSE_SPEC, sysc, [], usr).strip()
        m = re.search(r"\{.*\}", raw, re.S)
        d = json.loads(m.group(0)) if m else {}
        d["steps"] = (d.get("steps") or [])[:6]
        return d if d.get("steps") else {}
    except Exception:
        return {}


def _harrison(topic: str) -> str:
    try:
        out = subprocess.run(["harrison-search", "-q", topic, "--prose", "-n", "4", "--full"],
                             capture_output=True, text=True, timeout=90)
        return (out.stdout or "").strip()[:6000]
    except Exception:
        return ""

def _websearch(topic: str) -> str:
    """Tier 3 — hypersearch (the house web-search method: page→Harrison's→WEB). Returns a synthesized
    answer + top citations to reconcile against; empty on failure so the tutor still answers."""
    try:
        out = subprocess.run(["hypersearch", topic, "--depth", "1", "--json"],
                             capture_output=True, text=True, timeout=110)
        d = json.loads(out.stdout or "{}")
        ans = (d.get("answer") or "").strip()
        cites = d.get("citations") or []
        if not ans:
            return ""
        src = "\n".join(f"- {c}" for c in cites[:6] if isinstance(c, str))
        return (ans[:5500] + ("\n\nSources:\n" + src if src else ""))[:6000]
    except Exception:
        return ""

# ── PAGE grounding — the Chiron difference ──────────────────────────────────────
def _sys(lang: str, mode: str, section_text: str, selection: str, section_id: str) -> str:
    """System prompt that grounds the tutor in what the learner is reading on the page."""
    langname = "Italiano" if lang == "it" else "English"
    ground = ""
    if (section_text or "").strip():
        ground = ("\n\nANCHOR — the part of the lesson the learner is currently reading. Use it to GROUND and "
                  "contextualise your answer. It is NOT a scope limit: if the question is broader, adjacent, "
                  "upstream or downstream of it, teach the FULL picture from your own knowledge and the references. "
                  "Never trim an answer down to only what this text happens to mention:\n<<<\n"
                  + section_text.strip()[:4000] + "\n>>>")
    if (selection or "").strip():
        ground += f"\n\nThe learner highlighted: \"{selection.strip()[:600]}\" — focus the answer there."
    # Universal style rule — the ANSWER, straight: no source narration, depth matched to the ask, Unicode not LaTeX.
    style = ("\n\nSTYLE (strict): Answer the question directly and immediately. NEVER say 'based on the provided "
             "context/section/reference', never state what the page does or does not cover, and never name your "
             "sources. No hedging, no 'while the text focuses on…'. "
             "DEPTH FOLLOWS THE ASK: if they ask for detail, the full pathway, 'in detail', 'walk me through', or "
             "otherwise want the complete picture — go DEEP and COMPLETE (all branches, mechanisms and clinical "
             "correlations); otherwise stay high-yield and tight. "
             "Use clean markdown (headings, **bold**, bullet lists, tables) — it is rendered. Write symbols as "
             "UNICODE (α, β, →, ₂, ↑, ↓, ≥, ×) — NEVER LaTeX and never $…$ math delimiters; they do not render here.")
    if mode == "ita":
        return ("You are a clinical-Italian language coach for a doctor studying medicine in Italian. When the learner "
                "asks how to say something or what a term/phrase means, TEACH the Italian: the phrase in **Italian** (bold) "
                "with the **English** translation, the key **verb(s)** (infinitive), the formal clinical register (**Lei**), "
                "and a one-line clinical usage. ALWAYS bilingual IT+EN. High-yield, focused on doctor–patient "
                "communication — not deep medicine." + ground + style)
    # NB: no blanket "concise" here — it fought explicit "explain in detail" asks and brevity won.
    # Depth is governed by STYLE's DEPTH-FOLLOWS-THE-ASK rule instead.
    return (f"You are an expert, exam-focused medical tutor. Answer in {langname}." + ground + style)

def _say(on_status, text: str) -> None:
    """Report a REAL step to the caller's live status channel (SSE/poll). Never fatal, never required."""
    try:
        if on_status:
            on_status(text)
    except Exception:
        pass


async def _agentic_answer(question: str, history: list[dict], lang: str, sysprompt: str, on_status=None) -> str:
    """COMPLEX + model=='agent': a TRUE agent that decides when to call harrison_search, grounded on the section.
    Each tool call reports itself live (with its actual query) so the learner sees real progress, not a spinner."""
    def harrison_search(query: str) -> str:
        """Search Harrison's Principles of Internal Medicine for authoritative internal-medicine reference — diagnostic criteria, thresholds, mechanism, drug/dosing, or differentials. Pass a concise topic."""
        _say(on_status, "🔎 Harrison's: " + (query or "")[:60])
        r = _harrison(query)
        _say(on_status, ("📖 Found reference — reading…" if r else "📖 Nothing in Harrison's for that — trying another angle"))
        return r[:5000] if r else "(no reference found for that query)"
    def web_search(query: str) -> str:
        """Search the WEB (current guidelines, newly-approved drugs, recent trials, current epidemiology, or facts likely beyond a 2022 textbook). Use when Harrison's would be out of date or off-topic. Pass a concise query."""
        _say(on_status, "🌐 Searching the web: " + (query or "")[:60])
        r = _websearch(query)
        _say(on_status, ("🌐 Got web results — reading…" if r else "🌐 Web came back empty — trying another angle"))
        return r[:5000] if r else "(no web result for that query)"
    hist_txt = "\n".join(f"{m['role']}: {(m.get('content') or '')[:300]}" for m in history[-6:])
    objective = (f"{sysprompt}\nYou have two retrieval tools. Call harrison_search for authoritative internal-medicine "
                 f"detail (criteria/thresholds/mechanism/dosing/differential); call web_search for CURRENT info likely "
                 f"beyond a 2022 textbook (recent guidelines, new drugs, recent trials, epidemiology) or non-internal-medicine "
                 f"facts. Prefer the section + your own knowledge for simple points — retrieve only when it adds authority. "
                 f"Prior dialogue:\n{hist_txt}\n\nThe learner asks: {question}\n\nReturn ONLY the final answer, in markdown.")
    _say(on_status, "🧠 Working through it step by step…")
    agent = AgenticStepProcessor(objective=objective, model_name=AGENT_MODEL, max_internal_steps=5,
                                 history_mode="progressive", enable_blackboard=True)
    chain = PromptChain(models=[], instructions=[agent])
    chain.register_tool_function(harrison_search)
    chain.register_tool_function(web_search)
    chain.add_tools([
        {"type": "function", "function": {"name": "harrison_search",
            "description": "Search Harrison's for authoritative internal-medicine reference (criteria, thresholds, mechanism, dosing, differential).",
            "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Concise medical topic"}}, "required": ["query"]}}},
        {"type": "function", "function": {"name": "web_search",
            "description": "Search the web for CURRENT info beyond a 2022 textbook (recent guidelines, new drugs, recent trials, epidemiology) or non-internal-medicine facts.",
            "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Concise web query"}}, "required": ["query"]}}}])
    out = await chain.process_prompt_async(question or "?")
    return out if isinstance(out, str) else str(out)

def _static_synth(spec: str, question: str, history: list[dict], sysprompt: str, topic_hint: str, source: str,
                  on_status=None):
    """Draft + retrieve + reconcile. `source` = 'textbook' (Harrison's) or 'web' (hypersearch). Section stays
    in the system prompt; the retrieved reference is preferred for facts. Returns (reply, grounded)."""
    _say(on_status, "✍️ Drafting an answer…")
    draft = _answer(spec, sysprompt, history, question)
    topic = (topic_hint + " " + re.sub(r"[?.!]+$", "", question).strip())[:90]
    if source == "web":
        _say(on_status, "🌐 Searching the web: " + topic[:60])
        ctx, label = _websearch(topic), "WEB SEARCH (current — hypersearch; prefer for recent facts/guidelines)"
    else:
        _say(on_status, "🔎 Harrison's: " + topic[:60])
        ctx, label = _harrison(topic), "Harrison's (authoritative internal-medicine reference — prefer it)"
    if not ctx:
        _say(on_status, "📖 No reference found — answering from knowledge")
        return draft, False
    _say(on_status, "🧩 Checking the draft against the reference…")
    p = (f"{sysprompt}\nThe learner asked: {question}\n\nDraft answer:\n{draft}\n\n"
         f"Authoritative reference to verify against:\n{ctx}\n\nWrite the FINAL answer to the learner's question, "
         f"correcting the draft where the reference differs. Output ONLY the answer — do not mention the draft, the "
         f"reference, or any source, and do not comment on the section. Direct, high-yield, clean markdown.")
    return _answer(spec, p, [], ""), True

async def answer_turn(section_text: str, selection: str, section_id: str, lesson_slug: str,
                      messages: list[dict], lang: str, model: str | None = None, mode: str = "med",
                      on_status=None, client_system: str | None = None) -> dict:
    """`on_status(text)` (optional) receives REAL live progress — the router's verdict, each actual search
    with its query, drafting/reconciling — so the UI can narrate the wait instead of showing a dead spinner."""
    spec = MODELS.get(model or DEFAULT_MODEL, MODELS[DEFAULT_MODEL])["spec"]
    hist = _window([m for m in messages if m.get("role") in ("user", "assistant")])
    user = next((m.get("content", "").strip() for m in reversed(hist) if m.get("role") == "user"), "")
    if hist and hist[-1].get("role") == "user": hist = hist[:-1]
    # An OpenAI client (acolyte) sends its OWN system prompt carrying its persona,
    # its grounding policy and the passages it retrieved. Dropping that and
    # substituting the medical tutor prompt is how a page about Italian irregular
    # verbs got answered with atrial fibrillation and an AV block: the model was
    # told it was a medical tutor and given no page text at all.
    # So when a caller supplies a system message, it GOVERNS. That is what the
    # OpenAI contract promises, and honouring it is what makes the per-lesson
    # tutor page-scoped rather than decorative.
    sysprompt = client_system.strip() if (client_system or "").strip() \
        else _sys(lang, mode, section_text or "", selection or "", section_id or "")
    topic_hint = (section_id or "").replace("-", " ")
    # 🗣 Italiano coach — one fast shot with the language prompt, NO Harrison
    if mode == "ita":
        return {"reply": _answer(spec, sysprompt, hist, user), "depth": "language",
                "grounded": bool(section_text), "model": model or DEFAULT_MODEL, "mode": "ita"}
    _say(on_status, "🧭 Reading your question…")
    route = _route(user)                                  # quick · textbook (Harrison's) · web (hypersearch) · agent
    _say(on_status, {"quick":    "⚡ Straightforward — answering now",
                     "textbook": "📚 Needs the textbook — looking it up",
                     "web":      "🌐 Needs current info — searching the web",
                     "agent":    "🧠 Complicated one — researching it properly (this takes a minute)"}
                    .get(route, "Working…"))
    if route == "quick":                                  # SIMPLE → one fast shot grounded on the section
        return {"reply": _answer(spec, sysprompt, hist, user), "depth": "quick",
                "grounded": bool(section_text), "model": model or DEFAULT_MODEL, "source": "page"}
    # DIFFICULT (the router judged it needs several searches assembled) OR the user explicitly picked the
    # agent → the multi-step agent with BOTH tools: it decides what to search, repeatedly, then synthesizes.
    # Spending more machinery only on hard questions is the whole point of the difficulty dimension.
    if route == "agent" or spec == "agent":
        try:
            reply = await _agentic_answer(user, hist, lang, sysprompt, on_status)
            if reply and "unavailable" not in reply.lower():
                return {"reply": reply, "depth": "deep", "grounded": True,
                        "model": ("agent" if spec == "agent" else (model or DEFAULT_MODEL)), "source": "agent"}
        except Exception:
            pass
        route = "textbook"          # agent unavailable/failed → fall back to the proven static synth
    # Otherwise: fast static synth (draft + ONE retrieval + reconcile).
    reply, grounded = _static_synth(spec if spec != "agent" else MODELS[DEFAULT_MODEL]["spec"],
                                    user, hist, sysprompt, topic_hint, route, on_status)
    return {"reply": reply, "depth": "deep", "grounded": grounded,
            "model": model or DEFAULT_MODEL, "source": route}
