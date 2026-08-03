"""Chiron MEDICINE PRIMER lesson generator — the "simple & quick" depth (chain variant).

Third depth in the depth ladder (primer < atlas < systematic). Unlike the AMBOSS medicine chain
(one disease per chapter, LLM-planned), the PRIMER:
  - READS `skill/blueprints/disease-atlas.json` for the subject's curated issue list (our guidance),
  - GROUPS those issues into a handful of concise chapters (chapterCountExact — deterministic count),
  - authors each chapter as a FULL canonical AMBOSS chapter (full 04a widget palette + srCards) —
    "primer" = fewer, thematically-GROUPED chapters, NOT fewer widgets,
  - assembles (assemble-medicine.mjs) -> bakes (Atelier/Mac) -> stamps chiron.json tags -> library index.
Good for narrow systems (immunology/ENT/male-GU) and cross-cutting subjects (geriatrics).

Verdict (C) Hybrid. Facts from code (atlas + harrison), judgment from LLM (grouping + authoring).
NO model ever codes HTML — typed chapter JSON -> deterministic assembler.

Run:  cd ~/Documents/PromptChain && bash scripts/observe.sh runs/2026-07-05_chiron-medicine-primer-chain
Env:  OLLAMA_API_KEY ; CH_SUBJECT (atlas system name, default "Geriatrics – General") ;
      CH_CHAPTERS (grouped primer chapters, default 6) ; CH_STAGE (plan|chapters|assemble|audio|all).
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
import sys as _sys; from pathlib import Path as _P; _sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
import obs   # shared chains/obs.py — per-lesson steps.jsonl observability (best-effort; never breaks generation)
from promptchain.utils.external_loop import over_worklist

# ── config ────────────────────────────────────────────────────────────────────
HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
PROMPTS = SKILL / "prompts"
ATLAS = SKILL / "blueprints" / "disease-atlas.json"
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

SUBJECT = os.environ.get("CH_SUBJECT", "").strip()
if __name__ == "__main__" and not SUBJECT:
    raise SystemExit("[chiron] CH_SUBJECT is empty — refusing to generate a placeholder lesson (wrong-subject guard).")
N_CHAPTERS = int(os.environ.get("CH_CHAPTERS", "6"))
STAGE = os.environ.get("CH_STAGE", "plan")  # plan | chapters | assemble | audio | all
SLUG = "chiron-" + re.sub(r"[^a-z0-9]+", "-", SUBJECT.lower()).strip("-") + "-primer"
OUT = GEN / SLUG

MODEL_REASON = os.environ.get("CH_MODEL_REASON", "glm-5.1")
MODEL_STRUCT = os.environ.get("CH_MODEL_STRUCT", "glm-5.1")
CHAPTER_ENGINE = os.environ.get("CH_CHAPTER_ENGINE", "glm")  # "glm" | "claude"
AMBOSS_CURR = json.loads((SKILL / "curricula" / "medicine-amboss.json").read_text())  # full widget palette + targets


def ollama(model: str, temperature: float = 0.4) -> dict:
    return {"name": f"openai/{model}",
            "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": temperature}}


# Model FALLBACK ladder: when the primary can't produce valid JSON after its repairs, try the next model.
_FB = [m.strip() for m in os.environ.get("CH_MODEL_FALLBACKS", "local/gemma4:12b,deepseek-v4-flash,gpt-5-mini").split(",") if m.strip()]
FALLBACKS = [m for m in _FB if not (m.startswith("gpt-") and not OPENAI_KEY) and not (m.startswith("gemini") and not GEMINI_KEY) and not (m.startswith("local/") and not os.environ.get("CH_LOCAL_BASE"))]


def model_for(name: str, temperature: float = 0.4) -> dict:
    """model_dict for a bare model name. gpt-* → real OpenAI; everything else → Ollama Cloud (via ollama())."""
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
    try: chain.register_callback(obs.make_callback())
    except Exception: pass
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
    """Self-repair loop + MODEL FALLBACK: on unparseable/invalid JSON re-prompt the current model with the
    exact problem; if it still can't after max_repair, fall back to the next model in the ladder (primary +
    CH_MODEL_FALLBACKS). On exhaustion of every model returns None (caller flags needs_review, KEEPS GOING)."""
    ladder = [model_dict] + [model_for(m) for m in FALLBACKS]
    last_raw = ""
    for mi, md in enumerate(ladder):
        tag = md.get("name", "?")
        cur = prompt
        for attempt in range(1, max_repair + 1):
            try:
                last_raw = await call_engine(cur, md)
            except Exception as e:                   # transient LLM/network/provider error → retry same model, don't crash
                _msg = str(e).lower()
                if 'ratelimit' in _msg or '429' in _msg or 'usage limit' in _msg or 'rate limit' in _msg or 'resource_exhausted' in _msg or 'quota' in _msg:
                    print(f"[repair] {name} [{tag}]: rate-limited (429) — skipping retries, falling to next model", flush=True)
                    break   # advance the ladder to the next model immediately; don't hammer a capped provider
                print(f"[repair] {name} [{tag}] attempt {attempt}/{max_repair}: LLM call errored ({e}) — retrying", flush=True)
                await asyncio.sleep(3)
                continue
            try:
                obj = extract_json(last_raw)
            except Exception as e:
                print(f"[repair] {name} [{tag}] attempt {attempt}/{max_repair}: JSON parse failed ({e}) — re-prompting", flush=True)
                cur = (prompt + f"\n\n## YOUR PREVIOUS OUTPUT WAS INVALID JSON\nError: {e}\nPrevious output:\n{last_raw[:4000]}\n\n"
                       "Return ONLY corrected, valid JSON. Escape every \" and newline INSIDE string values.")
                continue
            issues = validate_fn(obj) if validate_fn else None
            if issues:
                print(f"[repair] {name} [{tag}] attempt {attempt}/{max_repair}: invalid ({issues[:2]}) — re-prompting", flush=True)
                cur = prompt + f"\n\n## YOUR PREVIOUS OUTPUT HAD PROBLEMS\n{issues}\nReturn ONLY corrected valid JSON fixing them."
                continue
            if mi > 0:
                print(f"[repair] {name}: RECOVERED via fallback [{tag}]", flush=True)
            return obj
        if mi < len(ladder) - 1:
            nxt = ladder[mi + 1].get("name", "?")
            print(f"[repair] {name}: [{tag}] exhausted {max_repair} attempts — FALLBACK to [{nxt}]", flush=True)
    (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
    (OUT / ".scratch" / f"{name}.raw.txt").write_text(last_raw or "(EMPTY)")
    print(f"[repair] {name}: ALL MODELS EXHAUSTED — flagging needs_review, continuing", flush=True)
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


# ── Phase 0.5 — READ the curated atlas (our guidance) ──────────────────────────
def atlas_issues() -> list:
    atlas = json.loads(ATLAS.read_text())
    entry = next((s for s in atlas["systems"]
                  if s["system"] == SUBJECT or SUBJECT in (s.get("aliases") or [])), None)
    if not entry:
        raise SystemExit(f"[abort] subject '{SUBJECT}' not found in {ATLAS.name}. "
                         f"Available: {[s['system'] for s in atlas['systems']]}")
    issues = [d["name"] for d in entry["diseases"]]
    print(f"[phase 0.5] atlas '{SUBJECT}': {len(issues)} curated issues -> grouping into {N_CHAPTERS} primer chapters", flush=True)
    return issues


# ── Phase 1 — PLAN: group the curated issues into N concise primer chapters ─────
async def phase1(issues: list, source: str):
    OUT.mkdir(parents=True, exist_ok=True)
    plan_p = (
        f"You are planning a SHORT medical PRIMER lesson on '{SUBJECT}'. This is a quick, high-yield "
        f"overview — NOT an exhaustive per-disease deep dive.\n\n"
        f"Our curriculum names these {len(issues)} clinical issues for this subject (cover the important ones; "
        f"you MAY merge closely-related issues into one chapter):\n- " + "\n- ".join(issues) + "\n\n"
        f"GROUP them into EXACTLY {N_CHAPTERS} coherent primer chapters (each chapter bundles related issues "
        f"under one teaching theme). Return a JSON array of EXACTLY {N_CHAPTERS} objects:\n"
        f'  {{"chapterNumber": <1-based>, "chapterId": "<kebab-id>", "title": "<theme title>", '
        f'"issues": ["<issue names covered>"], "narrative": "<80-150 word teaching arc, high-level only>", '
        f'"keyConcepts": ["<3-6 concepts>"]}}\n'
        f"Order chapters pedagogically (foundational first). Return ONLY the JSON array."
    )
    print("[phase 1] plan — grouping curated issues into primer chapters…", flush=True)
    syl = await llm_json(model_for(MODEL_REASON), plan_p, "syllabus")
    if isinstance(syl, dict):
        syl = syl.get("chapters") or syl.get("syllabus") or [syl]
    # brief.json (assembler/library read metadata from here + chiron.json)
    (OUT / "brief.json").write_text(json.dumps(
        {"domain": "medicine", "subMode": "primer", "extractedText": source,
         "metadata": {"subject": SUBJECT, "topic": SUBJECT, "depth": "primer"}}, indent=2))
    (OUT / "syllabus.json").write_text(json.dumps(syl, indent=2))
    print(f"[phase 1] syllabus: {len(syl)} chapters -> {[c.get('title') for c in syl]}", flush=True)
    return syl


# ── Phase 2 — Validate (light) ─────────────────────────────────────────────────
def validate(syl) -> list:
    issues = []
    if not isinstance(syl, list) or not syl:
        return ["syllabus is not a non-empty array"]
    if len(syl) != N_CHAPTERS:
        issues.append(f"expected {N_CHAPTERS} chapters, got {len(syl)}")
    for i, c in enumerate(syl):
        if not c.get("title"):
            issues.append(f"ch{i}: missing title")
    print(f"[phase 2] validate: {'OK' if not issues else issues}", flush=True)
    return issues


# ── Phase 3 — per-chapter author (Harrison-grounded, PRIMER-LIGHT) ──────────────
async def author_chapter(chapter, idx: int):
    n = chapter.get("chapterNumber", idx + 1)
    theme = chapter.get("title", SUBJECT)
    covered = chapter.get("issues", []) or chapter.get("keyConcepts", [])
    if (OUT / f"chapter{n}.json").exists() and os.environ.get("CH_FORCE") != "1":
        print(f"[phase 3] chapter {n} — RESUME (exists, skip)", flush=True)
        return n
    grounding = harrison(SUBJECT + " " + theme + " " + " ".join(covered[:4]), n=5)
    p = fill(load_prompt("04a-chapter-write.md"), chapterSyllabus=chapter, curriculum=AMBOSS_CURR) \
        + "\n\n## CLINICAL VIGNETTE (mandatory)\n" + load_prompt("04c-quiz-clinical-vignette.md") \
        + "\n\n" + load_prompt("04u-medical-algorithm-widgets.md")
    p += (
        f"\n\n{USER_CTX}## GROUNDING (Harrison's — ground every clinical claim to this; never invent):\n{grounding[:5000]}"
        f"\n\n## THIS PRIMER CHAPTER groups these clinical issues: {', '.join(covered)}."
        f"\n\n## WIDGETS (BLOCKING): produce a FULL canonical AMBOSS chapter — use the FULL 04a widget palette, NOT "
        f"a reduced set. Open with a why-care-callout; emit a VARIED widget mix per the curriculum widgetMix "
        f"({', '.join(AMBOSS_CURR.get('widgetMix', {}).keys())}) PLUS pedagogical widgets where they fit "
        f"(flow-animation for a differential/algorithm, step-cards for protocols, pattern-cards, agreement-matrix, "
        f"assertion-reason, glossary-tooltips); include ONE full mcq-clinical-vignette (stem, keyInfo[], 5 options "
        f"w/ per-distractor explanation, hammer, attendingTip, vignetteCategory); emit srCards "
        f"(aim ~{AMBOSS_CURR.get('perChapterSrCardTarget', 8)}). 'Primer' means fewer, THEMATICALLY-GROUPED chapters "
        f"— per-chapter widget VARIETY must match a full medicine lesson, NOT be reduced."
        f"\n\nReturn ONE JSON object: {{\"chapterIndex\": {n}, \"title\": \"{theme}\", \"exposition\": \"...\", "
        f"\"widgets\": [...], \"srCards\": [...]}}."
    )
    print(f"[phase 3] chapter {n} — {theme} (grounded {len(grounding)}c, engine={CHAPTER_ENGINE})…", flush=True)

    def ch_valid(obj):
        iss = []
        if not any(obj.get(k) for k in ("exposition", "narrativeHtml", "narrative", "body", "prose")):
            iss.append("missing prose (exposition/narrativeHtml)")
        if not any(w.get("type") == "mcq-clinical-vignette" for w in (obj.get("widgets") or [])):
            iss.append("missing the mandatory mcq-clinical-vignette widget")
        return iss or None

    ch = await json_with_repair(p, f"chapter{n}", model_for(MODEL_STRUCT), validate_fn=ch_valid)
    if ch is None:
        (OUT / f"chapter{n}.NEEDS_REVIEW").write_text(f"chapter {n} ({theme}) failed validation after repair")
        print(f"[phase 3] chapter {n} — NEEDS_REVIEW (kept lesson running)", flush=True)
        return None
    ch.setdefault("chapterIndex", n); ch.setdefault("title", theme)
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
    state = await over_worklist(syl, handler, max_iters=len(syl) + 1, max_seconds=1800)
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
    res = await llm_json(model_for(MODEL_REASON), p, "lecture-scripts")
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
        "title": f"Chiron · {SUBJECT} — Primer",
        "entry": "lesson.html",
        "domain": "medicine",
        "created": date.today().isoformat(),
        "audioClips": clips,
        "generator": "chiron-primer",
        "status": "staged",  # new lessons land in the library's "Needs Review" band until accepted
        # forward-path tags the library builder prefers (skips inference)
        "tags": {"dom": "medicine", "sys": "Geriatrics", "subj": SUBJECT, "scope": "subject", "depth": "primer"},
    }
    (OUT / "chiron.json").write_text(json.dumps(chiron_json, indent=2))
    print(f"[phase 7] stamped chiron.json (tags: medicine/Geriatrics/{SUBJECT}, clips={clips})", flush=True)
    print("[phase 7] rebuilding chiron library index…", flush=True)
    r = subprocess.run(["node", str(SKILL / "scripts" / "build-library-index.mjs")],
                       capture_output=True, text=True, timeout=180)
    print(((r.stdout or "")[-600:] + "\n" + (r.stderr or "")[-400:]), flush=True)


# ── orchestrate ────────────────────────────────────────────────────────────────
async def main():
    assert OLLAMA_KEY, "OLLAMA_API_KEY not set (source ~/.config/environment.d/ollama-cloud.conf)"
    obs.set_out(OUT)
    print(f"=== chiron PRIMER | subject='{SUBJECT}' chapters={N_CHAPTERS} stage={STAGE} -> {OUT}")
    obs.phase("Reading the atlas", "start")
    issues = atlas_issues()
    source = f"# {SUBJECT} — primer grounding\n\nCurated issues: {', '.join(issues)}\n\n" + harrison(SUBJECT, n=8)
    obs.phase("Reading the atlas", "end")
    syl_path = OUT / "syllabus.json"
    if syl_path.exists() and os.environ.get("CH_FORCE") != "1":
        syl = json.loads(syl_path.read_text())
        if isinstance(syl, dict):
            syl = syl.get("chapters") or syl.get("syllabus") or [syl]
        print(f"[phase 1] RESUME — reusing syllabus ({len(syl)} chapters). CH_FORCE=1 to replan.", flush=True)
    else:
        obs.phase("Planning the chapters", "start")
        syl = await phase1(issues, source)
        obs.phase("Planning the chapters", "end")
    issues_v = validate(syl)
    if issues_v and STAGE != "plan":
        print("[warn] validation issues (continuing):", issues_v)
    # 'audio' is the two-phase Phase-1 (viewable text + scripts, NO bake) — so it must also author
    # chapters + assemble, else there's no lesson.html and the bake fails "lesson.html not found".
    # Per-chapter RESUME (chapterN.json exists → skip) keeps this idempotent on retries.
    if STAGE in ("chapters", "assemble", "audio", "all"):
        obs.phase("Authoring chapters", "start")
        await phase3(syl)
        obs.phase("Authoring chapters", "end")
    if STAGE in ("assemble", "audio", "all"):
        obs.phase("Assembling the page", "start")
        copy_shell_assets()
        try:
            subprocess.run(["python3", str(SKILL / "scripts" / "gen-glossary.py"), str(OUT)], timeout=240, check=False)
        except Exception as e:
            print(f"[phase 3.95] glossary skipped ({e})", flush=True)
        assemble()
        obs.phase("Assembling the page", "end")
    clips = 0
    if STAGE in ("audio", "all"):
        obs.phase("Writing narration scripts", "start")
        await phase_lecture_scripts()
        obs.phase("Writing narration scripts", "end")
    if STAGE == "all":          # single-pass bakes inline; two-phase (stage=audio) stays viewable + bakes later via /bake
        obs.phase("Baking audio", "start")
        clips = bake_audio()
        obs.phase("Baking audio", "end")
    if STAGE in ("assemble", "audio", "all"):
        obs.phase("Publishing to the library", "start")
        register_library(clips)
        obs.phase("Publishing to the library", "end")
    print("=== done.")


if __name__ == "__main__":
    asyncio.run(main())
