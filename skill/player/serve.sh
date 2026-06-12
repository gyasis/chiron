#!/usr/bin/env bash
# Serve the Chiron Player locally. A service worker needs a secure context, so
# the player must run over http(s) — http://localhost counts; file:// does NOT.
#
#   bash serve.sh [port]            → http://localhost:<port>/  (default 8765)
#
# On your LAN (to install on a phone on the same Wi-Fi), note this machine's IP
# and open http://<ip>:<port>/ on the phone — but iOS only lets you "Add to
# Home Screen" over HTTPS, so for a real phone install, host the player on
# GitHub Pages / any HTTPS static host (it's just static files).
set -euo pipefail
PORT="${1:-8765}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${DIR}"
echo "Chiron Player → http://localhost:${PORT}/   (Ctrl-C to stop)"
exec python3 -m http.server "${PORT}"
