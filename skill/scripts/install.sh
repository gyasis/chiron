#!/bin/bash
# Chiron skill installer — symlinks the in-repo skill into Claude Code's skills dir.
# Idempotent: re-runs cleanly.

set -euo pipefail

# Resolve skill source dir relative to this script (portable).
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${HOME}/.claude/skills/chiron"

if [ ! -d "$SKILL_DIR" ]; then
  echo "ERROR: skill source dir does not exist: $SKILL_DIR" >&2
  exit 1
fi

mkdir -p "${HOME}/.claude/skills"

if [ -L "$TARGET_DIR" ]; then
  current="$(readlink "$TARGET_DIR")"
  if [ "$current" = "$SKILL_DIR" ]; then
    echo "Already installed: $TARGET_DIR -> $SKILL_DIR"
    exit 0
  fi
  echo "Removing existing symlink: $TARGET_DIR -> $current"
  rm "$TARGET_DIR"
elif [ -e "$TARGET_DIR" ]; then
  echo "ERROR: $TARGET_DIR exists and is not a symlink. Refusing to overwrite." >&2
  exit 1
fi

ln -s "$SKILL_DIR" "$TARGET_DIR"
echo "Installed: $TARGET_DIR -> $SKILL_DIR"
