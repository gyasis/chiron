#!/usr/bin/env bash
# Stop Hook - Auto-finalize when Claude stops responding
# Claude Code: exit 0 = allow stop, exit 2 = block stop (rare)

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

read -r EVENT_DATA || true

# Log the stop event
echo "$(date -Iseconds) SessionStop" >> .claude/activity_stream.md 2>/dev/null || true

# Auto-finalize if enabled and changes exist
if [ "${DEV_KID_AUTO_CHECKPOINT:-true}" = "true" ]; then
    if command -v dev-kid &>/dev/null; then
        if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
            dev-kid finalize 2>/dev/null || true
        fi
    fi
fi

exit 0
