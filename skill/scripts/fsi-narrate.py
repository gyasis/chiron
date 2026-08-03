#!/usr/bin/env python3
"""fsi-narrate — author audio-scripts.json so Lucrezia TEACHES the lesson, not just reads it.

    python3 fsi-narrate.py --lesson 2 [--model gemma4:31b] [--force]

The baker already voices every dialogue and vocabulary word from the page's own anchors.
This adds the other half of the 🎧 panel:

    summary    -> panel group "Whole lesson"  — how this lesson works and what carries it
    shortened  -> same group, a quick re-listen
    sections   -> panel group "By section"    — teaching commentary per section id

The rule that makes this worth baking: Lucrezia must TEACH here, never re-read what is
already on screen. A narration that just recites the dialog is dead weight — it has to
say the thing the page cannot: why this grammar bites, what an English speaker gets
wrong, why FSI ordered the steps this way.

Only sections that genuinely reward commentary get a clip; a vocabulary table with no
trap in it does not need Lucrezia talking over it.

Runs on Ollama Cloud (the lane the enricher uses). Resumable — re-running is free.
"""
from __future__ import annotations
import argparse, json, os, re, sys, urllib.request
from pathlib import Path

GEN   = Path.home() / "Documents/generated"
CLOUD = "https://ollama.com/api/chat"

# Which section kinds are worth Lucrezia's voice, and the angle she should take on each.
NARRATE = {
    "prose":      "the background and why it matters practically, not as trivia",
    "dialog":     "what to listen FOR — the shape of the exchange, whose lines are longer and why",
    "vocab":      "2-3 items with a real trap or a usage habit; ignore the obvious ones",
    "pearls":     "the deepest grammar point, said out loud, with the mistake it prevents",
    "repeat":     "what to physically listen for — vowels, doubled consonants, stress",
    "drill":      "why a drill with one unchanging answer is not trivial",
    "variants":   "the step where memorising stops working and listening starts",
    "narrative":  "how to listen once, and what the exercise is baiting you into",
    "situations": "why these scenes exist and how to work them",
}


def _key() -> str:
    k = os.environ.get("OLLAMA_API_KEY", "")
    if k:
        return k
    for f in (Path.home() / ".config/environment.d/ollama-cloud.conf", Path.home() / "dev/.env"):
        try:
            for line in f.read_text().splitlines():
                line = re.sub(r"^export\s+", "", line.strip())
                if line.startswith("OLLAMA_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("\"'")
        except Exception:
            pass
    sys.exit("OLLAMA_API_KEY not found")


def llm(prompt: str, model: str, timeout: int = 180) -> str:
    body = json.dumps({"model": model, "stream": False,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(CLOUD, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {_key()}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return (json.loads(r.read().decode()).get("message") or {}).get("content", "")


def as_json(text: str):
    t = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    i = t.find("{")
    if i < 0:
        return None
    depth, instr, esc = 0, False, False
    for j in range(i, len(t)):
        c = t[j]
        if instr:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = False
            continue
        if c == '"': instr = True
        elif c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try: return json.loads(t[i:j + 1])
                except Exception: return None
    return None


def ask(prompt: str, model: str, tries: int = 3):
    for k in range(tries):
        out = as_json(llm(prompt + ("\n\nReturn ONLY valid JSON." if k else ""), model))
        if out is not None:
            return out
    return None


def segs(paras: list) -> list:
    """The baker's segment shape. English narration with Italian citations kept as their
    own `it` segments so the TTS switches register cleanly instead of reading Italian
    with an English mouth."""
    out = []
    for p in paras:
        if isinstance(p, dict):
            out.append({"lang": p.get("lang", "en"), "text": p.get("text", ""), "gapAfter": "sentence"})
        else:
            out.append({"lang": "en", "text": str(p), "gapAfter": "sentence"})
    return [s for s in out if s["text"].strip()]


def sec_digest(s: dict) -> str:
    """A compact view of one section — enough for the model to teach it, not so much that
    it just paraphrases the page back."""
    k = s.get("kind")
    if k == "prose":      return re.sub(r"<[^>]+>", " ", s.get("body", ""))[:900]
    if k == "dialog":     return "\n".join(f'{t["label"]}: {t["it"]}' for t in (s.get("dialog") or {}).get("turns", [])[:10])
    if k == "vocab":      return "; ".join(f'{v["it"]} = {v["en"]}' for v in s.get("items", [])[:18])
    if k == "pearls":     return "\n".join(re.sub(r"<[^>]+>", "", p.get("it", "")) for p in s.get("items", []))[:900]
    if k == "repeat":     return "\n".join(l["it"] for l in s.get("lines", []))
    if k == "drill":      return f'model Q: {(s.get("model") or {}).get("q")} / A: {(s.get("model") or {}).get("a")}'
    if k == "variants":   return "\n".join(i.get("cue", "") for i in s.get("items", [])[:6])
    if k == "narrative":  return s.get("text", "")[:600]
    if k == "situations": return "; ".join(i.get("title", "") for i in s.get("items", []))
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", type=int, required=True)
    ap.add_argument("--model", default="gemma4:31b")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    dirs = sorted(GEN.glob(f"chiron-italian-fsi-{a.lesson:02d}-*"))
    if not dirs:
        sys.exit(f"no lesson dir for {a.lesson}")
    out = dirs[0]
    dst = out / "audio-scripts.json"
    if dst.exists() and not a.force:
        print(f"L{a.lesson:02d} cached"); return 0
    L = json.loads((out / "fsi.json").read_text())

    # section ids are positional in the assembler: step-1 .. step-N
    steps = [{**s, "sid": f"step-{i+1}"} for i, s in enumerate(L["steps"])]
    spine = " -> ".join(s.get("title", s["step"]) for s in steps)
    dialog = next((s for s in steps if s["kind"] == "dialog"), None)
    dlg_txt = sec_digest(dialog) if dialog else ""

    scripts = {"_note": f"Pedagogy narration for FSI Lesson {a.lesson}. Lucrezia teaches; she does "
                        f"not re-read what is on the page."}

    print(f"L{a.lesson:02d} {L['titleIt']}")
    print("   summary…", end="", flush=True)
    o = ask(f'''You are Lucrezia, an Italian tutor, introducing FSI lesson "{L['titleIt']} — {L['title']}"
to Gyasi, an English speaker, BEFORE he starts.

THE DIALOG:
{dlg_txt}

THE LESSON'S STEPS: {spine}

Write a spoken introduction (about 45 seconds). Cover: the situation; how FSI teaches it
(hear it before you see it, then it is taken away piece by piece — skipping steps ruins
it); the small set of language that carries the scene; and the ONE grammar point
underneath it. End by telling him that wherever the 1992 book says "practise with your
instructor", that instructor is you, and he should say his lines out loud.
Warm, direct, spoken — not written prose. Cite Italian as separate segments.

JSON: {{"paras":[{{"lang":"en|it","text":"..."}}, ...]}}''', a.model)
    if o: scripts["summary"] = segs(o.get("paras", [])); print(" ok", flush=True)
    else: print(" FAILED", flush=True)

    print("   shortened…", end="", flush=True)
    o = ask(f'''Same lesson ("{L['titleIt']}"). A 15-second version for a re-listen: the situation in one
line, the language that carries it, the one grammar point, and the instruction to say the
lines aloud. Nothing else.

JSON: {{"paras":[{{"lang":"en|it","text":"..."}}, ...]}}''', a.model)
    if o: scripts["shortened"] = segs(o.get("paras", [])); print(" ok", flush=True)
    else: print(" FAILED", flush=True)

    sections = {}
    for s in steps:
        angle = NARRATE.get(s["kind"])
        if not angle:
            continue
        body = sec_digest(s)
        if len(body.strip()) < 40:
            continue
        print(f"   {s['sid']} {s['kind']}…", end="", flush=True)
        o = ask(f'''You are Lucrezia. Narrate the section "{s.get('title')}" of FSI lesson
"{L['titleIt']}" — about 25 seconds, spoken.

ANGLE: {angle}

WHAT IS ON THE PAGE (do NOT simply read this back — teach around it):
{body}

Say what the page cannot: the trap, the habit, the reason. If there is genuinely nothing
worth adding, return {{"paras":[]}} and the section gets no clip.

JSON: {{"paras":[{{"lang":"en|it","text":"..."}}, ...]}}''', a.model)
        if o and o.get("paras"):
            sections[s["sid"]] = segs(o["paras"]); print(" ok", flush=True)
        else:
            print(" skip", flush=True)

    scripts["sections"] = sections
    dst.write_text(json.dumps(scripts, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"   -> {dst.name}  ({len(sections)} section clips + summary + shortened)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
