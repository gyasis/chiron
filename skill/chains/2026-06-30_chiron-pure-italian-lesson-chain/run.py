"""Chiron PURE-ITALIAN (non-medical) lesson generator — 7-phase PromptChain.

Turns a TOPIC (a word, a grammar point, an everyday situation) into a RICH Italian-language
lesson (the appunto / al-bar shape: cold-open + vocab tables + grammar pearls + everyday dialogues
+ stories + match-madness), Lucrezia-voiced, bilingual. Shares the deterministic
`assemble-language.mjs` with the wards/passage chains. NO medical grounding — general Italian.

The OLD chain authored the whole lesson in ONE monolithic call against a stripped schema + a
count-only validator → PLAIN lessons (zero <strong>/<em>). This chain restores agent-quality
richness by matching the richer chains (medicine / passage): a style pack + a per-section author
loop with a rich validator + a whole-lesson QC judge.

  Phase 0    STYLE PACK (fn, NO LLM) — exemplar-cafe.md + Lucrezia persona + FORMATTING_RULES.
  Phase 0.5  LIBRARY-DEDUP (fn, NO LLM) — scan chiron-italian-*/content.json → AVOID set.
  Phase 1    PLAN (LLM, MODEL_REASON) — 8 section plans (syllabus.json). plan_valid deterministic.
  Phase 2    PER-SECTION AUTHOR (author-ladder + over_worklist) — chapterN.json, sec_valid rich,
             NEEDS_REVIEW never fatal, per-section RESUME. Phase 2b authors coldOpen + extras.
  Phase 2.5  WHOLE-LESSON QC (LLM judge, MODEL_QC — different family) — deterministic globals +
             rubric → route issues back to named sections (bounded CH_QC_ROUNDS). Fail-OPEN.
  Phase 2.7  BALANCE (fn, NO LLM) — unique slugs, dedup srCard fronts, shuffle match-madness.
  Phase 3    ASSEMBLE (fn → assemble-language.mjs) + deterministic GATE (never fatal).
  Phase 4/5  AUDIO (04s bilingual) + BAKE (Atelier OmniVoice, Lucrezia) — UNCHANGED.

Run:  cd ~/Documents/PromptChain && CH_TOPIC="how to use the word appunto" CH_STAGE=assemble \
        bash scripts/observe.sh runs/2026-06-30_chiron-pure-italian-lesson-chain
Env:  OLLAMA_API_KEY ; CH_TOPIC (required) ; CH_STAGE (author|assemble|audio|all) ;
      CH_AUTHOR_LADDER (glm-5.1,claude,gemini/gemini-flash-latest) ; CH_MODEL_REASON/STRUCT/QC ; CH_QC_ROUNDS ; CH_FORCE.
"""
from promptchain.observability import init_mlflow
init_mlflow()

import asyncio, glob, json, os, random, re, subprocess, sys
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)
from promptchain import PromptChain
import sys as _sys; from pathlib import Path as _P; _sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
import obs   # shared chains/obs.py — per-lesson steps.jsonl observability (best-effort; never breaks generation)
from promptchain.utils.external_loop import over_worklist

# ── config ──────────────────────────────────────────────────────────────────────
HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
HERE = Path(__file__).resolve().parent   # this chain dir (holds exemplar-cafe.md)
GEN = HOME / "Documents/generated"
OLLAMA_KEY = os.environ.get("OLLAMA_API_KEY", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
if not OPENAI_KEY:   # last-resort OpenAI fallback key lives in ~/dev/.env even if not exported to the chain
    try:
        for _ln in (HOME / "dev/.env").read_text().splitlines():
            if _ln.strip().startswith("OPENAI_API_KEY="):
                OPENAI_KEY = _ln.split("=", 1)[1].strip().strip('"').strip("'"); break
    except Exception: pass
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_API_KEY", "")
if not GEMINI_KEY:
    try:
        for _ln in (HOME / "dev/.env").read_text().splitlines():
            _s = _ln.strip()
            if _s.startswith("GEMINI_API_KEY=") or _s.startswith("GOOGLE_API_KEY="):
                GEMINI_KEY = _s.split("=", 1)[1].strip().strip('"').strip("'")
                if GEMINI_KEY:
                    break
    except Exception:
        pass
LEARNER = os.environ.get("CH_LEARNER", "Gyasi")
TOPIC = os.environ.get("CH_TOPIC", "")
STAGE = os.environ.get("CH_STAGE", "author")

# Models (per role). glm-5.1 primary (glm-5.2 was flaky on Ollama Cloud); QC is a DIFFERENT family
# (gemini-flash) so the judge doesn't share the author's blind spots. max_tokens AUTOMATIC.
MODEL_REASON = os.environ.get("CH_MODEL_REASON", "glm-5.1")     # Phase 1 plan
MODEL_STRUCT = os.environ.get("CH_MODEL_STRUCT", "glm-5.1")     # Phase 2 per-section author
MODEL_QC = os.environ.get("CH_MODEL_QC", "gemini/gemini-flash-latest")  # Phase 2.5 judge (different family)
# Section authoring is governed by AUTHOR_LADDER (below), not a single engine — CH_AUTHOR_LADDER overrides it.
QC_ROUNDS = int(os.environ.get("CH_QC_ROUNDS", "0"))   # 0 = lean (Phase-2 validator + assemble gate suffice, like the medicine chain); set 1 to add the LLM QC re-author pass
N_SECTIONS = int(os.environ.get("CH_SECTIONS", "8"))

SLUG = "chiron-italian-" + re.sub(r"[^a-z0-9]+", "-", (TOPIC or "lesson").lower()).strip("-")[:48]
OUT = GEN / SLUG


def ollama(model=MODEL_STRUCT, t=0.45):
    return {"name": f"openai/{model}", "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": t}}


# Model FALLBACK ladder: when the primary can't produce valid JSON after its repairs, try the next model.
_FB = [m.strip() for m in os.environ.get("CH_MODEL_FALLBACKS", "gemma4:31b,gemini/gemini-flash-latest,gpt-5-mini").split(",") if m.strip()]
FALLBACKS = [m for m in _FB if not (m.startswith("gpt-") and not OPENAI_KEY) and not (m.startswith("gemini") and not GEMINI_KEY)]

# AUTHOR engine ladder (Phase-2 section authoring ONLY): glm (primary) -> claude (headless CLI) -> gemini-flash.
# glm authors first (fast, its 3 repairs); only if it CAN'T produce valid output do we fall to claude, then gemini.
# "claude" = the claude -p CLI (always available, not a litellm key); everything else routes through model_for/llm.
_AL = [m.strip() for m in os.environ.get("CH_AUTHOR_LADDER", "glm-5.1,claude,gemini/gemini-flash-latest").split(",") if m.strip()]
AUTHOR_LADDER = [m for m in _AL if m == "claude" or (not (m.startswith("gpt-") and not OPENAI_KEY) and not (m.startswith("gemini") and not GEMINI_KEY))]


def model_for(name: str, temperature: float = 0.4) -> dict:
    """model_dict for a bare model name. gpt-* → real OpenAI; gemini* → Gemini; everything else → Ollama Cloud."""
    if name.startswith("gemini"):
        gm = name if name.startswith("gemini/") else f"gemini/{name}"
        return {"name": gm, "params": {"api_key": GEMINI_KEY, "temperature": temperature}}
    if name.startswith("gpt-"):
        # gpt-5 models only support temperature=1 (the default) — passing 0.4 → litellm UnsupportedParamsError.
        return {"name": f"openai/{name}", "params": {"api_key": OPENAI_KEY}}
    if name.startswith("local/"):
        # local/<model> → the Atelier governor (memory-governed Mac ollama); base via env, neutral default (public repo)
        lm = name.split("/", 1)[1]
        base = os.environ.get("CH_LOCAL_BASE", "http://localhost:8799/llm/ollama/v1")
        return {"name": f"openai/{lm}", "params": {"api_base": base, "api_key": "local", "temperature": temperature}}
    return ollama(name, temperature)


def _author_item(name: str, temperature: float = 0.45) -> dict:
    """One rung of the AUTHOR_LADDER → a call-spec. 'claude' → the claude -p CLI marker; else a model_dict."""
    if name == "claude":
        return {"name": "claude", "_claude": True}
    return model_for(name, temperature)


def extract_json(s):
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s.strip(), flags=re.M).strip()
    st = next((i for i, ch in enumerate(s) if ch in "{["), -1)
    if st < 0: return json.loads(s, strict=False)
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
                if d == 0: return json.loads(s[st:i + 1], strict=False)
    return json.loads(s[st:], strict=False)


async def llm(md, prompt, user_input="go"):
    chain = PromptChain(models=[md], instructions=[prompt + "\n\n{input}" if "{input}" not in prompt else prompt])
    try: chain.register_callback(obs.make_callback())
    except Exception: pass
    return await chain.process_prompt_async(user_input)


def claude_p(prompt: str) -> str:
    """Headless Claude Code (strong Claude — Opus/Sonnet) as a function step (D4d). Prompt via stdin."""
    r = subprocess.run(["claude", "-p", "--dangerously-skip-permissions"],
                       input=prompt, capture_output=True, text=True, timeout=600)
    return r.stdout.strip()


async def json_with_repair(prompt, name, md, validate_fn=None, max_repair=3, via_engine=False):
    """Self-repair loop + MODEL FALLBACK (medicine/passage pattern). Re-prompt the current model on bad
    JSON / failed validate up to max_repair (feeding validate_fn's issues into a ## PROBLEMS re-prompt);
    if it STILL can't, fall back to the next model in the ladder. Returns None on total exhaustion (caller
    flags needs_review + KEEPS GOING). via_engine=True uses the AUTHOR_LADDER (glm->claude->gemini-flash)."""
    # Section authoring uses the AUTHOR_LADDER (glm -> claude -> gemini-flash); plan/extras/QC use the litellm FALLBACKS ladder.
    ladder = [_author_item(m) for m in AUTHOR_LADDER] if via_engine else ([md] + [model_for(m) for m in FALLBACKS])
    last = ""
    for mi, cmd in enumerate(ladder):
        tag = cmd.get("name", "?")
        cur = prompt
        attempts = max_repair if mi == 0 else 1   # primary: <=3 reviews then fail; fallbacks: ONE quick try each — HARD bound, never an infinite/runaway loop
        for attempt in range(1, attempts + 1):
            try: last = await (asyncio.to_thread(claude_p, cur + "\n\nReturn ONLY the JSON object, no prose.") if cmd.get("_claude") else llm(cmd, cur))   # author ladder rung: claude marker -> claude -p CLI; else litellm (glm/gemini)
            except Exception as e:
                _msg = str(e).lower()
                if 'ratelimit' in _msg or '429' in _msg or 'usage limit' in _msg or 'rate limit' in _msg or 'resource_exhausted' in _msg or 'quota' in _msg:
                    print(f"[repair] {name} [{tag}]: rate-limited (429) — skipping retries, falling to next model", flush=True)
                    break   # advance the ladder to the next model immediately; don't hammer a capped provider
                print(f"[repair] {name} [{tag}] {attempt}: LLM errored ({e})", flush=True); await asyncio.sleep(3); continue
            try: obj = extract_json(last)
            except Exception as e:
                cur = prompt + f"\n\n## PREVIOUS INVALID JSON\n{e}\nReturn ONLY corrected valid JSON. Escape every \" and newline inside string values."; continue
            iss = validate_fn(obj) if validate_fn else None
            if iss:
                print(f"[repair] {name} [{tag}] {attempt}: invalid ({iss[:2]}) — re-prompting", flush=True)
                cur = prompt + f"\n\n## PROBLEMS\n{iss}\nReturn ONLY corrected valid JSON that fixes every problem above."; continue
            if mi > 0: print(f"[repair] {name}: RECOVERED via fallback [{tag}]", flush=True)
            return obj
        if mi < len(ladder) - 1:
            nxt = ladder[mi + 1].get("name", "?")
            print(f"[repair] {name}: [{tag}] exhausted -> FALLBACK to [{nxt}]", flush=True)
    (OUT / ".scratch").mkdir(parents=True, exist_ok=True); (OUT / ".scratch" / f"{name}.raw.txt").write_text(last or "(EMPTY)")
    print(f"[repair] {name}: ALL MODELS EXHAUSTED — flagging needs_review, continuing", flush=True)
    return None


# ── Phase 0 — STYLE PACK (deterministic): exemplar + persona + formatting rules ───
def load_persona_block() -> str:
    """Lucrezia's register (copied from the passage chain). activePersonaFor:language-it."""
    for p in (HOME / ".chiron/packs/lucrezia/persona.md", HOME / ".chiron/packs/language-it/persona.md"):
        if p.exists():
            return p.read_text()[:4000]
    return ("Persona: Lucrezia — a warm, fond Italian tutor; greets the learner by name; bilingual "
            "(English instruction, perfect idiomatic Italian for target words); loves teaching; never "
            "voices the learner's own turns.")


def load_exemplar() -> str:
    """The café richness bar (Phase 0 style pack — checked in beside this run.py)."""
    p = HERE / "exemplar-cafe.md"
    try:
        return p.read_text()[:6000]
    except Exception:
        return ""


PERSONA_BLOCK = load_persona_block()
EXEMPLAR = load_exemplar()

FORMATTING_RULES = (
    "## FORMATTING RULES (BLOCKING — this is what makes the lesson RICH, not plain)\n"
    "1. `<strong>` the KEY TERM on its first definition in each section (>=1 per section) — e.g. "
    "`<strong>vorrei</strong> is the conditional`.\n"
    "2. `<em>` around EVERY Italian word or phrase you cite inside English prose, AND inside quoted "
    "example sentences (aim for >=6 `<em>` per section, >=45 across the whole lesson). "
    "e.g. `always use <em>vorrei</em>`, `<em>«Per me, il risotto.»</em>`.\n"
    "3. NEVER cite an Italian word with BARE quotes (`the word 'io'`). ALWAYS wrap it: "
    "`the word <em>io</em>`. Bare-quoted Italian in English prose is REJECTED.\n"
    "4. `vocab[].note` is a ONE-SENTENCE USAGE MICRO-LESSON with `<em>` on any Italian — WHEN/WHY/HOW "
    "the word is used, plus culture where relevant — NOT a bare gloss. "
    "BAD: `Emphatic use of 'I'`. GOOD: `Drunk only in the morning — Italians consider a cappuccino "
    "heavy after lunch.` Every note is a full sentence (>=6 words).\n"
    "5. `introHtml` OPENS by `<strong>`-defining the section's key term, cites examples in `<em>`, "
    "and ENDS with a contrast or common-mistake warning (`Same principle as \"Can I have…?\" vs "
    "\"Give me…!\"`).\n"
    "6. `pearls[].it` carries the RICH teaching text (with `<strong>` + `<em>` markup, English "
    "explanation threaded with `<em>`-cited Italian, exactly like the exemplar pearls); "
    "`pearls[].en` is the plain-English gloss for the reveal toggle.\n"
    "7. `stories[]` are in Lucrezia's FIRST PERSON (`it` = an Italian paragraph in her voice, "
    "`en` = the English gloss) — a short lived-in scene, warm and concrete.\n"
)


def _user_ctx() -> str:
    """Wizard/OCR grounding: CH_GROUNDING points to a markdown file of user-provided source/context."""
    p = os.environ.get("CH_GROUNDING")
    if p:
        try:
            t = Path(p).read_text().strip()
        except Exception:
            t = ""
        if t:
            return f"## USER-PROVIDED SOURCE (OCR'd pages / notes — build the lesson around this):\n{t[:4000]}\n\n"
    return ""


USER_CTX = _user_ctx()


# ── Phase 0.5 — LIBRARY-DEDUP (no LLM): what's already been taught ────────────────
def library_dedup() -> dict:
    """Scan existing chiron-italian-*/content.json for taught vocab/pearl slugs + section topics →
    the AVOID set, so we don't re-teach what the library already covers."""
    slugs, topics = set(), set()
    for cj in glob.glob(str(GEN / "chiron-italian-*" / "content.json")):
        if Path(cj).parent.name == SLUG:
            continue   # don't avoid our own in-progress lesson
        try:
            d = json.load(open(cj, encoding="utf-8"))
        except Exception:
            continue
        if d.get("title"): topics.add(str(d["title"]))
        for s in (d.get("sections") or []):
            if s.get("title"): topics.add(str(s["title"]))
            for v in (s.get("vocab") or []):
                if v.get("slug"): slugs.add(str(v["slug"]).lower())
            for p in (s.get("pearls") or []):
                if p.get("slug"): slugs.add(str(p["slug"]).lower())
    avoid = {"slugs": sorted(slugs), "topics": sorted(topics)}
    (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
    (OUT / ".scratch" / "dedup.json").write_text(json.dumps(avoid, ensure_ascii=False, indent=2))
    print(f"[phase 0.5] library-dedup: {len(slugs)} slugs + {len(topics)} topics already taught → AVOID", flush=True)
    return avoid


def avoid_block(avoid: dict) -> str:
    if not (avoid["slugs"] or avoid["topics"]):
        return ""
    return ("\n\n## ALREADY IN THE LIBRARY — DO NOT RE-TEACH\n"
            f"Already-taught vocab/pearl slugs (avoid re-centering the lesson on these): "
            f"{', '.join(avoid['slugs'][:80]) or '(none)'}\n"
            f"Already-covered topics/section titles (don't duplicate their angle): "
            f"{'; '.join(avoid['topics'][:40]) or '(none)'}\n")


# ── Phase 1 — PLAN (LLM, MODEL_REASON): 8 section plans ───────────────────────────
def plan_valid(o):
    secs = o.get("sections") if isinstance(o, dict) else (o if isinstance(o, list) else None)
    if not isinstance(secs, list) or len(secs) < N_SECTIONS:
        return [f"need exactly {N_SECTIONS} section plans (a deep lesson)"]
    ids = [s.get("id") for s in secs]
    if len(set(ids)) != len(ids):
        return ["section ids must be unique (chapter-1..chapter-N)"]
    thin = [s.get("id") for s in secs if not (s.get("teachingGoal") or "").strip()]
    if thin:
        return [f"every section needs a non-empty teachingGoal; empty: {thin}"]
    return None


async def phase1_plan(avoid: dict):
    OUT.mkdir(parents=True, exist_ok=True)
    if (OUT / "syllabus.json").exists() and os.environ.get("CH_FORCE") != "1":
        print("[phase 1] RESUME — reusing syllabus.json (CH_FORCE=1 to replan)", flush=True)
        return json.loads((OUT / "syllabus.json").read_text())
    p = (
        f"You are Lucrezia, a warm Italian tutor planning a DEEP (non-medical) Italian-language lesson on "
        f"**{TOPIC}** for {LEARNER} — a native-English speaker learning Italian.\n\n"
        + USER_CTX +
        f"Design EXACTLY {N_SECTIONS} content sections that build a coherent learning arc for this topic "
        "(from foundations → nuance → real-world use). Return ONLY JSON:\n"
        '{ "sections": [\n'
        '  {"id":"chapter-1","title":"1 <Italian section title>","titleEn":"<English of the title>",\n'
        '   "teachingGoal":"<one sentence: what the learner can DO after this section>",\n'
        '   "targetStructures":["<grammar point / phrase / word to teach>", ...2-4],\n'
        '   "arc":"<one sentence: how this section moves the lesson forward>"},\n'
        f'  ... chapter-1 .. chapter-{N_SECTIONS} ]}}\n'
        + avoid_block(avoid) +
        "The sections must FIT THE TOPIC and not overlap each other. Return ONLY the JSON."
    )
    print(f"[phase 1] PLAN — {N_SECTIONS} sections for '{TOPIC}'…", flush=True)
    # Phase 1 is the ONLY hard prerequisite (everything downstream needs the plan), but a transient bad-JSON
    # roll must not nuke a 60-min run — retry the whole plan a few times before giving up (robustness bug fix).
    plan = None
    for _attempt in range(1, 4):
        plan = await json_with_repair(p, "syllabus", model_for(MODEL_REASON), validate_fn=plan_valid)
        if plan is not None:
            break
        print(f"[phase 1] plan attempt {_attempt}/3 exhausted all repairs+fallbacks — retrying…", flush=True)
    if plan is None:
        raise RuntimeError("[chiron] phase-1 plan: unusable JSON after 3x all repairs/fallbacks — transient, re-run.")
    secs = plan.get("sections") if isinstance(plan, dict) else plan
    (OUT / "syllabus.json").write_text(json.dumps(secs, ensure_ascii=False, indent=2))
    print(f"[phase 1] syllabus: {len(secs)} sections → {[s.get('title') for s in secs]}", flush=True)
    return secs


# ── Phase 2 — PER-SECTION AUTHOR (author-ladder + over_worklist) ────────────────────
def _strip_tags(h): return re.sub(r"<[^>]+>", " ", h or "")
BARE_QUOTE_RE = re.compile(r"[A-Za-z]\s'[a-zà-ùéèìòùé]{2,}'", re.I)


def _rich_blob(sec: dict) -> str:
    """The text that carries the section's formatting richness (introHtml + vocab notes + pearls)."""
    parts = [sec.get("introHtml", "") or ""]
    for v in (sec.get("vocab") or []):
        parts.append(v.get("note", "") or "")
    for p in (sec.get("pearls") or []):
        parts.append((p.get("it", "") or "") + " " + (p.get("en", "") or ""))
    return " ".join(parts)


def sec_valid(s):
    """Rich validator — returns the list of issues fed into json_with_repair's ## PROBLEMS re-prompt."""
    iss = []
    vocab = s.get("vocab") or []
    pearls = s.get("pearls") or []
    if len(vocab) < 8:
        iss.append(f"need >=8 vocab rows (have {len(vocab)})")
    if len(pearls) < 2:
        iss.append(f"need >=2 grammar pearls (have {len(pearls)})")
    blob = _rich_blob(s)
    n_em = blob.count("<em>")
    if n_em < 6:
        iss.append(f"need >=6 <em>-wrapped Italian citations in this section (have {n_em}) — wrap EVERY cited Italian word in <em>")
    if "<strong>" not in (s.get("introHtml") or ""):
        iss.append("introHtml must <strong>-define the section's key term on first mention")
    bare = BARE_QUOTE_RE.findall(blob)
    if len(bare) > 2:
        iss.append(f"bare-quoted Italian in English prose ({bare[:3]}) — wrap Italian in <em>…</em>, not '…'")
    short_notes = [v.get("slug") or v.get("it") for v in vocab
                   if len(_strip_tags(v.get("note") or "").split()) < 6]
    if short_notes:
        iss.append(f"these vocab notes are bare glosses, not usage micro-lessons (rewrite as a full sentence): {short_notes[:5]}")
    if not s.get("dialogue") and not s.get("stories"):
        iss.append("section needs a dialogue OR a story")
    return iss or None


def _section_schema(is_first: bool) -> str:
    base = (
        "## OUTPUT — return ONLY this ONE section object (JSON):\n"
        "{\n"
        '  "id":"<chapter-N from the plan>", "title":"<Italian title from the plan>", "titleEn":"<English of the title>",\n'
        '  "introHtml":"<4-6 sentence Italian-teaching intro; OPEN by <strong>-defining the key term, cite examples in <em>, END with a contrast/common-mistake warning>",\n'
        '  "introEn":"<English translation of introHtml>",\n'
        '  "vocab":[{"slug":"<kebab, unique>","it":"<IT word/phrase>","en":"<EN>","note":"<one-sentence USAGE micro-lesson, <em> on Italian>"}, ...8-10],\n'
        '  "pearls":[{"slug":"<kebab, unique>","it":"<RICH teaching text w/ <strong> key term + <em>-cited Italian, like the exemplar>","en":"<plain-EN gloss for the toggle>"}, ...2-3],\n'
        '  "dialogue":{"id":"<chapter-N>","turns":[{"who":"a","label":"<IT speaker>","text":"<IT>","en":"<EN>"},{"who":"learner","label":"Tu","text":"<Gyasi\'s line, IT — NEVER voiced>","en":"<EN>"}, ...]},\n'
        '  "stories":[{"id":"<chapter-N>","it":"<short IT story in Lucrezia\'s first person>","en":"<EN gloss>"}]\n'
        "}\n"
        "VOICING: the OTHER speaker is `who:\"a\"` (voiced); the learner (Gyasi) is `who:\"learner\"` (NEVER voiced). "
        "Every dialogue turn carries an `en`. slugs kebab-case + unique. Real, idiomatic Italian.\n"
    )
    if is_first:
        base += (
            "\n## ALSO (section 1 only) — author Lucrezia's cold-open greeting as a top-level `coldOpen`:\n"
            f'  "coldOpen": {{"it":"<Lucrezia greets {LEARNER} by name, warm and fond, framing the topic, in Italian — '
            'VARY it, never a fixed phrase>","en":"<EN translation>"}}\n'
        )
    return base


async def author_section(plan_sec: dict, avoid: dict, idx: int, extra_directive: str = "", force: bool = False):
    n = idx + 1
    sid = plan_sec.get("id") or f"chapter-{n}"
    fpath = OUT / f"chapter{n}.json"
    if fpath.exists() and not force and os.environ.get("CH_FORCE") != "1":
        print(f"[phase 2] section {n} ({sid}) — RESUME (already authored)", flush=True)
        return n
    is_first = (idx == 0)
    engine_tag = AUTHOR_LADDER[0] if AUTHOR_LADDER else MODEL_STRUCT   # primary author rung (fallbacks logged as [repair] RECOVERED)
    p = (
        f"You are Lucrezia, a warm Italian tutor. Author ONE section of a DEEP (non-medical) Italian lesson on "
        f"**{TOPIC}** for {LEARNER} — a native-English speaker. LANGUAGE-FIRST: he must UNDERSTAND and USE the Italian.\n\n"
        + FORMATTING_RULES + "\n"
        + "## THE RICHNESS BAR — match this density and markup (study the FORMATTING, not the café topic):\n"
        + EXEMPLAR + "\n\n"
        + "## PERSONA (Lucrezia — her voice):\n" + PERSONA_BLOCK + "\n\n"
        + USER_CTX
        + f"## THIS SECTION'S PLAN\n{json.dumps(plan_sec, ensure_ascii=False)}\n"
        + avoid_block(avoid)
        + "\n" + _section_schema(is_first)
        + (f"\n\n## QC FIXES REQUIRED (re-author to fix these)\n{extra_directive}" if extra_directive else "")
        + "\nReturn ONLY the JSON object for THIS section."
    )
    print(f"[phase 2] AUTHOR section {n} ({sid}) engine={engine_tag} …", flush=True)
    sec = await json_with_repair(p, f"chapter{n}", model_for(MODEL_STRUCT), validate_fn=sec_valid, via_engine=True)
    if sec is None:
        (OUT / f"chapter{n}.NEEDS_REVIEW").write_text(f"section {n} ({sid}) failed sec_valid after all repairs/fallbacks")
        print(f"[phase 2] section {n} — NEEDS_REVIEW (lesson continues)", flush=True)
        return None
    sec.setdefault("id", sid)
    # section 1 carries the coldOpen — pull it out into extras, keep the section clean
    if is_first and isinstance(sec.get("coldOpen"), dict):
        (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
        (OUT / ".scratch" / "coldOpen.json").write_text(json.dumps(sec.pop("coldOpen"), ensure_ascii=False, indent=2))
    fpath.write_text(json.dumps(sec, ensure_ascii=False, indent=2))
    nem = _rich_blob(sec).count("<em>")
    print(f"[phase 2] section {n}: {len(sec.get('vocab', []))} vocab, {len(sec.get('pearls', []))} pearls, {nem} <em>", flush=True)
    return n


async def phase2_sections(syllabus, avoid):
    async def handler(item, state):
        i = state["_idx"] = state.get("_idx", -1) + 1
        try:
            r = await author_section(item, avoid, i)
        except Exception as e:               # a section must NEVER kill the whole lesson
            print(f"[phase 2] section idx {i}: unexpected error ({e}) — skipped, lesson continues", flush=True)
            r = None
        state.setdefault("done", []).append(r)
    state = await over_worklist(syllabus, handler, max_iters=len(syllabus) + 1, max_seconds=2400)
    done = [x for x in state.get("done", []) if x]
    print(f"[phase 2] authored {len(done)}/{len(syllabus)} sections: {sorted(done)}"
          + (f" | {len(syllabus)-len(done)} flagged NEEDS_REVIEW" if len(done) < len(syllabus) else ""), flush=True)
    return state


# ── Phase 2b — EXTRAS (coldOpen fallback + matchMadness + scenario + srCards + closing) ──
def _extras_valid(o):
    iss = []
    mm = (o.get("matchMadness") or {}).get("pairs") or []
    if not (8 <= len(mm) <= 12):
        iss.append(f"matchMadness needs 8-10 pairs (have {len(mm)})")
    msgs = (o.get("scenario") or {}).get("messages") or []
    if len(msgs) < 8:
        iss.append(f"scenario needs an 8-12 turn chat (have {len(msgs)})")
    if any(not m.get("bodyEn") for m in msgs):
        iss.append("every scenario message needs a bodyEn (EN toggle)")
    sr = o.get("srCards") or []
    if not (12 <= len(sr) <= 18):
        iss.append(f"srCards needs 12-16 (have {len(sr)})")
    if not (o.get("closingHtml") and o.get("closingEn")):
        iss.append("need closingHtml + closingEn")
    return iss or None


async def phase2b_extras(syllabus, avoid):
    fpath = OUT / "extras.json"
    if fpath.exists() and os.environ.get("CH_FORCE") != "1":
        print("[phase 2b] RESUME — reusing extras.json", flush=True)
        return json.loads(fpath.read_text())
    cold = {}
    cp = OUT / ".scratch" / "coldOpen.json"
    if cp.exists():
        try: cold = json.loads(cp.read_text())
        except Exception: cold = {}
    titles = "; ".join(s.get("title", "") for s in syllabus)
    p = (
        f"You are Lucrezia, a warm Italian tutor, finishing a DEEP Italian lesson on **{TOPIC}** for {LEARNER}.\n"
        f"The lesson's sections are: {titles}\n\n"
        + FORMATTING_RULES + "\n"
        "## OUTPUT — return ONLY this JSON (the lesson-level extras):\n"
        "{\n"
        + ("" if cold.get("it") else
           f'  "coldOpen":{{"it":"<Lucrezia greets {LEARNER} by name, warm+fond, frames the topic, Italian — VARIED>","en":"<EN>"}},\n')
        + '  "matchMadness":{"pairs":[{"a":"<IT term from the lesson>","b":"<EN>"}, ...8-10 pairs]},\n'
        '  "scenario":{"title":"<short IT situation title>","framing":"<one EN line: the everyday scene>",\n'
        '     "messages":[{"sender":"lucrezia","senderLabel":"Lucrezia","avatarChar":"L","body":"<IT chat line USING the target grammar>","bodyEn":"<EN>"},\n'
        f'        {{"sender":"you","senderLabel":"{LEARNER}","avatarChar":"G","body":"<IT reply USING the grammar>","bodyEn":"<EN>"}}, ...8-12 turns, warm back-and-forth]}},\n'
        '  "srCards":[{"front":"<IT>","back":"<EN>"}, ...12-16],\n'
        '  "closingHtml":"<short IT riepilogo paragraph, <em>-group the vocab the learner met>","closingEn":"<EN translation>"\n'
        "}\n"
        + avoid_block(avoid) +
        "matchMadness pairs draw from THIS lesson's vocab. scenario is a lively everyday chat (Lucrezia + "
        f"{LEARNER}, warm and fond) that puts the target grammar to work; EVERY message has bodyEn. Return ONLY the JSON."
    )
    print("[phase 2b] EXTRAS — coldOpen + matchMadness + scenario + srCards + closing …", flush=True)
    ex = await json_with_repair(p, "extras", model_for(MODEL_STRUCT), validate_fn=_extras_valid)
    if ex is None:
        print("[phase 2b] extras failed — writing minimal shell (lesson continues)", flush=True)
        ex = {"matchMadness": {"pairs": []}, "srCards": [], "closingHtml": "", "closingEn": ""}
    if cold.get("it"):
        ex["coldOpen"] = cold                       # section-1's persona cold-open wins
    ex.setdefault("coldOpen", cold or {"it": "", "en": ""})
    fpath.write_text(json.dumps(ex, ensure_ascii=False, indent=2))
    mm = (ex.get("matchMadness") or {}).get("pairs") or []
    print(f"[phase 2b] extras.json: matchMadness={len(mm)} scenario={len((ex.get('scenario') or {}).get('messages', []))} "
          f"srCards={len(ex.get('srCards', []))}", flush=True)
    return ex


# ── merge the per-section files + extras into the compat content.json shape ───────
def load_sections() -> list:
    """Read chapter1..N.json in order (skip NEEDS_REVIEW / missing) → the sections[] array."""
    syl = json.loads((OUT / "syllabus.json").read_text())
    secs = []
    for i, _ in enumerate(syl):
        cj = OUT / f"chapter{i+1}.json"
        if cj.exists():
            try: secs.append(json.loads(cj.read_text()))
            except Exception: pass
    return secs


def merge_content() -> dict:
    """Build the exact content.json shape assemble-language.mjs consumes (compat constraint)."""
    ex = json.loads((OUT / "extras.json").read_text()) if (OUT / "extras.json").exists() else {}
    cold = ex.get("coldOpen") or {"it": "", "en": ""}
    content = {
        "title": TOPIC.strip().capitalize() if TOPIC else "Lezione",
        "subtitle": "", "langName": "Italiano", "cefr": "A2-B1",
        "coldOpen": {"it": cold.get("it", ""), "en": cold.get("en", "")},
        "sections": load_sections(),
        "matchMadness": ex.get("matchMadness") or {"pairs": []},
        "scenario": ex.get("scenario"),
        "srCards": ex.get("srCards") or [],
        "closingHtml": ex.get("closingHtml", ""), "closingEn": ex.get("closingEn", ""),
        "_authoredBy": (AUTHOR_LADDER[0] if AUTHOR_LADDER else MODEL_STRUCT),   # primary author rung (assembler ignores unknown keys)
    }
    if content["scenario"] is None:
        content.pop("scenario")
    # title from section 1's plan/title if available (nicer than the raw topic)
    if content["sections"]:
        t0 = content["sections"][0].get("title", "")
        content["title"] = re.sub(r"^\d+\s+", "", t0) or content["title"]
    (OUT / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=2))
    return content


# ── Phase 2.5 — WHOLE-LESSON QC (LLM judge, MODEL_QC — different family). Fail-OPEN. ──
def _global_checks(content: dict) -> list:
    iss = []
    secs = content.get("sections") or []
    blob = " ".join(_rich_blob(s) for s in secs)
    nem = blob.count("<em>")
    # <strong> lives in introHtml + the (rich) pearls[].it teaching text
    nstrong = sum((s.get("introHtml") or "").count("<strong>") for s in secs) \
        + sum((p.get("it") or "").count("<strong>") for s in secs for p in (s.get("pearls") or []))
    if nem < 45:
        iss.append(f"whole lesson has only {nem} <em> (need >=45)")
    if nstrong < 6:
        iss.append(f"whole lesson has only {nstrong} <strong> (need >=6)")
    for s in secs:
        d = s.get("dialogue")
        if d and any(not t.get("en") for t in d.get("turns", [])):
            iss.append(f"{s.get('id')}: a dialogue turn is missing its `en` gloss")
    mm = (content.get("matchMadness") or {}).get("pairs") or []
    if not (8 <= len(mm) <= 12):
        iss.append(f"matchMadness has {len(mm)} pairs (need 8-10)")
    sr = content.get("srCards") or []
    if not (12 <= len(sr) <= 18):
        iss.append(f"srCards has {len(sr)} (need 12-16)")
    return iss


async def phase25_qc(syllabus, avoid) -> dict:
    """Merge → deterministic globals + one LLM-judge (different family) → route issues back to the
    NAMED sections for a bounded re-author. Fail-OPEN (any crash → proceed with what we have)."""
    content = merge_content()
    for rnd in range(1, QC_ROUNDS + 1):
        gissues = _global_checks(content)
        if gissues:
            print(f"[phase 2.5] QC round {rnd}: deterministic global gaps → {gissues[:4]}", flush=True)
        # LLM judge (skip gracefully if its model/key is unavailable)
        verdict = None
        if not (MODEL_QC.startswith("gemini") and not GEMINI_KEY):
            secs_min = [{"id": s.get("id"), "title": s.get("title"), "introHtml": s.get("introHtml", ""),
                         "vocab": s.get("vocab", []), "pearls": s.get("pearls", [])} for s in content.get("sections", [])]
            p = (
                "You are a rigorous Italian-lesson EDITOR. Judge this lesson against the rubric and return "
                "ONLY JSON: {\"pass\":bool,\"issues\":[{\"sectionId\":\"chapter-N\",\"problem\":\"...\",\"fix\":\"...\"}]}\n\n"
                "## RUBRIC (fail a section that misses any):\n"
                "- Persona voice: warm, fond Lucrezia; greets by name in the cold-open.\n"
                "- Bilingual correctness: every English gloss (`en`, `titleEn`, dialogue `en`) is a faithful translation.\n"
                "- vocab notes are USAGE MICRO-LESSONS (a full sentence teaching WHEN/WHY/HOW), not bare glosses.\n"
                "- NO bare-quoted Italian in English prose (must be <em>…</em>).\n"
                "- Examples are idiomatic, real Italian.\n\n"
                f"## LESSON (title: {content.get('title')})\n{json.dumps(secs_min, ensure_ascii=False)[:12000]}\n\n"
                "Return ONLY the JSON verdict."
            )
            try:
                verdict = await json_with_repair(p, "qc", model_for(MODEL_QC),
                                                 validate_fn=lambda o: None if isinstance(o, dict) and "pass" in o else ["need {pass, issues}"])
            except Exception as e:
                print(f"[phase 2.5] QC judge crashed ({e}) — failing OPEN", flush=True)
                verdict = None
        # collect per-section fixes (deterministic globals + judge issues), route back to NAMED sections
        fixes: dict = {}
        for it in ((verdict or {}).get("issues") or []):
            sid = it.get("sectionId")
            if sid:
                fixes.setdefault(sid, []).append(f"- {it.get('problem','')} → FIX: {it.get('fix','')}")
        # map deterministic per-section gaps (dialogue-missing-en) to their sections too
        for gi in gissues:
            m = re.match(r"(chapter-\d+):", gi)
            if m:
                fixes.setdefault(m.group(1), []).append(f"- {gi}")
        passed = (verdict is None or verdict.get("pass")) and not gissues
        if passed:
            print(f"[phase 2.5] QC round {rnd}: PASS", flush=True)
            break
        if not fixes:
            print(f"[phase 2.5] QC round {rnd}: gaps are lesson-level (not per-section) — re-running extras only", flush=True)
        # re-author the named sections (bounded); then re-merge
        id_to_idx = {s.get("id"): i for i, s in enumerate(syllabus)}
        for sid, notes in fixes.items():
            idx = id_to_idx.get(sid)
            if idx is None:
                continue
            print(f"[phase 2.5] QC re-author {sid}: {len(notes)} fix(es)", flush=True)
            try:
                await author_section(syllabus[idx], avoid, idx, extra_directive="\n".join(notes), force=True)
            except Exception as e:
                print(f"[phase 2.5] re-author {sid} failed ({e}) — keeping prior version", flush=True)
        content = merge_content()
    return content


# ── Phase 2.7 — BALANCE (deterministic, no model) ─────────────────────────────────
def phase27_balance(content: dict) -> dict:
    changes = []
    seen = set()
    for s in content.get("sections", []):
        for key in ("vocab", "pearls"):
            for item in (s.get(key) or []):
                slug = str(item.get("slug") or "").strip() or "x"
                base, k = slug, 1
                while slug in seen:
                    k += 1; slug = f"{base}-{k}"
                if slug != item.get("slug"):
                    changes.append(f"slug {item.get('slug')}→{slug}")
                    item["slug"] = slug
                seen.add(slug)
    # dedup srCard fronts
    sr, fronts, deduped = content.get("srCards") or [], set(), []
    for c in sr:
        f = str(c.get("front", "")).strip().lower()
        if f and f in fronts:
            changes.append(f"dropped dup srCard '{c.get('front')}'"); continue
        fronts.add(f); deduped.append(c)
    content["srCards"] = deduped
    # shuffle match-madness order
    mm = (content.get("matchMadness") or {}).get("pairs")
    if mm:
        random.shuffle(mm); changes.append("shuffled matchMadness")
    # STRIP inline markup from fields the assembler HTML-ESCAPES (else <em>/<strong> render as ugly literal
    # text). Rich markup renders ONLY in introHtml / vocab.note / pearls.it / closingHtml (injected raw);
    # strip it from the Italian terms, glosses, dialogue, stories, titles, coldOpen, scenario, and srCards.
    _TAG = re.compile(r"</?(?:em|strong|b|i)>", re.I)
    _cl = lambda x: _TAG.sub("", x) if isinstance(x, str) else x
    _n = [0]
    def _s(o, k):
        if isinstance(o.get(k), str):
            c = _cl(o[k])
            if c != o[k]:
                _n[0] += 1
            o[k] = c
    for s in content.get("sections", []):
        _s(s, "title"); _s(s, "titleEn"); _s(s, "introEn")   # introEn goes into data-en (escaped)
        for v in (s.get("vocab") or []): _s(v, "it"); _s(v, "en")
        for p in (s.get("pearls") or []): _s(p, "en")   # pearls.it stays raw (rendered); pearls.en is escaped in data-en
        for t in ((s.get("dialogue") or {}).get("turns") or []): _s(t, "text"); _s(t, "en")
        for st in (s.get("stories") or []): _s(st, "it"); _s(st, "en")
    _s(content, "closingEn")   # closingEn goes into data-en (escaped); closingHtml stays raw
    for k in ("it", "en"): _s(content.get("coldOpen") or {}, k)
    _sc = content.get("scenario") or {}
    _s(_sc, "title"); _s(_sc, "framing")
    for m in (_sc.get("messages") or []): _s(m, "body"); _s(m, "bodyEn")
    for c in (content.get("srCards") or []): _s(c, "front"); _s(c, "back")
    if _n[0]:
        changes.append(f"stripped markup from {_n[0]} escaped field(s)")
    (OUT / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=2))
    print(f"[phase 2.7] balance: {len(changes)} change(s) — {changes[:6]}{' …' if len(changes) > 6 else ''}", flush=True)
    return content


# ── Phase 3 — ASSEMBLE + GATE ─────────────────────────────────────────────────────
def assemble():
    print("[phase 3] ASSEMBLE → assemble-language.mjs", flush=True)
    r = subprocess.run(["node", str(SKILL / "scripts" / "assemble-language.mjs"), str(OUT)], capture_output=True, text=True)
    print("  " + (r.stdout or r.stderr).strip()[-300:], flush=True)
    return r.returncode == 0


def assemble_gate():
    """Deterministic gate on the built lesson.html (never fatal — logs + NEEDS_REVIEW)."""
    lh = OUT / "lesson.html"
    if not lh.exists():
        return
    html = lh.read_text()
    fails = []
    up_href = len(re.findall(r'href="\.\./', html))
    up_src = len(re.findall(r'src="\.\./', html))
    if up_href: fails.append(f"{up_href} up-tree href=\"../\" (assets must be local siblings)")
    if up_src: fails.append(f"{up_src} up-tree src=\"../\" (assets must be local siblings)")
    n_em = html.count("<em>")
    if n_em < 40:
        fails.append(f"only {n_em} <em> in lesson.html (need >=40 — lesson is too plain)")
    ids = re.findall(r'id="(pearl-[^"]+|vocab-[^"]+)"', html)
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        fails.append(f"duplicate audio-anchor ids (break audio): {dups[:8]}")
    if fails:
        (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
        (OUT / ".scratch" / "assemble-gate.json").write_text(json.dumps(fails, ensure_ascii=False, indent=2))
        (OUT / "lesson.NEEDS_REVIEW").write_text("assemble-gate failures:\n" + "\n".join(fails))
        print(f"[phase 3] GATE: {len(fails)} issue(s) → .scratch/assemble-gate.json + lesson.NEEDS_REVIEW: {fails}", flush=True)
    else:
        print(f"[phase 3] GATE: PASS ({n_em} <em>, no up-tree assets, unique anchors)", flush=True)


# ── Phase 4/5 — AUDIO (04s bilingual lecture + inline clips from HTML) + BAKE ──────
def load_prompt(name): return (SKILL / "prompts" / name).read_text()
def fill(t, **slots):
    for k, v in slots.items(): t = t.replace("{{" + k + "}}", v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
    return t
def _strip(h): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h or "")).strip()
def _sections_for_04s(content):
    secs = []
    for s in content.get("sections", []):
        parts = [_strip(s.get("introHtml", ""))]
        parts += [f"{v.get('it','')} — {v.get('en','')}" for v in s.get("vocab", [])]
        parts += [_strip(p.get("it", "")) + " " + p.get("en", "") for p in s.get("pearls", [])]
        if s.get("dialogue"): parts += [t.get("text", "") for t in s["dialogue"].get("turns", [])]
        parts += [st.get("it", "") + " " + st.get("en", "") for st in s.get("stories", [])]
        secs.append({"id": s["id"], "title": s.get("title", ""), "contentText": " ".join(parts)[:3000]})
    return secs
async def phase4_audio_scripts():
    content = json.loads((OUT / "content.json").read_text())
    secs = _sections_for_04s(content)
    p = fill(load_prompt("04s-lecture-script.md"), lessonTitle=content.get("title", SLUG),
             domain="language-it", sections=secs, granularity="all")
    p += ("\n\n## LEARNER + PODCAST (BLOCKING): native English speaker; audio is a PODCAST. English is the medium; "
          "every Italian term is its OWN lang:'it' segment and the NEXT lang:'en' glosses it. Persona Lucrezia: greet "
          "'Gyasi' by name in the summary, sign off warmly. Return ONLY {\"artifacts\":[...]}.")
    print(f"[phase 4] AUDIO transcripts — 04s bilingual ({len(secs)} sections)…", flush=True)
    res = await json_with_repair(p, "lecture-scripts", model_for(MODEL_REASON),
                                 validate_fn=lambda o: None if (isinstance(o, dict) and o.get("artifacts")) else ["no artifacts"])
    out = {"summary": [], "sections": {}}
    for a in (res or {}).get("artifacts", []):
        k, segs = a.get("kind"), a.get("segments", [])
        if k == "summary": out["summary"] = segs
        elif k == "shortened": out["shortened"] = segs
        elif k == "section" and a.get("sectionId"): out["sections"][a["sectionId"]] = segs
    (OUT / "audio-scripts.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"[phase 4] audio-scripts.json: summary={len(out['summary'])} shortened={'yes' if out.get('shortened') else 'no'} "
          f"sections={list(out['sections'])} (inline vocab/dialogue/pearl/story clips bake from the HTML)", flush=True)
def bake():
    print("[phase 5] BAKE → Atelier OmniVoice (Mac), Lucrezia, language-it …", flush=True)
    r = subprocess.run(["node", str(SKILL / "scripts" / "bake-lesson-audio.mjs"), str(OUT),
                        "--domain", "language-it", "--persona", "lucrezia"], capture_output=True, text=True, timeout=2400)
    print("  " + ((r.stdout or "") + (r.stderr or "")).strip()[-300:], flush=True)


# ── orchestrate ───────────────────────────────────────────────────────────────────
async def main():
    assert OLLAMA_KEY, "OLLAMA_API_KEY not set"
    assert TOPIC, "CH_TOPIC not set (e.g. CH_TOPIC='how to use the word appunto')"
    obs.set_out(OUT)
    print(f"=== chiron PURE-ITALIAN chain (7-phase) | topic='{TOPIC}' stage={STAGE} author-ladder={'->'.join(AUTHOR_LADDER)} -> {OUT}")

    # Phase 0 / 0.5 — style pack (loaded at import) + library dedup
    avoid = library_dedup()

    # RESUME shortcut: content.json already exists and we're past authoring → reuse it.
    if (OUT / "content.json").exists() and os.environ.get("CH_FORCE") != "1" and STAGE != "author":
        print("[phase 2] RESUME — reusing content.json", flush=True)
    else:
        obs.phase("Planning the lesson", "start")
        syllabus = await phase1_plan(avoid)                    # Phase 1 — PLAN
        obs.phase("Planning the lesson", "end")

        obs.phase("Writing the lesson content", "start")
        await phase2_sections(syllabus, avoid)                 # Phase 2 — per-section author loop
        await phase2b_extras(syllabus, avoid)                  # Phase 2b — coldOpen + matchMadness + scenario + srCards + closing
        obs.phase("Writing the lesson content", "end")

        obs.phase("Reviewing the lesson", "start")
        content = await phase25_qc(syllabus, avoid)            # Phase 2.5 — whole-lesson QC (fail-open)
        phase27_balance(content)                               # Phase 2.7 — balance (deterministic)
        obs.phase("Reviewing the lesson", "end")

    if STAGE in ("assemble", "audio", "all"):
        obs.phase("Assembling the page", "start")
        ok = assemble()                                        # Phase 3 — assemble
        assemble_gate()                                        # Phase 3 — deterministic gate (never fatal)
        obs.phase("Assembling the page", "end")
        if not ok: print("=== assemble failed"); return
    if STAGE in ("audio", "all"):
        obs.phase("Writing narration scripts", "start")
        await phase4_audio_scripts()                           # Phase 4 — audio scripts
        obs.phase("Writing narration scripts", "end")
        if STAGE == "all" or os.environ.get("CH_BAKE") == "1":
            obs.phase("Baking audio", "start")
            bake()                                             # Phase 5 — bake
            obs.phase("Baking audio", "end")
        else:
            print("[phase 5] BAKE skipped — CH_STAGE=all or CH_BAKE=1 to bake.", flush=True)
    if (OUT / "lesson.html").exists():
        print(f"=== done → {OUT}/lesson.html")
    else:
        print(f"=== authored content.json (no lesson.html — run CH_STAGE=assemble to build it) → {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
