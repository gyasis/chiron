#!/bin/bash
# Chiron skill installer — one-shot bootstrap.
#
# What this does (in order):
#   1. Verify Node ≥ 20 + npm are available
#   2. Symlink skill/ into ~/.claude/skills/chiron (so the skill is discoverable
#      by any Claude Code session)
#   3. Run `npm install` to fetch zod / better-sqlite3 / pdfjs-dist / pdf-to-img
#   4. Run `npm run build` to compile TypeScript to dist/
#   5. Verify the test harness runs cleanly
#
# Idempotent: re-running re-uses the symlink and re-runs npm install (which
# itself is idempotent on lockfiles).
#
# Note: Chiron is a Node/TypeScript project. There is NO Python venv to set up
# (no uv, no pip, no requirements.txt). All runtime deps are Node packages
# declared in skill/package.json.

set -euo pipefail

# ─── Paths ────────────────────────────────────────────────────────────────────
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${HOME}/.claude/skills/chiron"

# ─── 0. Sanity ────────────────────────────────────────────────────────────────
if [ ! -d "$SKILL_DIR" ]; then
  echo "ERROR: skill source dir does not exist: $SKILL_DIR" >&2
  exit 1
fi

# ─── 1. Verify Node + npm ─────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found in PATH. Install Node ≥ 20 first." >&2
  echo "  See: https://nodejs.org/  or  brew install node  or  apt install nodejs" >&2
  exit 1
fi
node_major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 20 ]; then
  echo "ERROR: Node >= 20 required (found $(node --version))." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found in PATH (usually installed alongside node)." >&2
  exit 1
fi
echo "✓ Node $(node --version), npm $(npm --version)"

# ─── 2. Symlink skill into Claude Code's skills dir ───────────────────────────
mkdir -p "${HOME}/.claude/skills"

if [ -L "$TARGET_DIR" ]; then
  current="$(readlink "$TARGET_DIR")"
  if [ "$current" = "$SKILL_DIR" ]; then
    echo "✓ Symlink already in place: $TARGET_DIR -> $SKILL_DIR"
  else
    echo "  Removing stale symlink: $TARGET_DIR -> $current"
    rm "$TARGET_DIR"
    ln -s "$SKILL_DIR" "$TARGET_DIR"
    echo "✓ Symlink updated: $TARGET_DIR -> $SKILL_DIR"
  fi
elif [ -e "$TARGET_DIR" ]; then
  echo "ERROR: $TARGET_DIR exists and is not a symlink. Refusing to overwrite." >&2
  echo "  Either remove it manually, or back it up before re-running." >&2
  exit 1
else
  ln -s "$SKILL_DIR" "$TARGET_DIR"
  echo "✓ Symlink created: $TARGET_DIR -> $SKILL_DIR"
fi

# ─── 3. Install Node deps ─────────────────────────────────────────────────────
cd "$SKILL_DIR"
if [ ! -f package.json ]; then
  echo "ERROR: $SKILL_DIR/package.json missing — cannot npm install." >&2
  exit 1
fi
echo "  Running 'npm install' (this may take a minute)…"
if [ -f package-lock.json ]; then
  npm ci --omit=dev=false 2>&1 | tail -5 || npm install 2>&1 | tail -5
else
  npm install 2>&1 | tail -5
fi
echo "✓ Node deps installed"

# ─── 4. Build TypeScript ──────────────────────────────────────────────────────
echo "  Running 'npm run build' (tsc → dist/)…"
npm run build 2>&1 | tail -5
if [ ! -d "$SKILL_DIR/dist" ]; then
  echo "WARN: dist/ not produced — check 'npm run build' output above." >&2
else
  echo "✓ TypeScript built (dist/)"
fi

# ─── 5. Sanity-check the test harness ─────────────────────────────────────────
if [ -x "$SKILL_DIR/tests/test.sh" ]; then
  echo "  Running 'tests/test.sh' to verify harness…"
  if "$SKILL_DIR/tests/test.sh" >/dev/null 2>&1; then
    echo "✓ Test harness runs cleanly (all golden inputs SKIP — expected without LLM-generated lesson.html)"
  else
    echo "WARN: tests/test.sh exited non-zero. Run manually for details:" >&2
    echo "       bash $SKILL_DIR/tests/test.sh" >&2
  fi
else
  echo "  (skipping test harness — tests/test.sh not executable)"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────"
echo "  ✅ Chiron skill installed."
echo ""
echo "  Skill source : $SKILL_DIR"
echo "  Symlinked at : $TARGET_DIR"
echo ""
echo "  From any Claude Code session, invoke via:"
echo "    /chiron                  — auto-detect domain + mode"
echo "    /chiron-code <repo>      — code-domain lesson"
echo "    /chiron-medicine <pdf>   — medicine-domain lesson"
echo "    /chiron-language <csv>   — Italian-language lesson"
echo "    /chiron-research-paper   — research-paper lesson"
echo "    /chiron-case-study <md>  — Mode B (case-study form)"
echo ""
echo "  Or use natural-language triggers like 'teach me X', 'make a course on Y'."
echo "──────────────────────────────────────────────────────────"
