"""
Chiron lesson TUTOR service — the PromptChain page-tutor as an API the lesson (web + mobile) calls.
Host-side (needs harrison-search + PromptChain + governor/Gemini — none in the Docker/lesson-static path).
Binds 0.0.0.0 so a phone (http://192.168.0.112:8912) and the laptop both reach it; brokers the LAN
governor (:8799) + cloud (Gemini/Ollama) calls. CORS open (the lesson is served from :8911, cross-origin).

LIVE PROGRESS — the agent tier can take minutes, so the tutor narrates what it's REALLY doing (router
verdict, each search with its actual query, drafting, reconciling). TWO transports, switchable client-side:
  A) SSE    POST /tutor-stream       → streams {type:status,text} … then {type:final, ...reply}
  B) POLL   POST /tutor-chat {rid}   → records status under `rid`; client polls GET /tutor-status/<rid>

  POST /tutor-chat    {lesson_slug, section_id, section_text, selection, messages, model, mode, lang,
                       suggest?, rid?}  → {reply, depth, grounded, model, source, suggestions?}
  POST /tutor-stream  (same body)      → text/event-stream of status events then the final payload
  GET  /tutor-status/<rid>             → {events:[{t,text}], done}
  GET  /tutor-models                   → {default, models:[{id,label}]}
  GET  /healthz
"""
import asyncio, json, os, queue, threading, time, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from tutor_chain import answer_turn, suggestions, decompose, cards, mcqs, train_path, MODELS, DEFAULT_MODEL

PORT = 8912

# ── live-status store (transport B: poll) ───────────────────────────────────────
_STATUS: dict = {}                 # rid -> {"events": [{"t","text"}], "done": bool, "ts": float}
_SLOCK = threading.Lock()


def _status_push(rid: str, text: str) -> None:
    if not rid:
        return
    with _SLOCK:
        st = _STATUS.setdefault(rid, {"events": [], "done": False, "ts": time.time()})
        st["events"].append({"t": round(time.time(), 3), "text": text})
        st["ts"] = time.time()


def _status_done(rid: str) -> None:
    if not rid:
        return
    with _SLOCK:
        _STATUS.setdefault(rid, {"events": [], "done": False, "ts": time.time()})["done"] = True


def _status_gc() -> None:
    """Drop stale buckets so the store can't grow forever (10 min TTL)."""
    cut = time.time() - 600
    with _SLOCK:
        for k in [k for k, v in _STATUS.items() if v.get("ts", 0) < cut]:
            _STATUS.pop(k, None)


def _run_answer(body: dict, on_status=None) -> dict:
    """One turn: route → answer (with live status) → optional follow-up suggestions."""
    msgs = body.get("messages") or []
    out = asyncio.run(answer_turn(
        section_text=body.get("section_text", ""), selection=body.get("selection", ""),
        section_id=body.get("section_id", ""), lesson_slug=body.get("lesson_slug", ""),
        messages=msgs, lang=body.get("lang", "en"), model=body.get("model"),
        mode=body.get("mode", "med"), on_status=on_status))
    if body.get("suggest") and out.get("reply"):
        q = next((m.get("content", "") for m in reversed(msgs) if m.get("role") == "user"), "")
        if on_status:
            on_status("💡 Thinking of what to ask next…")
        out["suggestions"] = suggestions(q, out["reply"], body.get("lang", "en"))
    return out


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # keep-alive; required for a well-behaved SSE stream

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/healthz"):
            return self._json({"ok": True, "port": PORT})
        if self.path.startswith("/tutor-models"):
            return self._json({"default": DEFAULT_MODEL,
                               "models": [{"id": k, "label": v["label"]} for k, v in MODELS.items()]})
        if self.path.startswith("/images"):                 # 🖼 highlight → real medical images (hypersearch)
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            q = (qs.get("q", [""])[0] or "").strip()
            try:
                k = max(2, min(int(qs.get("k", ["8"])[0] or 8), 12))
            except Exception:
                k = 8
            if not q:
                return self._json({"images": [], "q": ""})
            try:
                from hypersearch import search_images        # real images only — NEVER fabricated
                es = search_images(q, count=k, no_stock=True)
                ims = [{"url": im.url,
                        "thumbnail": getattr(im, "thumbnail", None) or im.url,
                        "page_url": getattr(im, "page_url", None),
                        "source": getattr(im, "source", None),
                        "width": getattr(im, "width", None),
                        "height": getattr(im, "height", None),
                        "engine": getattr(im, "engine", None)} for im in (es.images or [])]
                return self._json({"images": ims, "q": q})
            except Exception as e:
                return self._json({"images": [], "q": q, "error": str(e)}, 502)
        if self.path.startswith("/tutor-status/"):          # transport B — poll
            rid = self.path.split("/tutor-status/", 1)[1].split("?")[0]
            with _SLOCK:
                st = _STATUS.get(rid) or {"events": [], "done": False}
                return self._json({"events": st["events"], "done": st["done"]})
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path.startswith("/tutor-stream"):
            return self._stream()
        if self.path.startswith("/decompose"):
            # 🧬 THE SPINE — a note → its real teaching seams + the discriminators. Everything
            # downstream (cards / MCQs / train-me / lesson) hangs off this.
            try:
                b = self._body()
                out = decompose(b.get("note", ""), b.get("question", ""), b.get("concept", ""),
                                b.get("lang", "en"))
                return self._json(out or {"topics": [], "discriminators": [], "error": "decompose failed"})
            except Exception as e:
                return self._json({"topics": [], "discriminators": [], "error": str(e)}, 502)
        if self.path.startswith("/related"):
            # DOMAIN-BLIND passthrough: forward to whatever CHIRON_RELATED_URL points at (an SSM matcher,
            # or nothing). Chiron never learns what "SSM" is (R-CH5) — it just renders {label,url} pills.
            url = os.environ.get("CHIRON_RELATED_URL", "")
            if not url:
                return self._json({"related": []})
            try:
                raw = self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}"
                req = urllib.request.Request(url, data=raw, headers={"Content-Type": "application/json"})
                return self._json(json.loads(urllib.request.urlopen(req, timeout=90).read()))
            except Exception as e:
                return self._json({"related": [], "error": str(e)}, 502)
        if self.path.startswith("/cards"):
            # 🎴 cards OFF THE SPINE — discriminators first, then per-topic mechanisms.
            try:
                b = self._body()
                return self._json({"cards": cards(b.get("topics") or [], b.get("discriminators") or [],
                                                  b.get("concept", ""), b.get("lang", "en"))})
            except Exception as e:
                return self._json({"cards": [], "error": str(e)}, 502)
        if self.path.startswith("/mcqs"):
            try:
                b = self._body()
                return self._json({"mcqs": mcqs(b.get("topics") or [], b.get("discriminators") or [],
                                                b.get("concept",""), b.get("lang","en"))})
            except Exception as e:
                return self._json({"mcqs": [], "error": str(e)}, 502)
        if self.path.startswith("/train"):
            try:
                b = self._body()
                out = train_path(b.get("topics") or [], b.get("discriminators") or [],
                                 b.get("concept",""), b.get("lang","en"))
                return self._json(out or {"steps": [], "error": "train produced nothing"})
            except Exception as e:
                return self._json({"steps": [], "error": str(e)}, 502)
        if not self.path.startswith("/tutor-chat"):
            return self._json({"error": "not found"}, 404)
        rid = None
        try:
            body = self._body()
            rid = body.get("rid")
            _status_gc()
            out = _run_answer(body, on_status=((lambda t: _status_push(rid, t)) if rid else None))
            _status_done(rid)
            return self._json(out)
        except Exception as e:
            _status_done(rid)
            return self._json({"reply": "", "error": str(e)}, 502)

    def _stream(self):
        """Transport A — SSE: emit each REAL status event as it happens, then the final answer."""
        try:
            body = self._body()
        except Exception:
            body = {}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.end_headers()
        q: "queue.Queue" = queue.Queue()

        def run():
            try:
                out = _run_answer(body, on_status=lambda t: q.put({"type": "status", "text": t}))
                q.put({"type": "final", **out})
            except Exception as e:
                q.put({"type": "final", "reply": "", "error": str(e)})
            q.put(None)

        threading.Thread(target=run, daemon=True).start()
        while True:
            try:
                item = q.get(timeout=20)
            except queue.Empty:
                try:                                   # keep the connection warm through long model calls
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    continue
                except Exception:
                    break
            if item is None:
                break
            try:
                self.wfile.write(("data: " + json.dumps(item, ensure_ascii=False) + "\n\n").encode())
                self.wfile.flush()
            except Exception:
                break                                  # client disconnected — stop streaming
        try:
            self.wfile.write(b"data: {\"type\":\"end\"}\n\n")
            self.wfile.flush()
        except Exception:
            pass


if __name__ == "__main__":
    print(f"chiron-tutor on 0.0.0.0:{PORT}  (SSE /tutor-stream · poll /tutor-status · /tutor-chat)")
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
