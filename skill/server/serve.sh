#!/usr/bin/env bash
# Launch the Chiron generate-server (:8911). Sources the Ollama-Cloud key so chains can call the model.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p state
[ -f "$HOME/.config/environment.d/ollama-cloud.conf" ] && { set -a; . "$HOME/.config/environment.d/ollama-cloud.conf"; set +a; }
# glm-5.2 has a "silent-stop" regression on Ollama Cloud (returns empty content ~80% of
# calls, both /api/chat and /v1); reasoning_effort can't fix it via litellm's openai
# provider. glm-5.1 is the newest GLM that generates reliably (verified 6/6). Same
# PromptChain + /v1 + litellm path — only the model name changes. Override-safe.
export CH_MODEL_REASON="${CH_MODEL_REASON:-glm-5.1}"
export CH_MODEL_STRUCT="${CH_MODEL_STRUCT:-glm-5.1}"
# LOCAL generation option: route `local/<model>` through the Atelier governor (memory-governed Mac
# ollama) for zero-cloud-token bakes. Neutral localhost default here (public repo); the real governor
# host is supplied out-of-repo via a systemd drop-in (CH_LOCAL_BASE / CH_LOCAL_MODEL).
export CH_LOCAL_BASE="${CH_LOCAL_BASE:-http://localhost:8799/llm/ollama/v1}"
export CH_LOCAL_MODEL="${CH_LOCAL_MODEL:-qwen2.5:7b}"
exec python3 app.py
