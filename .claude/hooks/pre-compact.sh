#!/usr/bin/env bash
# PreCompact Hook - Emergency state backup before context compression
# Claude Code: exit 0 allows compression to proceed

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

# Read stdin safely
read -r EVENT_DATA || true

# Backup AGENT_STATE
if [ -f .claude/AGENT_STATE.json ]; then
    cp .claude/AGENT_STATE.json ".claude/AGENT_STATE.backup.$(date +%Y%m%d_%H%M%S).json" 2>/dev/null || true
fi

# Log
echo "$(date -Iseconds) PreCompact: backup created" >> .claude/activity_stream.md 2>/dev/null || true

# Log to system bus
if [ -f .claude/system_bus.json ]; then
    python3 -c "
import json, sys
from pathlib import Path
from datetime import datetime
f = Path('.claude/system_bus.json')
try:
    bus = json.loads(f.read_text())
    bus.setdefault('events', []).append({'timestamp': datetime.now().isoformat(), 'event_type': 'context_compression_detected'})
    f.write_text(json.dumps(bus, indent=2))
except Exception:
    pass
" 2>/dev/null || true
fi

# Auto-checkpoint if uncommitted changes exist.
#
# The gate is `.devkid/config.json -> cli.auto_git_commit`, the flag
# `dev-kid auto-checkpoint on|off` writes. Default OFF (opt-in): `dev-kid checkpoint`
# runs `git add -A .` and commits the whole tree, which in a checkout shared by two
# sessions sweeps one session's work onto the other's branch.
_AC=$(jq -r '.cli.auto_git_commit' .devkid/config.json 2>/dev/null)
if [ -z "$_AC" ] || [ "$_AC" = "null" ]; then
    _AC=$(jq -r '.cli.auto_git_commit' "${DEV_KID_GLOBAL_CONFIG:-$HOME/.config/dev-kid/config.json}" 2>/dev/null)
fi
[ "${DEV_KID_AUTO_CHECKPOINT:-}" = "true" ] && _AC=true

# Never auto-commit from inside a LINKED git worktree — same guard as stop.sh
# and skills/checkpoint.sh. Override: DEV_KID_ALLOW_WORKTREE_COMMIT=true.
_devkid_in_linked_worktree() {
    local git_dir common_dir
    git_dir=$(git rev-parse --git-dir 2>/dev/null) || return 1
    common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || return 1
    git_dir=$(cd "$git_dir" 2>/dev/null && pwd -P) || return 1
    common_dir=$(cd "$common_dir" 2>/dev/null && pwd -P) || return 1
    [ "$git_dir" != "$common_dir" ]
}

if [ "$_AC" = "true" ] && command -v dev-kid &>/dev/null; then
    if [ "${DEV_KID_ALLOW_WORKTREE_COMMIT:-false}" != "true" ] && _devkid_in_linked_worktree; then
        echo "$(date -Iseconds) PreCompact: linked worktree — auto-checkpoint skipped" \
            >> .claude/activity_stream.md 2>/dev/null || true
    elif ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        dev-kid checkpoint "[PRE-COMPACT] Auto-save" 2>/dev/null || true
    fi
fi

exit 0
