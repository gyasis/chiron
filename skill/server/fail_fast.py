"""fail_fast — make Chiron's exam paths (Sessione, mock oral, tutor) fail fast instead of hanging on the governor.

Origin: the 2026-10-17 governor wedge. One gemma4:12b call ran 22m42s on the Mac Studio, and Chiron's
fallback chains kept falling back into the same lane with per-attempt timeouts that added up
(the tutor could block for ~7 min on three 140 s attempts).

    with scope(60, "oral"):             one TOTAL deadline per user action. Nested scopes keep the outer one.
        t = attempt_timeout(90)         this attempt's timeout: min(cap, time left); DeadlineExceeded when spent
        check_governor("gemma4:12b")    GovernorBusy if /budget shows a lease on that model older than STALE_LEASE_S
        num_ctx_for(len(prompt))        options.num_ctx: CHIRON_NUM_CTX (8192), doubled for long prompts, capped
        governor_headers(t)             {"X-Governor-Max-Seconds": t}, a hint the governor may ignore
        modal_chat(system, user)        the non-governor fallback: the Modal lane (no lease, no queue)

The Modal lane only runs while a lane session is open (`lane open <model> <min>` on the Studio). Without
one it answers 409 at once and starts no GPU, so this fallback costs nothing unless a session is open.
Without a scope, attempt_timeout(cap) returns cap: callers outside an exam path keep their old timeouts.
"""
from __future__ import annotations
import contextlib, contextvars, json, os, sys, threading, time, urllib.error, urllib.request
from pathlib import Path

import local_models

NUM_CTX = int(os.environ.get("CHIRON_NUM_CTX") or 8192)
NUM_CTX_MAX = int(os.environ.get("CHIRON_NUM_CTX_MAX") or 32768)
CHARS_PER_TOKEN = 3            # conservative for Italian/English prose: overestimates tokens, so never truncates
REPLY_TOKENS = 2048            # room for the answer inside the window
STALE_LEASE_S = float(os.environ.get("CHIRON_STALE_LEASE_S") or 120)
BUDGET_TIMEOUT = 2.0           # /budget bypasses admission, so it answers in ms even while chat hangs
BUDGET_TTL = 3.0
MIN_ATTEMPT_S = 3.0            # an attempt with less time than this left is not worth starting
MODAL_MODEL = os.environ.get("CHIRON_MODAL_MODEL", "modal/Qwen3.8-Flash-Next-GSQ-RCO-IQ1_M")
MODAL_RESERVE_S = float(os.environ.get("CHIRON_MODAL_RESERVE_S") or 15)   # a warm lane answers in ~2 s
HEADER = "X-Governor-Max-Seconds"


class DeadlineExceeded(TimeoutError):
    pass


class GovernorBusy(RuntimeError):
    pass


def _log(msg: str) -> None:
    sys.stderr.write(f"[fail_fast] {msg}\n")
    sys.stderr.flush()


def governor_root() -> str:
    """'http://mac:8799/llm/ollama' -> 'http://mac:8799' (where /budget and /llm/lane live)."""
    return local_models.GOVERNOR.split("/llm/", 1)[0].rstrip("/")


# ── deadline ──────────────────────────────────────────────────────────────────

class Deadline:
    def __init__(self, seconds: float, label: str = "", clock=time.monotonic):
        self.total, self.label, self._clock = float(seconds), label, clock
        self._end = clock() + self.total

    def remaining(self) -> float:
        return self._end - self._clock()

    def timeout(self, cap: float | None = None, reserve: float = 0.0) -> float:
        left = self.remaining() - reserve
        if left < MIN_ATTEMPT_S:
            raise DeadlineExceeded(f"{self.label or 'action'} deadline: {max(self.remaining(), 0):.0f}s left "
                                   f"of {self.total:.0f}s" + (f" ({reserve:.0f}s kept for the fallback)" if reserve else ""))
        return min(cap, left) if cap else left


_current: contextvars.ContextVar[Deadline | None] = contextvars.ContextVar("chiron_deadline", default=None)


def current() -> Deadline | None:
    return _current.get()


@contextlib.contextmanager
def scope(seconds: float, label: str = ""):
    """One deadline for everything inside. An enclosing scope wins (one user action = one budget)."""
    if _current.get() is not None:
        yield _current.get()
        return
    tok = _current.set(Deadline(seconds, label))
    try:
        yield _current.get()
    finally:
        _current.reset(tok)


def attempt_timeout(cap: float, reserve: float = 0.0) -> float:
    d = _current.get()
    return cap if d is None else d.timeout(cap, reserve)


def modal_reserve() -> float:
    """Time governor attempts leave for the Modal fallback, so it still gets a turn."""
    return MODAL_RESERVE_S if MODAL_MODEL else 0.0


def governor_headers(timeout: float) -> dict:
    """How long Chiron will wait for this call. Past it the answer goes to nobody."""
    return {HEADER: str(max(1, int(timeout)))}


# ── context window ────────────────────────────────────────────────────────────

def num_ctx_for(prompt_chars: int) -> int:
    """NUM_CTX unless the prompt needs more: then the next doubling that fits, at most NUM_CTX_MAX.
    Never the server's 131K default, which thrashed swap on 2026-10-17."""
    need = prompt_chars // CHARS_PER_TOKEN + REPLY_TOKENS
    ctx = NUM_CTX
    while ctx < need and ctx < NUM_CTX_MAX:
        ctx *= 2
    return min(ctx, NUM_CTX_MAX)


# ── governor pre-flight ───────────────────────────────────────────────────────

_budget_lock = threading.Lock()
_budget = {"at": float("-inf"), "data": None}


def _fetch_budget(timeout: float) -> dict:
    return json.loads(urllib.request.urlopen(governor_root() + "/budget", timeout=timeout).read())


def _same_model(a, b) -> bool:
    norm = lambda s: str(s or "").removesuffix(":latest")
    return norm(a) == norm(b)


def stale_lease(model: str) -> dict | None:
    """The lease on `model` older than STALE_LEASE_S, if any. Unreachable /budget -> None (the call itself
    then fails fast on connect); it never blocks an attempt on its own."""
    with _budget_lock:
        now = time.monotonic()
        if now - _budget["at"] >= BUDGET_TTL:
            try:
                _budget["data"] = _fetch_budget(BUDGET_TIMEOUT)
            except Exception as e:
                _log(f"/budget unreachable ({type(e).__name__}: {e}); not skipping {model}")
                _budget["data"] = None
            _budget["at"] = now
        data = _budget["data"]
    for lease in (data or {}).get("active_leases") or []:
        if isinstance(lease, dict) and _same_model(lease.get("model"), model) \
                and float(lease.get("age_s") or 0) > STALE_LEASE_S:
            return lease
    return None


def check_governor(model: str) -> None:
    lease = stale_lease(model)
    if lease:
        msg = (f"governor lane busy: {model} lease {lease.get('lease_id', '?')} is {lease.get('age_s')}s old "
               f"(> {STALE_LEASE_S:.0f}s), skipped")
        _log(msg)
        raise GovernorBusy(msg)


# ── non-governor fallback: the Modal lane ─────────────────────────────────────

class _NoLedger:
    @staticmethod
    def record(*a, **k):
        return None


def _ledger():
    """The shared prompt-ledger module (chains/ledger.py); a no-op stand-in if it cannot be imported."""
    try:
        chains = str(Path(__file__).resolve().parent.parent / "chains")
        if chains not in sys.path:
            sys.path.insert(0, chains)
        import ledger
        return ledger
    except Exception as e:
        sys.stderr.write(f"[ledger] import failed: {type(e).__name__}: {e}\n")
        return _NoLedger


def modal_chat(system: str, user: str, cap: float = 60.0) -> tuple[str, dict]:
    """One reply from the Modal lane (OpenAI-compatible, routed through the governor's REMOTE_BACKENDS:
    no lease, no queue, so a wedged Ollama lane cannot block it)."""
    if not MODAL_MODEL:
        raise RuntimeError("Modal fallback disabled (CHIRON_MODAL_MODEL is empty)")
    t = attempt_timeout(cap)
    body = {"model": MODAL_MODEL, "temperature": 0.4, "reasoning_effort": "none",   # the lane maps it to thinking off
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    req = urllib.request.Request(governor_root() + "/llm/lane/v1/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json", **governor_headers(t)})
    lp = {k: v for k, v in body.items() if k != "messages"}
    url = governor_root() + "/llm/lane/v1/chat/completions"
    t0 = time.time()
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=t).read())
    except urllib.error.HTTPError as e:
        detail = e.read()[:200].decode(errors="replace")
        hint = " (no lane session open: run `lane open %s <minutes>` on the Studio)" % MODAL_MODEL if e.code == 409 else ""
        _ledger().record("server:modal", MODAL_MODEL, body["messages"], None, endpoint=url, params=lp, status="error",
                         error=f"HTTP {e.code}: {detail}"[:500], latency_ms=int((time.time() - t0) * 1000))
        raise RuntimeError(f"Modal lane HTTP {e.code}{hint}: {detail}") from None
    except Exception as e:
        _ledger().record("server:modal", MODAL_MODEL, body["messages"], None, endpoint=url, params=lp, status="error",
                         error=f"{type(e).__name__}: {e}"[:500], latency_ms=int((time.time() - t0) * 1000))
        raise
    ch = (d.get("choices") or [{}])[0]
    _ledger().record("server:modal", MODAL_MODEL, body["messages"], (ch.get("message") or {}).get("content"),
                     endpoint=url, params=lp, tokens_in=(d.get("usage") or {}).get("prompt_tokens"),
                     tokens_out=(d.get("usage") or {}).get("completion_tokens"), finish_reason=ch.get("finish_reason"),
                     latency_ms=int((time.time() - t0) * 1000))
    msg = ch.get("message") or {}
    reasoning = msg.get("reasoning_content") or msg.get("reasoning") or ""
    if reasoning:
        _log(f"{MODAL_MODEL} emitted {len(reasoning)} chars of reasoning despite reasoning_effort=none")
    if ch.get("finish_reason") == "length":
        raise RuntimeError(f"{MODAL_MODEL} reply truncated (finish_reason=length)")
    content = (msg.get("content") or "").strip()
    if not content:
        raise RuntimeError(f"empty reply from {MODAL_MODEL}")
    return content, {"model": MODAL_MODEL, "reasoning_chars": len(reasoning), **(d.get("usage") or {})}
