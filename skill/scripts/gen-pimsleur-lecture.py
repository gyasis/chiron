#!/usr/bin/env python3
"""gen-pimsleur-lecture — add Lucrezia's Riepilogo (summary) + Lezione (shortened) audio to a Pimsleur-only lesson.
Script step = the pipeline's own 04s prompt + chain model path (CH_MODEL_STRUCT, default gemma4:31b, via chiron_models with thinking off, no max_tokens);
bake step = bake-lesson-audio.mjs --only summary,shortened (Lucrezia, language-it). Backs up first; idempotent.
Usage: OLLAMA_API_KEY=… python3 gen-pimsleur-lecture.py <lesson-dir>"""
import asyncio, json, os, re, shutil, subprocess, sys, time
from pathlib import Path
from promptchain import PromptChain
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "chains")); import chiron_models
OUT = Path(sys.argv[1]).expanduser().resolve()
TS = time.strftime("%Y%m%d-%H%M%S")
KEY = os.environ["OLLAMA_API_KEY"]

def strip(h): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[\s\S]*?</\1>", "", h))).strip()
def extract_json(s):
    chiron_models.refuse_leaked(s)
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s.strip(), flags=re.M).strip()
    st = s.index("{"); d = 0; ins = esc = False
    for i in range(st, len(s)):
        c = s[i]
        if ins:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': ins = False
        elif c == '"': ins = True
        elif c == "{": d += 1
        elif c == "}":
            d -= 1
            if d == 0: return json.loads(s[st:i + 1], strict=False)
    raise ValueError("unbalanced JSON (truncated?)")

def done_kinds():
    try: m = json.load(open(OUT / "audio/manifest.json"))
    except Exception: return set()
    return {c["artifact"] for c in m["clips"] if c.get("status") in ("done", "reused") and (OUT / c["audioPath"]).exists()}

def words(segs): return sum(len(s["text"].split()) for s in segs)
def validate(o):
    arts = {a.get("kind"): a.get("segments", []) for a in o.get("artifacts", [])}
    iss = []
    for k, lo, hi in (("summary", 110, 230), ("shortened", 560, 1000)):
        sg = arts.get(k)
        if not sg: iss.append(f"missing {k}"); continue
        w = words(sg)
        if not lo <= w <= hi: iss.append(f"{k} has {w} words; must be {lo}-{hi}")
        for i, s in enumerate(sg):
            if s.get("lang") not in ("it", "en") or not s.get("text", "").strip(): iss.append(f"{k}[{i}] bad segment"); break
            if s["lang"] == "it" and i + 1 < len(sg) and sg[i + 1]["lang"] == "it" and False: pass
        if sg and sg[-1]["lang"] == "it" and k == "shortened": pass
    return iss

async def llm(md, prompt):
    if md.get("_claude"):   # pipeline AUTHOR_LADDER rung 2: headless claude -p
        r = await asyncio.to_thread(subprocess.run, ["claude", "-p", "--dangerously-skip-permissions"], input=prompt + "\n\nReturn ONLY the JSON object, no prose.", capture_output=True, text=True, timeout=600)
        if r.returncode: raise RuntimeError(f"claude -p exited {r.returncode}: {(r.stderr or r.stdout).strip()[-300:]}")
        return r.stdout.strip()
    ch = PromptChain(models=[md], instructions=[prompt + "\n\n{input}"])
    return await ch.process_prompt_async("go")

async def main():
    have = done_kinds()
    if {"summary", "shortened"} <= have: print(f"[skip] {OUT.name}: already has summary+shortened"); return
    pj = json.load(open(OUT / "pimsleur.json"))
    title = pj["title"].replace("Pimsleur · ", "")
    phrases = "\n".join(f"- {i['it']} — {i['en']}" for i in pj["items"])
    secs = [{"id": "lesson", "title": title, "contentText": ("SCENE: " + " ".join(pj.get("intro", [])) + "\nLESSON PHRASES:\n" + phrases + "\nPAGE TEXT: " + strip((OUT / "lesson.html").read_text())[:2500])}]
    prompt = (Path(HERE.parent / "prompts/04s-lecture-script.md").read_text()
              .replace("{{lessonTitle}}", title).replace("{{domain}}", "language-it")
              .replace("{{sections}}", json.dumps(secs, ensure_ascii=False)).replace("{{granularity}}", "summary and shortened ONLY (no section artifacts)"))
    prompt += ("\n\n## LEARNER + PODCAST (BLOCKING): native English speaker; audio is a PODCAST. English is the medium; every Italian term is its OWN "
               "lang:'it' segment and the NEXT lang:'en' glosses it. Persona Lucrezia: greet 'Gyasi' by name in the summary, sign off warmly. "
               "Use ONLY the lesson's own phrases and facts above; invent nothing. Spoken, so no lists or symbols.\n"
               "LENGTH (BLOCKING): `summary` = about 150 words total (~1 minute spoken). `shortened` (the Lezione, a talk-through of the whole lesson) = "
               "about 700 words total (~4-5 minutes spoken): walk through the scene, each phrase in Italian with its English gloss, a grammar note or two, and a closing.\n"
               "Return ONLY {\"artifacts\":[{\"kind\":\"summary\",...},{\"kind\":\"shortened\",...}]}.")
    md = chiron_models.thinking_off({"name": f"openai/{chiron_models.resolve(os.environ.get('CH_MODEL_STRUCT', 'gemma4:31b'))}",
          "params": {"api_base": "https://ollama.com/v1", "api_key": KEY, "temperature": 0.4}})
    cur, obj, last = prompt, None, ""
    for attempt in range(1, 7):
        try:
            last = await llm(md, cur)
            if not (last or "").strip(): print(f"[retry {attempt}] empty output"); continue
            o = extract_json(last)
        except Exception as e:
            if any(t in str(e).lower() for t in ("ratelimit", "429", "usage limit")) and not md.get("_claude"):
                print(f"[ladder] {md['name']} rate-limited ({str(e)[-120:]}) -> falling to claude -p (pipeline AUTHOR_LADDER)"); md = {"name": "claude", "_claude": True}; continue
            print(f"[retry {attempt}] {e}"); cur = prompt + f"\n\n## PREVIOUS OUTPUT INVALID/TRUNCATED: {e}\nReturn ONLY complete valid JSON."; continue
        iss = validate(o)
        if not iss: obj = o; break
        print(f"[retry {attempt}] {iss}")
        # The previous draft goes back with the problems, so a short script is expanded rather than rewritten from scratch.
        cur = (prompt + f"\n\n## PROBLEMS\n{iss}\nA script that is too short: keep every segment of your draft below and ADD "
               "segments (more scene detail, one more example per phrase, a grammar note) until it is inside the range. "
               "Return ONLY the corrected complete JSON.\n\n## YOUR DRAFT\n" + json.dumps(o, ensure_ascii=False))
    if not obj: print(f"[FAIL] {OUT.name}: no valid script after retries"); sys.exit(2)
    asp = OUT / "audio-scripts.json"
    for f in (asp, OUT / "audio/manifest.js", OUT / "audio/manifest.json"):
        if f.exists(): shutil.copy2(f, f.with_name(f.name + f".bak-lucrezia-{TS}"))
    cur_as = json.loads(asp.read_text()) if asp.exists() else {}
    for a in obj["artifacts"]:
        if a["kind"] in ("summary", "shortened"): cur_as[a["kind"]] = a["segments"]
    asp.write_text(json.dumps(cur_as, ensure_ascii=False, indent=2))
    print(f"[script] summary={words(cur_as['summary'])}w shortened={words(cur_as['shortened'])}w; baking…", flush=True)
    r = subprocess.run(["node", str(HERE / "bake-lesson-audio.mjs"), str(OUT), "--domain", "language-it", "--persona", "lucrezia", "--only", "summary,shortened"],
                       capture_output=True, text=True, timeout=2400)
    print((r.stdout + r.stderr)[-600:])
    if r.returncode: sys.exit(r.returncode)

asyncio.run(main())
