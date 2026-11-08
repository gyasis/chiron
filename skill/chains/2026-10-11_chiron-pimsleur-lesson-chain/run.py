#!/usr/bin/env python3
"""chiron PIMSLEUR lesson chain — one request ("Pimsleur lessons on X") -> a season of drill lessons.

Each lesson is a normal Chiron lesson dir with TWO faces rendered from ONE item bank (pimsleur.json):
  * a SHORT read card (lesson.html: pattern table, the lesson's phrases, one pearl, in-lesson Match Madness + SR)
  * the Pimsleur drill MP3, first in the lesson's own player (mobile ⛶ full-screen) — scripts/pimsleur_drill.py
and the same items feed Anki (scripts/pimsleur_to_anki.py) and Match Madness (in-lesson widget; Ordine app set).

WHY ITS OWN CHAIN (FSI precedent)
---------------------------------
The pure-italian chain authors a rich 8-section READING lesson. A Pimsleur lesson is the opposite shape: a handful
of SPEAKABLE items whose ORDER and TIMING are the method. Models only author content here; the running order,
pause lengths and loudness are deterministic (pimsleur_drill.py) — those were exactly where the 2026-10-10
prototype had its bugs. Model plumbing (ladder, JSON repair, fallbacks, observability) is borrowed from the
pure-italian chain, not copied.

PIPELINE
--------
  P0a CHECK    (LLM, CHECKERS)       a learner phrase list in CH_SOURCE is checked (Italian, translation, one English
                                     word per Italian word) and the season is built from the corrected list
  P0  PLAN     (LLM, PLANNERS)       topic (+ optional source) -> season.json: N lessons, targets, pattern; every
                                     given learner phrase must be a target, each target in one lesson (checked in code)
  P0b CHECK    (LLM, CHECKERS)       the planner's own supporting sentences are checked and corrected
  P1  AUTHOR   (LLM, WRITERS)        per lesson -> pimsleur.json items; validated by pimsleur_drill.validate + rules;
                                     thinking off, output capped (MAX_OUT), a reply that reasons before its JSON is refused
  P1b REVIEW   (LLM, CHECKERS)       every checker reviews the Italian; their issues are combined -> one re-author round
  P1c RECYCLE  (fn)                  2 items of the previous lesson become this lesson's `review` (graduated recall)
  P3  CARD     (LLM small + assemble-language.mjs) pattern table + pearl -> content.json -> lesson.html
  P4  BAKE     (fn)                  pimsleur_drill.py build --qc  (per-clip ASR, auto re-synth)
  P5  LISTEN   (Gemini)              pimsleur_drill.py listen      (whole-file review -> audio/pimsleur.listen.md);
                                    a FIX whose complaints are all timestamped clip glitches is re-measured
                                    (strict ASR + fade-out) and overruled only if every flagged clip is clean
  P6  EXPORT   (fn)                  Anki (if reachable). Match Madness: every read card carries the in-lesson
                                    widget built from the same items; the phone app's `ordine` flavour is fed by
                                    match-madness/ingest/pimsleur.mjs, which is Ordine-specific (it writes
                                    data/ordine-pimsleur.json) — so the chain never calls it for other seasons.
  P7  REPORT   (fn)                  run_report.py: time per stage + cost (Modal billing, Gemini tokens x price
                                    table, Ollama logged tokens) -> <topic-slug>.run-report.{md,json}.
                                    CH_STAGE=report re-prices a finished run (Modal's last hour keeps accruing).

USAGE
-----
  CH_TOPIC="common irregular verbs in the passato prossimo and futuro" CH_STAGE=all python3 run.py
  Env: CHIRON_PIMSLEUR_ENGINE=modal bakes on the chiron-bake Modal lane instead of the Mac.
  Env: CH_TARGETS=given -> the planner must use the phrases listed in CH_SOURCE as the lesson targets (server/pimsleur_jobs.py sets it)
  Env: CH_TOPIC (required) · CH_LESSONS (default: planner decides, 3-6) · CH_DOMAIN (language-it|medical-italian)
       CH_SOURCE (file or dir of .md/.txt/.json to ground in; e.g. a study pack) · CH_STAGE (plan|author|card|bake|
       listen|export|report|all; comma list ok) · CH_FORCE=1 (re-author) · plus the pure-italian chain's model env vars.
Outputs: ~/Documents/generated/chiron-pimsleur-<topic-slug>-<NN>-<lesson-slug>/ (one dir per lesson, Library-visible)
         ~/Documents/generated/chiron-pimsleur-<topic-slug>.season.json  (+ .run-report.md / .run-report.json)
"""
from __future__ import annotations

import asyncio, datetime, importlib.util, json, os, re, subprocess, sys, time
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)

HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
GEN = HOME / "Documents/generated"
TOPIC = os.environ.get("CH_TOPIC", "").strip()
if not TOPIC:
    sys.exit("[pimsleur] CH_TOPIC is required, e.g. CH_TOPIC='irregular verbs in the passato prossimo'")
STAGES = set((os.environ.get("CH_STAGE", "all")).split(","))
DOMAIN = os.environ.get("CH_DOMAIN", "language-it")
N_LESSONS = int(os.environ.get("CH_LESSONS", "0"))
FORCE = os.environ.get("CH_FORCE") == "1"
FORMAT = os.environ.get("CH_FORMAT", "drill")   # drill | exam (commission questions asked in Italian)
# Library tags stamped on every lesson of the season (chiron.json "labels"); "Pimsleur" is added by the
# library builder itself. CH_LABELS="Ordine exam,…" — an exam season is the Ordine test by construction.
LABELS = [t.strip() for t in os.environ.get("CH_LABELS", "Ordine exam" if FORMAT == "exam" else "").split(",") if t.strip()]
def _clip_slug(base: str, limit: int = 40) -> str:      # same rule as dispatch.clip_slug: cut at a hyphen, not mid-word
    if len(base) <= limit:
        return base
    cut = base[:limit]
    if base[limit] != "-" and "-" in cut:
        cut = cut.rsplit("-", 1)[0]
    return cut.strip("-")


TOPIC_SLUG = os.environ.get("CH_SLUG", "").removeprefix("chiron-pimsleur-") or _clip_slug(re.sub(r"[^a-z0-9]+", "-", TOPIC.lower()).strip("-"))
SEASON_FILE = GEN / f"chiron-pimsleur-{TOPIC_SLUG}.season.json"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Borrow the model plumbing. The pure-italian chain derives OUT from CH_TOPIC at import; we repoint it per lesson.
os.environ.setdefault("CH_TOPIC", TOPIC)
pi = _load("pure_italian_chain", SKILL / "chains" / "2026-06-30_chiron-pure-italian-lesson-chain" / "run.py")
pd = _load("pimsleur_drill", SKILL / "scripts" / "pimsleur_drill.py")
rr = _load("run_report", Path(__file__).parent / "run_report.py")


def stage(name: str) -> bool:
    return "all" in STAGES or name in STAGES


def point_at(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    pi.OUT = out
    try: pi.obs.set_out(out)
    except Exception: pass


def source_block() -> str:
    """CH_SOURCE grounding (a file or a dir of text files), passed whole. Empty when the topic is general grammar."""
    p = os.environ.get("CH_SOURCE")
    if not p:
        return ""
    p = Path(os.path.expanduser(p))
    files = [p] if p.is_file() else sorted(f for f in p.rglob("*") if f.suffix in (".md", ".txt", ".json"))
    text = "\n\n".join(f"### {f.name}\n{f.read_text(errors='ignore')}" for f in files)
    text = re.sub(r"<[^>]+>", " ", text)
    print(f"[source] CH_SOURCE passed in full: {len(text)} chars from {len(files)} file(s)", flush=True)
    return f"\n## SOURCE — ground every Italian line in this; do not invent facts it does not support\n{text}\n"


SRC = source_block()

# Lesson writing and both checks run on models whose thinking is switched OFF (verified per lane by
# chiron_models.thinking_off). glm-5.3 is not used: it cannot switch thinking off and moves its reasoning into the answer.
WRITERS = [m.strip() for m in os.environ.get("CH_PIMSLEUR_WRITERS", "gemma4:31b,deepseek-flash@latest").split(",") if m.strip()]
PLANNERS = [m.strip() for m in os.environ.get("CH_PIMSLEUR_PLANNERS", ",".join(WRITERS)).split(",") if m.strip()]
CHECKERS = [m.strip() for m in os.environ.get("CH_PIMSLEUR_CHECKERS", "deepseek-flash@latest,gemma4:31b").split(",") if m.strip()]
# The largest lesson answer across 38 real Pimsleur lessons was 7,764 characters, about 2,400 tokens (measured
# 2026-11-08 over ~/Documents/generated/chiron-pimsleur-*/pimsleur.json). 6,000 leaves 2.5x room; a reply that
# reaches it is cut off and fails validation, so a runaway answer costs about a minute, not ten.
MAX_OUT = int(os.environ.get("CH_PIMSLEUR_MAX_TOKENS", "6000"))
LEAK_CHARS = 300          # prose this long before the JSON is reasoning written into the answer


def quiet_model(name: str, temperature: float = 0.4) -> dict:
    """A model_dict with thinking switched off and the output capped."""
    md = pi.chiron_models.thinking_off(pi.model_for(name, temperature))
    md = {**md, "params": {**md["params"], "max_tokens": MAX_OUT}}
    return md


def leaked_reasoning(text: str) -> bool:
    """True when the reply opens with prose instead of the JSON: the model reasoned in the answer."""
    t = re.sub(r"^```(?:json)?\s*", "", (text or "").strip())
    i = min([k for k in (t.find("{"), t.find("[")) if k >= 0], default=len(t))
    return i > LEAK_CHARS


async def ask_json(prompt: str, name: str, names: list[str], validate=None, temperature: float = 0.4):
    """One JSON answer from the first model in `names` that gives a valid one. The first model is re-asked twice
    with the problems, each later model once. A reply with reasoning before its JSON is refused. None when every
    model fails; each failure is logged with its reason."""
    for k, mname in enumerate(names):
        md, cur = quiet_model(mname, temperature), prompt
        for attempt in range(1, (3 if k == 0 else 1) + 1):
            t0 = time.time()
            try:
                raw = await pi.llm(md, cur)
            except Exception as e:
                print(f"[ask] {name} [{mname}] {attempt}: call failed ({type(e).__name__}: {str(e)[:200]})", flush=True)
                continue
            secs = time.time() - t0
            if leaked_reasoning(raw):
                print(f"[ask] {name} [{mname}] {attempt}: {secs:.0f} s, reasoning written into the answer — refused", flush=True)
                cur = prompt + "\n\nReply with ONLY the JSON object. No analysis, no notes, nothing before or after it."
                continue
            try:
                obj = pi.extract_json(raw)
            except Exception as e:
                print(f"[ask] {name} [{mname}] {attempt}: {secs:.0f} s, not JSON ({e})", flush=True)
                cur = prompt + f"\n\n## PREVIOUS REPLY WAS NOT VALID JSON\n{e}\nReturn ONLY corrected valid JSON."
                continue
            iss = validate(obj) if validate else []
            if iss:
                print(f"[ask] {name} [{mname}] {attempt}: {secs:.0f} s, invalid {iss[:3]}", flush=True)
                cur = prompt + f"\n\n## PROBLEMS\n{iss}\nReturn ONLY corrected valid JSON that fixes every problem above."
                continue
            print(f"[ask] {name} [{mname}]: ok in {secs:.0f} s", flush=True)
            return obj
    return None


async def check_all(prompt: str, name: str) -> list | None:
    """Every checker answers the same prompt at once; their issues are combined. Each checker misses different
    things, so the union is the check. None when no checker answered."""
    valid = lambda o: [] if isinstance(o, dict) and isinstance(o.get("issues"), list) else ['return {"issues": [...]}']
    outs = await asyncio.gather(*[ask_json(prompt, f"{name}:{c}", [c], valid, 0.1) for c in CHECKERS])
    got = [o["issues"] for o in outs if o]
    if not got:
        return None
    for c, o in zip(CHECKERS, outs):
        print(f"[check] {name} [{c}]: " + ("no answer" if not o else f"{len(o['issues'])} issue(s)"), flush=True)
    return [dict(i, by=c) for c, o in zip(CHECKERS, outs) if o for i in o["issues"] if isinstance(i, dict)]


GIVEN: list[str] = []      # the learner's (checked) phrases when CH_SOURCE is a phrase list


# ── P0a SOURCE CHECK: the learner's own phrases are checked before anything is built from them ──────────
def source_targets() -> tuple[Path, dict] | None:
    """The CH_SOURCE file when it is a phrase list ({"targets": [{it, en}]}), else None."""
    p = os.environ.get("CH_SOURCE")
    if not p or not Path(p).is_file():
        return None
    try:
        d = json.loads(Path(p).read_text())
    except ValueError:
        return None
    return (Path(p), d) if isinstance(d, dict) and isinstance(d.get("targets"), list) and d["targets"] else None


def apply_source_fixes(targets: list[dict], issues: list[dict]) -> tuple[list[dict], list[str]]:
    """Corrected copies of the targets and one log line per change. Where several checkers fix the same pair, the
    first checker's fix is applied and the others are logged."""
    out, notes, done = [dict(t) for t in targets], [], set()
    for i in issues:
        n = i.get("n")
        if not isinstance(n, int) or not 1 <= n <= len(out):
            continue
        t = out[n - 1]
        new_it, new_en = str(i.get("fix_it") or t["it"]).strip(), str(i.get("fix_en") or t["en"]).strip()
        if (new_it, new_en) == (t["it"], t["en"]):
            continue
        if n in done:
            notes.append(f"pair {n}: also suggested by {i.get('by')}: {new_it} | {new_en} — {i.get('problem')}")
            continue
        notes.append(f"pair {n}: {t['it']} | {t['en']}  ->  {new_it} | {new_en}  ({i.get('by')}: {i.get('problem')})")
        t["it"], t["en"] = new_it, new_en
        done.add(n)
    return out, notes


async def p0a_source_check() -> None:
    """Checks the learner's phrases (Italian, translation, one English word per Italian word) and builds the season
    from the corrected list. The changes are written next to the plan and logged."""
    global SRC, GIVEN
    src = source_targets()
    if not src:
        return
    path, d = src
    plan_dir = GEN / f"chiron-pimsleur-{TOPIC_SLUG}-plan"
    done = plan_dir / "source.checked.json"
    if done.exists() and not FORCE:
        d = json.loads(done.read_text())
        print(f"[P0a] resume {done.name}")
    else:
        pairs = [{"n": k + 1, "it": t.get("it"), "en": t.get("en")} for k, t in enumerate(d["targets"])]
        prompt = f"""You are a native Italian editor who has worked in Italian hospitals. A learner (a doctor) collected these
phrase pairs and will drill them aloud, so every error will be memorised.
Check EACH pair: (1) is `it` correct standard Italian (grammar, agreement, irregular plurals, articles, prepositions)?
(2) does `en` translate `it` exactly, and does each Italian word get the SAME correct English in every pair (one
Italian word is never two different English words, two different things are never one Italian word)? (3) is it what
people in Italy would really say in that setting? Report ONLY real errors, never style preferences.
Reference (Italian hospital usage): il camice / i camici = the (white) coat, lab coat; la divisa or la casacca = scrubs,
uniform; il pigiama chirurgico = surgical scrubs; il lenzuolo, le lenzuola = the sheet, the sheets (bed linen).
`fix_en` is the plain English a narrator reads aloud: one meaning, no parentheses, no slashes, no alternatives.
When a pair's English names the wrong thing for its Italian word, correct the English; keep the learner's Italian
unless the Italian itself is wrong.
PAIRS:
{json.dumps(pairs, ensure_ascii=False, indent=1)}
Return ONLY JSON: {{"issues": [{{"n": <pair number>, "problem": "...", "fix_it": "<corrected Italian>", "fix_en": "<corrected English>"}}]}}"""
        issues = await check_all(prompt, "source")
        if issues is None:
            print("[P0a] no checker answered — the phrases are used as given", flush=True)
            return
        d = dict(d)
        d["targets"], notes = apply_source_fixes(d["targets"], issues)
        plan_dir.mkdir(parents=True, exist_ok=True)
        done.write_text(json.dumps({**d, "_checked": notes}, ensure_ascii=False, indent=1))
        print(f"[P0a] {len(notes)} change(s) to the learner's phrases" + ("" if notes else " — all correct"), flush=True)
        for line in notes:
            print(f"[P0a]   {line}", flush=True)
    GIVEN = [str(t.get("it") or "").strip() for t in d["targets"] if str(t.get("it") or "").strip()]
    body = json.dumps({k: v for k, v in d.items() if k != "_checked"}, ensure_ascii=False, indent=1)
    SRC = f"\n## SOURCE — ground every Italian line in this; do not invent facts it does not support\n### {path.name} (checked)\n{body}\n"

ITEM_RULES = """
ITEM RULES (a drill item is something the learner must SAY aloud, from an English cue):
- `it`: correct, natural, spoken Italian; 2-9 words for phrase/question. Formal "Lei" unless the topic is casual.
- `en`: natural English the narrator reads as the cue — never a single word, never containing Italian words.
- `kind`: "phrase" | "question" (en ends with "?") | "talk" (exactly ONE, LAST: `en` = an English prompt ending
  "...Go." asking for 20-30 s of speech on the lesson's core idea; `it` = a 1-2 sentence model answer that uses ONLY
  vocabulary taught in this lesson or earlier ones; `secs` = 25).
- `build` (back-chaining) on every phrase/question of 3+ words: pieces SHORTEST FIRST, each a word-level SUFFIX of
  `it` (the END of the phrase), never the full phrase. "Ieri ho fatto la spesa." -> ["la spesa", "fatto la spesa"].
- `id`: short snake_case, unique across the season.
- No item may repeat one taught in an earlier lesson (listed below): every item is a new sentence.
- Translate each Italian word exactly as the SOURCE does, the same way in every item. One Italian word never gets two
  different English words.
- A "question" is a real question a person asks. Its `en` starts with a question word or an auxiliary verb ("Where
  are...?", "Can you...?", "Is the...?", "Do we...?"); its `it` is a full sentence with a conjugated verb ("Dove sono
  gli asciugamani puliti?", "Può portare i camici in lavanderia?", "La lavatrice è libera?"). An instruction with a
  "?" added is NOT a question ("Lavare la biancheria a 90 gradi?" / "Wash the laundry at 90 degrees?").
  "Deve...?" is "Do you have to...?" in English, never "Must you...?".
- Every sentence is true and useful in the lesson's real setting. Never add the negative of another item to fill a slot.
- The talk item's `en` task asks about the same situation and things its model answer `it` talks about.
"""

EXAM_RULES = """
EXAM ITEMS (CH_FORMAT=exam — the learner is rehearsing the Ordine dei Medici oral/written language test):
- kind "exam": `q` = the question an examiner on the commission would ask, in natural formal Italian (Lei);
  `en` = English GUIDANCE on what a good answer must contain (not a translation), 8-30 words, no Italian words;
  `it` = a model answer the learner can actually say: 1-3 short sentences, 8-40 words, built from this lesson's
  phrase items (teach those phrases FIRST, as normal phrase items). No `build` on exam items.
- Facts in `q`/`it` (laws, Codice articles, procedures, doses) must be supported by the SOURCE — never invented.
"""


# ── P0 PLAN ────────────────────────────────────────────────────────────────────────────────────────────
def plan_valid(o) -> list:
    """Problems in a season plan. A target repeated in a later lesson is removed in place (it stays in the first)."""
    iss = []
    ls = o.get("lessons") if isinstance(o, dict) else None
    if not isinstance(ls, list) or not ls:
        return ["lessons: missing or empty"]
    seen = set()
    for l in ls:
        if isinstance(l, dict) and isinstance(l.get("targets"), list):
            keep = [t for t in l["targets"] if _fold(str(t)) not in seen]
            seen |= {_fold(str(t)) for t in keep}
            l["targets"] = keep
    if N_LESSONS and len(ls) != N_LESSONS:
        iss.append(f"need exactly {N_LESSONS} lessons, got {len(ls)}")
    if not N_LESSONS and not 2 <= len(ls) <= 8:
        iss.append(f"need 2-8 lessons, got {len(ls)}")
    for i, l in enumerate(ls):
        for k in ("title", "titleIt", "focus", "pattern"):
            if not str(l.get(k, "")).strip():
                iss.append(f"lessons[{i}].{k} missing")
        t = l.get("targets")
        if not isinstance(t, list) or not 3 <= len(t) <= 8:
            iss.append(f"lessons[{i}].targets: need 3-8 different targets, got {len(t) if isinstance(t, list) else 0}")
    for k in ("title", "album"):
        if not str(o.get(k, "")).strip():
            iss.append(f"{k} missing")
    if os.environ.get("CH_TARGETS") == "given" and GIVEN:
        planned = seen
        missing = [g for g in GIVEN if _fold(g) not in planned]
        if missing:
            iss.append(f"these SOURCE phrases are not a target of any lesson; use each one exactly: {missing}")
    return iss


GIVEN_TARGETS = ("\nThe SOURCE lists TARGET PHRASES the learner chose. Use EXACTLY those phrases as the lessons' targets: spread them "
                 "across the lessons from easiest to hardest, keep their wording and their Lei/tu form, and add supporting "
                 "sentences only where a lesson would otherwise have fewer than 5 targets. Never replace or rewrite a given phrase.\n"
                 if os.environ.get("CH_TARGETS") == "given" else "")


async def p0_plan() -> dict:
    if SEASON_FILE.exists() and not FORCE:
        print(f"[P0] resume {SEASON_FILE.name}")
        return json.loads(SEASON_FILE.read_text())
    point_at(GEN / f"chiron-pimsleur-{TOPIC_SLUG}-plan")
    count = f"exactly {N_LESSONS}" if N_LESSONS else "3 to 6 (as many as the topic genuinely needs)"
    prompt = f"""You are planning a PIMSLEUR-METHOD audio season for an English-speaking learner of Italian (a doctor).
Pimsleur: short audio lessons; each introduces a few speakable items, recalls them at growing intervals, and
recycles earlier lessons. Grammar is absorbed from whole sentences, never lectured.

TOPIC: {TOPIC}
{SRC}{GIVEN_TARGETS}
Plan {count} lessons, ordered easiest -> hardest, each building on the previous. For each lesson give 5-7 TARGETS:
the concrete Italian phrases/sentences (or exact forms) it must make the learner able to SAY. Each target appears
in ONE lesson only. Prefer high-frequency,
useful sentences over isolated forms. `pattern` = the one grammatical pattern the lesson's table will show
(e.g. "fare -> ho fatto, dire -> ho detto: irregular participles with avere").

Return ONLY JSON:
{{"title": "<English season title>", "titleIt": "<Italian>", "album": "Chiron Pimsleur · <short Italian name>",
  "lessons": [{{"title": "...", "titleIt": "...", "focus": "<one sentence>", "pattern": "...",
               "targets": ["<Italian>", "..."]}}]}}"""
    o = await ask_json(prompt, "pimsleur-plan", PLANNERS, plan_valid)
    if not o:
        sys.exit(f"[P0] planner failed on every model ({', '.join(PLANNERS)}) — see the [ask] lines above")
    await p0b_check_added(o)
    SEASON_FILE.write_text(json.dumps(o, ensure_ascii=False, indent=1))
    print(f"[P0] {len(o['lessons'])} lessons -> {SEASON_FILE.name}")
    return o


async def p0b_check_added(season: dict) -> None:
    """Targets the planner wrote itself (not the learner's checked phrases) are checked for errors and corrected in
    place. Fail-open: with no checker answer the plan is kept."""
    given = {_fold(g) for g in GIVEN}
    added = [(l, k) for l in season["lessons"] for k, t in enumerate(l["targets"]) if _fold(str(t)) not in given]
    if not added:
        return
    lines = [{"n": i + 1, "it": l["targets"][k]} for i, (l, k) in enumerate(added)]
    prompt = f"""You are a native Italian editor. A course will teach these Italian sentences aloud; every error will be memorised.
Report ONLY sentences with a real error (grammar, agreement, articles, irregular plurals, prepositions, a word that
does not exist, something no Italian would say). Not style preferences.
SENTENCES:
{json.dumps(lines, ensure_ascii=False, indent=1)}
Return ONLY JSON: {{"issues": [{{"n": <number>, "problem": "...", "fix_it": "<corrected Italian>"}}]}}"""
    issues = await check_all(prompt, "plan-added")
    if issues is None:
        print("[P0b] no checker answered — the planner's sentences are kept", flush=True)
        return
    done = set()
    for i in issues:
        n, fix = i.get("n"), str(i.get("fix_it") or "").strip()
        if not isinstance(n, int) or not 1 <= n <= len(added) or not fix or n in done:
            continue
        l, k = added[n - 1]
        print(f"[P0b] {l['targets'][k]!r} -> {fix!r} ({i.get('by')}: {i.get('problem')})", flush=True)
        l["targets"][k] = fix
        done.add(n)
    print(f"[P0b] {len(added)} planner sentence(s) checked, {len(done)} corrected", flush=True)


def lesson_dir(n: int, l: dict) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", l["title"].lower()).strip("-")[:32]
    return GEN / f"chiron-pimsleur-{TOPIC_SLUG}-{n:02d}-{slug}"


# ── P1 AUTHOR + REVIEW + RECYCLE ───────────────────────────────────────────────────────────────────────
def _fold(t: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", t.lower()).split())


EN_QUESTION = re.compile(r"^((at|in|on|for|to|from|with|by|of|about)\s+)?(is|are|was|were|do|does|did|can|could|will|would|shall|should|may|might|must|have|has|"
                         r"had|where|what|when|why|how|who|whom|whose|which)\b", re.I)
IT_INFINITIVE = re.compile(r"^\w{2,}(are|ere|ire)$", re.I)


def item_shape_issues(items: list) -> list:
    """Checks a model cannot be trusted with: a "question" that is an instruction with "?" added, and an item that is
    only the negative of another item."""
    iss, plain = [], {}
    for it in items:
        if it.get("kind") in ("phrase", "question"):
            plain[it.get("id")] = _fold(it.get("it") or "")
    for it in items:
        k, iid = it.get("kind"), it.get("id")
        if k == "question":
            en = (it.get("en") or "").strip().strip('"\'')
            first = (pd._words(it.get("it") or "") or [""])[0]
            if not en.endswith("?") or not EN_QUESTION.match(en):
                iss.append(f"{iid}: `en` {en!r} is not a real English question (start with Where/What/Can/Is/Do...)")
            if re.match(r"^must (i|you|we|he|she|they)\b", en, re.I):
                iss.append(f"{iid}: `en` {en!r}: say \"Do you have to...?\", not \"Must you...?\"")
            if IT_INFINITIVE.match(first):
                iss.append(f"{iid}: `it` starts with the infinitive {first!r}; a question needs a conjugated verb")
        if k not in ("phrase", "question"):
            continue
        mine = plain[iid]
        bare = " ".join(w for w in mine.split() if w != "non")
        for oid, other in plain.items():
            if oid == iid:
                continue
            if bare != mine and bare == other:
                iss.append(f"{iid}: is only the negative of {oid}; write a different, useful sentence")
    return iss


def bank_valid_for(prev_items: list):
    """bank_valid plus: the intro is a list of sentences, and no item repeats one from an earlier lesson."""
    taught = {_fold(i.get("it") or "") for i in prev_items if i.get("kind") != "talk"}

    def validate(o) -> list:
        if isinstance(o, dict) and isinstance(o.get("intro"), str):       # one sentence given as a bare string
            o["intro"] = [o["intro"]]
        iss = bank_valid(o)
        if not isinstance(o, dict):
            return iss
        iss += item_shape_issues(o.get("items") or [])
        intro = o.get("intro")
        if not isinstance(intro, list) or not all(isinstance(x, str) and x.strip() for x in intro):
            iss.append("`intro` must be a list of English sentences")
        for it in o.get("items") or []:
            if it.get("kind") != "talk" and _fold(it.get("it") or "") in taught:
                iss.append(f"{it.get('id')}: repeats an item taught in an earlier lesson ({it.get('it')!r}); write a new sentence")
        return iss
    return validate


def bank_valid(o) -> list:
    if not isinstance(o, dict) or not isinstance(o.get("items"), list):
        return ["return an object with an `items` list"]
    items = o["items"]
    iss = pd.validate({"items": items})
    talks = [i for i, it in enumerate(items) if it.get("kind") == "talk"]
    if not 8 <= len(items) <= 9:
        iss.append(f"need 8-9 items (incl. the talk item), got {len(items)}")
    if talks != [len(items) - 1]:
        iss.append("exactly ONE talk item, and it must be LAST")
    exams = [it for it in items if it.get("kind") == "exam"]
    if FORMAT == "exam" and not 2 <= len(exams) <= 3:
        iss.append(f"exam format: need 2-3 exam items, got {len(exams)}")
    if FORMAT != "exam" and exams:
        iss.append("exam items are only for CH_FORMAT=exam")
    for it in items:
        if it.get("kind") == "talk":
            it.setdefault("secs", 25)
            continue
        if it.get("kind") == "exam":
            n = len(pd._words(it.get("it", "")))
            if not 8 <= n <= 40:
                iss.append(f"{it.get('id')}: exam model answer has {n} words (8-40)")
            if not 8 <= len((it.get("en") or "").split()) <= 30:
                iss.append(f"{it.get('id')}: exam `en` guidance must be 8-30 words")
            continue
        n = len(pd._words(it.get("it", "")))
        if not 1 <= n <= 10:
            iss.append(f"{it.get('id')}: `it` has {n} words (1-10)")
        if len((it.get("en") or "").split()) < 2:
            iss.append(f"{it.get('id')}: `en` must be more than one word")
        if n >= 3 and not it.get("build"):
            iss.append(f"{it.get('id')}: 3+ words needs `build` pieces")
    return iss


def taught_block(prev_items: list) -> str:
    if not prev_items:
        return "(none — this is the first lesson)"
    return "\n".join(f"- {i['it']}  ({i['en']})" for i in prev_items if i.get("kind") != "talk")


async def review_italian(items: list) -> list | None:
    """A different model family checks every Italian line. Fail-OPEN: a broken judge never blocks the season."""
    prompt = f"""You are a native Italian editor checking lines a language course will teach to a learner.
For EACH item check: is `it` correct, natural spoken Italian (grammar, agreement, articles, clitics, participle
agreement with essere, formal Lei where addressed to someone)? Does `en` mean the same thing? (Not for kind "talk":
there `en` is the speaking TASK given to the learner and `it` a model answer — check only that `it` answers it.)
Ignore `build`: the code checks it. Only report REAL errors — not style preferences.
For kind "exam": `q` is the examiner's Italian question (check it), `en` is English guidance (not a translation),
`it` the model answer (check it answers `q`).
ALSO report any line that is FACTUALLY or CLINICALLY wrong — a dose or frequency a doctor would not prescribe,
a law, article or procedure stated wrongly or not supported by the SOURCE below. A learner will repeat it aloud.
Lines that are not in the SOURCE are expected: a lesson adds its own supporting sentences. Never report a line only
because the SOURCE does not contain it. DO report a "question" that is not a real question (an instruction with "?"
added), a sentence that is false or pointless in the setting, and a talk item whose model answer does not answer
its task.
{SRC}
ITEMS:
{json.dumps(items, ensure_ascii=False, indent=1)}
The SOURCE has already been checked: its Italian and its English for each word are correct. Never "correct" an item
back to something else.
Return ONLY JSON: {{"issues": [{{"id": "...", "problem": "...", "fix": "<corrected it or en>"}}]}} (empty list if none)."""
    issues = await check_all(prompt, "review")
    if issues is None:
        print("[P1b] review unavailable (no checker answered) — fail-open", flush=True)
    return issues


def lesson_targets(n: int, l: dict, prev_items: list, season: dict) -> tuple[list, list]:
    """This lesson's targets minus any already taught, and the targets of later lessons (which it must not use yet)."""
    taught = {_fold(i.get("it") or "") for i in prev_items if i.get("kind") != "talk"}
    mine = [t for t in l["targets"] if _fold(str(t)) not in taught]
    later = [t for x in season["lessons"][n:] for t in x.get("targets") or [] if _fold(str(t)) not in taught]
    return mine, later


async def p1_author(n: int, l: dict, out: Path, prev_items: list, season: dict) -> dict:
    bank_path = out / "pimsleur.json"
    if bank_path.exists() and not FORCE:
        print(f"[P1] resume {out.name}")
        return json.loads(bank_path.read_text())
    point_at(out)
    targets, later = lesson_targets(n, l, prev_items, season)
    prompt = f"""Write the item bank for ONE Pimsleur-method audio lesson (Italian for an English speaker, a doctor).
SEASON: {season['title']} — lesson {n} of {len(season['lessons'])}: {l['title']} ({l['titleIt']})
FOCUS: {l['focus']}
PATTERN: {l['pattern']}
TARGETS (the learner must be able to SAY these by the end): {json.dumps(targets, ensure_ascii=False)}
LATER LESSONS teach these — do not use them in this lesson: {json.dumps(later, ensure_ascii=False)}
ALREADY TAUGHT in earlier lessons:
{taught_block(prev_items)}
{SRC}
{ITEM_RULES}
{EXAM_RULES + "Write 3-5 phrase items (the building blocks of the answers), then 2-3 exam items, then the ONE talk item last." if FORMAT == "exam" else "Write 7-8 phrase/question items covering the targets, then the ONE talk item last (8-9 items in all)."}
Also write `intro`: ONE English sentence setting a scene for the lesson.
Return ONLY JSON: {{"intro": ["..."], "items": [{{"id": "...", "it": "...", "en": "...", "kind": "phrase", "build": ["..."]}}]}}"""
    valid = bank_valid_for(prev_items)
    o = await ask_json(prompt, f"pimsleur-l{n:02d}", WRITERS, valid, 0.45)
    if not o:
        sys.exit(f"[P1] lesson {n}: every model failed — see {out}/.scratch/")
    issues = await review_italian(o["items"])
    if issues:
        print(f"[P1b] lesson {n}: {len(issues)} Italian issue(s) -> one re-author round", flush=True)
        fixed = await ask_json(
            prompt + f"\n\n## PREVIOUS DRAFT\n{json.dumps(o, ensure_ascii=False)}\n\n## EDITOR'S CORRECTIONS — apply every one\n"
            + json.dumps(issues, ensure_ascii=False), f"pimsleur-l{n:02d}-fix", WRITERS, valid, 0.45)
        if fixed:
            # a talk item's `en` is the learner's TASK, never a translation — the fix round must not rewrite it
            task = {i["id"]: i["en"] for i in o["items"] if i.get("kind") == "talk"}
            for i in fixed["items"]:
                if i.get("kind") == "talk" and i["id"] in task:
                    i["en"] = task[i["id"]]
            o = fixed
        (out / "review.json").write_text(json.dumps({"issues": issues, "applied": bool(fixed)}, ensure_ascii=False, indent=1))
    elif issues is not None:
        print(f"[P1b] lesson {n}: Italian review clean", flush=True)
    # P1c RECYCLE (deterministic): two items of the previous lesson return as this lesson's review
    pool = [i for i in prev_items if i.get("kind") != "talk"][-8:]
    review = [pool[0], pool[len(pool) // 2]] if len(pool) >= 2 else pool
    bank = {"title": f"Pimsleur · {l['titleIt']}", "album": season["album"], "track": n,
            "intro": o.get("intro") or [], "items": o["items"], "review": review}
    errs = pd.validate(bank)
    if errs:
        sys.exit(f"[P1] lesson {n}: final bank invalid: {errs}")
    bank_path.write_text(json.dumps(bank, ensure_ascii=False, indent=1))
    print(f"[P1] {out.name}: {len(bank['items'])} items, {len(review)} review", flush=True)
    return bank


# ── P3 CARD ────────────────────────────────────────────────────────────────────────────────────────────
def card_valid(o) -> list:
    iss = []
    rows = (o.get("pattern") or {}).get("rows") if isinstance(o, dict) else None
    if not isinstance(rows, list) or not 3 <= len(rows) <= 12:
        iss.append("pattern.rows: need 3-12 {it, en} rows")
    for k in ("coldOpen", "pearl"):
        v = o.get(k) if isinstance(o, dict) else None
        if not isinstance(v, dict) or not v.get("it") or not v.get("en"):
            iss.append(f"{k}: need {{it, en}}")
    return iss


async def p3_card(n: int, l: dict, out: Path, bank: dict):
    if (out / "lesson.html").exists() and not FORCE:
        print(f"[P3] resume {out.name}")
        return
    point_at(out)
    prompt = f"""Write the SHORT read card that goes with a Pimsleur audio lesson (read in ~2 minutes).
LESSON: {l['title']} ({l['titleIt']}) — PATTERN: {l['pattern']}
ITEMS: {json.dumps([{'it': i['it'], 'en': i['en']} for i in bank['items'] if i.get('kind') != 'talk'], ensure_ascii=False)}
Return ONLY JSON:
{{"coldOpen": {{"it": "<one warm Italian sentence>", "en": "<English>"}},
  "pattern": {{"title": "<short Italian title>", "rows": [{{"it": "<form, e.g. fare → ho fatto>", "en": "<English>"}}]}},
  "pearl": {{"it": "<the ONE thing to remember, Italian, 1-2 sentences>", "en": "<English>"}}}}"""
    o = await ask_json(prompt, f"pimsleur-card-{n:02d}", WRITERS, card_valid)
    if not o:
        sys.exit(f"[P3] lesson {n}: card failed on every model")
    items = [i for i in bank["items"] if i.get("kind") != "talk"]
    content = {
        "title": l["titleIt"], "subtitle": f"Pimsleur · {l['title']} — ascolta il drill 🎧, poi leggi", "langName": "Italiano",
        "cefr": "A2-B1", "domain": DOMAIN, "coldOpen": o["coldOpen"],
        "sections": [
            {"id": "modello", "title": o["pattern"]["title"],
             "vocab": [{"slug": f"pat-{k}", "it": r["it"], "en": r["en"]} for k, r in enumerate(o["pattern"]["rows"])]},
            {"id": "frasi", "title": "Le frasi della lezione",
             "introHtml": "<p>Queste sono le frasi del drill audio. Ascoltalo prima (🎧 in alto), poi rileggile qui.</p>",
             "vocab": [{"slug": i["id"], "it": i["it"], "en": i["en"]} for i in items]},
            {"id": "ricorda", "title": "Da ricordare", "pearls": [{"slug": "ricorda", **o["pearl"]}]},
        ],
        "matchMadness": {"pairs": [{"a": i["it"], "b": i["en"]} for i in items]},
        "srCards": [{"front": i["en"], "back": i["it"], "tags": ["pimsleur"]} for i in items],
    }
    (out / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=1))
    (out / "chiron.json").write_text(json.dumps({
        "format": "chiron/1", "title": f"Chiron · {l['titleIt']}", "entry": "lesson.html", "domain": DOMAIN,
        "created": datetime.date.today().isoformat(), "generator": "chiron", "lessonFormat": "pimsleur",
        **({"labels": LABELS} if LABELS else {})}, indent=2))
    subprocess.run(["node", str(SKILL / "scripts" / "assemble-language.mjs"), str(out)], check=True)
    subprocess.run([sys.executable, str(SKILL / "scripts" / "upgrade_player_pimsleur.py"), str(out / "lesson.html")], check=True)
    print(f"[P3] {out.name}: lesson.html", flush=True)


# ── P4-P6 ──────────────────────────────────────────────────────────────────────────────────────────────
def p4_bake(out: Path):
    if (out / "audio" / "pimsleur.mp3").exists() and not FORCE:
        print(f"[P4] resume {out.name}")
        return
    r = subprocess.run([sys.executable, str(SKILL / "scripts" / "pimsleur_drill.py"), "build", str(out), "--qc"])
    if r.returncode == pd.QC_FAILED:
        print(f"[P4] {out.name}: QC left failing clips — see audio/pimsleur.timeline.json", flush=True)
    elif r.returncode:
        print(f"[P4] {out.name}: BAKE CRASHED (exit {r.returncode}) — no mp3; see the traceback above", flush=True)


def p5_listen(out: Path):
    if not (out / "audio" / "pimsleur.mp3").exists():
        print(f"[P5] {out.name}: skipped — no mp3 (the bake did not finish)", flush=True)
        return
    lm, mp3 = out / "audio" / "pimsleur.listen.md", out / "audio" / "pimsleur.mp3"
    if lm.exists() and lm.stat().st_mtime >= mp3.stat().st_mtime and not FORCE:
        print(f"[P5] resume {out.name} (review is newer than the mp3)", flush=True)
        return
    if not os.environ.get("GEMINI_API_KEY"):
        print("[P5] skipped: no GEMINI_API_KEY (run under `cred checkout gemini --exec`)", flush=True)
        return
    r = subprocess.run([sys.executable, str(SKILL / "scripts" / "pimsleur_drill.py"), "listen", str(out)],
                       capture_output=True, text=True)
    if not lm.exists() or lm.stat().st_mtime < mp3.stat().st_mtime:
        err = " | ".join((r.stderr or r.stdout or "no output").strip().splitlines()[-3:])[:400]
        print(f"[P5] {out.name}: listen check FAILED to run (exit {r.returncode}): {err} — the audio itself is not judged; "
              f"re-run: CH_STAGE=listen", flush=True)
        return
    rechecked = "re-checked" in (out / "audio" / "pimsleur.listen.md").read_text() if r.returncode == 0 else False
    verdict = ("PASS (Gemini flagged a glitch; every flagged clip measured clean — see listen.md)" if rechecked
               else "PASS" if r.returncode == 0 else "FIX — read audio/pimsleur.listen.md (auto re-check confirmed it or couldn't measure it)")
    print(f"[P5] {out.name}: {verdict}", flush=True)


def p6_export(outs: list):
    r = subprocess.run([sys.executable, str(SKILL / "scripts" / "pimsleur_to_anki.py"), *map(str, outs)])
    print(f"[P6] anki: {'ok' if r.returncode == 0 else 'unreachable' if r.returncode == 2 else 'FAILED'}", flush=True)


def p7_report(season: dict, outs: list, T=None):
    """Append this run to the season's run log and rewrite the report. Without a Timer (CH_STAGE=report)
    nothing is appended: every run's Modal line is re-priced (its last hour keeps accruing). A season with
    no log yet gets one APPROXIMATE run: the season plan to the last drill mp3."""
    stem = SEASON_FILE.with_name(SEASON_FILE.name.removesuffix(".season.json"))
    runs = rr.load_runs(stem.with_suffix(".run-report.json"))
    title, prices = season.get("album") or TOPIC, rr.load_prices()
    extra = [GEN / f"chiron-pimsleur-{TOPIC_SLUG}-plan"]
    if T is not None:
        rows = rr.modal_rows(min([T.start] + [r["start"] for r in runs]))
        runs.append(rr.build(title, outs, T.spans, T.start, time.time(), rows, prices, extra))
    elif not runs:
        mp3s = [o / "audio" / "pimsleur.mp3" for o in outs if (o / "audio" / "pimsleur.mp3").exists()]
        start = SEASON_FILE.stat().st_mtime
        end = max((f.stat().st_mtime for f in mp3s), default=start)
        rows = rr.modal_rows(start)
        runs.append(rr.build(title, outs, [], start, end, rows, prices, extra))
    else:
        rows = rr.modal_rows(min(r["start"] for r in runs))
    rr.reprice_modal(runs, rows)
    md = rr.write(stem, runs)
    t = rr.season_totals(runs)
    print(f"[P7] report: {len(runs)} run(s) · season ${t['usd']:.3f}{' (incomplete)' if t['incomplete'] else ''} -> {md}", flush=True)


async def main():
    T = rr.Timer()
    with T("P0"):
        await p0a_source_check()
        season = await p0_plan()
    outs, prev = [], []
    for n, l in enumerate(season["lessons"], 1):
        out = lesson_dir(n, l)
        if stage("author") or stage("card") or stage("bake") or stage("listen"):
            with T("P1", out.name):
                bank = await p1_author(n, l, out, prev, season)
            prev = prev + bank["items"]
            if stage("card"):
                with T("P3", out.name):
                    await p3_card(n, l, out, bank)
        outs.append(out)
    for out in outs:
        if stage("bake"):
            with T("P4", out.name):
                p4_bake(out)
        if stage("listen"):
            with T("P5", out.name):
                p5_listen(out)
    if stage("export"):
        with T("P6"):
            p6_export(outs)
    if STAGES == {"report"}:
        p7_report(season, outs)
    elif stage("bake") or stage("listen"):
        p7_report(season, outs, T)
    print("[done] " + " ".join(o.name for o in outs))


if __name__ == "__main__":
    asyncio.run(main())
