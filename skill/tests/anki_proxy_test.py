"""anki_proxy_test — POST /api/anki/connect adds the server-held AnkiConnect key, so browser clients
(Match Madness) never hold it. Drives a stub AnkiConnect over real HTTP that DEMANDS the key; never
touches the live collection or library: CHIRON_ANKI_URLS / CHIRON_SKILL / CHIRON_GEN point at temp stubs.
Run: ~/miniconda3/bin/python tests/anki_proxy_test.py"""
import json, os, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

KEY = "stub-key-not-real"
SEEN = []


class StubAnki(BaseHTTPRequestHandler):
    def do_POST(self):
        msg = json.loads(self.rfile.read(int(self.headers["content-length"])) or b"{}")
        SEEN.append(msg)
        if msg.get("key") != KEY:
            out = {"result": None, "error": "valid api key must be provided"}
        elif msg["action"] == "deckNames":
            out = {"result": ["Default"], "error": None}
        else:
            out = {"result": 6, "error": None}
        body = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


STUB = ThreadingHTTPServer(("127.0.0.1", 0), StubAnki)
threading.Thread(target=STUB.serve_forever, daemon=True).start()

SKILL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="chiron-ankiproxy-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name != "state" and f.name != "__pycache__":
        os.symlink(f, TMP / "skill" / "server" / f.name)
os.environ["CHIRON_SKILL"] = str(TMP / "skill")
os.environ["CHIRON_GEN"] = str(TMP / "gen")
os.environ["CHIRON_ANKI_URLS"] = f"http://127.0.0.1:{STUB.server_address[1]}"
os.environ.pop("CHIRON_ANKI_URL", None)
os.environ["CHIRON_ANKI_KEY"] = KEY
sys.path.insert(0, str(SKILL / "server"))
(TMP / "gen").mkdir(parents=True)

try:
    from fastapi.testclient import TestClient
    import app as A  # noqa: E402
    OK = True
except Exception as e:  # pragma: no cover - environment without the server deps
    OK, WHY = False, repr(e)


@unittest.skipUnless(OK, "server deps unavailable")
class Proxy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(A.app)

    def setUp(self):
        SEEN.clear()

    def test_server_adds_the_key(self):
        r = self.c.post("/api/anki/connect", json={"action": "deckNames", "version": 6, "params": {}})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"result": ["Default"], "error": None, "via": "chiron"})
        self.assertEqual(SEEN[-1]["key"], KEY)

    def test_key_never_echoed(self):
        r = self.c.post("/api/anki/connect", json={"action": "version", "params": {}})
        self.assertNotIn(KEY, r.text)

    def test_disallowed_action_never_reaches_anki(self):
        r = self.c.post("/api/anki/connect", json={"action": "deleteDecks", "params": {"decks": ["Default"]}})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(SEEN, [])

    def test_anki_error_keeps_ankiconnect_shape(self):
        import anki
        saved, anki.KEY = anki.KEY, "wrong"
        try:
            r = self.c.post("/api/anki/connect", json={"action": "deckNames", "params": {}})
        finally:
            anki.KEY = saved
        self.assertEqual(r.json()["error"], "valid api key must be provided")
        self.assertEqual(r.json()["via"], "chiron")

    def test_private_network_header(self):
        r = self.c.post("/api/anki/connect", json={"action": "version", "params": {}})
        self.assertEqual(r.headers.get("access-control-allow-private-network"), "true")


if __name__ == "__main__":
    unittest.main(verbosity=2)
