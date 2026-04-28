#!/usr/bin/env bash
# PreToolUse Hook - Block destructive commands before they execute
# Claude Code: exit 0 = allow, exit 2 = block (stderr shown to user)

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

read -r EVENT_DATA || true

# Extract tool name and input
TOOL_NAME=$(echo "$EVENT_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || true)
TOOL_INPUT=$(echo "$EVENT_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)

# Only inspect Bash tool calls
[ "$TOOL_NAME" != "Bash" ] && exit 0
[ -z "$TOOL_INPUT" ] && exit 0

# Block system-wide destructive patterns
BLOCKED=0
REASON=""

if echo "$TOOL_INPUT" | grep -qE "rm\s+-rf\s+/|rm\s+--force\s+-r\s+/"; then
    BLOCKED=1; REASON="Blocking rm -rf on root-level path"
fi

if echo "$TOOL_INPUT" | grep -qE "git\s+push\s+.*--force(\s|$)|git\s+push\s+.*-f\b"; then
    BLOCKED=1; REASON="Blocking force push (use --force-with-lease if required)"
fi

if echo "$TOOL_INPUT" | grep -qE "git\s+reset\s+--hard\b"; then
    BLOCKED=1; REASON="Blocking git reset --hard (destroys uncommitted work)"
fi

if echo "$TOOL_INPUT" | grep -qE "docker\s+system\s+prune|docker\s+volume\s+prune"; then
    BLOCKED=1; REASON="Blocking docker prune (user must run manually)"
fi

if [ "$BLOCKED" = "1" ]; then
    echo "🛡️  PreToolUse BLOCKED: $REASON" >&2
    echo "   Command: $TOOL_INPUT" >&2
    echo "   Override: set DEV_KID_HOOKS_ENABLED=false to disable" >&2
    exit 2
fi

exit 0
