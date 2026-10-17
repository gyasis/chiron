"""anki_proxy_test — POST /api/anki/connect adds the server-held AnkiConnect key, so browser clients
(Match Madness) never hold it, and the transport under it (anki.call) never risks the review schedule:
writes never fail over, a slow reply is not "host down", failover is not sticky, and only the app's
origins get CORS. Drives stub AnkiConnects over real HTTP that DEMAND the key; never touches the live
collection or library: CHIRON_ANKI_URLS / CHIRON_SKILL / CHIRON_GEN point at temp stubs.
Run: ~/miniconda3/bin/python tests/anki_proxy_test.py"""
import json, os, socket, sys, tempfile, threading, time, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

KEY = "stub-key-not-real"
SEEN = []                      # (stub name, message) for every request any stub received
DELAY = {}                     # stub name -> seconds to sleep before answering


def stub(name):
    class StubAnki(BaseHTTPRequestHandler):
        def do_POST(self):
            msg = json.loads(self.rfile.read(int(self.headers["content-length"])) or b"{}")
            SEEN.append((name, msg))
            time.sleep(DELAY.get(name, 0))
            if msg.get("key") != KEY:
                out = {"result": None, "error": "valid api key must be provided"}
            elif msg["action"] == "deckNames":
                out = {"result": ["Default", name], "error": None}
            else:
                out = {"result": 6, "error": None}
            body = json.dumps(out).encode()
            try:
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except OSError:
                pass               # the client gave up (timeout test)

        def log_message(self, *a):
            pass
    srv = ThreadingHTTPServer(("127.0.0.1", 0), StubAnki)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}"


def dead_url():
    """An address that refuses connections (bound, then closed)."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"http://127.0.0.1:{port}"


STUDIO, MACBOOK = stub("studio"), stub("macbook")

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
os.environ["CHIRON_ANKI_URLS"] = f"{STUDIO},{MACBOOK}"
os.environ.pop("CHIRON_ANKI_URL", None)
os.environ["CHIRON_ANKI_KEY"] = KEY
sys.path.insert(0, str(SKILL / "server"))
(TMP / "gen").mkdir(parents=True)

try:
    from fastapi.testclient import TestClient
    import app as A  # noqa: E402
    import anki  # noqa: E402
    OK = True
except Exception as e:  # pragma: no cover - environment without the server deps
    OK, WHY = False, repr(e)

WRITES = ["addNotes", "addTags", "removeTags", "answerCards", "createDeck"]
TAURI = "http://tauri.localhost"


def post(c, action, params=None, origin=None, **extra):
    h = {"origin": origin} if origin else {}
    return c.post("/api/anki/connect", json={"action": action, "version": 6, "params": params or {}, **extra},
                  headers=h)


@unittest.skipUnless(OK, "server deps unavailable")
class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = TestClient(A.app)

    def setUp(self):
        SEEN.clear()
        DELAY.clear()
        anki.HOSTS[:] = [STUDIO, MACBOOK]
        anki._primary_down_until = 0.0
        self._saved = (anki.TIMEOUT, anki.PRIMARY_RETRY_S)

    def tearDown(self):
        anki.TIMEOUT, anki.PRIMARY_RETRY_S = self._saved
        anki.HOSTS[:] = [STUDIO, MACBOOK]

    def hosts_seen(self):
        return [n for n, _ in SEEN]


class Proxy(Base):
    def test_server_adds_the_key(self):
        r = post(self.c, "deckNames")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"result": ["Default", "studio"], "error": None, "via": "chiron",
                                    "host": "studio"})
        self.assertEqual(SEEN[-1][1]["key"], KEY)

    def test_key_never_echoed(self):
        r = post(self.c, "version")
        self.assertNotIn(KEY, r.text)

    def test_disallowed_action_never_reaches_anki(self):
        r = post(self.c, "deleteDecks", {"decks": ["Default"]})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(SEEN, [])

    def test_non_string_action_is_400_not_500(self):
        for bad in (5, ["deckNames"], {"a": 1}, None, True):
            r = self.c.post("/api/anki/connect", json={"action": bad, "params": {}})
            self.assertEqual(r.status_code, 400, bad)
            self.assertEqual(r.json()["via"], "chiron")
        r = self.c.post("/api/anki/connect", json={"action": "deckNames", "params": [1]})
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/anki/connect", content=b"not json", headers={"content-type": "application/json"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(SEEN, [])

    def test_anki_error_keeps_ankiconnect_shape(self):
        saved, anki.KEY = anki.KEY, "wrong"
        try:
            r = post(self.c, "deckNames")
        finally:
            anki.KEY = saved
        self.assertEqual(r.json()["error"], "valid api key must be provided")
        self.assertEqual(r.json()["via"], "chiron")


class Failover(Base):
    def test_writes_never_fail_over(self):
        anki.HOSTS[:] = [dead_url(), MACBOOK]
        for action in WRITES:
            r = post(self.c, action, {"notes": [1], "tags": "x"})
            self.assertEqual(r.status_code, 503, action)
            self.assertIn("never sent to a fallback", r.json()["error"])
        self.assertEqual(SEEN, [], "a write reached the MacBook copy")

    def test_every_proxied_write_is_classed_as_a_write(self):
        self.assertEqual(A.ANKI_PROXY_ACTIONS - anki.READ_ONLY, set(WRITES) | {"answerCards"})

    def test_read_fails_over_and_says_so(self):
        anki.HOSTS[:] = [dead_url(), MACBOOK]
        with self.assertLogs("chiron.anki", "WARNING") as logs:
            r = post(self.c, "deckNames")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["host"], "macbook")
        self.assertEqual(r.json()["result"], ["Default", "macbook"])
        self.assertTrue(any("FALLBACK" in m and "macbook" in m for m in logs.output), logs.output)

    def test_failover_is_not_sticky(self):
        dead = dead_url()
        anki.HOSTS[:] = [dead, MACBOOK]
        anki.PRIMARY_RETRY_S = 0.0
        self.assertEqual(post(self.c, "deckNames").json()["host"], "macbook")
        anki.HOSTS[:] = [STUDIO, MACBOOK]          # the Studio is back
        SEEN.clear()
        r = post(self.c, "deckNames")
        self.assertEqual(r.json()["host"], "studio")
        self.assertEqual(self.hosts_seen(), ["studio"])

    def test_primary_marker_is_short_and_never_redirects_writes(self):
        anki.HOSTS[:] = [dead_url(), MACBOOK]
        post(self.c, "deckNames")
        self.assertGreater(anki._primary_down_until, time.monotonic())
        self.assertLessEqual(anki._primary_down_until - time.monotonic(), 30.0)
        SEEN.clear()
        self.assertEqual(post(self.c, "addTags", {"notes": [1], "tags": "x"}).status_code, 503)
        self.assertEqual(SEEN, [])
        anki._primary_down_until = 0.0              # marker expired
        anki.HOSTS[0] = STUDIO
        SEEN.clear()
        self.assertEqual(post(self.c, "deckNames").json()["host"], "studio")


class Timeouts(Base):
    def test_slow_big_read_is_not_cut_at_the_module_default(self):
        anki.TIMEOUT = 0.5                          # the 8 s module default, scaled down
        DELAY["studio"] = 1.5                       # a deck-sized notesInfo
        r = post(self.c, "notesInfo", {"notes": [1]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["host"], "studio")
        self.assertEqual(self.hosts_seen(), ["studio"])

    def test_read_timeout_is_an_error_not_a_failover(self):
        DELAY["studio"] = 3
        r = post(self.c, "notesInfo", {"notes": [1]}, timeoutMs=2000)   # -> 1 s server side
        self.assertEqual(r.status_code, 504, r.text)
        self.assertEqual(self.hosts_seen(), ["studio"], "a slow Studio was treated as down")

    def test_write_timeout_says_outcome_unknown(self):
        DELAY["studio"] = 3
        r = post(self.c, "answerCards", {"answers": []}, timeoutMs=2000)
        self.assertEqual(r.status_code, 504)
        self.assertIn("may have applied", r.json()["error"])
        self.assertEqual(self.hosts_seen(), ["studio"])

    def test_timeout_hint_default_and_cap(self):
        got = []
        real = anki.call
        anki.call = lambda a, p, t: (got.append(t), (6, STUDIO))[1]
        try:
            post(self.c, "version")
            post(self.c, "version", timeoutMs=45000)
            post(self.c, "version", timeoutMs=10_000_000)
            post(self.c, "version", timeoutMs="lots")
        finally:
            anki.call = real
        self.assertEqual(got, [60.0, 44.0, 90.0, 60.0])


class Cors(Base):
    def test_evil_origin_refused_before_anki(self):
        for origin in ("http://evil.example", "null", "http://192.168.0.50:8080"):
            r = post(self.c, "addTags", {"notes": [1], "tags": "x"}, origin=origin)
            self.assertEqual(r.status_code, 403, origin)
            self.assertNotIn("access-control-allow-origin", r.headers)
            self.assertNotIn("access-control-allow-private-network", r.headers)
        self.assertEqual(SEEN, [])

    def test_text_plain_post_from_evil_origin_does_not_write(self):
        r = self.c.post("/api/anki/connect", content=json.dumps({"action": "addTags", "params": {}}),
                        headers={"origin": "http://evil.example", "content-type": "text/plain"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(SEEN, [])

    def test_evil_preflight_gets_no_cors(self):
        r = self.c.options("/api/anki/connect", headers={
            "origin": "http://evil.example", "access-control-request-method": "POST",
            "access-control-request-private-network": "true"})
        self.assertNotIn("access-control-allow-origin", r.headers)
        self.assertNotIn("access-control-allow-private-network", r.headers)

    def test_app_origins_get_cors_and_private_network(self):
        for origin in ("http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"):
            pre = self.c.options("/api/anki/connect", headers={
                "origin": origin, "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
                "access-control-request-private-network": "true"})
            self.assertEqual(pre.status_code, 204, origin)
            self.assertEqual(pre.headers["access-control-allow-origin"], origin)
            self.assertEqual(pre.headers["access-control-allow-private-network"], "true")
            r = post(self.c, "version", origin=origin)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.headers["access-control-allow-origin"], origin)   # never `*`
            self.assertEqual(r.headers["access-control-allow-private-network"], "true")

    def test_same_origin_hub_page_allowed(self):
        r = post(self.c, "version", origin="http://testserver")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["access-control-allow-origin"], "http://testserver")

    def test_no_origin_client_passes_without_cors(self):
        r = post(self.c, "version")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("access-control-allow-origin", r.headers)

    def test_other_routes_unchanged(self):
        r = self.c.get("/api/pool/weak", headers={"origin": "http://evil.example"})
        self.assertEqual(r.headers.get("access-control-allow-origin"), "*")
        self.assertEqual(r.headers.get("access-control-allow-private-network"), "true")


if __name__ == "__main__":
    unittest.main(verbosity=2)
