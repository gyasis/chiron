#!/usr/bin/env python3
"""Name/summarize scenes from their DIALOGUE (text LLM, no vision, no Gemini) — the fallback for when video
scene-naming is unavailable/blocked. We already have the cuts (boundaries) + the character-attributed dialogue,
so naming is a cheap text task. Fills name/location/summary/characters on any UNNAMED scene, in place.
Usage: name_scenes_dialogue.py <transcript.json> [--force]  (--force renames even already-named scenes)"""
import sys, json, asyncio, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import episode_enrich as EN   # reuse the glm-5.1 -> deepseek ladder + json_with_repair

FORCE = "--force" in sys.argv
tpath = Path([a for a in sys.argv[1:] if not a.startswith("-")][0])

def _valid(o):
    return None if isinstance(o, dict) and (o.get("name") or "").strip() else ["need a non-empty name"]

async def name_one(s):
    lines = s.get("lines") or []
    dlg = "\n".join(f"{l.get('character','?')}: {l.get('italian_text','')}" for l in lines[:45] if l.get("italian_text"))
    if not dlg.strip():
        return None
    prompt = (
        "You are titling ONE scene of an Italian TV episode for a language lesson, using ONLY its dialogue "
        "(character-attributed Italian below). Infer the situation from what's said.\n\n"
        f"## DIALOGUE\n{dlg}\n\n"
        "Return STRICT JSON only: {\"name\":\"<short English scene title, 2-5 words>\","
        "\"location\":\"<best-guess setting>\",\"summary\":\"<1 English sentence: what happens>\","
        "\"characters_present\":[\"Name\",...]}")
    return await EN.json_with_repair(prompt, f"name-scene{s.get('scene')}", validate_fn=_valid)

async def main():
    data = json.loads(tpath.read_text())
    scenes = data if isinstance(data, list) else data.get("scenes", data)
    # the transcript/renderer schema uses `title` (scene header) + `situation` (summary) — NOT `name`.
    todo = [s for s in scenes if (FORCE or not (s.get("title") or "").strip()) and (s.get("lines"))]
    print(f"[name] naming {len(todo)}/{len(scenes)} scenes from dialogue · ladder={'->'.join(EN._ladder())}", flush=True)
    done = 0
    for s in todo:
        o = await name_one(s)
        if o:
            s["title"] = o.get("name")
            s["situation"] = o.get("summary") or s.get("situation")
            s["location"] = o.get("location") or s.get("location")
            s["characters_present"] = o.get("characters_present") or s.get("characters_present") or []
            done += 1
            print(f"  scene {s.get('scene')}: {o.get('name')}  [{o.get('location')}]", flush=True)
    tpath.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"[name] named {done}/{len(todo)} scenes → {tpath}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
