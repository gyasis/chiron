"""running — one list of everything the server is working on, for the "N running" pill on every page and the phone.

    collect(jobs, phrase_runs, live_sessions, dictation_jobs, now) -> {"items": [...], "recent": [...], "count": n}
        phrase_runs   [{"id", "user", "status", "age_s"}]   (the run store keeps a monotonic clock, so ages, not times)

Each item is {"kind", "id", "title", "status", "started" (epoch s), "elapsed_s", "detail", "link"}:
    lesson     a lesson generation or audio bake (JOBS)
    pimsleur   a Pimsleur season (JOBS, slug chiron-pimsleur-*)
    phrase     a phrase-coach answer still being written
    drill      Pimsleur-live audio being made, line by line
    dictation  a dettato lesson being built from a voice note
`recent` lists the JOBS that finished in the last RECENT_S seconds, so a page opened after a job ended still sees how
it ended. The state lives on the server, so closing and reopening a page or the app shows the same list.
"""
import re
from datetime import datetime

LIVE = ("queued", "running", "baking")
RECENT_S = 15 * 60


def _epoch(ts) -> float | None:
    if isinstance(ts, (int, float)):
        return float(ts)
    try:
        return datetime.fromisoformat(str(ts)).timestamp()
    except (TypeError, ValueError):
        return None


def _pretty_slug(slug) -> str:
    """A readable name from a lesson slug: no chiron- prefix, no type words, dashes as spaces."""
    w = [x for x in str(slug or "").removeprefix("chiron-").split("-") if x]
    if len(w) > 1 and w[0] in ("ssm", "ward", "italian", "pimsleur"):
        w = w[1:]
    if len(w) > 1 and w[-1] in ("systematic", "atlas", "primer", "amboss"):
        w = w[:-1]
    s = " ".join(w)
    return s[:1].upper() + s[1:]


def _job_name(j: dict) -> str:
    """The name a job shows: its title, else a prettified slug. A subject that is the slug or a question id is never shown."""
    if j.get("title"):
        return j["title"]
    subj = j.get("subject")
    if subj and subj != j.get("slug") and not subj.startswith("chiron-") and not re.match(r"^ssm\d{4}_\d+$", subj, re.I):
        return subj
    return _pretty_slug(j.get("slug") or j.get("id"))


def _item(kind, id_, title, status, started, now, detail="", link=""):
    return {"kind": kind, "id": id_, "title": title or id_, "status": status, "started": started,
            "elapsed_s": int(now - started) if started else None, "detail": detail, "link": link}


def _job_kind(j: dict) -> str:
    return "pimsleur" if str(j.get("slug") or "").startswith("chiron-pimsleur-") else "lesson"


def collect(jobs: list[dict], phrase_runs: list[dict], live_sessions: list[dict], dictation_jobs: list[dict], now: float) -> dict:
    items, recent = [], []
    for j in jobs:
        st = j.get("status")
        if st in LIVE:
            detail = st if st != "running" else (j.get("phase") or "running")
            if j.get("eta_seconds"):
                detail += f" · about {round(j['eta_seconds'] / 60) or 1} min left"
            items.append(_item(_job_kind(j), j.get("id"), _job_name(j), st,
                               _epoch(j.get("started") or j.get("created")), now, detail, "/library/"))
        elif j.get("finished") and (_epoch(j["finished"]) or 0) > now - RECENT_S:
            recent.append({"kind": _job_kind(j), "id": j.get("id"), "title": _job_name(j),
                           "status": st, "finished": _epoch(j["finished"]), "link": "/library/"})
    for r in phrase_runs:
        if r.get("status") == "running":
            items.append(_item("phrase", r.get("id"), (r.get("user") or "phrase")[:80], "running", now - r.get("age_s", 0), now,
                               "writing the answer", "/ask/"))
    for s in live_sessions:
        lines = s.get("lines") or []
        left = [ln for ln in lines if ln.get("state") in ("queued", "making")]
        if left:
            done = sum(1 for ln in lines if ln.get("state") == "ready")
            items.append(_item("drill", s.get("id"), "Pimsleur live audio", "running", _epoch(s.get("created")), now,
                               f"{done} of {len(lines)} lines ready"))
    for d in dictation_jobs:
        if d.get("status") in ("queued", "running"):
            items.append(_item("dictation", d.get("slug"), d.get("from") or d.get("slug"), d["status"],
                               _epoch(d.get("started") or d.get("queued")), now, "building the dictation", "/dettato/"))
    items.sort(key=lambda i: i["started"] or now)
    recent.sort(key=lambda r: r["finished"], reverse=True)
    return {"items": items, "recent": recent[:10], "count": len(items), "at": now}
