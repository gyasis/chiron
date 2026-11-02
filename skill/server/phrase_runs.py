"""phrase_runs — server-side phrase-coach runs that outlive the browser connection.

A coach run takes one to two minutes. On a phone the screen sleeps or Android suspends the WebView inside that time and the
connection drops. The run therefore belongs to the SERVER: it is an asyncio task that keeps going whether or not anyone
listens, and its output is kept here so a returning page can pick it up.

  run_id    = sha256(session key + the full messages list)
  start()   the same run_id while it runs ATTACHES (no second run); a finished run is returned as it is, with no model calls;
            a different request from the same session SUPERSEDES (cancels) that session's run in flight
  A disconnect cancels nothing. Only a newer, different request from the same session does.

The store is bounded in memory:
  TTL_S     1800 s (30 min) after a run finishes. A phone that sleeps for a few minutes or an app that is switched away
            for half an hour can still collect its answer; an answer is 10-20 KB, so the TTL costs little memory.
  MAX_RUNS  64 entries. Past it the oldest FINISHED runs go first; a running run is never evicted.
Every eviction is logged. The final text is also in the prompt ledger (one record per model call, written by the chain).
"""
from __future__ import annotations
import asyncio, hashlib, json, sys, time
from collections import OrderedDict

TTL_S = 1800.0
MAX_RUNS = 64


def _log(msg: str) -> None:
    sys.stderr.write(f"[phrase_runs] {msg}\n")
    sys.stderr.flush()


def run_id_of(key: str, messages: list) -> str:
    return hashlib.sha256((key + "\n" + json.dumps(messages, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()[:16]


class Run:
    def __init__(self, rid: str, key: str, messages: list, now: float):
        self.id, self.key, self.status = rid, key, "running"          # running | done | error | cancelled
        self.user = next((str(m.get("content") or "").strip() for m in reversed(messages)
                          if m.get("role") == "user"), "")
        self.chunks: list[str] = []
        self.content = ""
        self.error: str | None = None
        self.result: dict = {}
        self.started = now
        self.finished: float | None = None
        self.task: asyncio.Task | None = None
        self._waiters: list[asyncio.Future] = []

    def _wake(self) -> None:
        for f in self._waiters:
            if not f.done():
                f.set_result(None)
        self._waiters.clear()

    async def wait_change(self, seen: int) -> None:
        """Returns once there are more than `seen` chunks, or the run has stopped running."""
        while len(self.chunks) <= seen and self.status == "running":
            f = asyncio.get_running_loop().create_future()
            self._waiters.append(f)
            await f

    def view(self, now: float) -> dict:
        return {"id": self.id, "status": self.status, "content_so_far": "".join(self.chunks), "done": self.status == "done",
                "error": self.error, "user": self.user, "elapsed_s": int((self.finished or now) - self.started)}


class RunStore:
    def __init__(self, ttl_s: float = TTL_S, max_runs: int = MAX_RUNS, clock=time.monotonic):
        self.ttl_s, self.max_runs, self.clock = ttl_s, max_runs, clock
        self.runs: "OrderedDict[str, Run]" = OrderedDict()
        self.latest: dict[str, str] = {}           # session key -> its newest run id

    def get(self, rid: str) -> Run | None:
        self.evict()
        return self.runs.get(rid)

    def latest_for(self, key: str) -> Run | None:
        rid = self.latest.get(key)
        return self.get(rid) if rid else None

    def evict(self) -> None:
        now = self.clock()
        for rid, r in list(self.runs.items()):
            if r.status != "running" and r.finished is not None and now - r.finished > self.ttl_s:
                self._drop(rid, f"older than the {int(self.ttl_s)} s TTL")
        over = len(self.runs) - self.max_runs
        for rid, r in list(self.runs.items()):
            if over <= 0:
                break
            if r.status != "running":
                self._drop(rid, f"over the {self.max_runs}-entry cap")
                over -= 1

    def _drop(self, rid: str, why: str) -> None:
        r = self.runs.pop(rid)
        if self.latest.get(r.key) == rid:
            del self.latest[r.key]
        _log(f"evicted run {rid} ({r.status}, session {r.key}): {why}")

    def start(self, key: str, messages: list, drive) -> tuple[Run, bool]:
        """(run, attached). `drive(emit, messages, key)` is the coroutine function that produces the reply: it calls
        emit(chunk) per section and returns the result dict. Must be called inside a running event loop."""
        rid = run_id_of(key, messages)
        self.evict()
        cur = self.runs.get(rid)
        if cur is not None and cur.status in ("running", "done"):
            self.runs.move_to_end(rid)
            self.latest[key] = rid
            return cur, True
        if cur is not None:                         # error / cancelled earlier: a re-send is a retry
            self._drop(rid, "retried")
        prev = self.latest.get(key)
        if prev and prev in self.runs and self.runs[prev].status == "running":
            self.cancel(prev, "superseded by a newer request from this session")
        run = Run(rid, key, messages, self.clock())
        self.runs[rid] = run
        self.latest[key] = rid
        run.task = asyncio.ensure_future(self._drive(run, drive, messages))
        self.evict()
        return run, False

    def cancel(self, rid: str, why: str) -> None:
        r = self.runs.get(rid)
        if r is None or r.status != "running":
            return
        _log(f"run {rid} cancelled: {why}")
        r.status, r.error, r.finished = "cancelled", why, self.clock()
        if r.task is not None:
            r.task.cancel()
        r._wake()

    async def _drive(self, run: Run, drive, messages: list) -> None:
        def emit(chunk: str) -> None:
            run.chunks.append(chunk)
            run._wake()
        try:
            run.result = await drive(emit, messages, run.key) or {}
            if run.status == "running":
                run.content, run.status = "".join(run.chunks), "done"
        except asyncio.CancelledError:
            if run.status == "running":
                run.status, run.error = "cancelled", "cancelled"
        except BaseException as e:
            run.status, run.error = "error", f"{type(e).__name__}: {e}"[:500]
            _log(f"run {run.id} failed: {run.error}")
        finally:
            run.finished = self.clock()
            run._wake()
