#!/usr/bin/env python3
"""Serve the il-centro series over HTTP on the LAN.

    python3 serve.py [port]        # default 8010

Why serve rather than open the files: over http:// the browser has a real origin, so the
player's blob-cache works (fetch is blocked on file://), so seeking is exact, and iOS will
actually stream the audio. On file:// every clip falls back to a direct URL instead.

Binds 0.0.0.0 so an iPad or phone on the same wifi can open it — the LAN URL is printed
on start. Read-only: it only serves this directory.
"""
import http.server
import json
import os
import socket
import socketserver
import subprocess
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
ROOT = os.path.dirname(os.path.abspath(__file__))


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 1))      # no packet sent; just picks the outbound iface
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # NOTE: SimpleHTTPRequestHandler does NOT implement Range — a range request comes
        # back 200 with the whole body, not 206. Seeking is still exact because the player
        # fetches each clip into a blob: URL first (that fetch only works over http, which
        # is the other reason to serve rather than open file://).
        # no-cache keeps a re-baked clip from being served stale.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self):
        """The ONE write endpoint: the ingest review form confirming who each speaker is.
        localhost-only — a LAN client (the iPad) may read lessons but must not write the
        voice registry."""
        if self.path != "/ingest-confirm":
            self.send_error(404); return
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            self.send_error(403, "localhost only"); return
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            day = str(body.get("day", "")).strip()
            speakers = body.get("speakers") or {}
            if not day.isdigit() or not speakers:
                raise ValueError("need day + speakers")
            if len(set(speakers.values())) != len(speakers):
                raise ValueError("two speakers cannot be the same person")

            out = Path(ROOT) / f"day{day}"
            out.mkdir(exist_ok=True)
            (out / "speaker_map.json").write_text(
                json.dumps(speakers, ensure_ascii=False, indent=1), encoding="utf-8")

            # mark the ingest confirmed so nothing downstream runs on an unverified map
            ing = out / "ingest.json"
            if ing.is_file():
                d = json.loads(ing.read_text(encoding="utf-8"))
                d["confirmed"] = True
                d["speaker_names"] = speakers
                # persist each voice into the series registry -> future days self-identify
                reg = Path.home() / ".chiron" / "voice-registry" / f"{d.get('series','il-centro')}.json"
                reg.parent.mkdir(parents=True, exist_ok=True)
                cur = json.loads(reg.read_text(encoding="utf-8")) if reg.is_file() else {"voices": {}}
                for c in d.get("clusters", []):
                    name = speakers.get(c["speaker"])
                    if name and c.get("embedding"):
                        cur["voices"].setdefault(name, []).append(c["embedding"])
                        cur["voices"][name] = cur["voices"][name][-8:]   # keep last 8 exemplars
                reg.write_text(json.dumps(cur, ensure_ascii=False), encoding="utf-8")
                # The review form runs HERE, but the ingest runs on razer — two filesystems.
                # Day 4 proved it: the registry was written on the Mac and read on razer, so the
                # match came back 0.00 and the "zero-touch" identification silently didn't happen.
                # Publish it to the node that actually reads it.
                try:
                    subprocess.run(["ssh", "-o", "ConnectTimeout=8", "razer",
                                    "mkdir -p ~/.chiron/voice-registry"], timeout=15, check=False)
                    subprocess.run(["scp", "-q", str(reg),
                                    f"razer:.chiron/voice-registry/{reg.name}"],
                                   timeout=30, check=False)
                except Exception:
                    pass          # local write already succeeded; never fail the confirm on this
                ing.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")

            self._json({"ok": True, "speakers": speakers})
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 400)

    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, fmt, *args):
        if "audio/" not in (args[0] if args else ""):    # quiet the per-clip noise
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    ip = lan_ip()
    print(f"il centro di italia — serving {ROOT}")
    print(f"  this Mac : http://localhost:{PORT}/")
    print(f"  iPad/LAN : http://{ip}:{PORT}/")
    print("  Ctrl-C to stop")
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
