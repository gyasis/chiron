#!/usr/bin/env python3
"""Chiron VIDEO-EPISODE — Phase-2 ENRICHMENT (the FSI curriculum layer).

Reads a Phase-1 `transcript.json` (scene→line, produced by episode_ingest.py) and FILLS the
null teaching slots the Player renders:
  per LINE   → en_gloss (natural English), teaching_note (the ONE thing worth teaching: idiom /
               register / grammar / vocab — Lucrezia's bilingual register; empty if trivial)
  per SCENE  → target_structures[] (2-4 things to listen for in this scene)

"Teach the Italian OF the dialogue" (PRD §2 step 4). One LLM call per SCENE (the FSI unit) so the
model sees the whole situation. Uses the SAME house pattern as the chains: PromptChain single-step
calls, model FALLBACK ladder (glm-5.1 → deepseek-v4-flash, both Ollama Cloud — NO Gemini), self-repair on bad JSON/validation,
`over_worklist` bounded loop. Per-scene RESUME (skip already-enriched scenes unless CH_FORCE=1),
one-time `.bak` before writing. NOT hand-rolled orchestration (R-PC1).

Run:  ~/miniconda3/bin/python3 episode_enrich.py <episode_dir_or_transcript.json>
        [--force] [--concurrent] [--ladder glm-5.1,deepseek-v4-flash]
Env:  OLLAMA_API_KEY / GEMINI_API_KEY|GOOGLE_API_KEY / OPENAI_API_KEY (else read from ~/dev/.env);
      CH_ENRICH_LADDER · CH_FORCE · CH_LEARNER (default Gyasi)
"""
from __future__ import annotations
import argparse, asyncio, json, os, re, sys, time
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
from promptchain import PromptChain
from promptchain.utils.external_loop import over_worklist

HOME = Path(os.path.expanduser("~"))


def _key(*names: str) -> str:
    """First env var that's set, else scan ~/dev/.env (the chains do this too)."""
    for n in names:
        v = os.environ.get(n, "")
        if v:
            return v
    try:
        for ln in (HOME / "dev/.env").read_text().splitlines():
            s = ln.strip()
            for n in names:
                if s.startswith(n + "="):
                    return s.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


OLLAMA_KEY = _key("OLLAMA_API_KEY")
GEMINI_KEY = _key("GEMINI_API_KEY", "GOOGLE_API_KEY")
OPENAI_KEY = _key("OPENAI_API_KEY")
LEARNER = os.environ.get("CH_LEARNER", "Gyasi")

# ── language + persona seam (default it/Lucrezia; other languages/personas drop in here) ──
LANG_CODE = os.environ.get("CH_LANG", "it")
_LANG_NAMES = {"it": "Italian", "de": "German", "es": "Spanish", "fr": "French",
               "pt": "Portuguese", "en": "English", "ru": "Russian"}
LANG_NAME = _LANG_NAMES.get(LANG_CODE, LANG_CODE)
PERSONA = os.environ.get("CH_PERSONA", "lucrezia")


def persona_display() -> str:
    return (PERSONA or "").replace("-", " ").title() or "the tutor"


def load_persona_register(name: str | None = None, limit: int = 2500) -> str:
    """The persona DNA (voice/register) if the pack exists — used to flavor tone; empty if none."""
    name = name or PERSONA
    for p in (HOME / f".chiron/packs/{name}/persona.md", HOME / f".chiron/packs/{LANG_CODE}/persona.md"):
        try:
            if p.exists():
                return p.read_text()[:limit]
        except Exception:
            pass
    return ""

# Model ladder: glm-5.1 primary (Ollama Cloud), gemini-flash a DIFFERENT family fallback (mirrors the chains).
_DEFAULT_LADDER = os.environ.get("CH_ENRICH_LADDER", "glm-5.1,deepseek-v4-flash")


# ── model helpers (compact copies of the chain's — PromptChain-based, per-call explicit model) ──
def ollama(name: str, temperature: float = 0.4) -> dict:
    return {"name": f"ollama_chat/{name}",
            "params": {"api_base": "https://ollama.com", "api_key": OLLAMA_KEY, "temperature": temperature}}


def model_for(name: str, temperature: float = 0.4) -> dict:
    if name.startswith("gemini"):
        gm = name if name.startswith("gemini/") else f"gemini/{name}"
        return {"name": gm, "params": {"api_key": GEMINI_KEY, "temperature": temperature}}
    if name.startswith("gpt-"):
        return {"name": f"openai/{name}", "params": {"api_key": OPENAI_KEY}}
    return ollama(name, temperature)


def _ladder() -> list[str]:
    out = []
    for m in _DEFAULT_LADDER.split(","):
        m = m.strip()
        if not m:
            continue
        if m.startswith("gemini") and not GEMINI_KEY:
            continue
        if m.startswith("gpt-") and not OPENAI_KEY:
            continue
        out.append(m)
    return out or ["glm-5.1"]


def extract_json(s: str):
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s.strip(), flags=re.M).strip()
    st = next((i for i, ch in enumerate(s) if ch in "{["), -1)
    if st < 0:
        return json.loads(s, strict=False)
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
                if d == 0:
                    return json.loads(s[st:i + 1], strict=False)
    return json.loads(s[st:], strict=False)


async def _llm(md: dict, prompt: str) -> str:
    chain = PromptChain(models=[md], instructions=[prompt + "\n\n{input}"])
    return await chain.process_prompt_async("go")


async def json_with_repair(prompt: str, name: str, validate_fn=None, max_repair: int = 2):
    """Self-repair + model FALLBACK ladder (the chains' pattern). None on total exhaustion."""
    ladder = _ladder()
    last = ""
    for mi, mname in enumerate(ladder):
        md = model_for(mname)
        attempts = max_repair if mi == 0 else 1     # primary repairs a few times; fallbacks get one shot (hard-bounded)
        cur = prompt
        for attempt in range(1, attempts + 1):
            try:
                last = await _llm(md, cur)
            except Exception as e:
                msg = str(e).lower()
                if any(t in msg for t in ("ratelimit", "429", "rate limit", "resource_exhausted", "quota", "usage limit")):
                    print(f"[enrich] {name} [{mname}]: rate-limited — falling to next model", flush=True)
                    break
                print(f"[enrich] {name} [{mname}] {attempt}: LLM errored ({e})", flush=True)
                await asyncio.sleep(3); continue
            try:
                obj = extract_json(last)
            except Exception as e:
                cur = prompt + f"\n\n## PREVIOUS INVALID JSON\n{e}\nReturn ONLY corrected valid JSON. Escape every \" and newline inside strings."
                continue
            iss = validate_fn(obj) if validate_fn else None
            if iss:
                print(f"[enrich] {name} [{mname}] {attempt}: invalid ({iss[:2]}) — re-prompting", flush=True)
                cur = prompt + f"\n\n## PROBLEMS\n{iss}\nReturn ONLY corrected valid JSON that fixes every problem above."
                continue
            if mi > 0:
                print(f"[enrich] {name}: RECOVERED via fallback [{mname}]", flush=True)
            return obj
        if mi < len(ladder) - 1:
            print(f"[enrich] {name}: [{mname}] exhausted -> FALLBACK to [{ladder[mi + 1]}]", flush=True)
    print(f"[enrich] {name}: ALL MODELS EXHAUSTED — leaving scene un-enriched, continuing", flush=True)
    return None


# ── enrichment ──────────────────────────────────────────────────────────────────
def scene_enriched(scene: dict) -> bool:
    """RESUME test: every line has a non-empty en_gloss AND the scene has target_structures."""
    lines = scene.get("lines") or []
    if not lines:
        return True
    if not (scene.get("target_structures")):
        return False
    return all((l.get("en_gloss") or "").strip() for l in lines)


def build_prompt(scene: dict) -> str:
    lines = scene.get("lines") or []
    numbered = [{"i": i, "character": l.get("character", "?"), "it": l.get("italian_text", "")}
                for i, l in enumerate(lines)]
    ctx = {k: scene.get(k) for k in ("title", "location", "situation", "characters_present") if scene.get(k)}
    return (
        f"You are {persona_display()}, a warm, fond {LANG_NAME} tutor teaching {LEARNER} (a native-English "
        f"speaker) the {LANG_NAME} OF a real TV-episode scene. For THIS scene, produce the teaching layer: a "
        "natural English gloss of every line, a concise teaching note where a line is worth teaching, and the "
        "2-4 target structures a learner should listen for.\n\n"
        "## SCENE CONTEXT\n" + json.dumps(ctx, ensure_ascii=False) + "\n\n"
        "## LINES (spoken Italian, in order)\n" + json.dumps(numbered, ensure_ascii=False, indent=0) + "\n\n"
        "## OUTPUT — return ONLY this JSON object:\n"
        "{\n"
        '  "target_structures": ["<2-4 SHORT English phrases naming a grammar point / idiom / register '
        'a learner should catch in THIS scene, e.g. \'imperative + object pronoun (dammelo)\'>"],\n'
        '  "lines": [\n'
        '    {"i": 0, "en_gloss": "<natural, idiomatic English translation of the line>",\n'
        '     "teaching_note": "<the ONE thing worth teaching in this line — vocab / grammar / register / '
        f'idiom; concise (<=25 words), learner-facing English, cite the {LANG_NAME} in <em>…</em>; use \\"\\" '
        '(empty) if the line is trivial>"}\n'
        "  ]\n"
        "}\n"
        f"Cover EVERY line index 0..{len(lines) - 1}. en_gloss is REQUIRED and non-empty for every line. "
        f"Teach real, idiomatic {LANG_NAME}; be honest about vulgar/colloquial register when present. "
        "Return ONLY the JSON object."
    )


def make_validator(n_lines: int):
    def _v(obj):
        iss = []
        ts = obj.get("target_structures")
        if not isinstance(ts, list) or not (2 <= len(ts) <= 5):
            iss.append(f"target_structures must be a list of 2-5 items (have {len(ts) if isinstance(ts, list) else 'none'})")
        lines = obj.get("lines")
        if not isinstance(lines, list):
            return ["'lines' must be a list of {i, en_gloss, teaching_note}"]
        by_i = {l.get("i"): l for l in lines if isinstance(l, dict)}
        missing = [i for i in range(n_lines) if i not in by_i]
        if missing:
            iss.append(f"missing line indices {missing[:8]} — cover every i in 0..{n_lines - 1}")
        empty = [i for i in range(n_lines) if i in by_i and not (by_i[i].get("en_gloss") or "").strip()]
        if empty:
            iss.append(f"en_gloss empty for line indices {empty[:8]} — every line needs a non-empty en_gloss")
        return iss or None
    return _v


def apply_enrichment(scene: dict, obj: dict):
    scene["target_structures"] = [str(t) for t in (obj.get("target_structures") or [])][:5]
    by_i = {l.get("i"): l for l in (obj.get("lines") or []) if isinstance(l, dict)}
    for i, line in enumerate(scene.get("lines") or []):
        e = by_i.get(i) or {}
        if (e.get("en_gloss") or "").strip():
            line["en_gloss"] = e["en_gloss"].strip()
        tn = (e.get("teaching_note") or "").strip()
        line["teaching_note"] = tn or None


async def enrich(tpath: Path, force: bool, concurrent: bool):
    data = json.loads(tpath.read_text(encoding="utf-8"))
    scenes = data.get("scenes") or []
    force = force or os.environ.get("CH_FORCE") == "1"
    todo = [s for s in scenes if force or not scene_enriched(s)]
    n_lines = sum(len(s.get("lines") or []) for s in scenes)
    print(f"[enrich] {tpath} · {len(scenes)} scenes · {n_lines} lines · ladder={'->'.join(_ladder())}", flush=True)
    print(f"[enrich] {len(todo)}/{len(scenes)} scenes to enrich ({'--force' if force else 'resume'})", flush=True)
    if not todo:
        print("[enrich] nothing to do (all scenes already enriched).", flush=True)
        return data, 0

    # one-time backup before the first mutation
    bak = tpath.with_suffix(tpath.suffix + f".bak.{int(time.time())}")
    bak.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[enrich] backup → {bak.name}", flush=True)

    done = 0

    async def do_one(scene):
        nonlocal done
        lines = scene.get("lines") or []
        if not lines:
            return
        sc = scene.get("scene")
        obj = await json_with_repair(build_prompt(scene), f"scene{sc}", validate_fn=make_validator(len(lines)))
        if obj is None:
            print(f"[enrich] scene {sc}: NOT enriched (models exhausted) — kept as-is", flush=True)
            return
        apply_enrichment(scene, obj)
        done += 1
        tpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")  # incremental save = resumable
        ntn = sum(1 for l in lines if (l.get("teaching_note") or "").strip())
        print(f"[enrich] scene {sc} ✓ {len(lines)} glosses · {ntn} notes · {len(scene['target_structures'])} structures", flush=True)

    if concurrent:
        sem = asyncio.Semaphore(4)

        async def handler(item, state):
            async with sem:
                try:
                    await do_one(item)
                except Exception as e:
                    print(f"[enrich] scene {item.get('scene')}: error ({e}) — skipped", flush=True)
        await asyncio.gather(*(handler(s, {}) for s in todo))
    else:
        async def handler(item, state):
            try:
                await do_one(item)
            except Exception as e:
                print(f"[enrich] scene {item.get('scene')}: error ({e}) — skipped", flush=True)
        await over_worklist(todo, handler, max_iters=len(todo) + 1, max_seconds=3600)

    return data, done


def resolve_transcript(arg: str) -> Path:
    p = Path(arg).expanduser()
    if p.is_dir():
        p = p / "transcript.json"
    if not p.is_file():
        sys.exit(f"[enrich] no transcript.json at {p}")
    return p.resolve()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="episode dir OR path to transcript.json")
    ap.add_argument("--force", action="store_true", help="re-enrich every scene (ignore resume)")
    ap.add_argument("--concurrent", action="store_true", help="run scenes in parallel (sem=4)")
    ap.add_argument("--ladder", default="", help="override model ladder, e.g. glm-5.1,deepseek-v4-flash")
    ap.add_argument("--lang", default="", help="target language code (it/de/es/fr…); default it")
    ap.add_argument("--persona", default="", help="tutor persona pack name; default lucrezia")
    args = ap.parse_args()
    global _DEFAULT_LADDER, LANG_CODE, LANG_NAME, PERSONA
    if args.ladder:
        _DEFAULT_LADDER = args.ladder
    if args.lang:
        LANG_CODE = args.lang; LANG_NAME = _LANG_NAMES.get(LANG_CODE, LANG_CODE)
    if args.persona:
        PERSONA = args.persona
    tpath = resolve_transcript(args.target)
    data, done = asyncio.run(enrich(tpath, args.force, args.concurrent))
    # report coverage
    scenes = data.get("scenes") or []
    lines = [l for s in scenes for l in (s.get("lines") or [])]
    glossed = sum(1 for l in lines if (l.get("en_gloss") or "").strip())
    noted = sum(1 for l in lines if (l.get("teaching_note") or "").strip())
    struct = sum(1 for s in scenes if s.get("target_structures"))
    print(f"[enrich] DONE. enriched {done} scenes this run · coverage: "
          f"{glossed}/{len(lines)} glosses, {noted} teaching-notes, {struct}/{len(scenes)} scenes with target_structures",
          flush=True)


if __name__ == "__main__":
    main()
