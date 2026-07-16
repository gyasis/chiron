"""
Chiron lesson TUTOR service — the PromptChain page-tutor as an API the lesson (web + mobile) calls.
Host-side (needs harrison-search + PromptChain + governor/Gemini — none in the Docker/lesson-static path).
Binds 0.0.0.0 so a phone (http://192.168.0.112:8912) and the laptop both reach it; brokers the LAN
governor (:8799) + cloud (Gemini/Ollama) calls. CORS open (the lesson is served from :8911, cross-origin).

  POST /tutor-chat  {lesson_slug, section_id, section_text, selection, messages:[{role,content}], model, mode, lang}
                    → {reply, depth, grounded, model}
  GET  /tutor-models  → {default, models:[{id,label}]}
  GET  /healthz
"""
import json, asyncio
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from tutor_chain import answer_turn, MODELS, DEFAULT_MODEL

PORT = 8912

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self._cors(); self.send_header("Content-Length", str(len(b))); self.end_headers()
        self.wfile.write(b)
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self):
        if self.path.startswith("/healthz"): return self._json({"ok": True, "port": PORT})
        if self.path.startswith("/tutor-models"):
            return self._json({"default": DEFAULT_MODEL,
                               "models": [{"id": k, "label": v["label"]} for k, v in MODELS.items()]})
        self._json({"error": "not found"}, 404)
    def do_POST(self):
        if not self.path.startswith("/tutor-chat"):
            return self._json({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            out = asyncio.run(answer_turn(
                section_text=body.get("section_text", ""), selection=body.get("selection", ""),
                section_id=body.get("section_id", ""), lesson_slug=body.get("lesson_slug", ""),
                messages=body.get("messages") or [], lang=body.get("lang", "en"),
                model=body.get("model"), mode=body.get("mode", "med")))
            return self._json(out)
        except Exception as e:
            return self._json({"reply": "", "error": str(e)}, 502)

if __name__ == "__main__":
    print(f"chiron-tutor on 0.0.0.0:{PORT}  (lesson web + mobile → this API → governor/Gemini/Harrison)")
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
