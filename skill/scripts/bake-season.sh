#!/usr/bin/env bash
# Chiron OVERNIGHT SEASON BAKE — run many episodes through the full pipeline on the MAC STUDIO (FREE, serial).
#
# Policy (user, 2026-07-27): interactive / single-episode bakes use MODAL (default, ~$0.21/ep, ~15-20 min).
# A whole-season / multi-episode batch you don't need immediately → the Mac omnivoice sidecar (:8770):
# $0, but ~2 h/episode serial, so it's an overnight job. Output is byte-identical (same voice model).
#
# Usage:
#   bake-season.sh "<glob-or-dir>" [--series NAME] [--level B1] [--lang it] [--from STAGE] [--force]
# Launch overnight (detached, survives the shell):
#   nohup ~/Documents/code/chiron/skill/scripts/bake-season.sh \
#     "$HOME/Documents/code/series/epi/downloads/Baby*.mkv" --series Baby \
#     > "$HOME/chiron-season-bake.$(date +%Y%m%d).log" 2>&1 &
#
# Resumable: the pipeline skips any stage whose output already exists; already-finished episodes
# (lesson.html present) are skipped unless --force. Each episode logs to its own file; a summary prints at end.
set -uo pipefail

CHIRON="${CHIRON_SKILL:-$HOME/Documents/code/chiron/skill}"
PY="${CHIRON_PY:-$HOME/miniconda3/bin/python3}"
PIPE="$CHIRON/scripts/episode_pipeline.py"
GEN="${CHIRON_GEN:-$HOME/Documents/generated}"
LOGDIR="$HOME/.chiron/season-bake-logs"; mkdir -p "$LOGDIR"

[ $# -ge 1 ] || { echo "usage: bake-season.sh \"<glob-or-dir>\" [--series NAME] [--level B1] [--from STAGE] [--force]"; exit 2; }

SRC="$1"; shift
PASSTHRU=("$@")                       # --series/--level/--lang/--from/--force → straight to episode_pipeline.py
FORCE=0; for a in "${PASSTHRU[@]:-}"; do [ "$a" = "--force" ] && FORCE=1; done

# resolve the episode list: a directory → its video files; otherwise treat as a glob
shopt -s nullglob
if [ -d "$SRC" ]; then
  mapfile -t EPS < <(find "$SRC" -maxdepth 1 -type f \( -iname '*.mkv' -o -iname '*.mp4' \) | sort)
else
  mapfile -t EPS < <(for f in $SRC; do [ -f "$f" ] && echo "$f"; done | sort)
fi
[ "${#EPS[@]}" -gt 0 ] || { echo "no episode files matched: $SRC"; exit 1; }

# source keys (Gemini for enrich/tags/visual; no Modal needed on the Mac path)
set -a; [ -f "$HOME/dev/.env" ] && . "$HOME/dev/.env"; set +a

echo "═══ chiron SEASON bake · engine=MAC (free, serial) · ${#EPS[@]} episodes ═══"
printf '  %s\n' "${EPS[@]##*/}"
echo "  logs → $LOGDIR"
declare -a RESULT
i=0
for ep in "${EPS[@]}"; do
  i=$((i+1)); base="$(basename "$ep")"
  # derive the slug the pipeline will use (chiron-<series>-<epcode>) to check if it's already built
  slug="$($PY - "$ep" <<'PYEOF'
import sys,re;from pathlib import Path
sys.path.insert(0,str(Path.home()/"Documents/code/chiron/skill/scripts"));import episode_pipeline as P
print(P.parse_episode(Path(sys.argv[1]))["slug"])
PYEOF
)"
  if [ "$FORCE" -eq 0 ] && [ -f "$GEN/$slug/lesson.html" ]; then
    echo "[$i/${#EPS[@]}] $slug — already built (lesson.html exists), skip"; RESULT+=("SKIP  $slug"); continue
  fi
  log="$LOGDIR/${slug}.$(date +%Y%m%d-%H%M%S).log"
  echo "[$i/${#EPS[@]}] $(date +%H:%M) baking $slug on the Mac → $log"
  if $PY "$PIPE" "$ep" --engine mac "${PASSTHRU[@]:-}" > "$log" 2>&1; then
    stats="$GEN/$slug/audio/qc-stats.json"
    qc="$([ -f "$stats" ] && $PY -c "import json;s=json.load(open('$stats'));print(f\"retry {s['retry_rate']:.0%} residual {s['residual_rate']:.0%}\")" 2>/dev/null || echo '')"
    echo "     ✓ done $slug  $qc"; RESULT+=("OK    $slug  $qc")
  else
    echo "     ✗ FAILED $slug (see $log tail)"; tail -3 "$log" | sed 's/^/       /'; RESULT+=("FAIL  $slug")
  fi
done

echo "═══ SEASON bake complete ═══"
printf '  %s\n' "${RESULT[@]}"
