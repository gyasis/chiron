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

OPENAI FACE (additive — every route above is unchanged):
  POST /v1/chat/completions  {model, messages, stream?, chiron?:{lesson_slug,section_id,section_text,
                              selection,mode,lang}}  → OpenAI chat-completion shape
  GET  /v1/models                      → OpenAI model-list shape
This exists so acolyte can drive the tutor as `provider:'openai-compatible'` instead of Chiron
teaching acolyte a bespoke contract — the adapter belongs on the service, not in the reusable
widget. Grounding that has no OpenAI equivalent rides in the optional `chiron` object; a plain
OpenAI client that omits it still gets a working answer from the messages alone.
"""
import asyncio, html as _html, json, os, queue, re, threading, time, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from tutor_chain import (answer_turn, suggestions, decompose, cards, mcqs, train_path,
                         MODELS, DEFAULT_MODEL, LAST_ERRORS, refresh_models)
import local_models

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


LESSONS_DIR = os.environ.get("CHIRON_LESSONS_DIR",
                             os.path.expanduser("~/Documents/generated/chiron-library/lessons"))
_SLUG_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$")
_STOP = re.compile(r"<(script|style|svg|head)\b.*?</\1>", re.S | re.I)


def slug_text(slug: str, question: str = "", cap: int = 3800) -> str:
    """Ground a turn from the lesson the phone has open: the phone (esp. an offline lesson in a
    cross-origin iframe) cannot hand us the page text, only the slug. Reads
    <LESSONS_DIR>/<slug>/lesson.html, strips markup, and returns <= `cap` chars — the text blocks that
    share the most words with the question (original order), else the head of the lesson. Bounded:
    file read capped at 2 MB; '' on any miss (bad slug, no file) so the turn still answers ungrounded."""
    if not slug or not _SLUG_OK.match(slug) or ".." in slug:
        return ""
    path = os.path.join(LESSONS_DIR, slug, "lesson.html")
    try:
        with open(path, "rb") as f:
            html = f.read(2_000_000).decode("utf-8", "replace")
    except OSError:
        return ""
    html = _STOP.sub(" ", html)
    html = re.sub(r"</(p|div|li|h[1-6]|tr|section|article)>|<br\s*/?>", "\n", html, flags=re.I)
    txt = _html.unescape(re.sub(r"<[^>]+>", " ", html))
    blocks = [re.sub(r"\s+", " ", b).strip() for b in txt.split("\n")]
    blocks = [b for b in blocks if len(b) > 25]
    if not blocks:
        return ""
    words = {w for w in re.findall(r"\w{4,}", question.lower())}
    if words:
        scored = sorted(range(len(blocks)), key=lambda i: -len(words & set(re.findall(r"\w{4,}", blocks[i].lower()))))
        pick, used = [], 0
        for i in scored:
            if len(words & set(re.findall(r"\w{4,}", blocks[i].lower()))) == 0 or used >= cap:
                break
            pick.append(i); used += len(blocks[i]) + 1
        if pick:
            return "\n".join(blocks[i][:900] for i in sorted(pick))[:cap]
    return "\n".join(blocks)[:cap]


def _fmt_t(t: float) -> str:
    return f"{int(t) // 60}:{int(t) % 60:02d}"


def video_text(slug: str, t=None, scene=None, cap: int = 3800) -> tuple[str, bool]:
    """Ground on a video-it lesson's transcript.json (scenes[].lines[]). Returns (text, scene_known).
    The CURRENT scene (found by playback time `t`, else the 1-based `scene` index the page reports) goes in
    full — situation, target structures, every line with its gloss and teaching note, the line being
    played marked — followed by the video summary and the other scenes' titles. Without a time or scene the
    whole episode's scene list is returned instead (bounded). ('', False) when there is no transcript."""
    if not slug or not _SLUG_OK.match(slug) or ".." in slug:
        return "", False
    try:
        with open(os.path.join(LESSONS_DIR, slug, "transcript.json"), "rb") as f:
            tr = json.loads(f.read(4_000_000).decode("utf-8", "replace"))
    except (OSError, ValueError):
        return "", False
    scenes = tr.get("scenes") or []
    if not scenes:
        return "", False
    cur = None
    try:
        if t is not None and t != "":
            tf = float(t)
            cur = next((i for i, sc in enumerate(scenes) if sc.get("start", 0) <= tf < sc.get("end", 0)), None)
        if cur is None and scene not in (None, "", 0):
            i = int(scene) - 1
            cur = i if 0 <= i < len(scenes) else None
    except (TypeError, ValueError):
        cur = None
    out = []
    summ = tr.get("video_summary")
    if isinstance(summ, dict):
        summ = summ.get("en") or summ.get("it") or ""
    if summ:
        out.append("EPISODE SUMMARY: " + str(summ)[:500])
    if cur is not None:
        sc = scenes[cur]
        tf = float(t) if t not in (None, "") else None
        out.append(f"CURRENT SCENE {cur + 1}/{len(scenes)} — {sc.get('title', '')} "
                   f"({_fmt_t(sc.get('start', 0))}–{_fmt_t(sc.get('end', 0))}). Situation: {sc.get('situation', '')}")
        ts = sc.get("target_structures")
        if ts:
            out.append("Target structures: " + "; ".join(map(str, ts if isinstance(ts, list) else [ts])))
        now = -1
        if tf is not None:
            for i, ln in enumerate(sc.get("lines") or []):
                if tf >= ln.get("start", 0) - 0.05:
                    now = i
        lines = sc.get("lines") or []
        rows = []
        for i, ln in enumerate(lines):
            note = re.sub(r"<[^>]+>", "", ln.get("teaching_note") or "")
            rows.append(("▶ NOW PLAYING " if i == now else "") + f"[{_fmt_t(ln.get('start', 0))}] {ln.get('character', '')}: "
                        f"{ln.get('italian_text', '')} = {ln.get('en_gloss', '')}" + (f" (note: {note})" if note else ""))
        if sum(map(len, rows)) > 2300:                  # long scene: keep the lines around the playhead, bounded
            c = now if now >= 0 else 0
            lo = max(0, c - 7)
            out.append(f"(lines {lo + 1}-{min(len(rows), lo + 15)} of {len(rows)} in this scene, around the playhead)")
            rows = rows[lo:lo + 15]
        out.extend(rows)
        others = [f"{i + 1}. {x.get('title', '')}" for i, x in enumerate(scenes) if i != cur]
        out.append("OTHER SCENES: " + " | ".join(others))
    else:
        out.append("SCENES: " + " | ".join(
            f"{i + 1}. {x.get('title', '')} — {x.get('situation', '')}" for i, x in enumerate(scenes)))
    return "\n".join(out)[:cap], cur is not None


def _run_answer(body: dict, on_status=None) -> dict:
    """One turn: route → answer (with live status) → optional follow-up suggestions."""
    msgs = body.get("messages") or []
    scene_grounded = False
    # A video lesson that reports its playhead/scene is grounded on that scene even if the page also sent text.
    has_pos = body.get("lesson_time") not in (None, "") or body.get("scene") not in (None, "", 0)
    if body.get("lesson_slug") and (has_pos or not (body.get("section_text") or "").strip()):
        q = next((m.get("content", "") for m in reversed(msgs) if m.get("role") == "user"), "")
        vt, scene_grounded = video_text(body["lesson_slug"], body.get("lesson_time"), body.get("scene"))
        body = {**body, "section_text": vt or body.get("section_text") or slug_text(body["lesson_slug"], q)}
        if not body["section_text"]:
            print(f"tutor: no lesson text for slug {body.get('lesson_slug')!r} under {LESSONS_DIR}", flush=True)
    out = asyncio.run(answer_turn(
        section_text=body.get("section_text", ""), selection=body.get("selection", ""),
        section_id=body.get("section_id", ""), lesson_slug=body.get("lesson_slug", ""),
        messages=msgs, lang=body.get("lang", "en"), model=body.get("model"),
        mode=body.get("mode", "med"), on_status=on_status,
        client_system=body.get("client_system")))
    if scene_grounded and out.get("source") == "page" and out.get("grounded"):
        out["source"] = "scene"          # answer grounded on the scene the learner is watching
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
        # Authorization must be allowed or the OpenAI face is unusable from a
        # browser: any OpenAI client sends a Bearer header, and the preflight
        # rejects the whole request over the header alone — which surfaces as a
        # CORS error, not as an auth error, so it reads like a server misconfig.
        # The service is LAN-local and unauthenticated; the header is ignored.
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        # Chromium/Android WebView preflight a LAN target from a "less private" origin
        # (http://tauri.localhost -> 192.168.x.x) with this header; answering it keeps the phone app working.
        self.send_header("Access-Control-Allow-Private-Network", "true")

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
        if self.path.startswith("/v1/models"):
            # MODELS is a dict keyed by id, not a list of records.
            refresh_models()
            return self._json({"object": "list", "data": [
                {"id": mid, "object": "model", "owned_by": "chiron",
                 "created": 0, "name": (m or {}).get("label", mid)}
                for mid, m in MODELS.items()]})
        if self.path.startswith("/tutor-models"):
            refresh_models()
            return self._json({"default": DEFAULT_MODEL, "local": local_models.info(),
                               "models": [{"id": k, "label": v["label"], "group": v.get("group", "Cloud")}
                                          for k, v in MODELS.items()]})
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
        if self.path.startswith("/v1/chat/completions"):
            return self._openai_chat()
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

    def _openai_chat(self):
        """OpenAI chat-completions over the same answer path /tutor-chat uses.

        NOT token streaming. `answer_turn` is a multi-step chain (route → search →
        draft → reconcile), so there is no token stream to forward; when a client
        asks for `stream`, the finished answer is sent as one delta. Emitting fake
        incremental chunks would misrepresent how long the answer took to exist.
        """
        try:
            body = self._body()
            msgs = body.get("messages") or []
            if not msgs:
                return self._json({"error": {"message": "messages required", "type": "invalid_request_error"}}, 400)
            # Grounding with no OpenAI equivalent rides here; absent, the messages
            # carry it (acolyte puts its retrieved context in the prompt itself).
            g = body.get("chiron") or {}
            # System messages are the caller's contract; pass them through rather
            # than letting the service's own tutor prompt silently replace them.
            sysmsgs = "\n\n".join(m.get("content", "") for m in msgs if m.get("role") == "system")
            out = _run_answer({
                "messages": msgs,
                "client_system": sysmsgs,
                "section_text": g.get("section_text", ""),
                "selection": g.get("selection", ""),
                "section_id": g.get("section_id", ""),
                "lesson_slug": g.get("lesson_slug", ""),
                "lang": g.get("lang", "en"),
                "mode": g.get("mode", "med"),
                "model": body.get("model") or g.get("model"),
            })
            reply = out.get("reply", "")
            model = out.get("model") or body.get("model") or DEFAULT_MODEL
            if body.get("stream"):
                return self._openai_stream(reply, model)
            return self._json({
                "id": f"chatcmpl-chiron-{int(time.time()*1000)}",
                "object": "chat.completion", "created": int(time.time()), "model": model,
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": reply}}],
                # Chiron's own signal, kept OUT of the standard fields so a strict
                # client ignores it and the lesson UI can still show grounding.
                "chiron": {"depth": out.get("depth"), "grounded": out.get("grounded"),
                           "source": out.get("source"),
                           # Only when the answer IS the fallback string — so a
                           # failure says which provider failed and why instead
                           # of "check the model / keys" and nothing else.
                           **({"errors": [{"spec": sp, "error": er} for sp, er in LAST_ERRORS]}
                              if reply.startswith("(the tutor is unavailable") else {})},
            })
        except Exception as e:
            return self._json({"error": {"message": str(e), "type": "server_error"}}, 502)

    def _openai_stream(self, reply: str, model: str):
        cid = f"chatcmpl-chiron-{int(time.time()*1000)}"
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()

        def frame(delta, finish=None):
            return ("data: " + json.dumps({
                "id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                "model": model,
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }) + "\n\n").encode()

        try:
            self.wfile.write(frame({"role": "assistant", "content": reply}))
            self.wfile.write(frame({}, "stop"))
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass                       # client navigated away mid-answer

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
