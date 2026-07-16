#!/usr/bin/env python3
"""Generate a curated end-of-lesson glossary.json from a lesson's chapters (grounded, no invention).
Usage: gen-glossary.py <lesson-dir>   (writes <dir>/glossary.json; the assembler renders it). Free-ish: 1 glm call."""
import glob, json, os, re, subprocess, sys
from pathlib import Path

OUT = Path(sys.argv[1]).expanduser()
KEY = os.environ.get("OLLAMA_API_KEY", "")
MODEL = os.environ.get("CH_MODEL_STRUCT", "glm-5.2")

def strip(html): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()

# gather lesson content (chapter prose + vignette stems/keyInfo — the real terms live here)
chunks, subject = [], OUT.name.replace("chiron-", "").replace("-amboss", "").replace("-", " ")
for cj in sorted(glob.glob(str(OUT / "chapter*.json"))):
    d = json.load(open(cj))
    chunks.append(f"## {d.get('title','')}\n" + strip(d.get("exposition") or d.get("narrativeHtml") or "")[:1800])
    for w in d.get("widgets", []):
        if w.get("type") == "mcq-clinical-vignette":
            chunks.append("KEY: " + " · ".join(str(k) for k in (w.get("keyInfo") or []))[:300])
content = "\n".join(chunks)[:14000]

prompt = (f"From this medical lesson on '{subject}', extract a GLOSSARY of the 18-28 most important terms a "
          "learner must know (diseases, signs, labs, drugs, mechanisms, eponyms). For EACH: a concise "
          "1-sentence definition GROUNDED in the lesson content — do NOT invent. Return ONLY a JSON array: "
          '[{"term":"...","definition":"..."}], alphabetized by term.\n\nLESSON:\n' + content)

def ollama(prompt):
    import urllib.request
    body = json.dumps({"model": MODEL, "messages": [{"role": "user", "content": prompt}],
                       "temperature": 0.2}).encode()
    req = urllib.request.Request("https://ollama.com/v1/chat/completions", data=body,
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]

raw = ollama(prompt)
m = re.search(r"\[.*\]", re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M), re.S)
entries = json.loads(m.group(0))
entries = [e for e in entries if e.get("term") and e.get("definition")]
entries.sort(key=lambda e: e["term"].lower())
(OUT / "glossary.json").write_text(json.dumps(entries, indent=2))
print(f"[gen-glossary] {len(entries)} terms → {OUT.name}/glossary.json")
