#!/usr/bin/env bash
# PostToolUseFailure Hook - Log tool failures for diagnostics
# Claude Code: exit 0 = acknowledged (non-blocking)

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

read -r EVENT_DATA || true

# Extract tool name and error from JSON input
TOOL_NAME=$(echo "$EVENT_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name','unknown'))" 2>/dev/null || true)
ERROR_MSG=$(echo "$EVENT_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || true)

# Log failure to activity stream
{
    echo ""
    echo "### $(date -Iseconds) ToolFailure: $TOOL_NAME"
    [ -n "$ERROR_MSG" ] && echo "- Error: $ERROR_MSG" || true
} >> .claude/activity_stream.md 2>/dev/null || true

exit 0
