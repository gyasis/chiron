"""Chiron MEDICAL-ITALIAN (passage / SSM) lesson generator — focused PromptChain.

Turns ONE SSM exam MCQ into a chiron medical-Italian lesson in the language-it `passage`
sub-mode (the chiron-ssm-fattore-v shape): Lucrezia-voiced, bilingual, dual-speed readings.
Architecture template: the medicine chain (2026-06-29_chiron-medicine-lesson-chain). This is a
SEPARATE chain — it does not touch the medicine chain and is NOT a router.

  Phase 0  INGEST   — load an SSM MCQ (SSM_QID or random) → the PASSAGE (stem + 5 options, IT).
  Phase 1  PLAN     — chunk the passage (source-driven; the passage IS the syllabus).   [next step]
  Phase 2  AUTHOR   — 04t passage-breakdown → annotated-passage JSON (+ medicine concept layer). [next]
  Phase 3  ASSEMBLE — renderWidget + language skeleton → lesson.html.                    [next step]
  Phase 4  AUDIO    — 04s bilingual + curriculum.passageReadings → audio-scripts.json.   [next step]
  Phase 5  BAKE     — bake-lesson-audio.mjs --domain language-it --persona lucrezia.      [next step]

Run:  cd ~/Documents/PromptChain && bash scripts/observe.sh runs/2026-06-30_chiron-medical-italian-passage-chain
Env:  OLLAMA_API_KEY ; SSM_QID (e.g. ssm2018_111; omit → random) ; CH_STAGE (ingest|plan|author|assemble|audio|all).
"""
from promptchain.observability import init_mlflow
init_mlflow()

import asyncio
import csv
import json
import os
import random
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)

from promptchain import PromptChain
import sys as _sys; from pathlib import Path as _P; _sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
import obs   # shared chains/obs.py — per-lesson steps.jsonl observability (best-effort; never breaks generation)
from promptchain.utils.external_loop import over_worklist  # used from Phase 1 on

# ── config ──────────────────────────────────────────────────────────────────────
HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
PROMPTS = SKILL / "prompts"
CURRICULA = SKILL / "curricula"
GEN = HOME / "Documents/generated"
SSM_CSV = HOME / "Documents/code/ssm_essame/data_pipeline/ssm_questions_bilingual.csv"
OLLAMA_KEY = os.environ.get("OLLAMA_API_KEY", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
if not OPENAI_KEY:   # last-resort OpenAI fallback key lives in ~/dev/.env even if not exported to the chain
    try:
        for _ln in (HOME / "dev/.env").read_text().splitlines():
            if _ln.strip().startswith("OPENAI_API_KEY="):
                OPENAI_KEY = _ln.split("=", 1)[1].strip().strip('"').strip("'"); break
    except Exception: pass

# FIXED sub-mode — this chain is medical-language/passage only (no router).
SUBMODE = "language-it-passage"
DOMAIN = "medicine"          # the passage's concept layer teaches the medicine behind the Italian
LEARNER = os.environ.get("CH_LEARNER", "Gyasi")
SSM_QID = os.environ.get("SSM_QID", "")     # explicit item, else random
STAGE = os.environ.get("CH_STAGE", "ingest")  # ingest | plan | author | assemble | audio | all

# Models (glm-5.1 primary — glm-5.2 was flaky on Ollama Cloud; max_tokens AUTOMATIC).
MODEL_REASON = os.environ.get("CH_MODEL_REASON", "glm-5.1")
MODEL_STRUCT = os.environ.get("CH_MODEL_STRUCT", "glm-5.1")


def ollama(model: str, temperature: float = 0.4) -> dict:
    return {"name": f"openai/{model}",
            "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": temperature}}


# Model FALLBACK ladder: when the primary can't produce valid JSON after its repairs, try the next model.
# Default: gemma4:31b (Ollama Cloud, different family) → gpt-5-mini (OpenAI, reliable last resort).
# Claude is intentionally absent (no Anthropic key on this box). gpt-* entries auto-dropped if no OpenAI key.
_FB = [m.strip() for m in os.environ.get("CH_MODEL_FALLBACKS", "gemma4:31b,gpt-5-mini").split(",") if m.strip()]
FALLBACKS = [m for m in _FB if not (m.startswith("gpt-") and not OPENAI_KEY)]


def model_for(name: str, temperature: float = 0.4) -> dict:
    """model_dict for a bare model name. gpt-* → real OpenAI; everything else → Ollama Cloud (via ollama())."""
    if name.startswith("gpt-"):
        return {"name": f"openai/{name}", "params": {"api_key": OPENAI_KEY, "temperature": temperature}}
    return ollama(name, temperature)


def load_prompt(name: str) -> str:
    return (PROMPTS / name).read_text()


def load_curriculum() -> dict:
    """Phase 0.1 ROUTER (fixed): the saved passage shape — prompt, primaryWidget, readings, layers."""
    return json.loads((CURRICULA / f"{SUBMODE}.json").read_text())


def fill(t: str, **slots) -> str:
    for k, v in slots.items():
        t = t.replace("{{" + k + "}}", v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
    return t


def extract_json(s: str):
    """Pull the first balanced JSON object/array out of an LLM reply (string-aware brace balance)."""
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s.strip(), flags=re.M).strip()
    start = next((i for i, c in enumerate(s) if c in "{["), -1)
    if start < 0:
        return json.loads(s, strict=False)
    open_ch = s[start]; close_ch = "}" if open_ch == "{" else "]"
    depth = 0; in_str = False; esc = False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': in_str = False
        else:
            if c == '"': in_str = True
            elif c == open_ch: depth += 1
            elif c == close_ch:
                depth -= 1
                if depth == 0:
                    return json.loads(s[start:i + 1], strict=False)
    return json.loads(s[start:], strict=False)


async def llm(model_dict: dict, prompt: str, user_input: str = "go") -> str:
    chain = PromptChain(models=[model_dict],
                        instructions=[prompt + "\n\n{input}" if "{input}" not in prompt else prompt])
    try: chain.register_callback(obs.make_callback())   # stream MODEL_CALL/token events → steps.jsonl
    except Exception: pass
    return await chain.process_prompt_async(user_input)


async def json_with_repair(prompt: str, name: str, model_dict: dict, validate_fn=None, max_repair: int = 3):
    """Self-repair loop + MODEL FALLBACK: re-prompt the current model on bad JSON / failed validate up to
    max_repair; if it STILL can't, fall back to the next model in the ladder (primary + CH_MODEL_FALLBACKS).
    Only after every model is exhausted do we flag needs_review. Prevents one flaky model killing a lesson."""
    ladder = [model_dict] + [model_for(m) for m in FALLBACKS]
    last_raw = ""
    for mi, md in enumerate(ladder):
        tag = md.get("name", "?")
        cur = prompt                                 # fresh prompt per model — don't carry another model's mangled context
        for attempt in range(1, max_repair + 1):
            try:
                last_raw = await llm(md, cur)
            except Exception as e:                   # transient LLM/network/provider error → retry same model, don't crash
                print(f"[repair] {name} [{tag}] {attempt}/{max_repair}: LLM call errored ({e}) — retrying", flush=True)
                await asyncio.sleep(3)
                continue
            try:
                obj = extract_json(last_raw)
            except Exception as e:
                print(f"[repair] {name} [{tag}] {attempt}/{max_repair}: parse failed ({e}) — re-prompting", flush=True)
                obs.error(f"{name} — JSON parse failed ([{tag}] repair {attempt}/{max_repair})", e)
                cur = (prompt + f"\n\n## PREVIOUS OUTPUT WAS INVALID JSON\nError: {e}\nPrevious:\n{last_raw[:4000]}\n\n"
                       "Return ONLY corrected valid JSON. Escape every \" and newline inside string values.")
                continue
            issues = validate_fn(obj) if validate_fn else None
            if issues:
                print(f"[repair] {name} [{tag}] {attempt}/{max_repair}: invalid ({issues[:2]}) — re-prompting", flush=True)
                obs.error(f"{name} — validation failed ([{tag}] repair {attempt}/{max_repair})", str(issues[:2]))
                cur = prompt + f"\n\n## PREVIOUS OUTPUT HAD PROBLEMS\n{issues}\nReturn ONLY corrected valid JSON fixing them."
                continue
            if mi > 0:
                print(f"[repair] {name}: RECOVERED via fallback [{tag}]", flush=True)
            return obj
        # this model exhausted its repairs → advance to the next model in the ladder
        if mi < len(ladder) - 1:
            nxt = ladder[mi + 1].get("name", "?")
            print(f"[repair] {name}: [{tag}] exhausted {max_repair} tries → FALLBACK to [{nxt}]", flush=True)
            obs.error(f"{name} — [{tag}] exhausted, falling back to [{nxt}]", "")
    (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
    (OUT / ".scratch" / f"{name}.raw.txt").write_text(last_raw or "(EMPTY)")
    print(f"[repair] {name}: ALL MODELS EXHAUSTED — flagging needs_review, continuing", flush=True)
    return None


# ── Phase 0 — INGEST: SSM MCQ → the passage (the source IS the syllabus) ─────────
def load_ssm_mcq(qid: str = "") -> dict:
    """Load one bilingual SSM MCQ from the CSV. qid empty → random (prefer no-image, has EN)."""
    rows = list(csv.DictReader(open(SSM_CSV, encoding="utf-8")))
    if qid:
        hit = next((r for r in rows if r.get("question_id") == qid), None)
        if not hit:
            raise SystemExit(f"SSM_QID '{qid}' not found in {SSM_CSV.name}")
        return hit
    cand = [r for r in rows if r.get("text_en", "").strip()
            and r.get("has_image", "").lower() in ("", "false", "0", "no")]
    return random.choice(cand or rows)


def build_passage(mcq: dict) -> dict:
    """Assemble the exam item into the passage shape the 04t breakdown consumes.
    passageText = the FULL Italian item (stem + 5 lettered options) — verbatim, the learner's real text."""
    letters = "abcde"
    opts_it, opts_en = [], []
    for o in letters:
        t_it = (mcq.get(f"option_{o}_it") or "").strip()
        t_en = (mcq.get(f"option_{o}_en") or "").strip()
        if t_it:
            opts_it.append(f"{o.upper()}. {t_it}")
            opts_en.append(f"{o.upper()}. {t_en}")
    stem_it = (mcq.get("text_it") or "").strip()
    passage_text = stem_it + "\n\n" + "\n".join(opts_it)
    return {
        "qid": mcq.get("question_id", "ssm"),
        "passageText": passage_text,
        "stem_it": stem_it,
        "stem_en": (mcq.get("text_en") or "").strip(),
        "options_it": opts_it,
        "options_en": opts_en,
        "correct": (mcq.get("correct_answer") or "").strip(),
        "specialization": (mcq.get("specialization") or "").strip(),
        "year": mcq.get("year", ""),
        "domain": DOMAIN,
        "genre": "exam-question",
    }


def phase0_ingest() -> dict:
    mcq = load_ssm_mcq(SSM_QID)
    passage = build_passage(mcq)
    global OUT, SLUG
    SLUG = "chiron-ssm-" + re.sub(r"[^a-z0-9]+", "-", passage["qid"].lower()).strip("-")
    OUT = GEN / SLUG
    (OUT / "source").mkdir(parents=True, exist_ok=True)
    (OUT / "source" / "passage.json").write_text(json.dumps(passage, ensure_ascii=False, indent=2))
    print(f"[phase 0] INGEST {passage['qid']} ({passage['specialization'] or 'general'}, {passage['year']}) "
          f"→ correct={passage['correct']}", flush=True)
    print(f"          passage ({len(passage['options_it'])} options) → {OUT}/source/passage.json", flush=True)
    return passage


# ── Phase 1 — PLAN (source-driven chunking; short exam item = ONE chunk) ─────────
def phase1_chunk(passage: dict) -> list:
    """The passage IS the syllabus. A short SSM item is one coherent chunk (stem+options).
    (Longer passages would split per paragraph; an exam item stays whole so the reasoning is intact.)"""
    chunks = [{"idx": 1, "title": passage.get("specialization") or "Il quesito",
               "text": passage["passageText"]}]
    print(f"[phase 1] PLAN: {len(chunks)} passage chunk(s) (source-driven)", flush=True)
    return chunks


# ── Phase 2 — AUTHOR (04t passage-breakdown → annotated-passage JSON) ─────────────
def load_persona_block() -> str:
    """Lucrezia's register for {{personaContextBlock}} (activePersonaFor:language-it)."""
    for p in (HOME / ".chiron/packs/lucrezia/persona.md", HOME / ".chiron/packs/language-it/persona.md"):
        if p.exists():
            return p.read_text()[:4000]
    return "Persona: Lucrezia — warm Italian medical tutor; greets the learner by name; bilingual (English instruction, perfect Italian for target words); rigorous on clinical facts; never voices the learner's own turns."


def _user_ctx() -> str:
    """Wizard/OCR grounding: CH_GROUNDING points to a markdown file of user-provided source/context."""
    p = os.environ.get("CH_GROUNDING")
    if p:
        try:
            t = Path(p).read_text().strip()
        except Exception:
            t = ""
        if t:
            return f"## USER-PROVIDED SOURCE (OCR'd pages / notes — prioritize, weave in):\n{t[:4000]}"
    return ""


USER_CTX = _user_ctx()


async def phase2_author(passage: dict, cur: dict) -> dict:
    if (OUT / "breakdown.json").exists() and os.environ.get("CH_FORCE") != "1":
        print("[phase 2] RESUME — reusing existing breakdown.json (CH_FORCE=1 to re-author)", flush=True)
        return json.loads((OUT / "breakdown.json").read_text())
    layers_on = cur.get("layersDefaultOn", {})
    p = fill(load_prompt(Path(cur["promptOverride"]).name),
             passageText=f"<source-excerpt-untrusted>\n{passage['passageText']}\n</source-excerpt-untrusted>",
             targetLanguage="it", domain=DOMAIN, genre=passage["genre"],
             layersDefaultOn=layers_on, personaContextBlock=load_persona_block(), learnerName=LEARNER)
    # exam-question: options ARE supplied → resolve the answer + per-option reasoning (not placeholder).
    p += (f"\n\n## THIS ITEM (options supplied — NOT placeholder)\nCorrect answer: {passage['correct']}. "
          f"Options (verbatim): {passage['options_it']}. In the question/concept track, state the answer and give "
          f"per-option medical reasoning (associated vs NOT associated). Bilingual: English instruction, Italian for "
          f"every target term, and gloss each Italian term in English (podcast-safe).")
    # COLD-OPEN — Lucrezia authors her OWN greeting + sign-off, from her personality, varied every lesson
    # (mirrors the wards chain's `coldOpen`, which is authored the same way — see chiron-wards-lesson-chain).
    p += (
        f"\n\n## COLD-OPEN GREETING + SIGN-OFF (Persona Lucrezia — HER voice, varies every lesson)\n"
        f"Author a fresh, warm, NATURAL Italian greeting to {LEARNER} in Lucrezia's own voice — a typical Italian "
        f"opener of YOUR choosing (a time-of-day greeting, a warm aside, a check-in on how the exam prep is going, "
        f"a light remark about today's topic) — NEVER the same fixed phrase twice; vary it naturally the way a real "
        f"person would greet someone lesson to lesson. She genuinely enjoys seeing {LEARNER} and loves teaching him — "
        f"let that warmth show, with a little personal, affectionate touch about him (per her persona). Then a warm, "
        f"distinct sign-off closing (not a repeat of the greeting). Return them as a top-level `coldOpen` object:\n"
        '  "coldOpen": {"greeting": {"it":"<Italian greeting, her own voice, varied>", "en":"<EN translation>"},\n'
        '               "closing":  {"it":"<Italian sign-off, warm, varied>",         "en":"<EN translation>"}}\n'
        "Return ONLY the JSON object."
    )
    if USER_CTX:
        p += "\n\n" + USER_CTX

    def ap_valid(obj):
        iss = []
        ws = obj.get("widgets") or []
        ap = next((w for w in ws if w.get("type") == "annotated-passage"), None)
        if not ap:
            iss.append("missing the annotated-passage widget")
        elif not (ap.get("sentences") and ap["sentences"][0].get("tokens")):
            iss.append("annotated-passage has no sentences/tokens")
        if not obj.get("narrativeHtml"):
            iss.append("missing narrativeHtml (orientation)")
        co = obj.get("coldOpen") or {}
        if not (co.get("greeting", {}).get("it") and co.get("closing", {}).get("it")):
            iss.append("missing coldOpen.greeting.it / coldOpen.closing.it (Lucrezia-authored, required)")
        return iss or None

    print(f"[phase 2] AUTHOR via {cur['promptOverride']} (domain={DOMAIN}, layers_on={[k for k,v in layers_on.items() if v]})…", flush=True)
    bd = await json_with_repair(p, "breakdown", ollama(MODEL_STRUCT), validate_fn=ap_valid)
    if bd is None:
        (OUT / "breakdown.NEEDS_REVIEW").write_text("04t breakdown failed validation after repair")
        print("[phase 2] breakdown NEEDS_REVIEW", flush=True)
        return None
    (OUT / "breakdown.json").write_text(json.dumps(bd, ensure_ascii=False, indent=2))
    ap = next((w for w in bd.get("widgets", []) if w.get("type") == "annotated-passage"), {})
    nsent = len(ap.get("sentences", [])); ntok = sum(len(s.get("tokens", [])) for s in ap.get("sentences", []))
    wtypes = [w.get("type") for w in bd.get("widgets", [])]
    print(f"[phase 2] breakdown.json: title='{bd.get('title')}' sentences={nsent} tokens={ntok} "
          f"widgets={wtypes} srCards={len(bd.get('srCards', []))}", flush=True)
    return bd


# ── Phase 2.6 — CLINICAL SCENARIO CHAT (group-chat-animation) ─────────────────────
# SCOPED grounding: Harrison's + MRCP PACES are used ONLY for THIS builder (not the rest of the chain).
def harrison(query: str, n: int = 4) -> str:
    try:
        r = subprocess.run([str(HOME / ".local/bin/harrison-search"), "-q", query, "-n", str(n), "--prose"],
                           capture_output=True, text=True, timeout=150)
        return r.stdout.strip()[:2500]
    except Exception as e:
        return f"[harrison unavailable: {e}]"


def paces(query: str, k: int = 2) -> str:
    """MRCP PACES — SYMPTOM-LED (query by presentation, not disease name) per R-CH3."""
    try:
        r = subprocess.run(["booklake", "search", "--profile", "mrcp_paces", "--k", str(k), query],
                           capture_output=True, text=True, timeout=150)
        return "\n".join(l for l in r.stdout.splitlines() if l and not l.startswith(("INFO", "WARNING", "load", "mode")))[:2000]
    except Exception as e:
        return f"[paces unavailable: {e}]"


async def phase_scenario(passage: dict) -> dict:
    """Build a grounded medical-Italian clinical dialogue (group-chat-animation) that dramatizes the
    MCQ → answer. Doctor↔patient (presentation) OR doctor↔colleague/resident (reasoning) — chosen by the item.
    Grounded: PACES (symptom-led presentation/signs) + Harrison's (disease facts) — ONLY here."""
    bd = json.loads((OUT / "breakdown.json").read_text())
    topic = bd.get("title", passage["qid"])
    # symptom-led PACES (presentation) + disease-led Harrison (facts) — scoped to this builder
    g_paces = paces(f"{passage['stem_en']} presentation symptoms signs examination")
    g_harr = harrison(f"{topic} {passage['stem_en'][:120]}")
    p = (
        "You are Lucrezia, a warm Italian medical tutor, scripting a SHORT realistic clinical scene as a chat,\n"
        "to dramatize an SSM exam item so the learner SEES the answer in a real situation (not just Q&A).\n\n"
        f"## THE EXAM ITEM\nStem (IT): {passage['stem_it']}\nStem (EN): {passage['stem_en']}\n"
        f"Options (IT): {passage['options_it']}\nCORRECT: {passage['correct']}\n\n"
        f"## GROUNDING — use ONLY these for symptoms/signs/disease facts (do not invent)\n"
        f"### MRCP PACES (symptom-led presentation):\n{g_paces}\n\n### Harrison's (disease facts):\n{g_harr}\n\n"
        "## WRITE a group-chat-animation widget (JSON). Rules:\n"
        "- A 6–9 turn scene. Pick the setting from the item: a DOCTOR↔PATIENT presentation (symptoms) OR a\n"
        "  DOCTOR↔COLLEAGUE/RESIDENT/ATTENDING reasoning. Make it real: the case presents, they discuss the\n"
        "  clue, someone asks «cosa vuoi fare?» / «qual è la diagnosi?», and the scene LANDS on the correct answer.\n"
        "- `body` IS IN MEDICAL ITALIAN (this is an Italian lesson) — natural + clinically accurate. Do NOT inline\n"
        "  English in `body`; the English goes in a SEPARATE `bodyEn` field (a faithful full English translation of\n"
        "  that turn) — the lesson shows a 🇬🇧 toggle to reveal it.\n"
        "- DIALOGUE VOICING: the LEARNER/doctor-in-training is NOT a sender here (this scene is observed) — use\n"
        "  named clinicians/patient. senders e.g. 'patient','resident','attending'. senderLabel in Italian\n"
        "  (e.g. 'Sig.ra Bianchi', 'Dott. Rossi (specializzando)', 'Prof. Conti'). avatarChar = 2 initials.\n"
        "- The FINAL turn states the answer in-scene (e.g. the attending confirms it), tying it to the clue.\n\n"
        "Return ONLY JSON: {\"type\":\"group-chat-animation\",\"id\":\"scenario\",\"title\":\"<IT title>\",\n"
        "  \"framing\":\"<one EN sentence: the setting>\",\n"
        "  \"messages\":[{\"sender\":\"...\",\"senderLabel\":\"...\",\"avatarChar\":\"..\",\"body\":\"<IT>\",\"bodyEn\":\"<EN translation>\"}, ...]}"
    )
    def sc_valid(o):
        m = o.get("messages") if isinstance(o, dict) else None
        return None if (isinstance(m, list) and len(m) >= 4) else ["need a group-chat-animation with >=4 messages"]
    print(f"[phase 2.6] CLINICAL SCENARIO — grounded (PACES {len(g_paces)}c + Harrison {len(g_harr)}c) → group-chat-animation…", flush=True)
    sc = await json_with_repair(p, "scenario", ollama(MODEL_REASON), validate_fn=sc_valid)
    if sc is None:
        print("[phase 2.6] scenario failed — skipping (lesson continues)", flush=True)
        return bd
    sc.setdefault("type", "group-chat-animation"); sc.setdefault("id", "scenario")
    # inject into the breakdown widgets so the assembler renders it (placed in the medicine section)
    bd.setdefault("widgets", []).append(sc)
    (OUT / "breakdown.json").write_text(json.dumps(bd, ensure_ascii=False, indent=2))
    print(f"[phase 2.6] scenario: '{sc.get('title')}' — {len(sc['messages'])} turns "
          f"(senders: {sorted(set(m.get('sender') for m in sc['messages']))}) → injected into breakdown", flush=True)
    return bd


# ── Phase 4 — AUDIO TRANSCRIPTS (04s bilingual lecture + Veloce/Lenta passage reads) ──
def _strip(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


def passage_sections(passage: dict) -> list:
    """[{id,title,contentText}] for the 5 fixed passage sections — content pulled from the breakdown."""
    bd = json.loads((OUT / "breakdown.json").read_text())
    ap = next((w for w in bd.get("widgets", []) if w.get("type") == "annotated-passage"), {})
    sents = ap.get("sentences", [])
    lang_txt = " ".join(f"{s.get('text','')} — {s.get('translation','')}" for s in sents)[:3000]
    med = " ".join(_strip(json.dumps(w, ensure_ascii=False)) for w in bd.get("widgets", [])
                   if w.get("type") in ("why-care-callout", "pattern-cards", "flow-animation"))[:2500]
    return [
        {"id": "overview", "title": "Il quesito", "contentText": _strip(bd.get("narrativeHtml")) + " " + passage["passageText"]},
        {"id": "breakdown", "title": "Analisi della frase", "contentText": lang_txt},
        {"id": "medicine", "title": "La medicina", "contentText": med},
        {"id": "question", "title": "La risposta", "contentText": f"Correct answer: {passage['correct']}. Options: {passage['options_it']}."},
        {"id": "closing", "title": "Chiusura", "contentText": _strip(bd.get("narrativeHtml"))[:600]},
    ]


async def phase4_audio_scripts(passage: dict, cur: dict) -> dict:
    bd = json.loads((OUT / "breakdown.json").read_text())
    secs = passage_sections(passage)
    # overview + closing are voiced from the DISPLAYED text (single-sourced via
    # audio-intro.json, injected below) — so they bypass the 04s "teach-don't-read"
    # LLM. The deeper sections (breakdown/medicine/question) keep 04s teaching.
    llm_secs = [s for s in secs if s["id"] not in ("overview", "closing")]
    p = fill(load_prompt("04s-lecture-script.md"), lessonTitle=bd.get("title", passage["qid"]),
             domain="language-it", sections=llm_secs, granularity="all")
    p += ("\n\n## LEARNER + PODCAST (BLOCKING): native English speaker; audio is a PODCAST (not looking at the page). "
          "English is the medium; every Italian term is its OWN lang:'it' segment and the NEXT lang:'en' segment glosses it. "
          "Persona Lucrezia: do NOT open with a greeting (her own persona-authored greeting for THIS lesson — varied, "
          "not a fixed phrase — is prepended automatically to summary and shortened) — start straight into the content; "
          "sign off warmly. Return ONLY {\"artifacts\":[...]}.")
    print(f"[phase 4] AUDIO transcripts — 04s bilingual ({len(secs)} sections) + Veloce/Lenta reads…", flush=True)
    res = await json_with_repair(p, "lecture-scripts", ollama(MODEL_REASON),
                                 validate_fn=lambda o: None if (o.get("artifacts") or isinstance(o, list)) else ["no artifacts"])
    arts = (res or {}).get("artifacts", res if isinstance(res, list) else [])
    out = {"summary": [], "sections": {}}
    for a in arts:
        k, segs = a.get("kind"), a.get("segments", [])
        if k == "summary": out["summary"] = segs
        elif k == "shortened": out["shortened"] = segs
        elif k == "section" and a.get("sectionId"): out["sections"][a["sectionId"]] = segs

    # OVERVIEW + CLOSING AUDIO == the DISPLAYED cold-open/closing text. The assembler
    # single-sources those exact strings to audio-intro.json; voice them verbatim
    # (IT line + EN gloss → bilingual, podcast self-contained) so narration matches
    # the screen and can never drift. General: any lesson whose assembler emits
    # audio-intro.json gets its listed sections matched to the display.
    def _intro_segs(blk, anchor=None):
        s = []
        if blk.get("it"): s.append({"lang": "it", "text": blk["it"], "gapAfter": "sentence", **({"refAnchor": anchor} if anchor else {})})
        if blk.get("en"): s.append({"lang": "en", "text": blk["en"], "gapAfter": "sentence", **({"refAnchor": anchor} if anchor else {})})
        return s

    intro_path = OUT / "audio-intro.json"
    if intro_path.exists():
        intro = json.loads(intro_path.read_text())
        # overview + closing == the DISPLAYED cold-open/closing text (verbatim).
        for sec_id in ("overview", "closing"):
            segs = _intro_segs(intro.get(sec_id, {}), anchor=sec_id)
            if segs: out["sections"][sec_id] = segs
        # summary + full-lecture OPEN WITH THE SAME personalized greeting as the intro
        # (single-sourced) so all three clips are consistent; the LLM body follows.
        greet = _intro_segs(intro.get("greeting", {}))
        if greet:
            if out.get("summary"): out["summary"] = greet + out["summary"]
            if out.get("shortened"): out["shortened"] = greet + out["shortened"]
        print(f"[phase 4] intro single-sourced from audio-intro.json → overview/closing verbatim; greeting prepended to summary+shortened", flush=True)
    else:
        print("[phase 4] WARNING: audio-intro.json missing — overview/closing/greeting not single-sourced", flush=True)

    # PASSAGE READINGS (curriculum.passageReadings) — Veloce + Lenta (Lucrezia, omni; slow = speed 0.8)
    pr = cur.get("passageReadings", {})
    # TTS-friendly read: bare list letters "A." get misread as trailing letters ("tofi a"); speak them as
    # "Opzione A: …" so each option is announced cleanly. (durable fix — applies to every passage lesson.)
    _opts = []
    for o in passage.get("options_it", []):
        mo = re.match(r"^([A-E])\.\s*(.*)$", o)
        _opts.append(f"Opzione {mo.group(1)}: {mo.group(2)}" if mo else o)
    read_text = passage["stem_it"] + ("  " + ".  ".join(_opts) + "." if _opts else "")
    read_seg = [{"lang": "it", "text": read_text, "gapAfter": "sentence"}]
    out["sections"]["passage-fast"] = {"engine": pr.get("fast", {}).get("engine", "omni"), "segments": read_seg}
    out["sections"]["passage-slow"] = {"engine": pr.get("slow", {}).get("engine", "omni"),
                                        "speed": pr.get("slow", {}).get("speed", 0.8), "segments": read_seg}
    (OUT / "audio-scripts.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
    le = lambda s: {l: sum(1 for x in s if x.get("lang") == l) for l in ("en", "it")}
    print(f"[phase 4] audio-scripts.json: summary={le(out['summary'])} shortened={le(out.get('shortened', []))} "
          f"sections={list(out['sections'])}", flush=True)
    print("          NOTE: passage-fast/slow use raw digits — number-spelling for TTS is a refinement (fattore-v spelled '28'→'ventotto').", flush=True)
    return out


# ── orchestrate ──────────────────────────────────────────────────────────────────
OUT: Path = GEN / "chiron-ssm"   # rebound in phase0_ingest once the qid is known
SLUG = "chiron-ssm"


async def main():
    assert OLLAMA_KEY, "OLLAMA_API_KEY not set (source ~/.config/environment.d/ollama-cloud.conf)"
    cur = load_curriculum()   # Phase 0.1 ROUTER (fixed → passage shape)
    print(f"=== chiron medical-italian PASSAGE chain | submode={SUBMODE} domain={DOMAIN} "
          f"qid={SSM_QID or '(random)'} stage={STAGE}")
    print(f"[route] curriculum: subMode={cur['subMode']} widget={cur['primaryWidget']} "
          f"prompt={cur['promptOverride']} readings={list(cur['passageReadings'])[1:]} theme={cur['themeId']}",
          flush=True)
    passage = phase0_ingest()
    if STAGE == "ingest":
        print("=== ingest + route done.")
        return
    obs.set_out(OUT)                               # OUT is now bound to the real slug → start steps.jsonl
    obs.phase("Analyzing the question", "start"); obs.phase("Analyzing the question", "end")  # ingest (fast, already done)
    obs.phase("Planning the passage", "start")
    chunks = phase1_chunk(passage)               # Phase 1 — PLAN
    obs.phase("Planning the passage", "end")
    if STAGE in ("author", "scenario", "assemble", "audio", "all"):
        obs.phase("Writing the breakdown / scaffold", "start")
        bd = await phase2_author(passage, cur)   # Phase 2 — 04t breakdown
        if bd is None:
            print("=== stopped: breakdown failed (see breakdown.NEEDS_REVIEW).")
            obs.error("Writing the breakdown / scaffold", "breakdown failed — needs review"); return
        obs.phase("Writing the breakdown / scaffold", "end")
    if STAGE in ("scenario", "assemble", "audio", "all") and os.environ.get("CH_NO_SCENARIO") != "1":
        obs.phase("Building the clinical scenario", "start")
        await phase_scenario(passage)            # Phase 2.6 — grounded clinical-scenario chat (Harrison+PACES, scoped)
        obs.phase("Building the clinical scenario", "end")
    if STAGE in ("assemble", "audio", "all"):
        obs.phase("Assembling the page", "start")
        print("[phase 3] ASSEMBLE → renderWidget + skeleton shell → lesson.html", flush=True)
        # Lucrezia authored her own coldOpen (greeting + closing) in Phase 2 — pass it to the
        # assembler via env so the SAME persona-authored strings feed the on-page cold-open AND
        # the audio-intro.json greeting/closing (single-sourced, no drift). Falls back to the
        # assembler's own neutral default if Phase 2 didn't produce one (needs_review case).
        cold = (bd or {}).get("coldOpen", {}) or {}
        greeting, closing = cold.get("greeting", {}) or {}, cold.get("closing", {}) or {}
        assemble_env = {**os.environ, "CH_LEARNER": LEARNER}
        if greeting.get("it"): assemble_env["CH_GREETING_IT"] = greeting["it"]
        if greeting.get("en"): assemble_env["CH_GREETING_EN"] = greeting["en"]
        if closing.get("it"): assemble_env["CH_CLOSING_IT"] = closing["it"]
        if closing.get("en"): assemble_env["CH_CLOSING_EN"] = closing["en"]
        r = subprocess.run(["node", str(SKILL / "scripts" / "assemble-passage.mjs"), str(OUT)],
                           capture_output=True, text=True, env=assemble_env)
        print("  " + (r.stdout or r.stderr).strip()[-400:], flush=True)
        if r.returncode != 0:
            print("=== stopped: assemble failed."); obs.error("Assembling the page", "assemble failed"); return
        obs.phase("Assembling the page", "end")
    if STAGE in ("audio", "all"):
        obs.phase("Writing narration scripts", "start")
        await phase4_audio_scripts(passage, cur)  # Phase 4 — 04s bilingual + Veloce/Lenta → audio-scripts.json
        obs.phase("Writing narration scripts", "end")
        # Phase 5 — BAKE (audio is first-class; runs on CH_STAGE=all or CH_BAKE=1). Without it there's no
        # manifest → no 🎧 player. Heavy Mac TTS; needs Atelier reachable.
        if STAGE == "all" or os.environ.get("CH_BAKE") == "1":
            obs.phase("Baking audio (Lucrezia)", "start")
            print("[phase 5] BAKE → Atelier OmniVoice (Mac), Lucrezia, language-it …", flush=True)
            r = subprocess.run(["node", str(SKILL / "scripts" / "bake-lesson-audio.mjs"), str(OUT),
                                "--domain", "language-it", "--persona", "lucrezia"],
                               capture_output=True, text=True, timeout=2400,
                               env={**os.environ, "CH_LEARNER": LEARNER})
            print("  " + ((r.stdout or "") + (r.stderr or "")).strip()[-300:], flush=True)
            obs.phase("Baking audio (Lucrezia)", "end")
        else:
            print(f"[phase 5] BAKE skipped (CH_STAGE={STAGE}). Use CH_STAGE=all or CH_BAKE=1 to bake "
                  "(audio is first-class — bake before shipping).", flush=True)
    # Phase 6 — PUBLISH to the chiron library (so it shows up in the app). Always on CH_STAGE=all.
    if STAGE == "all" or os.environ.get("CH_PUBLISH") == "1":
        obs.phase("Publishing to the library", "start")
        lib = GEN / "chiron-library"
        bundle = lib / "lessons" / f"{SLUG}.chiron"
        try:
            subprocess.run(["bash", str(SKILL / "scripts" / "bundle-lesson.sh"), str(OUT), str(bundle), "--domain", "language"],
                           capture_output=True, text=True, timeout=300)
            subprocess.run(["node", str(SKILL / "scripts" / "build-library-index.mjs")], capture_output=True, text=True, timeout=120)
            print(f"[phase 6] PUBLISHED → chiron-library/lessons/{SLUG}.chiron (in the app)", flush=True)
        except Exception as e:
            print(f"[phase 6] publish failed: {e}", flush=True)
        obs.phase("Publishing to the library", "end")
    print(f"=== done → {OUT}/lesson.html")


if __name__ == "__main__":
    asyncio.run(main())
