#!/usr/bin/env python3
"""Chiron VIDEO-EPISODE — enrichment v2: DIFFICULTY score + SPEECH-ACT tags (Radio-D #1, #2).

Additive pass over a Phase-1/2 `transcript.json`. Adds two per-SCENE fields that feed BOTH surfaces
(video-podcast chips/badges AND audio-podcast scaffolding/narration):

  scene.difficulty  — DETERMINISTIC (no LLM), from data we already have:
      speakers      distinct characters in the scene            (more voices = harder)
      speech_rate   median chars/sec of the dialogue            (faster = harder)
      slang         fraction of lines whose teaching_note flags  (vulgar/colloq/idiom = harder)
      visual_carry  how much of the scene is NOT dialogue        (visuals carrying it = harder audio-only)
    → {score:0-1, band:easy|medium|hard, factors:{…}}  — scales how much SCAFFOLDING a scene gets
      (Radio-D #1: ramp by scaffolding, NEVER reorder the episode).

  scene.speech_acts — LLM (reuse episode_enrich ladder). The FUNCTIONAL layer beside the grammar-shaped
      target_structures (Radio-D #2 "both, not either"): how you DO things in this scene — greet, snap at
      someone, brush someone off, ask to repeat — with a real example phrase FROM the scene.
      [{function:"<how you DO X, learner-facing>", example_it:"<phrase from scene>", example_en:"<EN>"}]

Additive + resumable: difficulty always recomputed (cheap); speech_acts skipped if present unless --force.
Run:  ~/miniconda3/bin/python3 episode_tags.py <episode_dir_or_transcript.json> [--force] [--persona X] [--lang it]
"""
from __future__ import annotations
import argparse, asyncio, json, re, statistics, sys, time
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import episode_enrich as EN     # reuse the PromptChain ladder + lang/persona seam

# words in a teaching_note that mark colloquial/hard register (slang-density signal)
_SLANG_RE = re.compile(r"vulgar|colloq|slang|idiom|contraction|informal|rude|swear|crude|"
                       r"offensive|profan|register|volgare|gergo", re.I)


# ── difficulty (deterministic) ────────────────────────────────────────────────
def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def scene_difficulty(scene: dict) -> dict:
    lines = scene.get("lines") or []
    n = len(lines)
    speakers = {(l.get("character") or "").strip() for l in lines if (l.get("character") or "").strip()}
    n_spk = len(speakers)

    rates = []
    dial_dur = 0.0
    slang_hits = 0
    for l in lines:
        try:
            dur = max(0.15, float(l["end"]) - float(l["start"]))
        except Exception:
            dur = 0.15
        chars = len((l.get("italian_text") or ""))
        if chars:
            rates.append(chars / dur)
        dial_dur += min(dur, 30.0)
        if _SLANG_RE.search(l.get("teaching_note") or ""):
            slang_hits += 1

    med_rate = statistics.median(rates) if rates else 0.0
    try:
        scene_dur = max(1.0, float(scene["end"]) - float(scene["start"]))
    except Exception:
        scene_dur = max(1.0, dial_dur)

    # normalize each factor to 0-1
    speakers_s = _clamp((n_spk - 1) / 3.0)             # 1 spk→0, 4+→1
    rate_s = _clamp((med_rate - 9.0) / 7.0)            # ~9 cps→0, ~16 cps→1 (Italian speech)
    slang_s = _clamp((slang_hits / n) * 1.3) if n else 0.0
    visual_s = _clamp(1.0 - (dial_dur / scene_dur))    # little dialogue over the span → visuals carry it

    score = round(0.30 * speakers_s + 0.30 * rate_s + 0.20 * slang_s + 0.20 * visual_s, 3)
    band = "easy" if score < 0.40 else ("medium" if score < 0.68 else "hard")
    return {
        "score": score, "band": band,
        "factors": {"speakers": n_spk, "speech_rate_cps": round(med_rate, 1),
                    "slang_frac": round(slang_hits / n, 2) if n else 0.0,
                    "visual_carry": round(visual_s, 2)},
        "sub": {"speakers": round(speakers_s, 2), "rate": round(rate_s, 2),
                "slang": round(slang_s, 2), "visual": round(visual_s, 2)},
    }


# ── speech-act tags (LLM) ─────────────────────────────────────────────────────
def _sa_valid(obj):
    sa = obj.get("speech_acts")
    if not isinstance(sa, list) or not (1 <= len(sa) <= 6):
        return [f"speech_acts must be a list of 1-6 items (have {len(sa) if isinstance(sa, list) else 'none'})"]
    iss = []
    for i, a in enumerate(sa):
        if not isinstance(a, dict) or not (a.get("function") or "").strip():
            iss.append(f"item {i}: needs a non-empty `function`")
        if not (a.get("example_it") or "").strip():
            iss.append(f"item {i}: needs a non-empty `example_it` (a phrase FROM the scene)")
    return iss or None


def _sa_prompt(scene: dict) -> str:
    lines = [{"character": l.get("character", "?"), "it": l.get("italian_text", "")}
             for l in (scene.get("lines") or [])]
    ctx = {k: scene.get(k) for k in ("title", "situation", "characters_present") if scene.get(k)}
    lang = EN.LANG_NAME
    return (
        f"You are {EN.persona_display()}, a {lang} tutor. Grammar is covered elsewhere. For THIS scene, tag the "
        f"FUNCTIONAL speech acts — how people actually DO things in {lang}: greet, express irritation, brush "
        "someone off, apologize, ask someone to repeat, insult, flirt, refuse. For a learner watching a teen "
        "drama, 'this is how Italians snap at someone' is more useful than a grammar term.\n\n"
        "## SCENE\n" + json.dumps(ctx, ensure_ascii=False) + "\n## LINES\n" + json.dumps(lines, ensure_ascii=False) + "\n\n"
        "## OUTPUT — return ONLY this JSON:\n"
        '{"speech_acts": [{"function": "<how you DO it, learner-facing, e.g. \'brushing someone off rudely\'>", '
        '"example_it": "<the actual phrase FROM the lines that performs it>", "example_en": "<EN>"}]}\n'
        "2-5 acts, only ones truly present, each grounded in a real line above. Return ONLY the JSON object."
    )


async def add_speech_acts(scene: dict) -> bool:
    obj = await EN.json_with_repair(_sa_prompt(scene), f"scene{scene['scene']}-sa", validate_fn=_sa_valid)
    if obj is None:
        return False
    acts = []
    for a in obj.get("speech_acts", []):
        if isinstance(a, dict) and (a.get("function") or "").strip():
            acts.append({"function": a["function"].strip(),
                         "example_it": (a.get("example_it") or "").strip(),
                         "example_en": (a.get("example_en") or "").strip()})
    scene["speech_acts"] = acts[:5]
    return True


# ── main ──────────────────────────────────────────────────────────────────────
def resolve_transcript(arg: str) -> Path:
    p = Path(arg).expanduser()
    if p.is_dir():
        p = p / "transcript.json"
    if not p.is_file():
        sys.exit(f"[tags] no transcript.json at {p}")
    return p.resolve()


async def run(tpath: Path, force: bool):
    data = json.loads(tpath.read_text(encoding="utf-8"))
    scenes = data.get("scenes") or []
    bak = tpath.with_suffix(tpath.suffix + f".bak.{int(time.time())}")
    bak.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[tags] {tpath.name} · {len(scenes)} scenes · ladder={'->'.join(EN._ladder())} · backup {bak.name}", flush=True)

    # 1) difficulty — always (deterministic, cheap)
    bands = {"easy": 0, "medium": 0, "hard": 0}
    for s in scenes:
        if not (s.get("lines")):
            continue
        d = scene_difficulty(s)
        s["difficulty"] = d
        bands[d["band"]] += 1
    tpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[tags] difficulty scored: {bands['easy']} easy · {bands['medium']} medium · {bands['hard']} hard", flush=True)

    # 2) speech_acts — LLM, resumable
    todo = [s for s in scenes if s.get("lines") and (force or not s.get("speech_acts"))]
    print(f"[tags] speech-acts: {len(todo)}/{len(scenes)} scenes to tag", flush=True)
    done = 0
    for s in todo:
        try:
            ok = await add_speech_acts(s)
        except Exception as e:
            print(f"[tags] scene {s.get('scene')}: speech-act error ({e}) — skipped", flush=True)
            ok = False
        if ok:
            done += 1
            tpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            fns = " · ".join(a["function"] for a in s["speech_acts"][:3])
            print(f"[tags] scene {s['scene']} ✓ [{s['difficulty']['band']}] {len(s['speech_acts'])} acts: {fns}", flush=True)
    return data, done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="episode dir OR transcript.json")
    ap.add_argument("--force", action="store_true", help="re-tag speech_acts even if present")
    ap.add_argument("--lang", default="")
    ap.add_argument("--persona", default="")
    ap.add_argument("--ladder", default="")
    args = ap.parse_args()
    if args.ladder:
        EN._DEFAULT_LADDER = args.ladder
    if args.lang:
        EN.LANG_CODE = args.lang; EN.LANG_NAME = EN._LANG_NAMES.get(args.lang, args.lang)
    if args.persona:
        EN.PERSONA = args.persona
    tpath = resolve_transcript(args.target)
    data, done = asyncio.run(run(tpath, args.force))
    scenes = data.get("scenes") or []
    sa = sum(1 for s in scenes if s.get("speech_acts"))
    df = sum(1 for s in scenes if s.get("difficulty"))
    print(f"[tags] DONE. difficulty {df}/{len(scenes)} · speech_acts {sa}/{len(scenes)} (tagged {done} this run)", flush=True)


if __name__ == "__main__":
    main()
