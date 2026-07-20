"""Chiron PURE-ITALIAN (non-medical) lesson generator — focused PromptChain.

Turns a TOPIC (a word, a grammar point, an everyday situation) into a regular Italian-language lesson
(the appunto / al-bar shape: cold-open + vocab tables + grammar pearls + everyday dialogues + stories +
match-madness), Lucrezia-voiced, bilingual. Shares the deterministic `assemble-language.mjs` with the
wards chain. NO medical grounding — general Italian. Architecture template: the wards chain.

  Phase 0  RESOLVE  — topic + slug.
  Phase 2  AUTHOR   — LLM → content.json (general-Italian shape; sections fit the topic).
  Phase 2.6 SCENARIO — optional everyday-conversation chat (group-chat-animation, EN toggle).
  Phase 3  ASSEMBLE — assemble-language.mjs → lesson.html.
  Phase 4/5 AUDIO+BAKE — 04s bilingual + section reads (shared with the other chains).

Run:  cd ~/Documents/PromptChain && CH_TOPIC="how to use the word appunto" CH_STAGE=assemble \
        bash scripts/observe.sh runs/2026-06-30_chiron-pure-italian-lesson-chain
Env:  OLLAMA_API_KEY ; CH_TOPIC (required) ; CH_STAGE (author|assemble|audio|all).
"""
from promptchain.observability import init_mlflow
init_mlflow()

import asyncio, json, os, re, subprocess, sys
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)
from promptchain import PromptChain
import sys as _sys; from pathlib import Path as _P; _sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
import obs   # shared chains/obs.py — per-lesson steps.jsonl observability (best-effort; never breaks generation)

HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
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
MODEL = os.environ.get("CH_MODEL_REASON", "glm-5.1")
SLUG = "chiron-italian-" + re.sub(r"[^a-z0-9]+", "-", (TOPIC or "lesson").lower()).strip("-")[:48]
OUT = GEN / SLUG


def ollama(model=MODEL, t=0.45):
    return {"name": f"openai/{model}", "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": t}}


# Model FALLBACK ladder: when the primary can't produce valid JSON after its repairs, try the next model.
_FB = [m.strip() for m in os.environ.get("CH_MODEL_FALLBACKS", "gemma4:31b,gemini/gemini-flash-latest,gpt-5-mini").split(",") if m.strip()]
FALLBACKS = [m for m in _FB if not (m.startswith("gpt-") and not OPENAI_KEY) and not (m.startswith("gemini") and not GEMINI_KEY)]


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


async def json_with_repair(prompt, name, md, validate_fn=None, max_repair=3):
    ladder = [md] + [model_for(m) for m in FALLBACKS]
    last = ""
    for mi, cmd in enumerate(ladder):
        tag = cmd.get("name", "?")
        cur = prompt
        for attempt in range(1, max_repair + 1):
            try: last = await llm(cmd, cur)
            except Exception as e:
                _msg = str(e).lower()
                if 'ratelimit' in _msg or '429' in _msg or 'usage limit' in _msg or 'rate limit' in _msg or 'resource_exhausted' in _msg or 'quota' in _msg:
                    print(f"[repair] {name} [{tag}]: rate-limited (429) — skipping retries, falling to next model", flush=True)
                    break   # advance the ladder to the next model immediately; don't hammer a capped provider
                print(f"[repair] {name} [{tag}] {attempt}: LLM errored ({e})", flush=True); await asyncio.sleep(3); continue
            try: obj = extract_json(last)
            except Exception as e:
                cur = prompt + f"\n\n## PREVIOUS INVALID JSON\n{e}\nReturn ONLY corrected valid JSON."; continue
            iss = validate_fn(obj) if validate_fn else None
            if iss: cur = prompt + f"\n\n## PROBLEMS\n{iss}\nReturn ONLY corrected valid JSON."; continue
            if mi > 0: print(f"[repair] {name}: RECOVERED via fallback [{tag}]", flush=True)
            return obj
        if mi < len(ladder) - 1:
            nxt = ladder[mi + 1].get("name", "?")
            print(f"[repair] {name}: [{tag}] exhausted -> FALLBACK to [{nxt}]", flush=True)
    (OUT / ".scratch").mkdir(parents=True, exist_ok=True); (OUT / ".scratch" / f"{name}.raw.txt").write_text(last or "(EMPTY)")
    return None


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


async def phase2_author():
    OUT.mkdir(parents=True, exist_ok=True)
    p = (
        f"You are Lucrezia, a warm Italian tutor. Author a REGULAR (non-medical) Italian-language lesson on **{TOPIC}** "
        f"for {LEARNER} — a native-English speaker learning Italian. LANGUAGE-FIRST: the learner must understand and use the Italian.\n\n"
        + _user_ctx() +
        "## OUTPUT — return ONLY a content.json with this schema:\n"
        "{\n"
        '  "title":"<Italian title>", "subtitle":"<one EN sentence>", "langName":"Italiano", "cefr":"A2-B1",\n'
        '  "coldOpen":{"it":"<Lucrezia greets Gyasi by name, frames the topic, in Italian>","en":"<EN translation>"},\n'
        '  "sections":[   // 3-4 content sections that FIT THE TOPIC. ids: "chapter-1","chapter-2","chapter-3"[,"chapter-4"].\n'
        '    {"id":"chapter-1","title":"1 <Italian title>","introHtml":"<short IT intro>",\n'
        '       "vocab":[{"slug":"<kebab>","it":"<IT word/phrase>","en":"<EN>","note":"<short note, may use <em>example</em>>"}, ...5-8],\n'
        '       "pearls":[{"slug":"<kebab>","it":"<Italian grammar/usage pearl>","en":"<EN explanation>"}],\n'
        '       "dialogue":{"id":"chapter-1","turns":[{"who":"a","label":"<IT speaker>","text":"<IT>"},\n'
        '                   {"who":"learner","label":"Tu","text":"<Gyasi\'s line, IT — NEVER voiced>"}, ...]},\n'
        '       "stories":[{"id":"chapter-1","it":"<short IT story/example paragraph>","en":"<EN gloss>"}]},\n'
        '    ... (each section uses whichever of vocab/pearls/dialogue/stories fit) ],\n'
        '  "srCards":[{"front":"<IT>","back":"<EN>"}, ...6-8],\n'
        '  "closingHtml":"<short IT riepilogo paragraph>"\n'
        "}\n\n"
        "RULES: natural, correct Italian. In any dialogue the OTHER speaker is `who:\"a\"` (voiced), the learner (Gyasi) is\n"
        "`who:\"learner\"` (NEVER voiced). slugs kebab-case + unique. Real, idiomatic examples. Return ONLY the JSON."
    )
    def valid(o):
        secs = o.get("sections") or []
        if len(secs) < 2: return ["need >=2 sections"]
        if not any(s.get("vocab") for s in secs): return ["no vocab"]
        return None
    print(f"[phase 2] AUTHOR pure-Italian content.json for '{TOPIC}'…", flush=True)
    content = await json_with_repair(p, "content", ollama(), validate_fn=valid)
    if content is None: print("[phase 2] failed — see .scratch/content.raw.txt"); return None
    (OUT / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=2))
    nv = sum(len(s.get("vocab", [])) for s in content.get("sections", []))
    print(f"[phase 2] content.json: '{content.get('title')}' — {len(content['sections'])} sections, {nv} vocab", flush=True)
    return content


def assemble():
    print("[phase 3] ASSEMBLE → assemble-language.mjs", flush=True)
    r = subprocess.run(["node", str(SKILL / "scripts" / "assemble-language.mjs"), str(OUT)], capture_output=True, text=True)
    print("  " + (r.stdout or r.stderr).strip()[-300:], flush=True); return r.returncode == 0


# ── Phase 4/5 — AUDIO (04s bilingual lecture + inline clips from HTML) + BAKE ──
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
    res = await json_with_repair(p, "lecture-scripts", ollama(),
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


async def main():
    assert OLLAMA_KEY, "OLLAMA_API_KEY not set"
    assert TOPIC, "CH_TOPIC not set (e.g. CH_TOPIC='how to use the word appunto')"
    obs.set_out(OUT)
    print(f"=== chiron PURE-ITALIAN chain | topic='{TOPIC}' stage={STAGE} -> {OUT}")
    if (OUT / "content.json").exists() and os.environ.get("CH_FORCE") != "1" and STAGE != "author":
        print("[phase 2] RESUME — reusing content.json", flush=True)
    else:
        obs.phase("Writing the lesson content", "start")
        r = await phase2_author()
        obs.phase("Writing the lesson content", "end")
        if r is None: return
    if STAGE in ("assemble", "audio", "all"):
        obs.phase("Assembling the page", "start")
        ok = assemble()
        obs.phase("Assembling the page", "end")
        if not ok: print("=== assemble failed"); return
    if STAGE in ("audio", "all"):
        obs.phase("Writing narration scripts", "start")
        await phase4_audio_scripts()
        obs.phase("Writing narration scripts", "end")
        if STAGE == "all" or os.environ.get("CH_BAKE") == "1":
            obs.phase("Baking audio", "start")
            bake()
            obs.phase("Baking audio", "end")
        else:
            print("[phase 5] BAKE skipped — CH_STAGE=all or CH_BAKE=1 to bake.", flush=True)
    if (OUT / "lesson.html").exists():
        print(f"=== done → {OUT}/lesson.html")
    else:
        print(f"=== authored content.json (no lesson.html — run CH_STAGE=assemble to build it) → {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
