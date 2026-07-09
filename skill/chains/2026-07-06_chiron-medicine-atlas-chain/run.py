"""Chiron MEDICINE ATLAS lesson generator — the organ-system SURVEY depth (chain variant).

Second depth in the depth ladder (primer < ATLAS < systematic). Unlike the primer (which GROUPS
curated issues into a handful of concise chapters), the ATLAS:
  - READS `skill/blueprints/disease-atlas.json` for the subject's curated organ-system issue list,
  - BOUNDS to the top ~N high-yield diseases (CH_MAX_DISEASES, default 12) so the atlas stays a
    manageable 10-15 chapters — one chapter PER DISEASE (entity-axis survey, deterministic mapping,
    no LLM planning step: `brief.clinicalAtlasUnits` = the disease list, chapterCountExact = len(diseases)),
  - authors EVERY chapter as a FULL canonical AMBOSS disease article (the FULL 04a widget palette —
    NOT the primer's stripped-down set): why-care-callout, pattern-cards, flow-animation for DDx/
    workup, step-cards for protocols, agreement-matrix, assertion-reason, glossary-tooltips, ONE
    mandatory mcq-clinical-vignette, and srCards — covering overview -> epidemiology -> etiology ->
    pathophysiology -> clinical-features -> diagnostics -> differential -> treatment ->
    complications -> prognosis inside the chapter,
  - assembles (assemble-medicine.mjs) -> bakes (Atelier/Mac) -> stamps chiron.json tags -> library index.
Good for a full organ-system survey (Cardiovascular, Respiratory, Neurology, ...) where the primer's
light 1-2-widget-per-chapter treatment would be too thin.

Verdict (C) Hybrid. Facts from code (atlas + harrison) drive WHICH diseases and HOW MANY chapters —
Phase 1 is fully deterministic, no LLM call. Judgment from LLM is reserved for per-chapter AUTHORING
(Phase 3) only. NO model ever codes HTML — typed chapter JSON -> deterministic assembler.

Run:  cd ~/Documents/PromptChain && bash scripts/observe.sh runs/2026-07-06_chiron-medicine-atlas-chain
Env:  OLLAMA_API_KEY ; CH_SUBJECT (atlas system name, default "Cardiovascular") ;
      CH_MAX_DISEASES (bound on high-yield diseases -> chapters, default 12) ;
      CH_STAGE (plan|chapters|assemble|audio|all).
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
ATLAS = SKILL / "blueprints" / "disease-atlas.json"
AMBOSS_CURR = json.loads((SKILL / "curricula" / "medicine-amboss.json").read_text())
GEN = HOME / "Documents/generated"
OLLAMA_KEY = os.environ.get("OLLAMA_API_KEY", "")

SUBJECT = os.environ.get("CH_SUBJECT", "").strip()
if __name__ == "__main__" and not SUBJECT:
    raise SystemExit("[chiron] CH_SUBJECT is empty — refusing to generate a placeholder lesson (wrong-subject guard).")
MAX_DISEASES = int(os.environ.get("CH_MAX_DISEASES", "12"))
STAGE = os.environ.get("CH_STAGE", "plan")  # plan | chapters | assemble | audio | all
SLUG = "chiron-" + re.sub(r"[^a-z0-9]+", "-", SUBJECT.lower()).strip("-") + "-atlas"
OUT = GEN / SLUG

MODEL_REASON = os.environ.get("CH_MODEL_REASON", "glm-5.2")
MODEL_STRUCT = os.environ.get("CH_MODEL_STRUCT", "glm-5.2")
CHAPTER_ENGINE = os.environ.get("CH_CHAPTER_ENGINE", "glm")  # "glm" | "claude"


def ollama(model: str, temperature: float = 0.4) -> dict:
    return {"name": f"openai/{model}",
            "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": temperature}}


def load_prompt(name: str) -> str:
    return (PROMPTS / name).read_text()


def fill(t: str, **slots) -> str:
    for k, v in slots.items():
        t = t.replace("{{" + k + "}}", v if isinstance(v, str) else json.dumps(v))
    return t


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


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


# ── Phase 0.5 — READ the curated atlas + BOUND to top high-yield diseases ──────
def atlas_diseases() -> list:
    """Read disease-atlas.json for SUBJECT, keep only highYield===True entries (some rows carry a
    stray non-bool 'highYield' array — treat strictly, `is True` only), drop cross-list pointer rows
    ("... (see OtherSystem)" — a duplicate of another system's canonical entry), and bound to the
    first MAX_DISEASES in curated order (the atlas is already roughly importance-ordered)."""
    atlas = json.loads(ATLAS.read_text())
    entry = next((s for s in atlas["systems"]
                  if s["system"] == SUBJECT or SUBJECT in (s.get("aliases") or [])), None)
    if not entry:
        raise SystemExit(f"[abort] subject '{SUBJECT}' not found in {ATLAS.name}. "
                         f"Available: {[s['system'] for s in atlas['systems']]}")
    all_d = entry["diseases"]
    selected = []
    for d in all_d:
        if d.get("highYield") is not True:
            continue
        if re.search(r"\(see\s", d["name"], re.I):
            continue  # cross-list pointer to another system's canonical entry — skip the duplicate
        selected.append(d)
        if len(selected) >= MAX_DISEASES:
            break
    print(f"[phase 0.5] atlas '{SUBJECT}': {len(all_d)} total diseases -> {len(selected)} high-yield "
          f"(bounded to {MAX_DISEASES}): {[d['name'] for d in selected]}", flush=True)
    return selected


# ── Phase 1 — PLAN: one chapter PER disease (DETERMINISTIC, no LLM) ─────────────
def build_syllabus(diseases: list) -> list:
    syl = []
    for i, d in enumerate(diseases, start=1):
        name = d["name"]
        syl.append({
            "chapterNumber": i,
            "chapterId": slugify(name),
            "title": name,
            "diseaseName": name,
            "keyConcepts": d.get("aliases", []),
            "sources": d.get("sources", []),
            "narrative": f"Full AMBOSS-style survey of {name}: presentation, workup, and management.",
        })
    return syl


def phase1(diseases: list, source: str):
    OUT.mkdir(parents=True, exist_ok=True)
    syl = build_syllabus(diseases)
    # brief.json: clinicalAtlasUnits + chapterCountExact are the forward-path tags the 04a prompt +
    # assembler prefer (chapter count = atlas length; overrides chapterCountTarget/Exact — see
    # skill/prompts/04a-chapter-write.md "Brief inputs that drive medicine layout").
    (OUT / "brief.json").write_text(json.dumps(
        {"domain": "medicine", "subMode": "atlas", "extractedText": source,
         "metadata": {"subject": SUBJECT, "topic": SUBJECT, "depth": "atlas"},
         "clinicalAtlasUnits": [d["name"] for d in diseases],
         "chapterCountExact": len(diseases)}, indent=2))
    (OUT / "syllabus.json").write_text(json.dumps(syl, indent=2))
    print(f"[phase 1] DETERMINISTIC syllabus (no LLM, one chapter per disease): {len(syl)} chapters -> "
          f"{[c['title'] for c in syl]}", flush=True)
    return syl


# ── Phase 2 — Validate (light) ─────────────────────────────────────────────────
def validate(syl) -> list:
    issues = []
    if not isinstance(syl, list) or not syl:
        return ["syllabus is not a non-empty array"]
    for i, c in enumerate(syl):
        if not c.get("title"):
            issues.append(f"ch{i}: missing title")
    print(f"[phase 2] validate: {'OK' if not issues else issues}", flush=True)
    return issues


# ── Phase 3 — per-chapter author (Harrison-grounded, FULL AMBOSS widget palette) ─
async def author_chapter(chapter, idx: int):
    n = chapter.get("chapterNumber", idx + 1)
    disease = chapter.get("diseaseName") or chapter.get("title", SUBJECT)
    key_concepts = chapter.get("keyConcepts", []) or []
    if (OUT / f"chapter{n}.json").exists() and os.environ.get("CH_FORCE") != "1":
        print(f"[phase 3] chapter {n} — RESUME (exists, skip)", flush=True)
        return n
    grounding = harrison(disease + " " + " ".join(key_concepts[:3]), n=5)
    p = fill(load_prompt("04a-chapter-write.md"), chapterSyllabus=chapter, curriculum=AMBOSS_CURR) \
        + "\n\n## CLINICAL VIGNETTE (mandatory)\n" + load_prompt("04c-quiz-clinical-vignette.md") \
        + "\n\n" + load_prompt("04u-medical-algorithm-widgets.md")
    p += (
        f"\n\n{USER_CTX}## GROUNDING (Harrison's — ground every clinical claim to this; never invent):\n{grounding[:6000]}"
        f"\n\n## ATLAS SURVEY (BLOCKING — CRITICAL, do NOT reduce widgets): Produce a FULL canonical "
        f"AMBOSS disease article for '{disease}' — a high-yield SURVEY covering overview -> epidemiology "
        f"-> etiology -> pathophysiology -> clinical-features -> diagnostics -> differential -> "
        f"treatment -> complications -> prognosis inside the chapter. Use the FULL 04a widget palette "
        f"(why-care-callout to open, pattern-cards, flow-animation for DDx/workup algorithms, step-cards "
        f"for protocols, agreement-matrix, assertion-reason, glossary-tooltips), ONE full "
        f"mcq-clinical-vignette, varied widgets per the curriculum widgetMix, and srCards (aim "
        f"perChapterSrCardTarget={AMBOSS_CURR.get('perChapterSrCardTarget', 8)}). This is a SURVEY "
        f"chapter, NOT a light primer — do not strip the widget set down."
        f"\n\nReturn ONE JSON object: {{\"chapterIndex\": {n}, \"title\": \"{disease}\", "
        f"\"exposition\": \"...\", \"widgets\": [...], \"srCards\": [...]}}."
    )
    print(f"[phase 3] chapter {n} — {disease} (grounded {len(grounding)}c, engine={CHAPTER_ENGINE})…", flush=True)

    def ch_valid(obj):
        iss = []
        if not any(obj.get(k) for k in ("exposition", "narrativeHtml", "narrative", "body", "prose")):
            iss.append("missing prose (exposition/narrativeHtml)")
        widgets = obj.get("widgets") or []
        if not any(w.get("type") == "mcq-clinical-vignette" for w in widgets):
            iss.append("missing the mandatory mcq-clinical-vignette widget")
        if len(widgets) < 4:
            iss.append("widget palette too thin for an atlas SURVEY chapter (<4) — use the FULL 04a "
                       "palette, this is not a primer")
        return iss or None

    ch = await json_with_repair(p, f"chapter{n}", ollama(MODEL_STRUCT), validate_fn=ch_valid)
    if ch is None:
        (OUT / f"chapter{n}.NEEDS_REVIEW").write_text(f"chapter {n} ({disease}) failed validation after repair")
        print(f"[phase 3] chapter {n} — NEEDS_REVIEW (kept lesson running)", flush=True)
        return None
    ch.setdefault("chapterIndex", n); ch.setdefault("title", disease)
    ch.setdefault("chapterId", chapter.get("chapterId", f"ch-{n}"))
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
        "title": f"Chiron · {SUBJECT} — Atlas",
        "entry": "lesson.html",
        "domain": "medicine",
        "created": date.today().isoformat(),
        "audioClips": clips,
        "generator": "chiron-atlas",
        "status": "staged",  # new lessons land in the library's "Needs Review" band until accepted
        "tags": {"dom": "medicine", "sys": SUBJECT, "subj": None, "scope": "system", "depth": "atlas"},
    }
    (OUT / "chiron.json").write_text(json.dumps(chiron_json, indent=2))
    print(f"[phase 7] stamped chiron.json (tags: medicine/{SUBJECT}/atlas, clips={clips})", flush=True)
    print("[phase 7] rebuilding chiron library index…", flush=True)
    r = subprocess.run(["node", str(SKILL / "scripts" / "build-library-index.mjs")],
                       capture_output=True, text=True, timeout=180)
    print(((r.stdout or "")[-600:] + "\n" + (r.stderr or "")[-400:]), flush=True)


# ── orchestrate ────────────────────────────────────────────────────────────────
async def main():
    assert OLLAMA_KEY, "OLLAMA_API_KEY not set (source ~/.config/environment.d/ollama-cloud.conf)"
    print(f"=== chiron ATLAS | subject='{SUBJECT}' max_diseases={MAX_DISEASES} stage={STAGE} -> {OUT}")
    diseases = atlas_diseases()
    source = (f"# {SUBJECT} — atlas grounding\n\nCurated high-yield diseases: "
              f"{', '.join(d['name'] for d in diseases)}\n\n" + harrison(SUBJECT, n=8))
    syl_path = OUT / "syllabus.json"
    if syl_path.exists() and os.environ.get("CH_FORCE") != "1":
        syl = json.loads(syl_path.read_text())
        if isinstance(syl, dict):
            syl = syl.get("chapters") or syl.get("syllabus") or [syl]
        print(f"[phase 1] RESUME — reusing syllabus ({len(syl)} chapters). CH_FORCE=1 to rebuild.", flush=True)
    else:
        syl = phase1(diseases, source)
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
