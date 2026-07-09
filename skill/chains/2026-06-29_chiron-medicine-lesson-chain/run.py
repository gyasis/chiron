"""Chiron MEDICINE (AMBOSS) lesson generator — multiphasic PromptChain.

Adapts the Pharos dataviz generator pattern (recipe: dataviz-generator-pipeline) to chiron
lesson generation. Engine verdict (C) Hybrid, chain 1 of 4. Facts from code, judgment from LLM.

  Phase 0    INGEST/source-pack (fn) — primary source markdown, or ground a pack from harrison-search.
  Phase 0.5  LIBRARY-DEDUP (fn, NO LLM) — scan existing medicine lessons' chapter*.json for
             already-covered concept_ids + existing vignette stems/categories → AVOID set.
  Phase 1    BRIEF + SYLLABUS (LLM) — chiron 01/02 prompts; AVOID injected (don't re-plan covered chapters).
  Phase 2    VALIDATE (fn) — light schema/shape checks (full Zod lives in TS; v1 checks shape + chapter count).
  Phase 3    PER-CHAPTER (ExternalLoop) — grounding via harrison-search (deterministic fn, pre-injected;
             sidesteps tool-call-weak models) -> author chapterN.json (04a + 04c vignette) with the
             AVOID-vignettes constraint -> light QUEST-AI verify pass.
  Phase 4    ASSEMBLE (fn -> node assemble-medicine.mjs) — typed chapterN.json -> lesson.html. NO model codes HTML.
  Phase 5/6  BAKE + audio-QC — Atelier (off by default; --bake to enable).

Models: Ollama Cloud, tiered (deepseek-v3.2 reasoning / qwen3-coder:480b structured). max_tokens AUTOMATIC.
Run:  cd ~/Documents/PromptChain && bash scripts/observe.sh runs/2026-06-29_chiron-medicine-lesson-chain
Env:  OLLAMA_API_KEY (from ~/.config/environment.d/ollama-cloud.conf); CH_SUBJECT, CH_SYSTEM, CH_CHAPTERS, CH_STAGE.
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
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)  # flush phase prints even when redirected to a log

from promptchain import PromptChain
from promptchain.utils.external_loop import over_worklist

# ── config ────────────────────────────────────────────────────────────────────
HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
PROMPTS = SKILL / "prompts"
GEN = HOME / "Documents/generated"
OLLAMA_KEY = os.environ.get("OLLAMA_API_KEY", "")

SUBJECT = os.environ.get("CH_SUBJECT", "Cardiac Arrhythmias")
SYSTEM = os.environ.get("CH_SYSTEM", "").strip()   # NO hardcoded default — inferred from the subject in main() if absent
N_CHAPTERS = int(os.environ.get("CH_CHAPTERS", "4"))
STAGE = os.environ.get("CH_STAGE", "plan")  # plan | chapters | assemble | all
SLUG = "chiron-" + re.sub(r"[^a-z0-9]+", "-", SUBJECT.lower()).strip("-") + "-amboss"
OUT = GEN / SLUG

# Model probe (2026-06-29): glm-5.2 is the newest/strong GLM (glm-4.6 RETIRED 2026-06-16) — fast (~2s)
# and returns clean JSON content. deepseek-v3.2 is a hidden-reasoner → returns EMPTY content here.
# qwen3-coder:480b also works. STRONG default = glm-5.2. The chapter-author/verify SEAM can also use
# the strongest model — headless Claude Code (Opus/Sonnet) via `claude -p` — set CH_CHAPTER_ENGINE=claude.
MODEL_REASON = os.environ.get("CH_MODEL_REASON", "glm-5.2")
MODEL_STRUCT = os.environ.get("CH_MODEL_STRUCT", "glm-5.2")
CHAPTER_ENGINE = os.environ.get("CH_CHAPTER_ENGINE", "glm")  # "glm" (glm-5.2) | "claude" (claude -p headless)


def ollama(model: str, temperature: float = 0.4) -> dict:
    # max_tokens AUTOMATIC (omitted) — a low cap makes ollama reasoners return empty content.
    return {"name": f"openai/{model}",
            "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": temperature}}


def load_prompt(name: str) -> str:
    return (PROMPTS / name).read_text()


def fill(t: str, **slots) -> str:
    for k, v in slots.items():
        t = t.replace("{{" + k + "}}", v if isinstance(v, str) else json.dumps(v))
    return t


def extract_json(s: str):
    """Pull the first balanced JSON object/array out of an LLM reply.
    strict=False tolerates literal newlines/tabs inside strings (LLMs emit these in long
    fields like extractedText/exposition); brace-balancing (string-aware) avoids the greedy
    regex grabbing a stray brace in trailing prose."""
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
    return json.loads(s[start:], strict=False)  # unbalanced — let json raise with detail


async def llm(model_dict: dict, prompt: str, user_input: str = "go") -> str:
    chain = PromptChain(models=[model_dict], instructions=[prompt + "\n\n{input}" if "{input}" not in prompt else prompt])
    return await chain.process_prompt_async(user_input)


async def infer_system(subject: str) -> str:
    """Derive the medical system/specialty for ANY subject (the model knows them all — NOT a hardcoded list)."""
    try:
        r = await llm(ollama(MODEL_REASON),
            "You are a medical curriculum router. Name the SINGLE best medical system/specialty that contains the topic. "
            "Reply with ONLY the specialty name — e.g. Immunology, Dermatology, Radiology, Cardiovascular, Neurology, Endocrine, "
            "Hematology/Oncology, Infectious Disease, Nephrology, Gastroenterology, Respiratory, Musculoskeletal, Psychiatry, "
            "Reproductive, Genetics. No other words.\nTopic: " + subject, "go")
        s = (r or "").strip().splitlines()[0].strip().strip('."*').strip()
        return s[:48] if s else "General Medicine"
    except Exception:
        return "General Medicine"


def claude_p(prompt: str) -> str:
    """Headless Claude Code (strong Claude — Opus/Sonnet) as a function step (D4d). Prompt via stdin."""
    r = subprocess.run(["claude", "-p", "--dangerously-skip-permissions"],
                       input=prompt, capture_output=True, text=True, timeout=600)
    return r.stdout.strip()


async def call_engine(prompt: str, model_dict: dict) -> str:
    """One model call via the configured strong engine: glm-5.2 (Ollama) or headless Claude (claude -p)."""
    if CHAPTER_ENGINE == "claude":
        return await asyncio.to_thread(claude_p, prompt + "\n\nReturn ONLY the JSON object, no prose.")
    return await llm(model_dict, prompt)


async def json_with_repair(prompt: str, name: str, model_dict: dict, validate_fn=None, max_repair: int = 3):
    """SELF-REPAIR LOOP (pharos REPAIR pattern): call the model; if the JSON won't parse OR fails
    validate_fn, re-prompt it with the previous output + the exact problem and loop (≤max_repair).
    On exhaustion returns None (caller flags needs_review and KEEPS GOING — a bad chapter must not
    kill the whole lesson). This is LOOP #1/#3 from the investigation, made real."""
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
    """LLM call that MUST return JSON. On parse failure, dump raw to .scratch/<name>.raw for debugging."""
    raw = await llm(model_dict, prompt, user_input)
    try:
        return extract_json(raw)
    except Exception as e:
        (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
        dbg = OUT / ".scratch" / f"{name}.raw.txt"
        dbg.write_text(raw or "(EMPTY RESPONSE)")
        print(f"[ERROR] {name}: JSON parse failed ({e}); raw len={len(raw)} dumped → {dbg}", flush=True)
        raise


# ── Phase 0 — source pack (deterministic grounding via harrison-search) ─────────
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


def harrison(query: str, n: int = 6) -> str:
    try:
        r = subprocess.run([str(HOME / ".local/bin/harrison-search"), "-q", query, "-n", str(n), "--prose", "--full"],
                           capture_output=True, text=True, timeout=180)
        return r.stdout.strip()
    except Exception as e:
        return f"[harrison-search unavailable: {e}]"


def build_source_pack() -> str:
    (OUT / "source").mkdir(parents=True, exist_ok=True)
    sp = OUT / "source" / f"{SLUG}-source.md"
    if sp.exists() and sp.stat().st_size > 500:
        return sp.read_text()
    print(f"[phase 0] grounding source pack from Harrison's for: {SUBJECT}")
    text = _user_ctx() + f"# {SUBJECT} — grounded source pack (Harrison's 22e)\n\n" + harrison(SUBJECT, n=10)
    sp.write_text(text)
    return text


# ── Phase 0.5 — LIBRARY-DEDUP (no LLM): what's already been generated ───────────
def dedup_scan() -> dict:
    """Scan existing medicine lessons' chapter*.json for already-covered concept_ids +
    existing vignette stems/(concept,category) keys. Returns the AVOID set."""
    covered_concepts, vignettes = set(), []
    already_exists = OUT.exists() and any(OUT.glob("chapter*.json"))
    for cj in glob.glob(str(GEN / "chiron-*" / "chapter*.json")):
        try:
            d = json.load(open(cj))
        except Exception:
            continue
        for c in (d.get("keyConcepts") or []):
            covered_concepts.add(str(c).lower())
        for w in (d.get("widgets") or []):
            if w.get("type") == "mcq-clinical-vignette":
                vignettes.append({"stem": str(w.get("stem", ""))[:140],
                                  "category": w.get("vignetteCategory"),
                                  "lesson": Path(cj).parent.name})
    # keyConcepts live in syllabus.json (chapter-level), not chapter*.json — scan both.
    for sj in glob.glob(str(GEN / "chiron-*" / "syllabus.json")):
        try:
            syl = json.load(open(sj))
        except Exception:
            continue
        for ch in (syl if isinstance(syl, list) else syl.get("chapters", [])):
            for c in (ch.get("keyConcepts") or []):
                covered_concepts.add(str(c).lower())
    avoid = {"already_generated_this_subject": already_exists,
             "covered_concepts": sorted(covered_concepts),
             "existing_vignettes": vignettes}
    print(f"[phase 0.5] dedup: {len(covered_concepts)} concepts + {len(vignettes)} vignettes already in library"
          + (f" — WARNING: '{SLUG}' already generated" if already_exists else ""))
    (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
    (OUT / ".scratch" / "dedup.json").write_text(json.dumps(avoid, indent=2))
    return avoid


def avoid_block(avoid: dict, for_vignettes: bool = False) -> str:
    b = ("\n\n## ALREADY IN THE LIBRARY — DO NOT DUPLICATE\n"
         f"Concepts already taught in other lessons (cover only if essential, don't center a chapter on them): "
         f"{', '.join(avoid['covered_concepts'][:60]) or '(none)'}\n")
    if for_vignettes and avoid["existing_vignettes"]:
        ex = "\n".join(f"- [{v['category']}] {v['stem']}" for v in avoid["existing_vignettes"][:40])
        b += ("EXISTING clinical-vignette MCQs (DO NOT reproduce these cases, stems, or the same "
              f"concept+category combination — make NET-NEW vignettes):\n{ex}\n")
    return b


# ── Phase 1 — Brief + Syllabus ─────────────────────────────────────────────────
async def phase1(source: str, avoid: dict):
    OUT.mkdir(parents=True, exist_ok=True)
    brief_p = fill(load_prompt("01-brief.md"), domain="medicine", sourceType="markdown",
                   sourcePath=str(OUT / "source"), extractedText=source[:8000], metadata={"subject": SUBJECT})
    # Robustness: do NOT make the LLM echo the (large) source text back inside JSON — it fails to
    # escape quotes/backslashes in a 12K blob → invalid JSON. Leave it empty; we inject it after.
    brief_p += '\n\nIMPORTANT: in your output JSON, set "extractedText" to "" (empty string). Do NOT echo the source text.'
    print("[phase 1] brief…", flush=True)
    brief = await json_with_repair(brief_p, "brief", ollama(MODEL_REASON))
    if brief is None:
        raise RuntimeError("[chiron] phase-1 brief: the reasoning model returned unusable JSON after 3 repair attempts — try regenerating (usually transient).")
    brief["extractedText"] = source            # inject the real source deterministically
    brief.setdefault("metadata", {})["subject"] = SUBJECT
    (OUT / "brief.json").write_text(json.dumps(brief, indent=2))

    syl_p = fill(load_prompt("02-syllabus.md"), brief=brief,
                 curriculum={"chapterCountTarget": N_CHAPTERS, "subMode": "amboss", "system": SYSTEM},
                 themeBlock="(clinical theme)", conceptDag="(medicine concept DAG)")
    syl_p += avoid_block(avoid)
    syl_p += (f"\n\nReturn a JSON array of EXACTLY {N_CHAPTERS} chapters covering '{SUBJECT}'. "
              "Each: {chapterId, chapterNumber, title, narrative (150-400w arc), keyConcepts[], "
              "widgets:[{type}]} — medicine chapters MUST include a 'mcq-clinical-vignette' widget.")
    print("[phase 1] syllabus…", flush=True)
    syl = await json_with_repair(syl_p, "syllabus", ollama(MODEL_REASON))
    if syl is None:
        raise RuntimeError("[chiron] phase-1 syllabus: unusable JSON after 3 repair attempts — try regenerating.")
    if isinstance(syl, dict):
        syl = syl.get("chapters") or syl.get("syllabus") or [syl]
    (OUT / "syllabus.json").write_text(json.dumps(syl, indent=2))
    print(f"[phase 1] syllabus: {len(syl)} chapters -> {[c.get('title') for c in syl]}")
    return syl


# ── Phase 2 — Validate (light, deterministic; full Zod is in TS) ────────────────
def validate(syl) -> list:
    issues = []
    if not isinstance(syl, list) or not syl:
        issues.append("syllabus is not a non-empty array")
        return issues
    for i, c in enumerate(syl):
        if not c.get("title"):
            issues.append(f"ch{i}: missing title")
        if not (c.get("keyConcepts")):
            issues.append(f"ch{i}: missing keyConcepts")
    print(f"[phase 2] validate: {'OK' if not issues else issues}")
    return issues


# ── render-check gate (node renderWidget + shared normalizer) — the lint_runtime rung ──
def render_check(chapter_obj) -> list:
    """Run skill/scripts/render-check.mjs on a candidate chapter. Returns the list of widgets
    that fail to render (after normalization) — [] means every widget renders. Empty/error → []."""
    try:
        sc = OUT / ".scratch"; sc.mkdir(parents=True, exist_ok=True)
        tmp = sc / "_rendercheck.json"; tmp.write_text(json.dumps(chapter_obj))
        r = subprocess.run(["node", str(SKILL / "scripts" / "render-check.mjs"), str(tmp)],
                           capture_output=True, text=True, timeout=60)
        return json.loads(r.stdout).get("failures", []) if r.stdout.strip() else []
    except Exception:
        return []  # never block authoring on the checker itself failing


# ── Phase 3 — per-chapter author (grounded + AVOID + light verify) ──────────────
async def author_chapter(chapter, source: str, avoid: dict, idx: int):
    n = chapter.get("chapterNumber", idx + 1)
    condition = chapter.get("title", SUBJECT)
    if (OUT / f"chapter{n}.json").exists() and os.environ.get("CH_FORCE") != "1":
        print(f"[phase 3] chapter {n} — RESUME (already authored, skip)", flush=True)
        return n
    grounding = harrison(condition + " " + " ".join(chapter.get("keyConcepts", [])[:3]), n=5)
    p = fill(load_prompt("04a-chapter-write.md"), chapterSyllabus=chapter) \
        + "\n\n## CLINICAL VIGNETTE (mandatory)\n" + load_prompt("04c-quiz-clinical-vignette.md") \
        + "\n\n" + load_prompt("04u-medical-algorithm-widgets.md")  # shared DDx/algorithm widget pedagogy (parity w/ skill)
    p += (f"\n\n## GROUNDING (Harrison's — ground every clinical claim to this or the source; never invent):\n{grounding[:6000]}"
          f"\n\n## SOURCE PACK:\n{source[:4000]}"
          + avoid_block(avoid, for_vignettes=True)
          + f"\n\nReturn ONE JSON object: {{chapterIndex:{n}, title, exposition, widgets:[...]}} for chapter '{condition}'. "
            "widgets MUST include a full mcq-clinical-vignette (stem, keyInfo[], 5 options w/ per-distractor "
            "explanation, hammer, attendingTip, vignetteCategory). NET-NEW vignette, not in the AVOID list.")
    print(f"[phase 3] chapter {n} — {condition} (grounded {len(grounding)}c, engine={CHAPTER_ENGINE})…", flush=True)
    def ch_valid(obj):
        iss = []
        # prose may be under any of these keys — the assembler accepts narrativeHtml OR exposition.
        if not any(obj.get(k) for k in ("exposition", "narrativeHtml", "narrative", "body", "prose")):
            iss.append("missing prose (exposition/narrativeHtml)")
        widgets = obj.get("widgets") or []
        if not any(w.get("type") == "mcq-clinical-vignette" for w in widgets):
            iss.append("missing the mandatory mcq-clinical-vignette widget")
        return iss or None
    ch = await json_with_repair(p, f"chapter{n}", ollama(MODEL_STRUCT), validate_fn=ch_valid)
    if ch is None:
        (OUT / f"chapter{n}.NEEDS_REVIEW").write_text(f"chapter {n} ({condition}) failed validation after repair attempts")
        print(f"[phase 3] chapter {n} — NEEDS_REVIEW (kept lesson running)", flush=True)
        return None
    ch.setdefault("chapterIndex", n); ch.setdefault("title", condition)
    # RENDER-CHECK gate (deterministic): drop any widget that still fails to render after normalization,
    # so the assembled lesson is guaranteed 0-failed. Re-prompting can't fix field-aliases (empirically),
    # so we DROP + LOG (extend widget-normalize.mjs for recurring drops) rather than waste model calls.
    fails = render_check(ch)
    if fails:
        bad = {f["index"] for f in fails}
        ch["widgets"] = [w for i, w in enumerate(ch.get("widgets", [])) if i not in bad]
        (OUT / ".scratch" / f"chapter{n}.dropped.json").write_text(json.dumps(fails, indent=2))
        print(f"[phase 3] chapter {n} — dropped {len(bad)} unrenderable widget(s): "
              f"{[f['type'] for f in fails]} (logged → .scratch/chapter{n}.dropped.json)", flush=True)
    (OUT / f"chapter{n}.json").write_text(json.dumps(ch, indent=2))
    return n


async def phase3(syl, source, avoid):
    async def handler(item, state):
        i = state["_idx"] = state.get("_idx", -1) + 1
        try:
            r = await author_chapter(item, source, avoid, i)
        except Exception as e:               # a chapter must NEVER kill the whole lesson
            print(f"[phase 3] chapter idx {i}: unexpected error ({e}) — skipped, lesson continues", flush=True)
            r = None
        state.setdefault("done", []).append(r)
    state = await over_worklist(syl, handler, max_iters=len(syl) + 1, max_seconds=2400)
    done = [x for x in state.get("done", []) if x]
    print(f"[phase 3] authored {len(done)}/{len(syl)} chapters: {sorted(done)}"
          + (f" | {len(syl)-len(done)} flagged NEEDS_REVIEW" if len(done) < len(syl) else ""), flush=True)
    return state


# ── Phase 3.9 — SHELL ASSETS (fn) — copy theme CSS next to the lesson ───────────
def copy_shell_assets():
    """Copy skill/shell/themes/*.css → <out>/themes/ so the assembler's
    <link href="themes/*.css"> tags RESOLVE. Historically a manual/agent step (SKILL.md BLOCKING rule);
    making it an explicit deterministic CHAIN step is why headless lessons come out STYLED, not bare."""
    import shutil
    src = SKILL / "shell" / "themes"
    dst = OUT / "themes"
    dst.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in src.glob("*.css"):
        shutil.copyfile(f, dst / f.name); n += 1
    print(f"[phase 3.9] shell assets: copied {n} theme CSS → {dst.name}/ (lesson will be STYLED)", flush=True)


# ── Phase 4 — Assemble (node; typed JSON -> HTML, NO model codes HTML) ──────────
def assemble():
    assembler = SKILL / "scripts" / "assemble-medicine.mjs"
    if not assembler.exists():
        print(f"[phase 4] SKIP assemble — generic assembler not built yet ({assembler.name}); "
              "chapterN.json are ready. (Task #7: generalize build-bloodchem-assemble.mjs.)")
        return
    print("[phase 4] assemble -> lesson.html")
    subprocess.run(["node", str(assembler), str(OUT)], check=True)


# ── Phase 5.5 / 6 — AUDIO sub-chain: lecture scripts → bake (Atelier) → QC ──────
def lesson_sections() -> list:
    """[{id, title, contentText}] per chapter. id = chapterId = the lesson's section DOM id
    (what the bake's audio-scripts sectionId must match). contentText = the exposition (tags stripped)."""
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
        prose = re.sub(r"<[^>]+>", " ", prose); prose = re.sub(r"\s+", " ", prose).strip()
        secs.append({"id": cid, "title": d.get("title") or ch.get("title", ""), "contentText": prose[:3500]})
    return secs


async def phase_lecture_scripts():
    """Stage-4s: elicit the spoken lecture (summary + shortened/overview + one per chapter)."""
    secs = lesson_sections()
    print(f"[phase 5.5] lecture scripts for {len(secs)} sections + summary + overview…", flush=True)
    p = fill(load_prompt("04s-lecture-script.md"), lessonTitle=SUBJECT, domain="medicine",
             sections=secs, granularity="all")
    p += ("\n\n## MEDICAL-TTS SAFETY (BLOCKING): this is SPOKEN audio. Write every electrolyte/clinical "
          "term as plain English 'low/high X' BEFORE any Latin (the TTS reverses hypo-/hyper- prefixes). "
          "Return ONLY the JSON object {\"artifacts\":[...]}.")
    res = await json_with_repair(p, "lecture-scripts", ollama(MODEL_REASON)) or {}
    arts = res.get("artifacts", res if isinstance(res, list) else [])
    # transform artifacts -> audio-scripts.json {summary, shortened, sections:{id:segments}}
    out = {"summary": [], "sections": {}}
    for a in arts:
        k, segs = a.get("kind"), a.get("segments", [])
        if k == "summary": out["summary"] = segs
        elif k == "shortened": out["shortened"] = segs
        elif k == "section" and a.get("sectionId"): out["sections"][a["sectionId"]] = segs
    (OUT / "audio-scripts.json").write_text(json.dumps(out, indent=2))
    print(f"[phase 5.5] audio-scripts.json: summary={len(out['summary'])} seg, "
          f"shortened={'yes' if out.get('shortened') else 'no'}, sections={list(out['sections'])}", flush=True)
    return out


def bake_audio():
    """Phase 6 — bake via Atelier OmniVoice on the Mac (pauls_tutor, −20 LUFS) + Gemini audio-QC."""
    print("[phase 6] bake → Atelier OmniVoice (Mac) …", flush=True)
    # --persona pauls-tutor: activePersonaFor('medicine') is unset in ~/.chiron/packs/active.json, so the
    # bake would fall back to lucrezia (wrong voices map). Force the medicine voice explicitly.
    # ECONOMY: Gemini audio-QC fires per-clip (token hog) — OFF by default (the lecture-script already
    # applies the hypo/hyper safety). Opt in with CH_AUDIO_QC=1; cheap whisper+text QC is the real fix.
    cmd = ["node", str(SKILL / "scripts" / "bake-lesson-audio.mjs"), str(OUT),
           "--domain", "medicine", "--persona", "pauls-tutor"]
    if os.environ.get("CH_AUDIO_QC") != "1":
        cmd.append("--no-qc")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=2400)
    tail = (r.stdout or "")[-1200:] + "\n" + (r.stderr or "")[-1200:]
    print(tail, flush=True)
    clips = sorted((OUT / "audio").glob("**/*.mp3")) if (OUT / "audio").exists() else []
    print(f"[phase 6] baked {len(clips)} audio clip(s) → audio/", flush=True)


# ── orchestrate ────────────────────────────────────────────────────────────────
async def main():
    global SYSTEM
    assert OLLAMA_KEY, "OLLAMA_API_KEY not set (source ~/.config/environment.d/ollama-cloud.conf)"
    if not SYSTEM:
        SYSTEM = await infer_system(SUBJECT)
        print(f"[phase 0] inferred system for '{SUBJECT}': {SYSTEM}", flush=True)
    print(f"=== chiron medicine chain | subject='{SUBJECT}' system='{SYSTEM}' chapters={N_CHAPTERS} stage={STAGE} -> {OUT}")
    source = build_source_pack()
    avoid = dedup_scan()
    # Resume (stateful, D5): reuse an existing valid plan instead of re-running Phase 1 every time.
    syl_path = OUT / "syllabus.json"
    if syl_path.exists() and os.environ.get("CH_FORCE") != "1":
        syl = json.loads(syl_path.read_text())
        if isinstance(syl, dict):
            syl = syl.get("chapters") or syl.get("syllabus") or [syl]
        print(f"[phase 1] RESUME — reusing existing syllabus ({len(syl)} chapters). CH_FORCE=1 to replan.", flush=True)
    else:
        syl = await phase1(source, avoid)
    issues = validate(syl)
    if issues:
        print("[abort] validation issues (v1 stops; Phase-2 retry loop is the next increment):", issues)
        return
    if STAGE in ("chapters", "all"):
        await phase3(syl, source, avoid)
    if STAGE in ("assemble", "all"):
        copy_shell_assets()   # Phase 3.9 — themes next to the lesson (styling)
        # Phase 3.95 — curated end-of-lesson glossary (grounded; the assembler renders glossary.json)
        try:
            subprocess.run(["python3", str(SKILL / "scripts" / "gen-glossary.py"), str(OUT)],
                           timeout=240, check=False)
        except Exception as e:
            print(f"[phase 3.95] glossary gen skipped ({e})", flush=True)
        assemble()
    if STAGE in ("audio", "all"):
        await phase_lecture_scripts()   # Phase 5.5 — lecture scripts → audio-scripts.json
        bake_audio()                    # Phase 6 — Atelier bake + QC
    print("=== done.")


if __name__ == "__main__":
    asyncio.run(main())
