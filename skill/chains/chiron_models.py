"""chiron_models — resolve Ollama Cloud model names against the LIVE catalog, so a retired model can't stall Chiron.

Why (2026-10-10): glm-5.1 AND deepseek-v4-flash were retired by Ollama Cloud on 2026-09-25. Both were
hard-coded defaults in every chain, the server rotation, the tutor and the UI, so every narration-script
backfill failed ('glm-5.1 was retired') and bakes produced 0 clips. Nothing noticed for two weeks.

The catalog is already kept current: `ollama-cloud-models` (systemd timer, daily) writes
~/.config/ollama-cloud/models.json with the live model ids. This module reads it.

  resolve("glm@latest")          -> newest LIVE + VERIFIED glm-<ver>          (family alias)
  resolve("deepseek-flash@latest")
  resolve("glm-5.1")             -> live? keep it : heal to its family's latest (retired-name healing)
  resolve("gpt-5-mini") / "local/…" / "gemini/…" / "claude"  -> unchanged (not Ollama Cloud)

VERIFIED = a one-time probe (3 small JSON calls, called the way the chains call: default thinking) must
return valid, non-empty JSON every time. It exists because "newest" is not "working": glm-5.2 shipped
with a silent-stop regression (empty content ~80% of calls). Results are cached for PROBE_TTL_DAYS in
~/.cache/chiron/model-probe.json, so a new model costs 3 tiny calls once, not per lesson.

Observability: every heal prints one `[models]` line to stderr; `python3 chiron_models.py` prints the
current resolution table, `--json` for machines, `--reprobe` to force fresh probes,
`--thinking` the verified thinking-off method per model (see thinking_off()).
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

CATALOG = Path(os.environ.get("CHIRON_MODEL_CATALOG", Path.home() / ".config/ollama-cloud/models.json"))
PROBE_CACHE = Path(os.environ.get("CHIRON_MODEL_PROBE_CACHE", Path.home() / ".cache/chiron/model-probe.json"))
PROBE_TTL_DAYS = 14
PROBE_N = 3
OLLAMA_V1 = "https://ollama.com/v1/chat/completions"

# family -> regex over catalog ids; group(1) is the version used for "newest". Flash/pro variants are their
# own families so glm@latest never silently swaps to a smaller -flash model.
FAMILIES = {
    "glm":            r"glm-(\d+(?:\.\d+)*)",
    "glm-flash":      r"glm-(\d+(?:\.\d+)*)-flash",
    "deepseek-flash": r"deepseek-v(\d+(?:\.\d+)*)-flash",
    "deepseek-pro":   r"deepseek-v(\d+(?:\.\d+)*)-pro",
}
# Used ONLY when the catalog file is unreadable (logged loudly). Last verified 2026-10-10.
LAST_KNOWN = {"glm": "glm-5.3", "glm-flash": "glm-5.3-flash",
              "deepseek-flash": "deepseek-v4.1-flash", "deepseek-pro": "deepseek-v4-pro"}

_memo: dict[str, str] = {}


def _log(msg: str) -> None:
    print(f"[models] {msg}", file=sys.stderr, flush=True)


def _not_cloud(name: str) -> bool:
    return name.startswith(("local/", "gpt-", "gemini", "claude", "openai/", "o1", "o3", "o4"))


def live_ids() -> list[str] | None:
    try:
        return [m["id"] for m in json.loads(CATALOG.read_text())["models"]]
    except Exception as e:
        _log(f"catalog unreadable ({CATALOG}: {e}) — run `ollama-cloud-models --write`; using LAST_KNOWN")
        return None


def family_of(name: str) -> str | None:
    base = name.split(":")[0]
    for fam, rx in FAMILIES.items():
        if re.fullmatch(rx, base):
            return fam
    return None


def _ver(s: str) -> tuple:
    return tuple(int(x) for x in s.split("."))


def candidates(family: str, ids: list[str]) -> list[str]:
    rx = FAMILIES[family]
    hits = [(m, re.fullmatch(rx, m.split(":")[0])) for m in ids]
    return [m for m, h in sorted(((m, h) for m, h in hits if h), key=lambda t: _ver(t[1].group(1)), reverse=True)]


# ── probe ─────────────────────────────────────────────────────────────────────
def _probe_once(model: str, key: str) -> str | None:
    """None = good; otherwise the reason it failed."""
    body = {"model": model, "temperature": 0.4, "messages": [{"role": "user", "content":
            'Return ONLY a JSON object {"term":"hyponatremia","definition":"<one sentence>"} — no prose.'}]}
    req = urllib.request.Request(OLLAMA_V1, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:160].decode('utf-8', 'replace')}"
    except Exception as e:
        return f"call failed: {e}"
    c = (d["choices"][0]["message"].get("content") or "").strip()
    if not c:
        return "empty content (silent stop)"
    try:
        json.loads(c[c.find("{"):c.rfind("}") + 1])
    except Exception:
        return f"not JSON: {c[:80]!r}"
    return None


def verified(model: str, force: bool = False) -> bool:
    key = os.environ.get("OLLAMA_API_KEY") or os.environ.get("OLLAMA_CLOUD_API_KEY")
    if not key:
        _log(f"no OLLAMA_API_KEY — can't probe {model}; trusting the catalog")
        return True
    PROBE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROBE_CACHE.with_suffix(".lock"), "w") as lk:      # gen workers start together; probe once
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            cache = json.loads(PROBE_CACHE.read_text())
        except Exception:
            cache = {}
        hit = cache.get(model)
        if hit and not force and time.time() - hit["ts"] < PROBE_TTL_DAYS * 86400:
            return hit["ok"]
        fails = [r for r in (_probe_once(model, key) for _ in range(PROBE_N)) if r]
        transient = fails and all(f.startswith(("call failed", "HTTP 5", "HTTP 429")) for f in fails)
        if transient:                                         # network/provider blip: don't condemn the model
            _log(f"probe {model}: transient failures {fails[:1]} — not cached, trusting the catalog")
            return True
        ok = not fails
        cache[model] = {"ok": ok, "ts": time.time(), "fails": fails[:3]}
        PROBE_CACHE.write_text(json.dumps(cache, indent=1))
        _log(f"probe {model}: {'OK' if ok else 'FAILED ' + str(fails[:2])} ({PROBE_N - len(fails)}/{PROBE_N})")
        return ok


# ── resolve ───────────────────────────────────────────────────────────────────
def latest(family: str, force: bool = False) -> str:
    ids = live_ids()
    if ids is None:
        return LAST_KNOWN[family]
    cands = candidates(family, ids)
    if not cands:
        _log(f"no live model in family '{family}' — falling back to LAST_KNOWN {LAST_KNOWN[family]}")
        return LAST_KNOWN[family]
    for m in cands:
        if verified(m, force):
            return m
        _log(f"{m} failed its probe — trying the next {family}")
    _log(f"every live {family} failed its probe — using newest {cands[0]} anyway")
    return cands[0]


def resolve(name: str) -> str:
    """Map a model name/alias to a live Ollama Cloud id. Non-cloud names pass through unchanged."""
    name = (name or "").strip()
    if not name or _not_cloud(name):
        return name
    if name in _memo:
        return _memo[name]
    if name.endswith("@latest"):
        fam = name[:-len("@latest")]
        out = latest(fam) if fam in FAMILIES else name
        if fam not in FAMILIES:
            _log(f"unknown family alias '{name}' (known: {', '.join(FAMILIES)})")
    else:
        ids = live_ids()
        fam = family_of(name)
        if ids is None or name in ids or name.split(":")[0] in ids or not fam:
            if ids is not None and name not in ids and not fam:
                _log(f"'{name}' is not in the live catalog and has no known family — leaving it as-is")
            out = name
        else:
            out = latest(fam)
            _log(f"{name} is RETIRED (not in the live catalog) → healed to {out}")
    _memo[name] = out
    return out


def resolve_list(csv: str) -> list[str]:
    """'glm@latest,deepseek-flash@latest,gpt-5-mini' -> resolved, de-duplicated, order kept."""
    out: list[str] = []
    for m in (x.strip() for x in csv.split(",")):
        r = resolve(m) if m else ""
        if r and r not in out:
            out.append(r)
    return out


# ── thinking off ──────────────────────────────────────────────────────────────
# Every lane takes a DIFFERENT off switch, and the wrong one either errors or is silently ignored.
# Measured through litellm 2026-10-11 (the way the chains call models):
#   Ollama Cloud / local (openai/<model> + api_base): litellm REJECTS reasoning_effort unless it is in
#     allowed_openai_params; extra_body passes it raw. Both -> 0 reasoning. "minimal"/"disable" rejected.
#   gemini/: litellm maps reasoning_effort natively ("none"/"disable"/"minimal" -> 0); extra_body -> 400.
#   real OpenAI gpt-5*: "none" is rejected by OpenAI; "minimal" -> 0 reasoning tokens.
# Reasoning shows up in DIFFERENT places per lane (Ollama: message.reasoning_content / provider
# "reasoning"; Gemini + OpenAI: only usage.completion_tokens_details.reasoning_tokens) — read all three.
_ALLOW = {"allowed_openai_params": ["reasoning_effort"]}
THINK_OFF_LADDERS = {
    "openai-compatible": [{"reasoning_effort": "none", **_ALLOW}, {"extra_body": {"reasoning_effort": "none"}},
                          {"extra_body": {"think": False}}],
    "gemini": [{"reasoning_effort": "none"}, {"reasoning_effort": "disable"}, {"reasoning_effort": "minimal"}],
    "openai": [{"reasoning_effort": "minimal"}, {"reasoning_effort": "low"}],
}
_TRANSIENT = ("Timeout", "APIConnectionError", "ServiceUnavailable", "RateLimit", "InternalServerError")


def think_lane(md: dict) -> str | None:
    """Which off-switch family a litellm model_dict needs. None = nothing to switch off (claude CLI)."""
    name, base = md.get("name", ""), (md.get("params") or {}).get("api_base") or ""
    if md.get("_claude") or name == "claude":
        return None
    if name.startswith("gemini/"):
        return "gemini"
    if name.startswith("openai/") and (not base or "api.openai.com" in base):
        return "openai"
    return "openai-compatible"


def reasoning_size(resp) -> int:
    """Reasoning emitted by one litellm response, whichever field the lane uses (chars or tokens)."""
    m = resp.choices[0].message
    psf = getattr(m, "provider_specific_fields", None) or {}
    det = getattr(getattr(resp, "usage", None), "completion_tokens_details", None)
    return max(len(getattr(m, "reasoning_content", None) or ""),
               len(psf.get("reasoning") or "") if isinstance(psf, dict) else 0,
               getattr(det, "reasoning_tokens", None) or 0)


def _probe_think_off(md: dict, method: dict) -> tuple[str, int]:
    """('ok'|'transient'|'rejected'|'still-thinking'|'empty', reasoning) for one candidate method."""
    import litellm
    try:
        r = litellm.completion(model=md["name"], timeout=120, max_tokens=2000,
                               messages=[{"role": "user", "content": "Is 'Penso che sia vero' correct Italian? yes or no."}],
                               **{k: v for k, v in (md.get("params") or {}).items() if k != "temperature"}, **method)
    except Exception as e:
        return ("transient" if any(t in type(e).__name__ for t in _TRANSIENT) else "rejected"), 0
    n = reasoning_size(r)
    if not (r.choices[0].message.content or "").strip():
        return "empty", n
    return ("ok" if n == 0 else "still-thinking"), n


def thinking_off(md: dict, force: bool = False) -> dict:
    """Return a copy of a litellm model_dict with thinking switched off by the method VERIFIED for its lane.

    Tries the lane's ladder in order; a method counts only if the call succeeds AND emits 0 reasoning.
    The winner is cached (PROBE_CACHE, PROBE_TTL_DAYS) so this costs a few tiny calls once per model.
    Fallback when nothing reaches 0: the method with the least reasoning, else the md UNCHANGED (thinking
    stays on) — logged loudly either way. Never raises: a gate that thinks is slower, not broken."""
    lane = think_lane(md)
    if lane is None:
        return md
    base = (md.get("params") or {}).get("api_base") or ""
    ck = f"think-off|{md['name']}|{base}"
    PROBE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROBE_CACHE.with_suffix(".lock"), "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            cache = json.loads(PROBE_CACHE.read_text())
        except Exception:
            cache = {}
        hit = cache.get(ck)
        if hit and not force and time.time() - hit["ts"] < PROBE_TTL_DAYS * 86400:
            method = hit["method"]
        else:
            tried, best, method, transient = [], None, None, False
            for cand in THINK_OFF_LADDERS[lane]:
                verdict, n = _probe_think_off(md, cand)
                tried.append({"method": cand, "verdict": verdict, "reasoning": n})
                if verdict == "ok":
                    method = cand
                    break
                if verdict == "transient":
                    transient = True
                elif verdict == "still-thinking" and (best is None or n < best[1]):
                    best = (cand, n)
            if method is None and best:
                method = best[0]
                _log(f"thinking-off {md['name']}: nothing reached 0 — using least-reasoning {method} ({best[1]})")
            if transient and method is None:
                _log(f"thinking-off {md['name']}: transient probe failures — not cached, using {THINK_OFF_LADDERS[lane][0]}")
                method = THINK_OFF_LADDERS[lane][0]
            else:
                cache[ck] = {"ts": time.time(), "lane": lane, "method": method, "tried": tried}
                PROBE_CACHE.write_text(json.dumps(cache, indent=1))
                _log(f"thinking-off {md['name']}: {method if method else 'NO METHOD WORKS — thinking stays ON'} "
                     f"({lane}; tried {len(tried)})")
    if not method:
        return md
    return {**md, "params": {**(md.get("params") or {}), **method}}


def status(force: bool = False) -> dict:
    try:
        gen = json.loads(CATALOG.read_text()).get("generated")
    except Exception:
        gen = None
    aliases = {f"{f}@latest": latest(f, force) for f in FAMILIES}   # probes first, then read the cache
    try:
        probes = json.loads(PROBE_CACHE.read_text())
    except Exception:
        probes = {}
    return {"catalog": str(CATALOG), "catalog_generated": gen, "aliases": aliases, "probes": probes}


if __name__ == "__main__":
    if "--thinking" in sys.argv:          # which off-switch each model verified (from the probe cache)
        try:
            probes = json.loads(PROBE_CACHE.read_text())
        except Exception:
            probes = {}
        for k, v in probes.items():
            if k.startswith("think-off|"):
                print(f"  {k.split('|')[1]:34} {v['lane']:18} -> {v['method']}")
        sys.exit(0)
    s = status(force="--reprobe" in sys.argv)
    if "--json" in sys.argv:
        print(json.dumps(s, indent=1))
    else:
        print(f"catalog {s['catalog']}  (generated {s['catalog_generated']})")
        for a, m in s["aliases"].items():
            p = s["probes"].get(m, {})
            print(f"  {a:24} -> {m:22} probe={'ok' if p.get('ok') else ('FAILED' if p else 'n/a')}")
