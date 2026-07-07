"""Chiron MEDICAL-ITALIAN WARD lesson generator — focused PromptChain.

Turns a disease/ward TOPIC into a chiron medical-Italian ward lesson (the diabete / pronto-soccorso
shape: cold-open + vocab tables + grammar pearls + doctor↔patient dialogues + stories + match-madness),
Lucrezia-voiced, bilingual. Shares the deterministic `assemble-language.mjs` with the pure-Italian chain.
Architecture template: the passage chain (2026-06-30_chiron-medical-italian-passage-chain).

  Phase 0  RESOLVE  — topic + setting (ward OR specialist) + slug.
  Phase 2  AUTHOR   — LLM → content.json (medical-Italian ward shape), grounded (Harrison/PACES, scoped).
  Phase 2.6 SCENARIO — grounded clinical-scenario chat (group-chat-animation, EN toggle) — appended.
  Phase 3  ASSEMBLE — assemble-language.mjs → lesson.html.
  Phase 4  AUDIO    — 04s bilingual lecture + per-section reads → audio-scripts.json.
  Phase 5  BAKE     — bake-lesson-audio.mjs --domain language-it --persona lucrezia (CH_STAGE=all / CH_BAKE=1).

Run:  cd ~/Documents/PromptChain && CH_TOPIC="type 2 diabetes" CH_SETTING="il diabetologo" CH_STAGE=all \
        bash scripts/observe.sh runs/2026-06-30_chiron-wards-lesson-chain
Env:  OLLAMA_API_KEY ; CH_TOPIC (required) ; CH_SETTING (optional) ; CH_STAGE (author|scenario|assemble|audio|all).
"""
from promptchain.observability import init_mlflow
init_mlflow()

import asyncio
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
from promptchain import PromptChain

HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
PROMPTS = SKILL / "prompts"
GEN = HOME / "Documents/generated"
OLLAMA_KEY = os.environ.get("OLLAMA_API_KEY", "")

DOMAIN = "medicine"
LEARNER = os.environ.get("CH_LEARNER", "Gyasi")
TOPIC = os.environ.get("CH_TOPIC", "")
SETTING = os.environ.get("CH_SETTING", "")
STAGE = os.environ.get("CH_STAGE", "author")
MODEL = os.environ.get("CH_MODEL_REASON", "glm-5.2")
SLUG = "chiron-ward-" + re.sub(r"[^a-z0-9]+", "-", (TOPIC or "lesson").lower()).strip("-")
OUT = GEN / SLUG


def ollama(model=MODEL, temperature=0.4):
    return {"name": f"openai/{model}",
            "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": temperature}}


def load_prompt(name): return (PROMPTS / name).read_text()


def extract_json(s):
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s.strip(), flags=re.M).strip()
    start = next((i for i, ch in enumerate(s) if ch in "{["), -1)
    if start < 0: return json.loads(s, strict=False)
    op = s[start]; cl = "}" if op == "{" else "]"
    depth = 0; ins = False; esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if ins:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': ins = False
        else:
            if ch == '"': ins = True
            elif ch == op: depth += 1
            elif ch == cl:
                depth -= 1
                if depth == 0: return json.loads(s[start:i + 1], strict=False)
    return json.loads(s[start:], strict=False)


async def llm(model_dict, prompt, user_input="go"):
    chain = PromptChain(models=[model_dict],
                        instructions=[prompt + "\n\n{input}" if "{input}" not in prompt else prompt])
    return await chain.process_prompt_async(user_input)


async def json_with_repair(prompt, name, model_dict, validate_fn=None, max_repair=3):
    cur, last = prompt, ""
    for attempt in range(1, max_repair + 1):
        try:
            last = await llm(model_dict, cur)
        except Exception as e:
            print(f"[repair] {name} {attempt}: LLM errored ({e}) — retry", flush=True)
            await asyncio.sleep(3); continue
        try:
            obj = extract_json(last)
        except Exception as e:
            print(f"[repair] {name} {attempt}: parse failed ({e}) — re-prompt", flush=True)
            cur = prompt + f"\n\n## PREVIOUS OUTPUT INVALID JSON\n{e}\nReturn ONLY corrected valid JSON."
            continue
        issues = validate_fn(obj) if validate_fn else None
        if issues:
            print(f"[repair] {name} {attempt}: invalid ({issues[:2]}) — re-prompt", flush=True)
            cur = prompt + f"\n\n## PROBLEMS\n{issues}\nReturn ONLY corrected valid JSON."
            continue
        return obj
    (OUT / ".scratch").mkdir(parents=True, exist_ok=True)
    (OUT / ".scratch" / f"{name}.raw.txt").write_text(last or "(EMPTY)")
    return None


# ── grounding (SCOPED to medical accuracy of THIS lesson) ──
def harrison(q, n=4):
    try:
        r = subprocess.run([str(HOME / ".local/bin/harrison-search"), "-q", q, "-n", str(n), "--prose"],
                           capture_output=True, text=True, timeout=150)
        return r.stdout.strip()[:2800]
    except Exception as e:
        return f"[harrison unavailable: {e}]"


# ── Phase 2 — AUTHOR the ward-shape content.json ──
async def phase2_author():
    OUT.mkdir(parents=True, exist_ok=True)
    grounding = harrison(TOPIC, n=5)
    setting = SETTING or "il reparto appropriato (medicina interna, pronto soccorso, o lo specialista)"
    p = (
        f"You are Lucrezia, a warm Italian medical tutor. Author a MEDICAL-ITALIAN ward lesson on **{TOPIC}**, "
        f"set in **{setting}**, for {LEARNER} — a native-English-speaker DOCTOR learning medical Italian for the SSM exam.\n"
        "LANGUAGE-FIRST: the goal is to UNDERSTAND and SPEAK the Italian; the medicine is the bonus (but must be ACCURATE).\n\n"
        f"## GROUNDING (Harrison's — keep every clinical claim accurate to this; do not invent):\n{grounding}\n\n"
        "## OUTPUT — return ONLY a content.json with EXACTLY this schema:\n"
        "{\n"
        '  "title": "<Italian title>", "subtitle": "<one EN sentence>", "langName": "Italiano medico", "cefr": "B1-B2",\n'
        '  "coldOpen": {"it":"<Lucrezia greets Gyasi by name, frames the topic, in Italian>", "en":"<EN translation>"},\n'
        '  "sections": [   // EXACTLY these 4 content sections, ids verbatim:\n'
        '    {"id":"malattia","title":"1 La malattia e i termini", "introHtml":"<short IT intro, 1-2 sentences>",\n'
        '       "vocab":[{"slug":"<kebab>","it":"<term IT>","en":"<EN>","note":"<short note, may use <em>>"}, ... 6-8 terms],\n'
        '       "pearls":[{"slug":"<kebab>","it":"<Italian grammar/usage pearl, may use <em>>","en":"<EN explanation>"}]},\n'
        '    {"id":"diagnosi","title":"2 La diagnosi e gli esami", "vocab":[... 5-7 terms: exams, lab values, signs],\n'
        '       "pearls":[{...1 pearl}]},\n'
        '    {"id":"terapia","title":"3 La terapia e i consigli", "vocab":[... 5-7 terms: drugs, management],\n'
        '       "stories":[{"id":"terapia","it":"<a short IT clinical vignette paragraph>","en":"<EN gloss>"}]},\n'
        '    {"id":"paziente","title":"4 Spiegare al paziente",\n'
        '       "dialogue":{"id":"paziente","turns":[\n'
        '          {"who":"a","label":"Paziente","text":"<patient asks/says, IT>"},\n'
        '          {"who":"learner","label":"Tu (il medico)","text":"<the DOCTOR=Gyasi answers, IT — NEVER voiced>"}, ...6-8 turns]}}\n'
        "  ],\n"
        '  "srCards": [{"front":"<IT term>","back":"<EN>"}, ... 8 cards],\n'
        '  "closingHtml": "<short IT riepilogo paragraph>"\n'
        "}\n\n"
        "RULES: clinically accurate Italian; vocab `it` = the Italian medical term, `en` = English. In the dialogue, the\n"
        "PATIENT is `who:\"a\"` (voiced) and the DOCTOR (Gyasi) is `who:\"learner\"` (NEVER voiced — his lines to speak).\n"
        "slugs kebab-case + unique. Return ONLY the JSON."
    )

    def valid(o):
        secs = o.get("sections") or []
        if len(secs) < 3: return ["need >=3 sections"]
        if not any(s.get("vocab") for s in secs): return ["no vocab tables"]
        return None
    print(f"[phase 2] AUTHOR ward content.json for '{TOPIC}' (grounded {len(grounding)}c)…", flush=True)
    content = await json_with_repair(p, "content", ollama(), validate_fn=valid)
    if content is None:
        print("[phase 2] content failed — see .scratch/content.raw.txt"); return None
    (OUT / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=2))
    nv = sum(len(s.get("vocab", [])) for s in content.get("sections", []))
    print(f"[phase 2] content.json: '{content.get('title')}' — {len(content['sections'])} sections, "
          f"{nv} vocab, {sum(1 for s in content['sections'] if s.get('dialogue'))} dialogues", flush=True)
    return content


def assemble():
    print("[phase 3] ASSEMBLE → assemble-language.mjs", flush=True)
    r = subprocess.run(["node", str(SKILL / "scripts" / "assemble-language.mjs"), str(OUT)],
                       capture_output=True, text=True)
    print("  " + (r.stdout or r.stderr).strip()[-300:], flush=True)
    return r.returncode == 0


# ── Phase 4 — AUDIO TRANSCRIPTS (04s bilingual lecture from the lesson sections) ──
def fill(t, **slots):
    for k, v in slots.items():
        t = t.replace("{{" + k + "}}", v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
    return t


def _strip(h): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h or "")).strip()


def _sections_for_04s(content):
    secs = []
    for s in content.get("sections", []):
        parts = [_strip(s.get("introHtml", ""))]
        parts += [f"{v.get('it','')} — {v.get('en','')}" for v in s.get("vocab", [])]
        parts += [_strip(p.get("it", "")) + " " + p.get("en", "") for p in s.get("pearls", [])]
        if s.get("dialogue"):
            parts += [t.get("text", "") for t in s["dialogue"].get("turns", [])]
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
    res = await json_with_repair(p, "lecture-scripts", ollama(),
                                 validate_fn=lambda o: None if (isinstance(o, dict) and o.get("artifacts")) else ["no artifacts"])
    arts = (res or {}).get("artifacts", [])
    out = {"summary": [], "sections": {}}
    for a in arts:
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


async def main():
    assert OLLAMA_KEY, "OLLAMA_API_KEY not set"
    assert TOPIC, "CH_TOPIC not set (e.g. CH_TOPIC='type 2 diabetes')"
    print(f"=== chiron WARDS chain | topic='{TOPIC}' setting='{SETTING or '(auto)'}' stage={STAGE} -> {OUT}")
    if (OUT / "content.json").exists() and os.environ.get("CH_FORCE") != "1" and STAGE != "author":
        print("[phase 2] RESUME — reusing content.json", flush=True)
    else:
        if await phase2_author() is None: return
    if STAGE in ("assemble", "audio", "all"):
        if not assemble(): print("=== assemble failed"); return
    if STAGE in ("audio", "all"):
        await phase4_audio_scripts()
        if STAGE == "all" or os.environ.get("CH_BAKE") == "1":
            bake()
        else:
            print("[phase 5] BAKE skipped — CH_STAGE=all or CH_BAKE=1 to bake.", flush=True)
    if (OUT / "lesson.html").exists():
        print(f"=== done → {OUT}/lesson.html")
    else:
        print(f"=== authored content.json (no lesson.html — run CH_STAGE=assemble to build it) → {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
