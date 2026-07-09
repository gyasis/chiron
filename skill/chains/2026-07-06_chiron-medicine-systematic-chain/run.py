"""Chiron MEDICINE SYSTEMATIC lesson generator — the single-disease 11-section DEEP-DIVE (chain variant).

Fourth depth in the depth ladder (primer < atlas < systematic < ...). Unlike the AMBOSS medicine
chain (LLM-planned N chapters, one disease per lesson but chapter count varies) and the PRIMER
(atlas-driven, groups curated issues into a handful of LIGHT chapters), the SYSTEMATIC chain:
  - Takes ONE disease (CH_SUBJECT) — NO disease-atlas read, no grouping, no LLM chapter-count decision,
  - Uses a FIXED 11-section skeleton (the canonical AMBOSS chapter structure walked disease-axis:
    Definition & Summary -> Epidemiology/Etiology/Pathogenesis -> Classification -> Pathophysiology
    [DEEP] -> Clinical Features -> Diagnosis & Workup -> Differential Diagnosis -> Treatment ->
    Complications -> Prognosis & Prevention -> Clinical Reasoning & High-Yield Integration [capstone]),
  - authors EACH section-chapter Harrison-grounded with the FULL AMBOSS widget palette (04a + the
    medicine-amboss.json curriculum + 04c mandatory vignette + 04u algorithm/DDx widgets) — this is
    the DEEP variant; do not thin the widget mix the way the primer does,
  - assembles (assemble-medicine.mjs) -> bakes (Atelier/Mac) -> stamps chiron.json tags -> library index.
Good for a single high-yield disease that deserves the full board-exam-depth treatment (one condition,
eleven angles) rather than a whole system/atlas swept at primer depth.

Verdict (C) Hybrid. Facts from code (fixed skeleton + harrison grounding), judgment from LLM
(per-section focus/keyConcepts + authoring). NO model ever codes HTML — typed chapter JSON ->
deterministic assembler.

Run:  cd ~/Documents/PromptChain && bash scripts/observe.sh runs/2026-07-06_chiron-medicine-systematic-chain
Env:  OLLAMA_API_KEY ; CH_SUBJECT (single disease, default "Aortic aneurysm") ;
      CH_SYSTEM (tag only, default "General") ; CH_STAGE (plan|chapters|assemble|audio|all).
"""
from promptchain.observability import init_mlflow
init_mlflow()

import asyncio
import glob
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)

from promptchain import PromptChain
from promptchain.utils.external_loop import over_worklist

# ── config ────────────────────────────────────────────────────────────────────
HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
PROMPTS = SKILL / "prompts"
CURRICULA = SKILL / "curricula"
GEN = HOME / "Documents/generated"
OLLAMA_KEY = os.environ.get("OLLAMA_API_KEY", "")

SUBJECT = os.environ.get("CH_SUBJECT", "").strip()
if __name__ == "__main__" and not SUBJECT:
    raise SystemExit("[chiron] CH_SUBJECT is empty — refusing to generate a placeholder lesson (wrong-subject guard).")
SYSTEM = os.environ.get("CH_SYSTEM", "General")  # tag-only; no atlas/grouping implication
STAGE = os.environ.get("CH_STAGE", "plan")  # plan | chapters | assemble | audio | all
SLUG = "chiron-" + re.sub(r"[^a-z0-9]+", "-", SUBJECT.lower()).strip("-") + "-systematic"
OUT = GEN / SLUG

MODEL_REASON = os.environ.get("CH_MODEL_REASON", "glm-5.2")
MODEL_STRUCT = os.environ.get("CH_MODEL_STRUCT", "glm-5.2")
CHAPTER_ENGINE = os.environ.get("CH_CHAPTER_ENGINE", "glm")  # "glm" | "claude"

# The FIXED 11-section skeleton (disease-axis systematic depth). NEVER LLM-planned/grouped —
# every systematic lesson walks these eleven angles, in this order, no exceptions.
CHAPTER_COUNT_EXACT = 11
SECTION_SKELETON = [
    {"chapterNumber": 1, "sectionKey": "overview",
     "title": "Definition & Summary"},
    {"chapterNumber": 2, "sectionKey": "epidemiology-etiology",
     "title": "Epidemiology, Etiology & Pathogenesis"},
    {"chapterNumber": 3, "sectionKey": "classification",
     "title": "Classification / Subtypes"},
    {"chapterNumber": 4, "sectionKey": "pathophysiology",
     "title": "Pathophysiology"},
    {"chapterNumber": 5, "sectionKey": "clinical-features",
     "title": "Clinical Features / Manifestations"},
    {"chapterNumber": 6, "sectionKey": "diagnostics",
     "title": "Diagnosis & Workup"},
    {"chapterNumber": 7, "sectionKey": "differential-diagnosis",
     "title": "Differential Diagnosis"},
    {"chapterNumber": 8, "sectionKey": "treatment",
     "title": "Treatment / Management"},
    {"chapterNumber": 9, "sectionKey": "complications",
     "title": "Complications"},
    {"chapterNumber": 10, "sectionKey": "prognosis",
     "title": "Prognosis & Prevention"},
    {"chapterNumber": 11, "sectionKey": "capstone",
     "title": "Clinical Reasoning & High-Yield Integration"},
]

# ── DRUG / PHARMACOLOGY template (CH_TEMPLATE=drug) — a drug-class-axis skeleton, NOT the disease one ──
DRUG_SKELETON = [
    {"chapterNumber": 1, "sectionKey": "overview", "title": "Drug Class & Overview"},
    {"chapterNumber": 2, "sectionKey": "mechanism", "title": "Mechanism of Action"},
    {"chapterNumber": 3, "sectionKey": "indications", "title": "Indications & Clinical Uses"},
    {"chapterNumber": 4, "sectionKey": "pharmacokinetics", "title": "Pharmacokinetics (ADME)"},
    {"chapterNumber": 5, "sectionKey": "contraindications", "title": "Contraindications & Cautions"},
    {"chapterNumber": 6, "sectionKey": "adverse-effects", "title": "Adverse Effects"},
    {"chapterNumber": 7, "sectionKey": "interactions", "title": "Drug Interactions"},
    {"chapterNumber": 8, "sectionKey": "dosing-monitoring", "title": "Dosing & Monitoring"},
    {"chapterNumber": 9, "sectionKey": "key-drugs", "title": "Key Drugs & Comparisons"},
    {"chapterNumber": 10, "sectionKey": "capstone", "title": "Clinical Reasoning & High-Yield Integration"},
]
TEMPLATE = os.environ.get("CH_TEMPLATE", "disease")   # disease | drug
if TEMPLATE == "drug":
    SECTION_SKELETON = DRUG_SKELETON
CHAPTER_COUNT_EXACT = len(SECTION_SKELETON)
ENTITY = "drug / drug-class" if TEMPLATE == "drug" else "disease"

# Per-section widget hints (04a's widget-mix table, adapted to our fixed 11-section skeleton).
SECTION_WIDGET_HINTS = {
    "overview": "why-care-callout (opening) + one crisp summary paragraph",
    "epidemiology-etiology": "pattern-cards (risk groups / cause categories) + glossary-tooltips",
    "classification": "pattern-cards (subtype families) and/or layer-toggle (comparing subtypes)",
    "pathophysiology": "flow-animation and/or pathway-diagram (mechanism cascade) + mathjax where a formula/threshold applies",
    "clinical-features": "pattern-cards (symptom clusters) + agreement-matrix",
    "diagnostics": "flow-animation (workup algorithm) + step-cards (diagnostic criteria)",
    "differential-diagnosis": "flow-animation (decision tree) + pattern-cards (mimickers)",
    "treatment": "step-cards (protocol/escalation) + agreement-matrix (drug-class indications)",
    "complications": "pattern-cards (complication families) + pathway-diagram (sequela paths)",
    "prognosis": "chart-xy (survival/recovery curve) + step-cards (risk factors)",
    "capstone": "a hardest cumulative mcq-clinical-vignette + match-madness over ALL prior concepts + a boss",
}


def ollama(model: str, temperature: float = 0.4) -> dict:
    return {"name": f"openai/{model}",
            "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": temperature}}


def load_prompt(name: str) -> str:
    return (PROMPTS / name).read_text()


def fill(t: str, **slots) -> str:
    for k, v in slots.items():
        t = t.replace("{{" + k + "}}", v if isinstance(v, str) else json.dumps(v))
    return t


def extract_json(s: str):
    """Pull the first balanced JSON object/array out of an LLM reply (string-aware, strict=False)."""
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
    chain = PromptChain(models=[model_dict], instructions=[prompt + "\n\n{input}" if "{input}" not in prompt else prompt])
    return await chain.process_prompt_async(user_input)


def claude_p(prompt: str) -> str:
    r = subprocess.run(["claude", "-p", "--dangerously-skip-permissions"],
                       input=prompt, capture_output=True, text=True, timeout=600)
    return r.stdout.strip()


async def call_engine(prompt: str, model_dict: dict) -> str:
    if CHAPTER_ENGINE == "claude":
        return await asyncio.to_thread(claude_p, prompt + "\n\nReturn ONLY the JSON object, no prose.")
    return await llm(model_dict, prompt)


async def json_with_repair(prompt: str, name: str, model_dict: dict, validate_fn=None, max_repair: int = 3):
    """Self-repair loop: call the model; on unparseable/invalid JSON re-prompt with the exact problem.
    On exhaustion returns None (caller flags needs_review and KEEPS GOING)."""
    cur, last_raw = prompt, ""
    for attempt in range(1, max_repair + 1):
        last_raw = await call_engine(cur, model_dict)
        try:
            obj = extract_json(last_raw)
        except Exception as e:
            print(f"[repair] {name} attempt {attempt}/{max_repair}: JSON parse failed ({e}) — re-prompting", flush=True)
            cur = (prompt + f"\n\n## YOUR PREVIOUS OUTPUT WAS INVALID JSON\nError: {e}\nPrevious output:\n{last_raw[:4000]}\n\n"
                   "Return ONLY corrected, valid JSON. Escape every \" and newline INSIDE string values.")
            continue
        issues = validate_fn(obj) if validate_fn else None
        if issues:
            print(f"[repair] {name} attempt {attempt}/{max_repair}: invalid ({issues[:2]}) — re-prompting", flush=True)
            cur = prompt + f"\n\n## YOUR PREVIOUS OUTPUT HAD PROBLEMS\n{issues}\nReturn ONLY corrected valid JSON fixing them."
            continue
        return obj
    (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
    (OUT / ".scratch" / f"{name}.raw.txt").write_text(last_raw or "(EMPTY)")
    print(f"[repair] {name}: EXHAUSTED {max_repair} attempts — flagging needs_review, continuing", flush=True)
    return None


async def llm_json(model_dict: dict, prompt: str, name: str, user_input: str = "go"):
    raw = await llm(model_dict, prompt, user_input)
    try:
        return extract_json(raw)
    except Exception as e:
        (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
        (OUT / ".scratch" / f"{name}.raw.txt").write_text(raw or "(EMPTY RESPONSE)")
        print(f"[ERROR] {name}: JSON parse failed ({e}); raw len={len(raw)} dumped", flush=True)
        raise


def _user_ctx() -> str:
    """Wizard/OCR grounding: CH_GROUNDING points to a markdown file of user-provided source/context."""
    p = os.environ.get("CH_GROUNDING")
    if p:
        try:
            t = Path(p).read_text().strip()
        except Exception:
            t = ""
        if t:
            return f"## USER-PROVIDED CONTEXT (source material / OCR — prioritize this, weave it in):\n{t[:4000]}\n\n"
    return ""


USER_CTX = _user_ctx()


def harrison(query: str, n: int = 5) -> str:
    try:
        r = subprocess.run([str(HOME / ".local/bin/harrison-search"), "-q", query, "-n", str(n), "--prose", "--full"],
                           capture_output=True, text=True, timeout=180)
        return r.stdout.strip()
    except Exception as e:
        return f"[harrison-search unavailable: {e}]"


def render_check(chapter_obj) -> list:
    try:
        sc = OUT / ".scratch"; sc.mkdir(parents=True, exist_ok=True)
        tmp = sc / "_rendercheck.json"; tmp.write_text(json.dumps(chapter_obj))
        r = subprocess.run(["node", str(SKILL / "scripts" / "render-check.mjs"), str(tmp)],
                           capture_output=True, text=True, timeout=60)
        return json.loads(r.stdout).get("failures", []) if r.stdout.strip() else []
    except Exception:
        return []


# ── Phase 1 — PLAN: fill the FIXED 11-section skeleton with per-section focus + keyConcepts ────
async def phase1(source: str):
    OUT.mkdir(parents=True, exist_ok=True)
    section_list = "\n".join(f"{s['chapterNumber']}. {s['title']} (sectionKey={s['sectionKey']})"
                              for s in SECTION_SKELETON)
    plan_p = (
        f"You are planning a SYSTEMATIC (deep-dive, board-exam depth) medical lesson on the SINGLE "
        f"{ENTITY} '{SUBJECT}'. The lesson has a FIXED {CHAPTER_COUNT_EXACT}-section structure — you may "
        f"NOT reorder, rename, merge, or drop sections:\n{section_list}\n\n"
        f"For EACH of the {CHAPTER_COUNT_EXACT} sections, produce (a) a ONE-sentence 'focus' statement "
        f"tailored SPECIFICALLY to {SUBJECT} (what this exact section will teach for THIS disease, not "
        f"generic disease theory), and (b) 3-6 'keyConcepts' specific to {SUBJECT} for that section. "
        f"Return a JSON array of EXACTLY {CHAPTER_COUNT_EXACT} objects, IN SECTION ORDER: "
        f'{{"chapterNumber": <1-based, matching the list above>, "focus": "...", "keyConcepts": ["..."]}}. '
        f"Return ONLY the JSON array."
    )
    print(f"[phase 1] plan — filling the fixed {CHAPTER_COUNT_EXACT}-section skeleton for '{SUBJECT}'…", flush=True)
    filled = await llm_json(ollama(MODEL_REASON), plan_p, "syllabus")
    if isinstance(filled, dict):
        filled = filled.get("chapters") or filled.get("sections") or [filled]
    by_num = {int(f.get("chapterNumber", i + 1)): f for i, f in enumerate(filled) if isinstance(f, dict)}
    syl = []
    for s in SECTION_SKELETON:
        f = by_num.get(s["chapterNumber"], {})
        syl.append({
            "chapterNumber": s["chapterNumber"],
            "chapterId": s["sectionKey"],
            "sectionKey": s["sectionKey"],
            "title": s["title"],
            "narrative": f.get("focus") or f"{s['title']} of {SUBJECT}.",
            "keyConcepts": f.get("keyConcepts") or [],
        })
    # brief.json (assembler/library read metadata from here + chiron.json)
    (OUT / "brief.json").write_text(json.dumps(
        {"domain": "medicine", "subMode": "systematic", "extractedText": source,
         "metadata": {"subject": SUBJECT, "topic": SUBJECT, "depth": "systematic",
                      "chapterCountExact": CHAPTER_COUNT_EXACT}}, indent=2))
    (OUT / "syllabus.json").write_text(json.dumps(syl, indent=2))
    print(f"[phase 1] syllabus: {len(syl)} sections -> {[c.get('title') for c in syl]}", flush=True)
    return syl


# ── Phase 2 — Validate (light) ─────────────────────────────────────────────────
def validate(syl) -> list:
    issues = []
    if not isinstance(syl, list) or not syl:
        return ["syllabus is not a non-empty array"]
    if len(syl) != CHAPTER_COUNT_EXACT:
        issues.append(f"expected exactly {CHAPTER_COUNT_EXACT} sections (chapterCountExact), got {len(syl)}")
    for i, c in enumerate(syl):
        if not c.get("title"):
            issues.append(f"ch{i}: missing title")
    print(f"[phase 2] validate: {'OK' if not issues else issues}", flush=True)
    return issues


# ── Phase 3 — per-section author (Harrison-grounded, FULL AMBOSS widget palette) ───────────────
AMBOSS_CURR = json.loads((CURRICULA / "medicine-amboss.json").read_text())


async def author_chapter(chapter, idx: int):
    n = chapter.get("chapterNumber", idx + 1)
    theme = chapter.get("title", SUBJECT)
    section_key = chapter.get("sectionKey", "overview")
    focus = chapter.get("narrative", theme)
    concepts = chapter.get("keyConcepts", [])
    is_pathophys = section_key == "pathophysiology"
    is_capstone = section_key == "capstone"
    if (OUT / f"chapter{n}.json").exists() and os.environ.get("CH_FORCE") != "1":
        print(f"[phase 3] chapter {n} — RESUME (exists, skip)", flush=True)
        return n
    grounding = harrison(SUBJECT + " " + focus + " " + " ".join(concepts[:4]), n=6)
    hint = SECTION_WIDGET_HINTS.get(section_key, "the widgets recommended by 04a for this section")
    p = fill(load_prompt("04a-chapter-write.md"), chapterSyllabus=chapter, curriculum=AMBOSS_CURR) \
        + "\n\n## CLINICAL VIGNETTE (mandatory)\n" + load_prompt("04c-quiz-clinical-vignette.md") \
        + "\n\n" + load_prompt("04u-medical-algorithm-widgets.md")
    p += (
        f"\n\n{USER_CTX}## GROUNDING (Harrison's — ground every clinical claim to this; never invent):\n{grounding[:6000]}"
        f"\n\n## SYSTEMATIC DEEP-DIVE (BLOCKING): this lesson is a single-{ENTITY}, {CHAPTER_COUNT_EXACT}-section "
        f"systematic deep-dive on '{SUBJECT}'. Produce a FULL canonical AMBOSS chapter for the section "
        f"'{theme}' (sectionKey={section_key}), focused on: {focus}. Use the FULL widget palette per 04a — "
        f"do NOT thin it down the way a primer would. This section's recommended widgets: {hint}. "
        f"ALWAYS: open with a why-care-callout, include ONE full mcq-clinical-vignette (stem, keyInfo[], "
        f"5 options w/ per-distractor explanation, hammer, attendingTip, vignetteCategory), emit varied "
        f"widgets per the curriculum's widgetMix, and emit srCards (aim for perChapterSrCardTarget from "
        f"the curriculum)."
    )
    if is_pathophys:
        p += (
            "\n\nThis is Chapter 4 (Pathophysiology) — the DEEP chapter. Go beyond a surface mechanism "
            "summary: walk the full causal cascade (molecular/cellular -> organ -> systemic effect), use "
            "flow-animation and/or pathway-diagram for the cascade, add mathjax for any relevant "
            "formula/threshold/hemodynamic relationship, and write RICHER exposition than the other sections."
        )
    if is_capstone:
        p += (
            "\n\nThis is Chapter 11 (Clinical Reasoning & High-Yield Integration) — the CAPSTONE. Write the "
            "HARDEST cumulative mcq-clinical-vignette in the lesson (integrates >=3 prior sections' concepts), "
            "add a match-madness widget spanning concepts from ALL PRIOR sections (epidemiology through "
            "prognosis), and close with a 'boss' widget synthesizing the whole disease."
        )
    p += (
        f"\n\nReturn ONE JSON object: {{\"chapterIndex\": {n}, \"title\": \"{theme}\", \"exposition\": \"...\", "
        f"\"widgets\": [...], \"srCards\": [...]}}."
    )
    print(f"[phase 3] chapter {n} — {theme} [{section_key}] (grounded {len(grounding)}c, engine={CHAPTER_ENGINE})…", flush=True)

    def ch_valid(obj):
        iss = []
        if not any(obj.get(k) for k in ("exposition", "narrativeHtml", "narrative", "body", "prose")):
            iss.append("missing prose (exposition/narrativeHtml)")
        if not any(w.get("type") == "mcq-clinical-vignette" for w in (obj.get("widgets") or [])):
            iss.append("missing the mandatory mcq-clinical-vignette widget")
        return iss or None

    ch = await json_with_repair(p, f"chapter{n}", ollama(MODEL_STRUCT), validate_fn=ch_valid)
    if ch is None:
        (OUT / f"chapter{n}.NEEDS_REVIEW").write_text(f"chapter {n} ({theme}) failed validation after repair")
        print(f"[phase 3] chapter {n} — NEEDS_REVIEW (kept lesson running)", flush=True)
        return None
    ch.setdefault("chapterIndex", n); ch.setdefault("title", theme)
    ch.setdefault("chapterId", chapter.get("chapterId", section_key))
    fails = render_check(ch)
    if fails:
        bad = {f["index"] for f in fails}
        ch["widgets"] = [w for i, w in enumerate(ch.get("widgets", [])) if i not in bad]
        (OUT / ".scratch" / f"chapter{n}.dropped.json").write_text(json.dumps(fails, indent=2))
        print(f"[phase 3] chapter {n} — dropped {len(bad)} unrenderable widget(s): {[f['type'] for f in fails]}", flush=True)
    (OUT / f"chapter{n}.json").write_text(json.dumps(ch, indent=2))
    return n


async def phase3(syl):
    async def handler(item, state):
        i = state["_idx"] = state.get("_idx", -1) + 1
        try:
            r = await author_chapter(item, i)
        except Exception as e:
            print(f"[phase 3] chapter idx {i}: unexpected error ({e}) — skipped, lesson continues", flush=True)
            r = None
        state.setdefault("done", []).append(r)
    state = await over_worklist(syl, handler, max_iters=len(syl) + 1, max_seconds=2400)
    done = [x for x in state.get("done", []) if x]
    print(f"[phase 3] authored {len(done)}/{len(syl)} chapters: {sorted(done)}", flush=True)
    return state


# ── Phase 3.9 — shell assets (themes next to the lesson) ───────────────────────
def copy_shell_assets():
    import shutil
    src = SKILL / "shell" / "themes"; dst = OUT / "themes"; dst.mkdir(parents=True, exist_ok=True)
    n = sum(1 for f in src.glob("*.css") if (shutil.copyfile(f, dst / f.name) or True))
    print(f"[phase 3.9] shell assets: copied {n} theme CSS → themes/", flush=True)


# ── Phase 4 — assemble (deterministic; typed JSON -> HTML) ──────────────────────
def assemble():
    assembler = SKILL / "scripts" / "assemble-medicine.mjs"
    print("[phase 4] assemble -> lesson.html", flush=True)
    subprocess.run(["node", str(assembler), str(OUT)], check=True)


# ── Phase 5.5 — lecture scripts ; Phase 6 — bake (Atelier/Mac) ──────────────────
def lesson_sections() -> list:
    syl = json.loads((OUT / "syllabus.json").read_text())
    syl = syl if isinstance(syl, list) else syl.get("chapters", [])
    secs = []
    for ch in syl:
        n = ch.get("chapterNumber")
        cj = OUT / f"chapter{n}.json"
        if not cj.exists():
            continue
        d = json.loads(cj.read_text())
        cid = d.get("chapterId") or ch.get("chapterId") or f"ch-{n}"
        prose = d.get("exposition") or d.get("narrativeHtml") or d.get("narrative") or ""
        prose = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", prose)).strip()
        secs.append({"id": cid, "title": d.get("title") or ch.get("title", ""), "contentText": prose[:3500]})
    return secs


async def phase_lecture_scripts():
    asp = OUT / "audio-scripts.json"
    if asp.exists() and os.environ.get("CH_FORCE") != "1":
        print("[phase 5.5] RESUME — reusing existing audio-scripts.json (skip regen; keeps bake resumable)", flush=True)
        return
    secs = lesson_sections()
    print(f"[phase 5.5] lecture scripts for {len(secs)} sections + summary…", flush=True)
    p = fill(load_prompt("04s-lecture-script.md"), lessonTitle=SUBJECT, domain="medicine",
             sections=secs, granularity="all")
    p += ("\n\n## MEDICAL-TTS SAFETY (BLOCKING): spoken audio — write every clinical term as plain English "
          "'low/high X' BEFORE any Latin (the TTS reverses hypo-/hyper- prefixes). Return ONLY {\"artifacts\":[...]}.")
    res = await llm_json(ollama(MODEL_REASON), p, "lecture-scripts")
    arts = res.get("artifacts", res if isinstance(res, list) else [])
    out = {"summary": [], "sections": {}}
    for a in arts:
        k, segs = a.get("kind"), a.get("segments", [])
        if k == "summary": out["summary"] = segs
        elif k == "shortened": out["shortened"] = segs
        elif k == "section" and a.get("sectionId"): out["sections"][a["sectionId"]] = segs
    (OUT / "audio-scripts.json").write_text(json.dumps(out, indent=2))
    print(f"[phase 5.5] audio-scripts.json: summary={len(out['summary'])} sections={list(out['sections'])}", flush=True)


def bake_audio():
    print("[phase 6] bake → Atelier OmniVoice (Mac) …", flush=True)
    cmd = ["node", str(SKILL / "scripts" / "bake-lesson-audio.mjs"), str(OUT),
           "--domain", "medicine", "--persona", "pauls-tutor"]
    if os.environ.get("CH_AUDIO_QC") != "1":
        cmd.append("--no-qc")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=2400)
    print(((r.stdout or "")[-1200:] + "\n" + (r.stderr or "")[-1200:]), flush=True)
    clips = sorted((OUT / "audio").glob("**/*.mp3")) if (OUT / "audio").exists() else []
    print(f"[phase 6] baked {len(clips)} audio clip(s) → audio/", flush=True)
    return len(clips)


# ── Phase 7 — register in the chiron library (stamp chiron.json tags) ───────────
def register_library(clips: int):
    clips = clips or (len(list((OUT / "audio").glob("**/*.mp3"))) if (OUT / "audio").exists() else 0)
    chiron_json = {
        "format": "chiron/1",
        "title": f"Chiron · {SUBJECT} — Systematic (Deep-Dive)",
        "entry": "lesson.html",
        "domain": "medicine",
        "created": date.today().isoformat(),
        "audioClips": clips,
        "generator": "chiron-systematic",
        "status": "staged",  # new lessons land in the library's "Needs Review" band until accepted
        # forward-path tags the library builder prefers (skips inference)
        "tags": {"dom": "medicine", "sys": SYSTEM, "subj": SUBJECT, "scope": "disease", "depth": "systematic"},
    }
    (OUT / "chiron.json").write_text(json.dumps(chiron_json, indent=2))
    print(f"[phase 7] stamped chiron.json (tags: medicine/{SYSTEM}/{SUBJECT}, clips={clips})", flush=True)
    print("[phase 7] rebuilding chiron library index…", flush=True)
    r = subprocess.run(["node", str(SKILL / "scripts" / "build-library-index.mjs")],
                       capture_output=True, text=True, timeout=180)
    print(((r.stdout or "")[-600:] + "\n" + (r.stderr or "")[-400:]), flush=True)


# ── orchestrate ────────────────────────────────────────────────────────────────
async def main():
    assert OLLAMA_KEY, "OLLAMA_API_KEY not set (source ~/.config/environment.d/ollama-cloud.conf)"
    print(f"=== chiron SYSTEMATIC | subject='{SUBJECT}' sections={CHAPTER_COUNT_EXACT} stage={STAGE} -> {OUT}")
    OUT.mkdir(parents=True, exist_ok=True)
    source = f"# {SUBJECT} — systematic deep-dive grounding\n\n" + harrison(SUBJECT, n=8)
    syl_path = OUT / "syllabus.json"
    if syl_path.exists() and os.environ.get("CH_FORCE") != "1":
        syl = json.loads(syl_path.read_text())
        if isinstance(syl, dict):
            syl = syl.get("chapters") or syl.get("syllabus") or [syl]
        print(f"[phase 1] RESUME — reusing syllabus ({len(syl)} sections). CH_FORCE=1 to replan.", flush=True)
    else:
        syl = await phase1(source)
    issues_v = validate(syl)
    if issues_v and STAGE != "plan":
        print("[warn] validation issues (continuing):", issues_v)
    if STAGE in ("chapters", "all"):
        await phase3(syl)
    if STAGE in ("assemble", "all"):
        copy_shell_assets()
        try:
            subprocess.run(["python3", str(SKILL / "scripts" / "gen-glossary.py"), str(OUT)], timeout=240, check=False)
        except Exception as e:
            print(f"[phase 3.95] glossary skipped ({e})", flush=True)
        assemble()
    clips = 0
    if STAGE in ("audio", "all"):
        await phase_lecture_scripts()
        clips = bake_audio()
    if STAGE in ("assemble", "audio", "all"):
        register_library(clips)
    print("=== done.")


if __name__ == "__main__":
    asyncio.run(main())
