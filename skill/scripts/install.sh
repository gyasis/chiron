#!/usr/bin/env bash
# Chiron skill install — idempotent symlink into ~/.claude/skills/chiron
set -euo pipefail

SKILL_DIR="/home/gyasisutton/dev/projects/chiron/skill"
LINK_TARGET="$HOME/.claude/skills/chiron"

if [[ ! -d "$SKILL_DIR" ]]; then
  echo "ERROR: skill source dir does not exist: $SKILL_DIR" >&2
  exit 1
fi

mkdir -p "$(dirname "$LINK_TARGET")"
ln -sfn "$SKILL_DIR" "$LINK_TARGET"

if [[ -L "$LINK_TARGET" ]]; then
  RESOLVED="$(readlink -f "$LINK_TARGET")"
  echo "OK: $LINK_TARGET -> $RESOLVED"
else
  echo "ERROR: link not created at $LINK_TARGET" >&2
  exit 1
fi
