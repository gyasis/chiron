"""Chiron generation observability — writes a per-lesson steps.jsonl the server streams to the
Jobs page. Two levels: chiron PHASE markers (parent rail) + raw PromptChain ExecutionEvents
(nested model/tool calls). EVERYTHING here is best-effort — a failure must NEVER break generation.

Record shapes (one JSON object per line):
  {"kind":"phase","name":"...","status":"start|end","ts":ISO,"seq":N}
  {"kind":"event","phase":"<parent phase>","event_type":"MODEL_CALL_START|...","model_name":...,
   "step_instruction":...,"metadata":{"tokens_used":...,"execution_time_ms":...,"error":...},"ts":ISO,"seq":N}
"""
import json, threading
from datetime import datetime
from pathlib import Path

_lock = threading.Lock()
_state = {"path": None, "phase": None, "seq": 0}


def set_out(out_dir) -> None:
    """Point the log at <out_dir>/steps.jsonl and start it fresh for this run."""
    try:
        p = Path(out_dir) / "steps.jsonl"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("")            # fresh per generation
        _state["path"] = p
        _state["seq"] = 0
    except Exception:
        _state["path"] = None


def _write(rec: dict) -> None:
    p = _state["path"]
    if not p:
        return
    try:
        with _lock:
            _state["seq"] += 1
            rec["seq"] = _state["seq"]
            rec["ts"] = datetime.now().isoformat()
            with open(p, "a") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass


def phase(name: str, status: str, **extra) -> None:
    """Mark a parent phase boundary. status = 'start' | 'end'."""
    if status == "start":
        _state["phase"] = name
    _write({"kind": "phase", "name": name, "status": status, **extra})


def error(label: str, detail: str) -> None:
    _write({"kind": "event", "event_type": "STEP_ERROR", "phase": _state["phase"],
            "step_instruction": label, "metadata": {"error": str(detail)[:300]}})


def make_callback():
    """A PromptChain callback: forwards every ExecutionEvent into steps.jsonl, tagged with the phase.
    Keeps only the fields the UI needs; trims big content so the log stays small."""
    def cb(ev):
        try:
            d = ev.to_dict() if hasattr(ev, "to_dict") else dict(ev)
            md = d.get("metadata") or {}
            slim = {"kind": "event", "phase": _state["phase"],
                    "event_type": d.get("event_type"), "model_name": d.get("model_name"),
                    "step_number": d.get("step_number"),
                    "step_instruction": (d.get("step_instruction") or "")[:120],
                    "metadata": {k: md[k] for k in ("tokens_used", "execution_time_ms", "error") if k in md}}
            _write(slim)
        except Exception:
            pass
    return cb
