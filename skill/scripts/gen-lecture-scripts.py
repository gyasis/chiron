#!/usr/bin/env python3
"""Generate audio-scripts.json (lecture scripts) for an EXISTING assembled lesson that lacks them.
Reads syllabus.json + chapterN.json → per-section lecture scripts (04s prompt, GLM) → audio-scripts.json,
so `bake-lesson-audio.mjs` can then bake the section audio. For old-pipeline lessons (e.g. sarcoma-amboss)
whose sections were never scripted. Idempotent-friendly: overwrites audio-scripts.json.

Usage: OLLAMA_API_KEY=… python3 gen-lecture-scripts.py <lesson-dir> "<Lesson Title>" [medicine|medical-italian]
"""
import asyncio, json, os, re, sys
from pathlib import Path
from promptchain import PromptChain

HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
PROMPTS = SKILL / "prompts"
OLLAMA_KEY = os.environ["OLLAMA_API_KEY"]
OUT = Path(sys.argv[1]).expanduser()
SUBJECT = sys.argv[2]
DOMAIN = sys.argv[3] if len(sys.argv) > 3 else "medicine"


def load_prompt(n): return (PROMPTS / n).read_text()
def fill(t, **s):
    for k, v in s.items():
        t = t.replace("{{" + k + "}}", v if isinstance(v, str) else json.dumps(v))
    return t


def extract_json(s):
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s.strip(), flags=re.M).strip()
    st = next((i for i, c in enumerate(s) if c in "{["), -1)
    if st < 0:
        return json.loads(s, strict=False)
    o = s[st]; cl = "}" if o == "{" else "]"; d = 0; instr = False; esc = False
    for i in range(st, len(s)):
        c = s[i]
        if instr:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == o: d += 1
            elif c == cl:
                d -= 1
                if d == 0:
                    return json.loads(s[st:i + 1], strict=False)
    return json.loads(s[st:], strict=False)


async def llm(prompt):
    ch = PromptChain(models=[{"name": "openai/glm-5.2",
                              "params": {"api_base": "https://ollama.com/v1", "api_key": OLLAMA_KEY, "temperature": 0.4}}],
                     instructions=[prompt + "\n\n{input}"])
    return await ch.process_prompt_async("go")


def lesson_sections():
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


async def main():
    secs = lesson_sections()
    print(f"[gen-scripts] {len(secs)} sections for '{SUBJECT}': {[s['id'] for s in secs]}", flush=True)
    p = fill(load_prompt("04s-lecture-script.md"), lessonTitle=SUBJECT, domain=DOMAIN, sections=secs, granularity="all")
    p += ("\n\n## MEDICAL-TTS SAFETY (BLOCKING): spoken audio — write every clinical term as plain English "
          "'low/high X' BEFORE any Latin (the TTS reverses hypo-/hyper- prefixes). Return ONLY {\"artifacts\":[...]}.")
    raw = await llm(p)
    res = extract_json(raw)
    arts = res.get("artifacts", res if isinstance(res, list) else [])
    out = {"summary": [], "sections": {}}
    for a in arts:
        k, segs = a.get("kind"), a.get("segments", [])
        if k == "summary": out["summary"] = segs
        elif k == "shortened": out["shortened"] = segs
        elif k == "section" and a.get("sectionId"): out["sections"][a["sectionId"]] = segs
    (OUT / "audio-scripts.json").write_text(json.dumps(out, indent=2))
    print(f"[gen-scripts] audio-scripts.json: summary={len(out['summary'])} shortened={'y' if out.get('shortened') else 'n'} "
          f"sections={list(out['sections'])}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
