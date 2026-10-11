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
  P0  PLAN     (LLM, MODEL_REASON)   topic (+ optional source) -> season.json: N lessons, targets, pattern
  P1  AUTHOR   (LLM ladder)          per lesson -> pimsleur.json items; validated by pimsleur_drill.validate + rules
  P1b REVIEW   (LLM, MODEL_QC — a different family) Italian correctness/register per item -> one re-author round
  P1c RECYCLE  (fn)                  2 items of the previous lesson become this lesson's `review` (graduated recall)
  P3  CARD     (LLM small + assemble-language.mjs) pattern table + pearl -> content.json -> lesson.html
  P4  BAKE     (fn)                  pimsleur_drill.py build --qc  (per-clip ASR, auto re-synth)
  P5  LISTEN   (Gemini)              pimsleur_drill.py listen      (whole-file review -> audio/pimsleur.listen.md)
  P6  EXPORT   (fn)                  Anki (if reachable). Match Madness: every read card carries the in-lesson
                                    widget built from the same items; the phone app's `ordine` flavour is fed by
                                    match-madness/ingest/pimsleur.mjs, which is Ordine-specific (it writes
                                    data/ordine-pimsleur.json) — so the chain never calls it for other seasons.

USAGE
-----
  CH_TOPIC="common irregular verbs in the passato prossimo and futuro" CH_STAGE=all python3 run.py
  Env: CHIRON_PIMSLEUR_ENGINE=modal bakes on the chiron-bake Modal lane instead of the Mac.
  Env: CH_TOPIC (required) · CH_LESSONS (default: planner decides, 3-6) · CH_DOMAIN (language-it|medical-italian)
       CH_SOURCE (file or dir of .md/.txt/.json to ground in; e.g. a study pack) · CH_STAGE (plan|author|card|bake|
       listen|export|all; comma list ok) · CH_FORCE=1 (re-author) · plus the pure-italian chain's model env vars.
Outputs: ~/Documents/generated/chiron-pimsleur-<topic-slug>-<NN>-<lesson-slug>/ (one dir per lesson, Library-visible)
         ~/Documents/generated/chiron-pimsleur-<topic-slug>.season.json
"""
from __future__ import annotations

import asyncio, datetime, importlib.util, json, os, re, subprocess, sys
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
TOPIC_SLUG = re.sub(r"[^a-z0-9]+", "-", TOPIC.lower()).strip("-")[:40]
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


def stage(name: str) -> bool:
    return "all" in STAGES or name in STAGES


def point_at(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    pi.OUT = out
    try: pi.obs.set_out(out)
    except Exception: pass


def source_block() -> str:
    """CH_SOURCE grounding (a file or a dir of text files), capped. Empty when the topic is general grammar."""
    p = os.environ.get("CH_SOURCE")
    if not p:
        return ""
    p = Path(os.path.expanduser(p))
    files = [p] if p.is_file() else sorted(f for f in p.rglob("*") if f.suffix in (".md", ".txt", ".json"))
    text = "\n\n".join(f"### {f.name}\n{f.read_text(errors='ignore')}" for f in files)
    text = re.sub(r"<[^>]+>", " ", text)
    return f"\n## SOURCE — ground every Italian line in this; do not invent facts it does not support\n{text[:24000]}\n"


SRC = source_block()

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
- No duplicates of items taught in earlier lessons (listed below) — build on them instead.
"""


# ── P0 PLAN ────────────────────────────────────────────────────────────────────────────────────────────
def plan_valid(o) -> list:
    iss = []
    ls = o.get("lessons") if isinstance(o, dict) else None
    if not isinstance(ls, list) or not ls:
        return ["lessons: missing or empty"]
    if N_LESSONS and len(ls) != N_LESSONS:
        iss.append(f"need exactly {N_LESSONS} lessons, got {len(ls)}")
    if not N_LESSONS and not 2 <= len(ls) <= 8:
        iss.append(f"need 2-8 lessons, got {len(ls)}")
    for i, l in enumerate(ls):
        for k in ("title", "titleIt", "focus", "pattern"):
            if not str(l.get(k, "")).strip():
                iss.append(f"lessons[{i}].{k} missing")
        t = l.get("targets")
        if not isinstance(t, list) or not 5 <= len(t) <= 8:
            iss.append(f"lessons[{i}].targets: need 5-8, got {len(t) if isinstance(t, list) else 0}")
    for k in ("title", "album"):
        if not str(o.get(k, "")).strip():
            iss.append(f"{k} missing")
    return iss


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
{SRC}
Plan {count} lessons, ordered easiest -> hardest, each building on the previous. For each lesson give 5-7 TARGETS:
the concrete Italian phrases/sentences (or exact forms) it must make the learner able to SAY. Prefer high-frequency,
useful sentences over isolated forms. `pattern` = the one grammatical pattern the lesson's table will show
(e.g. "fare -> ho fatto, dire -> ho detto: irregular participles with avere").

Return ONLY JSON:
{{"title": "<English season title>", "titleIt": "<Italian>", "album": "Chiron Pimsleur · <short Italian name>",
  "lessons": [{{"title": "...", "titleIt": "...", "focus": "<one sentence>", "pattern": "...",
               "targets": ["<Italian>", "..."]}}]}}"""
    o = await pi.json_with_repair(prompt, "pimsleur-plan", pi.model_for(pi.MODEL_REASON), plan_valid)
    if not o:
        sys.exit("[P0] planner failed on every model — see .scratch/pimsleur-plan.raw.txt")
    SEASON_FILE.write_text(json.dumps(o, ensure_ascii=False, indent=1))
    print(f"[P0] {len(o['lessons'])} lessons -> {SEASON_FILE.name}")
    return o


def lesson_dir(n: int, l: dict) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", l["title"].lower()).strip("-")[:32]
    return GEN / f"chiron-pimsleur-{TOPIC_SLUG}-{n:02d}-{slug}"


# ── P1 AUTHOR + REVIEW + RECYCLE ───────────────────────────────────────────────────────────────────────
def bank_valid(o) -> list:
    if not isinstance(o, dict) or not isinstance(o.get("items"), list):
        return ["return an object with an `items` list"]
    items = o["items"]
    iss = pd.validate({"items": items})
    talks = [i for i, it in enumerate(items) if it.get("kind") == "talk"]
    if not 6 <= len(items) <= 9:
        iss.append(f"need 6-9 items (incl. the talk item), got {len(items)}")
    if talks != [len(items) - 1]:
        iss.append("exactly ONE talk item, and it must be LAST")
    for it in items:
        if it.get("kind") == "talk":
            it.setdefault("secs", 25)
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
there `en` is the speaking TASK given to the learner and `it` a model answer — check only that `it` answers it.) Are the `build`
pieces the same WORDS as the end of `it` (ignore punctuation and capitals — the code compares words)? Only report
REAL errors — not style preferences, not punctuation in build pieces.
ITEMS:
{json.dumps(items, ensure_ascii=False, indent=1)}
Return ONLY JSON: {{"issues": [{{"id": "...", "problem": "...", "fix": "<corrected it or en>"}}]}} (empty list if none)."""
    try:
        # deepseek-*-flash is a THINKING model; this is a gate, so thinking off — by the method VERIFIED for its
        # lane (chiron_models.thinking_off: per-lane ladder, measured to emit 0 reasoning, cached).
        md = pi.chiron_models.thinking_off(pi.model_for(pi.MODEL_QC, 0.1))
        raw = await pi.llm(md, prompt)
        return (pi.extract_json(raw) or {}).get("issues") or []
    except Exception as e:
        print(f"[P1b] review unavailable ({e}) — fail-open", flush=True)
        return None


async def p1_author(n: int, l: dict, out: Path, prev_items: list, season: dict) -> dict:
    bank_path = out / "pimsleur.json"
    if bank_path.exists() and not FORCE:
        print(f"[P1] resume {out.name}")
        return json.loads(bank_path.read_text())
    point_at(out)
    prompt = f"""Write the item bank for ONE Pimsleur-method audio lesson (Italian for an English speaker, a doctor).
SEASON: {season['title']} — lesson {n} of {len(season['lessons'])}: {l['title']} ({l['titleIt']})
FOCUS: {l['focus']}
PATTERN: {l['pattern']}
TARGETS (the learner must be able to SAY these by the end): {json.dumps(l['targets'], ensure_ascii=False)}
ALREADY TAUGHT in earlier lessons:
{taught_block(prev_items)}
{SRC}
{ITEM_RULES}
Write 5-8 phrase/question items covering the targets, then the ONE talk item last.
Also write `intro`: ONE English sentence setting a scene for the lesson.
Return ONLY JSON: {{"intro": ["..."], "items": [{{"id": "...", "it": "...", "en": "...", "kind": "phrase", "build": ["..."]}}]}}"""
    o = await pi.json_with_repair(prompt, f"pimsleur-l{n:02d}", pi.model_for(pi.MODEL_STRUCT), bank_valid, via_engine=True)
    if not o:
        sys.exit(f"[P1] lesson {n}: every model failed — see {out}/.scratch/")
    issues = await review_italian(o["items"])
    if issues:
        print(f"[P1b] lesson {n}: {len(issues)} Italian issue(s) -> one re-author round", flush=True)
        fixed = await pi.json_with_repair(
            prompt + f"\n\n## PREVIOUS DRAFT\n{json.dumps(o, ensure_ascii=False)}\n\n## EDITOR'S CORRECTIONS — apply every one\n"
            + json.dumps(issues, ensure_ascii=False), f"pimsleur-l{n:02d}-fix", pi.model_for(pi.MODEL_STRUCT), bank_valid, via_engine=True)
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
    o = await pi.json_with_repair(prompt, f"pimsleur-card-{n:02d}", pi.model_for(pi.MODEL_STRUCT), card_valid)
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
        "created": datetime.date.today().isoformat(), "generator": "chiron", "lessonFormat": "pimsleur"}, indent=2))
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
    if not os.environ.get("GEMINI_API_KEY"):
        print("[P5] skipped: no GEMINI_API_KEY (run under `cred checkout gemini --exec`)", flush=True)
        return
    r = subprocess.run([sys.executable, str(SKILL / "scripts" / "pimsleur_drill.py"), "listen", str(out)],
                       capture_output=True, text=True)
    verdict = "PASS" if r.returncode == 0 else "FIX — read audio/pimsleur.listen.md"
    print(f"[P5] {out.name}: {verdict}", flush=True)


def p6_export(outs: list):
    r = subprocess.run([sys.executable, str(SKILL / "scripts" / "pimsleur_to_anki.py"), *map(str, outs)])
    print(f"[P6] anki: {'ok' if r.returncode == 0 else 'unreachable' if r.returncode == 2 else 'FAILED'}", flush=True)


async def main():
    season = await p0_plan()
    outs, prev = [], []
    for n, l in enumerate(season["lessons"], 1):
        out = lesson_dir(n, l)
        if stage("author") or stage("card") or stage("bake") or stage("listen"):
            bank = await p1_author(n, l, out, prev, season)
            prev = prev + bank["items"]
            if stage("card"):
                await p3_card(n, l, out, bank)
        outs.append(out)
    for out in outs:
        if stage("bake"):
            p4_bake(out)
        if stage("listen"):
            p5_listen(out)
    if stage("export"):
        p6_export(outs)
    print("[done] " + " ".join(o.name for o in outs))


if __name__ == "__main__":
    asyncio.run(main())
