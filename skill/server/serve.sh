#!/usr/bin/env bash
# Launch the Chiron generate-server (:8911). Sources the Ollama-Cloud key so chains can call the model.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p state
[ -f "$HOME/.config/environment.d/ollama-cloud.conf" ] && { set -a; . "$HOME/.config/environment.d/ollama-cloud.conf"; set +a; }
# Each chain picks its own models (CH_MODEL_REASON / CH_MODEL_STRUCT in its run.py); set them here only to
# override every chain at once.
# LOCAL generation option: route `local/<model>` through the Atelier governor (memory-governed Mac
# ollama) for zero-cloud-token bakes. Neutral localhost default here (public repo); the real governor
# host is supplied out-of-repo via a systemd drop-in (CH_LOCAL_BASE / CH_LOCAL_MODEL).
export CH_LOCAL_BASE="${CH_LOCAL_BASE:-http://localhost:8799/llm/ollama/v1}"
export CH_LOCAL_MODEL="${CH_LOCAL_MODEL:-qwen2.5:7b}"
exec python3 app.py
