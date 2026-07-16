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
exec python3 app.py
