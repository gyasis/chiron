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
                  r"expand|tell me more|more detail|explain the|walk me|reason|criteria|threshold)\b", re.I)
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

def _answer(spec: str, system: str, history: list[dict], user: str) -> str:
    for s in [spec] + [f for f in FALLBACKS if f != spec]:
        try:
            r = _call(s, system, history, user)
            if r: return r
        except Exception:
            continue
    return "(the tutor is unavailable right now — check the model / keys)"

def _route(user: str) -> str:
    """3-way retrieval router: quick (page+model) · textbook (Harrison's) · web (hypersearch).
    The tutor's RAG ladder — page grounding is always in the system prompt; this picks the EXTRA source."""
    if len(user) < 40 and not DEEP.search(user) and not RECENT.search(user):
        return "quick"
    if RECENT.search(user):
        return "web"                                       # obvious "latest/2024/guideline" → web
    try:
        sysc = ("Classify a medical learner's question about a lesson they're reading. Reply EXACTLY one word.\n"
                "QUICK = a definition/clarification the section + a strong model answers directly.\n"
                "TEXTBOOK = needs authoritative internal-medicine reference — criteria, thresholds, mechanism, "
                "dosing, or differential (pull Harrison's).\n"
                "WEB = needs CURRENT info likely beyond a 2022 textbook — recent guidelines, newly-approved drugs, "
                "recent trials, current epidemiology, or a non-internal-medicine fact (search the web).")
        out = _call(CLASSIFY_SPEC, sysc, [], user).upper()
        if "WEB" in out: return "web"
        if "TEXTBOOK" in out or "COMPLEX" in out: return "textbook"
        return "quick"
    except Exception:
        if RECENT.search(user): return "web"
        return "textbook" if DEEP.search(user) or len(user) > 160 else "quick"

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
        ground = ("\n\nContext the learner is currently reading (use it SILENTLY as background — never mention, quote, "
                  "or comment on what this section does or does not contain):\n<<<\n" + section_text.strip()[:4000] + "\n>>>")
    if (selection or "").strip():
        ground += f"\n\nThe learner highlighted: \"{selection.strip()[:600]}\" — focus the answer there."
    # Universal style rule — the user wants the ANSWER, straight, with no meta-narration about sources.
    style = ("\n\nSTYLE (strict): Answer the question directly and immediately. Do NOT preface with what the "
             "section/page/lesson covers or omits. Do NOT say where the information comes from (the section, a "
             "textbook, Harrison's, the web, or 'the provided reference') — the learner does not want to know the "
             "source. No hedging, no 'while the text focuses on…'. Just give the best answer. Use clean markdown "
             "(headings, **bold**, bullet lists, and tables) — it is rendered.")
    if mode == "ita":
        return ("You are a clinical-Italian language coach for a doctor studying medicine in Italian. When the learner "
                "asks how to say something or what a term/phrase means, TEACH the Italian: the phrase in **Italian** (bold) "
                "with the **English** translation, the key **verb(s)** (infinitive), the formal clinical register (**Lei**), "
                "and a one-line clinical usage. ALWAYS bilingual IT+EN. High-yield, focused on doctor–patient "
                "communication — not deep medicine." + ground + style)
    return (f"You are a concise, exam-focused medical tutor. Answer in {langname}, high-yield and direct." + ground + style)

async def _agentic_answer(question: str, history: list[dict], lang: str, sysprompt: str) -> str:
    """COMPLEX + model=='agent': a TRUE agent that decides when to call harrison_search, grounded on the section."""
    def harrison_search(query: str) -> str:
        """Search Harrison's Principles of Internal Medicine for authoritative internal-medicine reference — diagnostic criteria, thresholds, mechanism, drug/dosing, or differentials. Pass a concise topic."""
        r = _harrison(query)
        return r[:5000] if r else "(no reference found for that query)"
    def web_search(query: str) -> str:
        """Search the WEB (current guidelines, newly-approved drugs, recent trials, current epidemiology, or facts likely beyond a 2022 textbook). Use when Harrison's would be out of date or off-topic. Pass a concise query."""
        r = _websearch(query)
        return r[:5000] if r else "(no web result for that query)"
    hist_txt = "\n".join(f"{m['role']}: {(m.get('content') or '')[:300]}" for m in history[-6:])
    objective = (f"{sysprompt}\nYou have two retrieval tools. Call harrison_search for authoritative internal-medicine "
                 f"detail (criteria/thresholds/mechanism/dosing/differential); call web_search for CURRENT info likely "
                 f"beyond a 2022 textbook (recent guidelines, new drugs, recent trials, epidemiology) or non-internal-medicine "
                 f"facts. Prefer the section + your own knowledge for simple points — retrieve only when it adds authority. "
                 f"Prior dialogue:\n{hist_txt}\n\nThe learner asks: {question}\n\nReturn ONLY the final answer, in markdown.")
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

def _static_synth(spec: str, question: str, history: list[dict], sysprompt: str, topic_hint: str, source: str):
    """Draft + retrieve + reconcile. `source` = 'textbook' (Harrison's) or 'web' (hypersearch). Section stays
    in the system prompt; the retrieved reference is preferred for facts. Returns (reply, grounded)."""
    draft = _answer(spec, sysprompt, history, question)
    topic = (topic_hint + " " + re.sub(r"[?.!]+$", "", question).strip())[:90]
    if source == "web":
        ctx, label = _websearch(topic), "WEB SEARCH (current — hypersearch; prefer for recent facts/guidelines)"
    else:
        ctx, label = _harrison(topic), "Harrison's (authoritative internal-medicine reference — prefer it)"
    if not ctx:
        return draft, False
    p = (f"{sysprompt}\nThe learner asked: {question}\n\nDraft answer:\n{draft}\n\n"
         f"Authoritative reference to verify against:\n{ctx}\n\nWrite the FINAL answer to the learner's question, "
         f"correcting the draft where the reference differs. Output ONLY the answer — do not mention the draft, the "
         f"reference, or any source, and do not comment on the section. Direct, high-yield, clean markdown.")
    return _answer(spec, p, [], ""), True

async def answer_turn(section_text: str, selection: str, section_id: str, lesson_slug: str,
                      messages: list[dict], lang: str, model: str | None = None, mode: str = "med") -> dict:
    spec = MODELS.get(model or DEFAULT_MODEL, MODELS[DEFAULT_MODEL])["spec"]
    hist = _window([m for m in messages if m.get("role") in ("user", "assistant")])
    user = next((m.get("content", "").strip() for m in reversed(hist) if m.get("role") == "user"), "")
    if hist and hist[-1].get("role") == "user": hist = hist[:-1]
    sysprompt = _sys(lang, mode, section_text or "", selection or "", section_id or "")
    topic_hint = (section_id or "").replace("-", " ")
    # 🗣 Italiano coach — one fast shot with the language prompt, NO Harrison
    if mode == "ita":
        return {"reply": _answer(spec, sysprompt, hist, user), "depth": "language",
                "grounded": bool(section_text), "model": model or DEFAULT_MODEL, "mode": "ita"}
    route = _route(user)                                  # quick · textbook (Harrison's) · web (hypersearch)
    if route == "quick":                                  # SIMPLE → one fast shot grounded on the section
        return {"reply": _answer(spec, sysprompt, hist, user), "depth": "quick",
                "grounded": bool(section_text), "model": model or DEFAULT_MODEL, "source": "page"}
    # DEEP. Default = fast static synth (draft + retrieve + reconcile). The tool-calling agent is opt-in
    # (model=='agent') and gets BOTH tools to decide page/Harrison's/web itself.
    if spec == "agent":
        try:
            reply = await _agentic_answer(user, hist, lang, sysprompt)
            if reply and "unavailable" not in reply.lower():
                return {"reply": reply, "depth": "deep", "grounded": True, "model": "agent", "source": "agent"}
        except Exception:
            pass
    reply, grounded = _static_synth(spec if spec != "agent" else MODELS[DEFAULT_MODEL]["spec"],
                                    user, hist, sysprompt, topic_hint, route)
    return {"reply": reply, "depth": "deep", "grounded": grounded,
            "model": model or DEFAULT_MODEL, "source": route}
