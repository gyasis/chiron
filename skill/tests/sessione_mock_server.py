#!/usr/bin/env python3
"""Mock server for shell/sessione.html: serves the page + fake JSON for every contract route. Port 8977."""
import io, json, struct, sys, time, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PAGE = Path(__file__).resolve().parent.parent / "shell" / "sessione.html"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8977
FAIL_ANSWER = {"n": 0}

def wav():
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(struct.pack("<h", 0) * 4000)
    return b.getvalue()

CARDS = [{"cardId": 100 + i, "deck": d, "direction": "it>en", "front": f, "back": b, "audio": a, "side": "vocab",
          "due": 0, "interval": 0, "tags": []} for i, (d, f, b, a) in enumerate([
    ("Medical Italian::Anamnesi", "Ha mai firmato un consenso informato?", "Have you ever signed informed consent?", "a.mp3"),
    ("Medical Italian::Vocab", "il consenso informato", "informed consent", ""),
    ("chiron::Pimsleur::L3", "Mi dica dove le fa male", "Tell me where it hurts", "b.mp3"),
    ("Medical Italian::Vocab", "il dolore toracico", "chest pain", ""),
    ("Chiron::Quaderno", "L\u2019ospedale \u00e8 vicino a casa, ma perch\u00e9 non andiamo insieme agli altri pazienti nella sala d\u2019attesa prima della visita?", "The hospital is near home, but why don't we go together with the other patients in the waiting room before the visit?", "c.mp3"),
])]
PROD = [{"noteId": 1, "cardId": 200 + i, "situation_en": s, "word_bank": wb, "verbs": vb, "answer_it": a,
         "notes": "Passato prossimo con essere.", "audio": "p.mp3"} for i, (s, wb, vb, a) in enumerate([
    ("Yesterday the patient went to the emergency room because of chest pain.", ["ieri", "paziente", "pronto soccorso", "per"],
     [{"inf": "andare", "form": "è andato"}], "Ieri il paziente è andato al pronto soccorso per un dolore toracico."),
    ("We have already explained the risks to her.", ["già", "rischi", "spiegare"], [{"inf": "spiegare", "form": "abbiamo spiegato"}],
     "Le abbiamo già spiegato i rischi."),
])]
QUAD = [{"noteId": 3 + i, "cardId": 300 + i, "it": it, "en": en, "note": nt, "audio": "q.mp3"} for i, (it, en, nt) in enumerate([
    ("Ho mal di testa da due giorni.", "I have had a headache for two days.", "'da' + presente per durata"),
    ("Mi faccia vedere la gola.", "Let me see your throat.", "Imperativo formale"),
    ("L\u2019ospedale \u00e8 vicino a casa, ma perch\u00e9 non andiamo insieme agli altri pazienti nella sala d\u2019attesa prima della visita?", "The hospital is near home, but why don't we go together with the other patients in the waiting room before the visit?", "Articolo + preposizione: agli, nella, della"),
])]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json"):
        if not isinstance(body, bytes): body = json.dumps(body).encode()
        self.send_response(code); self.send_header("content-type", ctype); self.send_header("content-length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        p = urlparse(self.path).path
        if p in ("/sessione", "/sessione.html"): return self.send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        if p.startswith("/cards/media/"): return self.send(200, wav(), "audio/wav")
        if p == "/api/sessione/deck":
            return self.send(200, {"cards": [{"cardId": q["cardId"], "deck": "Chiron::Quaderno", "front": q["it"], "back": q["en"], "audio": "q.mp3"} for q in QUAD]})
        if p.startswith("/jobs/"):
            time.sleep(0.3); return self.send(200, {"status": "ready", "lesson_url": "/lessons/mock.html"})
        self.send(404, {"detail": "not found " + p})
    def do_POST(self):
        p = urlparse(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0)) or 0) or b"{}")
        if p == "/api/sessione/search": return self.send(200, {"cards": CARDS})
        if p == "/api/sessione/tag": return self.send(200, {"ok": True, "tagged": len(body.get("cardIds", []))})
        if p == "/api/sessione/produce": time.sleep(2); return self.send(200, {"items": PROD, "anki": {"added": 2, "duplicates": 0, "deck": "Chiron::Produzione"}})
        if p == "/api/sessione/quaderno": time.sleep(2); return self.send(200, {"items": QUAD, "anki": {"added": 2, "duplicates": 0}})
        if p == "/api/sessione/tutor":
            m = body.get("message", "").lower()
            if "lezione" in m: return self.send(200, {"intent": "lesson", "job_id": "j1"})
            if "frasi" in m: return self.send(200, {"intent": "produce", "items": PROD})
            return self.send(200, {"intent": "explain", "text": "Il consenso informato è l'accordo del paziente al trattamento dopo adeguata informazione."})
        if p == "/cards/answer":
            FAIL_ANSWER["n"] += 1
            if body.get("reviews", [{}])[0].get("cardId") == 999: return self.send(503, {"detail": "AnkiConnect unreachable"})
            return self.send(200, {"ok": True, "written": 1, "of": 1, "results": [{"cardId": body["reviews"][0]["cardId"], "written": FAIL_ANSWER["n"] % 3 != 0}]})
        self.send(404, {"detail": "not found " + p})

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
