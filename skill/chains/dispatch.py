#!/usr/bin/env python3
"""Chiron chain DISPATCHER — the ONE entry point that routes a lesson request to the correct chain.

The Chiron generate-server calls this; the Wizard's job payload maps 1:1 to its args. It hides the
per-chain env-var contract differences (medicine=CH_SUBJECT, passage=SSM_QID, ward/pure-italian=CH_TOPIC).

Routing: (domain × depth) → chain dir. depth auto-derives from subject_type or the subject when omitted
(medicine: system→atlas, disease→systematic, cross-cutting→primer).

CLI:  python3 dispatch.py --domain medicine --subject "Aortic aneurysm" [--depth systematic] \
                          [--subject-type disease] [--stage all|chapters|assemble|audio|plan] [--dry-run]
API:  from dispatch import resolve, run   # resolve(...) -> {runpy, env, depth, domain, slug}; run(res, stage)
"""
import argparse, json, os, re, subprocess, sys
from pathlib import Path

SKILL = Path(os.environ.get("CHIRON_SKILL", Path.home() / "Documents/code/chiron/skill"))
CHAINS = SKILL / "chains"
ATLAS = SKILL / "blueprints" / "disease-atlas.json"

# (domain, depth) -> chain dir
CHAIN = {
    ("medicine", "amboss"):        "2026-06-29_chiron-medicine-lesson-chain",
    ("medicine", "primer"):        "2026-07-05_chiron-medicine-primer-chain",
    ("medicine", "atlas"):         "2026-07-06_chiron-medicine-atlas-chain",
    ("medicine", "systematic"):    "2026-07-06_chiron-medicine-systematic-chain",
    ("medical-italian", "passage"): "2026-06-30_chiron-medical-italian-passage-chain",
    ("medical-italian", "ward"):    "2026-06-30_chiron-wards-lesson-chain",
    ("italian", "lesson"):          "2026-06-30_chiron-pure-italian-lesson-chain",
}
DEFAULT_DEPTH = {"medicine": "primer", "medical-italian": "ward", "italian": "lesson"}


def _atlas_systems():
    try:
        return [s["system"].lower() for s in json.loads(ATLAS.read_text())["systems"]]
    except Exception:
        return []


def detect_depth(subject, domain):
    """Medicine only: cross-cutting(geriatrics)→primer, organ-system→atlas, else single-disease→systematic."""
    if domain != "medicine":
        return None
    s = (subject or "").strip().lower()
    if not s:
        return None
    if "geriatr" in s:
        return "primer"
    if any(s == k or (len(s) > 3 and (s in k or k.split(" ")[0] in s)) for k in _atlas_systems()):
        return "atlas"
    return "systematic"


def _slug(domain, depth, subject):
    base = re.sub(r"[^a-z0-9]+", "-", (subject or "lesson").lower()).strip("-")
    if domain == "medicine":
        return f"chiron-{base}-{depth}" if depth != "amboss" else f"chiron-{base}-amboss"
    if domain == "medical-italian" and depth == "passage":
        return f"chiron-ssm-{base}"
    if domain == "medical-italian" and depth == "ward":
        return f"chiron-ward-{base}"
    return f"chiron-italian-{base[:48]}"


def resolve(domain, depth=None, subject="", subject_type=None, extra=None):
    """Return the routing decision: {runpy, chain_name, env, depth, domain, slug}."""
    domain = (domain or "medicine").lower()
    extra = extra or {}
    if not depth:
        depth = {"system": "atlas", "disease": "systematic", "cross-cutting": "primer"}.get(subject_type)
    if not depth:
        depth = detect_depth(subject, domain) or DEFAULT_DEPTH.get(domain, "primer")
    key = (domain, depth)
    if key not in CHAIN:
        raise SystemExit(f"[dispatch] no chain for {key}. Known: {sorted(CHAIN)}")
    chain = CHAINS / CHAIN[key]
    env = {}
    if domain == "medicine":
        env["CH_SUBJECT"] = subject
        if depth == "atlas" and extra.get("max_diseases"):
            env["CH_MAX_DISEASES"] = str(extra["max_diseases"])
        if depth == "primer" and extra.get("chapters"):
            env["CH_CHAPTERS"] = str(extra["chapters"])
        if depth == "amboss" and extra.get("system"):
            env["CH_SYSTEM"] = extra["system"]
    elif domain == "medical-italian" and depth == "passage":
        env["SSM_QID"] = subject   # an SSM question id; blank → the chain picks random
    elif domain == "medical-italian" and depth == "ward":
        env["CH_TOPIC"] = subject
        if extra.get("setting"):
            env["CH_SETTING"] = extra["setting"]
    elif domain == "italian":
        env["CH_TOPIC"] = subject
    return {"runpy": str(chain / "run.py"), "chain_name": chain.name, "env": env,
            "depth": depth, "domain": domain, "slug": _slug(domain, depth, subject)}


def run(res, stage="all"):
    """Run the resolved chain with its env + CH_STAGE. Returns the CompletedProcess."""
    env = {**os.environ, **res["env"], "CH_STAGE": stage}
    return subprocess.run([sys.executable, res["runpy"]], env=env)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", default="medicine")
    ap.add_argument("--depth", default="")
    ap.add_argument("--subject", required=True)
    ap.add_argument("--subject-type", default="")
    ap.add_argument("--stage", default="all")
    ap.add_argument("--dry-run", action="store_true", help="print the routing decision, don't run")
    a = ap.parse_args()
    res = resolve(a.domain, a.depth or None, a.subject, a.subject_type or None)
    print(json.dumps({"routed_to_depth": res["depth"], "chain": res["chain_name"],
                      "slug": res["slug"], "env": res["env"]}, indent=2))
    if not a.dry_run:
        sys.exit(run(res, a.stage).returncode)
