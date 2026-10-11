"""run_report — the time + cost report a Pimsleur season run writes when it finishes.

Sources (each labelled in the report as measured / estimated / unavailable — never a silent 0):
  time    per-stage timers recorded by run.py (Timer), stored in <season>.run-report.json
  Modal   `modal billing report --resolution h --json`, rows for app MODAL_APP whose hour overlaps the run.
          Hourly buckets: they include any other use of that app in those hours, and the current hour is
          still accruing when the run ends -> `CH_STAGE=report` re-prices later without re-running anything.
  Gemini  audio/pimsleur.listen.usage.json per lesson (pimsleur_drill listen) x the llm-snitch price
          table (CHIRON_PRICE_TABLE), keyed by the response's modelVersion; valid_until respected.
  Ollama  token counts the chain's step logs recorded (a flat plan: no $; some calls are not logged).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import time
from pathlib import Path

MODAL_APP = "chiron-bake"
PRICE_TABLE = Path(os.environ.get("CHIRON_PRICE_TABLE",
                                  Path.home() / "Documents/code/llm-snitch/accounts/prices_official.json"))


class Timer:
    """Collects (stage, lesson, start, end) wall-clock spans. `with T("P4", "lesson-01"): ...`"""
    def __init__(self):
        self.spans: list[dict] = []
        self.start = time.time()

    def __call__(self, stage: str, lesson: str = ""):
        timer = self

        class _Span:
            def __enter__(self):
                self.t0 = time.time()

            def __exit__(self, *exc):
                timer.spans.append({"stage": stage, "lesson": lesson, "start": self.t0, "end": time.time()})
        return _Span()


# ── costs ─────────────────────────────────────────────────────────────────────
def modal_rows(start: float) -> list[dict] | str:
    """Hourly billing rows since the run's start date, or a reason string."""
    day = dt.datetime.fromtimestamp(start).date().isoformat()
    try:
        cp = subprocess.run(["modal", "billing", "report", "--start", day, "--resolution", "h", "--tz", "local", "--json"],
                            capture_output=True, text=True, timeout=60)
    except Exception as e:
        return f"modal CLI failed: {type(e).__name__}"
    if cp.returncode:
        return f"modal billing report exit {cp.returncode}: {cp.stderr.strip()[:120]}"
    try:
        return json.loads(cp.stdout)
    except Exception:
        return "modal billing report: unreadable JSON"


def modal_cost(rows: list[dict], start: float, end: float, app: str = MODAL_APP) -> dict:
    """Sum `app` rows whose hour overlaps [start, end]. Pure."""
    hours, total = [], 0.0
    for r in rows:
        if r.get("description") != app:
            continue
        h0 = dt.datetime.fromisoformat(r["interval_start"]).timestamp()
        if h0 + 3600 > start and h0 <= end:
            c = float(r.get("cost") or 0)
            hours.append({"hour": r["interval_start"], "usd": round(c, 4)})
            total += c
    return {"usd": round(total, 4), "hours": hours}


def load_prices(path: Path = PRICE_TABLE) -> dict:
    try:
        return json.loads(path.read_text()).get("models", {})
    except Exception:
        return {}


def gemini_cost(usage: dict, prices: dict, on: dt.date | None = None) -> float | None:
    """USD for one generateContent usageMetadata (+ modelVersion). None = price unknown. Pure."""
    p = prices.get(usage.get("modelVersion") or "")
    on = on or dt.date.today()
    if not p or (p.get("valid_until") and on.isoformat() > p["valid_until"]):
        return None
    audio = sum(d["tokenCount"] for d in usage.get("promptTokensDetails") or [] if d.get("modality") == "AUDIO")
    prompt = usage.get("promptTokenCount") or 0
    out = (usage.get("candidatesTokenCount") or 0) + (usage.get("thoughtsTokenCount") or 0)   # thinking = output rate
    a_rate = p.get("audio_input") or p["input"]
    return round(((prompt - audio) * p["input"] + audio * a_rate + out * p["output"]) / 1e6, 5)


def ollama_tokens(dirs: list[Path], start: float = 0, end: float = float("inf")) -> dict:
    """Model calls the chain's step logs recorded inside [start, end] (so a rerun doesn't recount them)."""
    n = tin = tout = 0
    for d in dirs:
        f = d / "steps.jsonl"
        if not f.exists():
            continue
        for line in f.read_text().splitlines():
            try:
                e = json.loads(line)
            except Exception:
                continue
            try:
                ts = dt.datetime.fromisoformat(e.get("ts", "")).timestamp()
            except Exception:
                ts = None
            if e.get("event_type") == "MODEL_CALL_END" and (ts is None or start - 1 <= ts <= end + 1):
                t = (e.get("metadata") or {}).get("tokens_used") or {}
                n, tin, tout = n + 1, tin + t.get("prompt_tokens", 0), tout + t.get("completion_tokens", 0)
    return {"calls_logged": n, "in": tin, "out": tout}


# ── build + write ─────────────────────────────────────────────────────────────
def _in(f: Path, start: float, end: float) -> bool:
    """Did THIS run write f? (a rerun must not claim an earlier run's Gemini or Modal usage)"""
    return f.exists() and start - 1 <= f.stat().st_mtime <= end + 1


def build(title: str, lessons: list[Path], spans: list[dict], start: float, end: float,
          rows: list[dict] | str, prices: dict, extra_dirs: list[Path] = ()) -> dict:
    """One run's record. Gemini and Modal GPU count only files written inside [start, end]."""
    gem = []
    for d in lessons:
        u = d / "audio" / "pimsleur.listen.usage.json"
        if _in(u, start, end):
            usage = json.loads(u.read_text())
            gem.append({"lesson": d.name, "model": usage.get("modelVersion"),
                        "tokens": usage.get("totalTokenCount"), "usd": gemini_cost(usage, prices)})
        elif _in(d / "audio" / "pimsleur.listen.md", start, end) or (not spans and (d / "audio" / "pimsleur.listen.md").exists()):
            # listened, usage not recorded (an approximate pre-timer run listened to every lesson it has a verdict for)
            gem.append({"lesson": d.name, "model": None, "tokens": None, "usd": None})
    known = [g["usd"] for g in gem if g["usd"] is not None]
    gpu = {}
    for d in lessons:
        tl = d / "audio" / "pimsleur.timeline.json"
        if _in(tl, start, end):
            try:
                gpu[d.name] = json.loads(tl.read_text())["qc"].get("modal") or {}
            except Exception:
                gpu[d.name] = {}
    stages: dict[str, float] = {}
    for sp in spans:
        stages[sp["stage"]] = stages.get(sp["stage"], 0) + sp["end"] - sp["start"]
    return {"title": title, "generated": dt.datetime.now().isoformat(timespec="seconds"),
            "start": start, "end": end, "wall_s": round(end - start),
            "stages_s": {k: round(v) for k, v in stages.items() if v >= 1},     # resumed no-op stages are noise
            "spans": spans, "lessons": [d.name for d in lessons],
            "modal": modal_cost(rows, start, end) if isinstance(rows, list) else {"usd": None, "hours": [], "error": rows},
            "modal_gpu": gpu,
            "gemini": {"usd": round(sum(known), 5) if known else None, "unpriced": len(gem) - len(known), "calls": gem},
            "ollama": {**ollama_tokens(list(lessons) + list(extra_dirs), start, end), "usd": 0.0,
                       "note": "flat plan; authoring/review calls are not logged"}}


def load_runs(path: Path) -> list[dict]:
    try:
        d = json.loads(path.read_text())
    except Exception:
        return []
    return d.get("runs") or ([d] if "start" in d else [])     # a pre-runs-list report counts as one run


def reprice_modal(runs: list[dict], rows: list[dict] | str) -> None:
    """Modal's last hour keeps accruing after a run ends: refresh every run's Modal line in place."""
    if isinstance(rows, list):
        for r in runs:
            r["modal"] = modal_cost(rows, r["start"], r["end"])


def season_totals(runs: list[dict]) -> dict:
    """Modal hours shared by two runs are counted ONCE (billing is per hour, not per run)."""
    hours = {h["hour"]: h["usd"] for r in runs for h in r["modal"].get("hours", [])}
    modal_known = any(r["modal"].get("usd") is not None for r in runs)
    gem = [r["gemini"]["usd"] for r in runs if r["gemini"]["usd"] is not None]
    unpriced = sum(r["gemini"]["unpriced"] for r in runs) + sum(1 for r in runs if r["modal"].get("usd") is None)
    return {"modal_usd": round(sum(hours.values()), 4) if modal_known else None,
            "gemini_usd": round(sum(gem), 5) if gem else None,
            "usd": round(sum(hours.values()) + sum(gem), 4), "incomplete": unpriced,
            "wall_s": sum(r["wall_s"] for r in runs)}


def _t(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts).strftime("%H:%M")


NAMES = {"P0": "Plan", "P1": "Author + Italian review", "P3": "Read cards", "P4": "Audio (synth + speech check + mp3)",
         "P5": "Gemini listen", "P6": "Anki export"}


def render_run(r: dict, k: int) -> list[str]:
    m, g, o = r["modal"], r["gemini"], r["ollama"]
    approx = "" if r["spans"] else " — approximate, from file times (run predates the timers)"
    lines = [f"## Run {k} — {dt.datetime.fromtimestamp(r['start']).strftime('%Y-%m-%d')} "
             f"{_t(r['start'])} → {_t(r['end'])}{approx}", "", "| Stage | Took |", "|---|---|"]
    for st, v in r["stages_s"].items():
        if v < 1:
            continue
        lines.append(f"| {NAMES.get(st, st)} | {v // 60} min {v % 60} s |")
    lines += [f"| **Total** | **{r['wall_s'] // 60} min {r['wall_s'] % 60} s** |", ""]
    gpu_s = sum((v.get("gpu_s") or 0) for v in r["modal_gpu"].values())
    if gpu_s:
        lines += [f"Modal GPU time: {round(gpu_s)} s across {sum((v.get('clips') or 0) for v in r['modal_gpu'].values())} clips.", ""]
    modal_txt = (f"${m['usd']:.3f} | measured · hour(s) {', '.join(h['hour'][11:16] for h in m['hours']) or 'none'} "
                 f"of `{MODAL_APP}`" if m.get("usd") is not None else f"unavailable | {m.get('error')}")
    gem_txt = ((f"${g['usd']:.3f} | measured tokens × llm-snitch price table" if g["usd"] is not None else "— | ")
               + (f" · {g['unpriced']} call(s) unpriced (no model version recorded, or no price)" if g["unpriced"] else ""))
    lines += ["| Cost | Amount | Source |", "|---|---|---|", f"| Modal | {modal_txt} |",
              f"| Gemini listen ×{len(g['calls'])} | {gem_txt} |",
              f"| Ollama Cloud | $0 extra | flat plan · logged {o['calls_logged']} calls, {o['in']:,} in / {o['out']:,} out ({o['note']}) |", ""]
    return lines


def render(runs: list[dict]) -> str:
    t = season_totals(runs)
    n = max(len(runs[-1]["lessons"]), 1)
    total = (f"at least ${t['usd']:.2f} ({t['incomplete']} item(s) could not be priced)" if t["incomplete"]
             else f"${t['usd']:.2f} (≈ ${t['usd'] / n:.3f} per lesson)")
    lines = [f"# Run report — {runs[-1]['title']}", "",
             f"Updated {runs[-1]['generated']} by the Pimsleur chain · {n} lessons · {len(runs)} run(s)", "",
             f"**Season total: {total} · {t['wall_s'] // 60} min of runs.** "
             f"Modal ${t['modal_usd'] or 0:.3f} (shared hours counted once; the latest hour may still be accruing — "
             f"`CH_STAGE=report` refreshes) · Gemini ${t['gemini_usd'] or 0:.3f} · Ollama Cloud $0 (flat plan).", ""]
    for k, r in enumerate(runs, 1):
        lines += render_run(r, k)
    return "\n".join(lines)


def write(stem: Path, runs: list[dict]) -> Path:
    stem.with_suffix(".run-report.json").write_text(json.dumps({"runs": runs, "totals": season_totals(runs)}, indent=1))
    md = stem.with_suffix(".run-report.md")
    md.write_text(render(runs))
    return md
