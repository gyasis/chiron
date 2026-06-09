#!/bin/bash
# Chiron skill doctor — fresh-machine health check.
#
# Verifies that a Chiron install actually landed and is usable. Safe to run on
# any machine after `scripts/install.sh`. Read-only: it diagnoses, it does not
# fix (run install.sh to fix). Prints a traffic-light report and exits:
#   0  — everything required is OK (warnings allowed)
#   1  — one or more REQUIRED checks FAILED
#
# What it checks:
#   Host tools   : node>=20, npm, bash>=4, git, claude CLI, jq(optional)
#   Wiring       : ~/.claude/skills/chiron symlink points at THIS repo's skill/
#   Deps         : node_modules + the 4 runtime packages present
#   Build        : dist/ compiled (tsc ran)
#   Harness      : tests/test.sh runs cleanly
#   Skill        : SKILL.md present + discoverable
#   Vendored libs: mathjax, mermaid, forest-plot bundled; molecule-renderer WASM (optional)
#   Open work    : surfaces the known v1 gap (TTS / issue #2) so a new machine knows the task
#
# NO Python venv, NO Anthropic/Google SDK, NO API key needed for the BUILD to be
# healthy — only chiron-the-runtime (generating a lesson) needs the parent Claude
# Code session's LLM access. (Q8 architecture.)

# Intentionally NOT `set -e` — we want to run every check and report all results.
set -uo pipefail

# ─── Paths ────────────────────────────────────────────────────────────────────
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${HOME}/.claude/skills/chiron"

FAILS=0
WARNS=0

# ─── Reporting helpers ─────────────────────────────────────────────────────────
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; WARNS=$((WARNS+1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
hint() { printf '      ↳ %s\n' "$1"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

echo "Chiron doctor — checking install at:"
echo "  skill source : $SKILL_DIR"
echo "  expected link: $TARGET_DIR"

# ─── 1. Host tools ──────────────────────────────────────────────────────────────
section "Host tools"

if command -v node >/dev/null 2>&1; then
  node_major="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [ "${node_major:-0}" -ge 20 ]; then
    ok "node $(node --version) (>= 20)"
  else
    fail "node $(node --version) — Chiron requires Node >= 20"
    hint "Install Node 20+: https://nodejs.org/ | brew install node | nvm install 20"
  fi
else
  fail "node not found in PATH"
  hint "Install Node >= 20 first, then re-run scripts/install.sh"
fi

if command -v npm >/dev/null 2>&1; then ok "npm $(npm --version)"; else fail "npm not found (usually ships with node)"; fi

bash_major="${BASH_VERSINFO[0]:-0}"
if [ "$bash_major" -ge 4 ]; then ok "bash $bash_major.x (>= 4)"; else fail "bash $bash_major.x — test.sh/build.sh need bash >= 4 (assoc arrays)"; fi

if command -v git >/dev/null 2>&1; then ok "git $(git --version | awk '{print $3}')"; else fail "git not found — needed for code-repo ingest"; fi

if command -v claude >/dev/null 2>&1; then
  ok "claude CLI present ($(claude --version 2>/dev/null | head -1))"
else
  warn "claude CLI not found — Chiron is a Claude Code skill; the runtime needs it to generate lessons"
  hint "Build/doctor work without it, but lesson generation requires a Claude Code session"
fi

if command -v jq >/dev/null 2>&1; then ok "jq present (nicer test diffs)"; else warn "jq not found (optional — test.sh falls back to python3)"; fi

# ─── 2. Skill wiring ─────────────────────────────────────────────────────────────
section "Skill wiring (~/.claude/skills/chiron)"

if [ -L "$TARGET_DIR" ]; then
  current="$(readlink "$TARGET_DIR")"
  if [ "$current" = "$SKILL_DIR" ]; then
    ok "symlink points at this repo's skill/"
  else
    fail "symlink points elsewhere: $current"
    hint "Re-run scripts/install.sh to repoint it at $SKILL_DIR"
  fi
elif [ -e "$TARGET_DIR" ]; then
  fail "$TARGET_DIR exists but is NOT a symlink"
  hint "Back it up and re-run scripts/install.sh"
else
  fail "no skill symlink at $TARGET_DIR — skill not discoverable by Claude Code"
  hint "Run: bash $SKILL_DIR/scripts/install.sh"
fi

if [ -f "$SKILL_DIR/SKILL.md" ]; then ok "SKILL.md present"; else fail "SKILL.md missing at skill root"; fi

# ─── 3. Node deps ────────────────────────────────────────────────────────────────
section "Node dependencies"

if [ -d "$SKILL_DIR/node_modules" ]; then
  ok "node_modules present"
  for pkg in zod better-sqlite3 pdfjs-dist; do
    if [ -d "$SKILL_DIR/node_modules/$pkg" ]; then ok "dep: $pkg"; else fail "dep missing: $pkg"; fi
  done
  # pdf-to-img OR equivalent rasterizer (T002 allows either)
  if [ -d "$SKILL_DIR/node_modules/pdf-to-img" ] || ls "$SKILL_DIR/node_modules" 2>/dev/null | grep -qiE 'pdf.*img|pdf2pic|canvas'; then
    ok "dep: scanned-PDF rasterizer present"
  else
    warn "no scanned-PDF rasterizer (pdf-to-img) found — vision PDF fallback may be limited"
  fi
else
  fail "node_modules missing — deps not installed"
  hint "Run: cd $SKILL_DIR && npm install   (or scripts/install.sh)"
fi

# ─── 4. TypeScript build ─────────────────────────────────────────────────────────
section "TypeScript build"

if [ -d "$SKILL_DIR/dist" ] && [ -n "$(find "$SKILL_DIR/dist" -name '*.js' -print -quit 2>/dev/null)" ]; then
  ok "dist/ present ($(find "$SKILL_DIR/dist" -name '*.js' | wc -l | tr -d ' ') compiled modules)"
else
  fail "dist/ missing or empty — TypeScript not built"
  hint "Run: cd $SKILL_DIR && npm run build"
fi
# A stale dist/ can mask a broken build — verify the source actually compiles clean.
# (strict mode noUnusedLocals: a single dead import fails the build on a fresh machine.)
if [ -d "$SKILL_DIR/node_modules/typescript" ]; then
  if ( cd "$SKILL_DIR" && npx tsc --noEmit >/tmp/chiron-tsc.$$ 2>&1 ); then
    ok "tsc --noEmit clean (source compiles from scratch)"
  else
    fail "tsc --noEmit FAILED — build is broken (stale dist/ may be masking it)"
    sed 's/^/        /' /tmp/chiron-tsc.$$ | head -8
    hint "Fix the errors above, then: cd $SKILL_DIR && npm run build"
  fi
  rm -f /tmp/chiron-tsc.$$
else
  warn "typescript not installed — cannot verify a clean compile (run npm install)"
fi

# ─── 5. Test harness ─────────────────────────────────────────────────────────────
section "Test harness"

if [ -x "$SKILL_DIR/tests/test.sh" ]; then
  if "$SKILL_DIR/tests/test.sh" >/dev/null 2>&1; then
    ok "tests/test.sh runs cleanly (golden inputs SKIP without an LLM-generated lesson.html — expected)"
  else
    warn "tests/test.sh exited non-zero — run for details: bash $SKILL_DIR/tests/test.sh"
  fi
else
  warn "tests/test.sh not executable/found (skipping)"
fi

# ─── 6. Vendored runtime libraries (FR-037 — self-contained output) ──────────────
section "Vendored libraries (single-file lesson.html)"

vendor="$SKILL_DIR/shell/vendor"
for lib in mathjax mermaid forest-plot; do
  if [ -d "$vendor/$lib" ] && [ -n "$(ls -A "$vendor/$lib" 2>/dev/null)" ]; then
    ok "vendored: $lib"
  else
    warn "vendored lib thin/missing: $lib (lessons using it won't render self-contained)"
  fi
done
if ls "$vendor/molecule-renderer"/*.wasm >/dev/null 2>&1 || ls "$vendor/molecule-renderer"/RDKit_minimal.js >/dev/null 2>&1; then
  ok "molecule-renderer WASM bundled"
else
  warn "molecule-renderer WASM not bundled (optional — molecule widgets fall back gracefully)"
  hint "See $vendor/molecule-renderer/README.md for the RDKit-JS install step"
fi

# ─── 7. Known open work (so a fresh machine knows the task) ──────────────────────
section "Known open work (v1)"
warn "TTS / audio is TABLED — issue #2 (gyasis/chiron#2), T058"
hint "Italian native-speaker dialog emits <audio> tags but no MP3 until a provider is selected"
hint "Decision PRD: ~/dev/prd/scratch/chiron_tts_provider_selection_2026-04-29.md (or carry it to this machine)"
warn "Browser safety hardening: most of T162–T165 landed; don't open lessons in a browser holding sensitive creds"

# ─── Verdict ──────────────────────────────────────────────────────────────────────
section "Verdict"
if [ "$FAILS" -eq 0 ]; then
  printf '  \033[32m✅ Chiron install is healthy\033[0m — %d warning(s).\n' "$WARNS"
  echo "     Build + skill wiring are good. Generate a lesson from a Claude Code session: /chiron"
  exit 0
else
  printf '  \033[31m❌ %d required check(s) FAILED\033[0m, %d warning(s).\n' "$FAILS" "$WARNS"
  echo "     Fix the ✗ items above (usually: re-run bash scripts/install.sh), then re-run doctor."
  exit 1
fi
