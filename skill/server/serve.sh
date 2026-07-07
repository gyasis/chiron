#!/usr/bin/env bash
# Launch the Chiron generate-server (:8911). Sources the Ollama-Cloud key so chains can call the model.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p state
[ -f "$HOME/.config/environment.d/ollama-cloud.conf" ] && { set -a; . "$HOME/.config/environment.d/ollama-cloud.conf"; set +a; }
exec python3 app.py
