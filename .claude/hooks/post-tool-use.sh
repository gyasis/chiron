#!/usr/bin/env bash
# PostToolUse Hook - Format and lint after file edits
# Claude Code: exit 0 = success, non-zero = hook error

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

# Read stdin safely (never use set -e with read)
read -r EVENT_DATA || true

# Extract tool name and file path from JSON input
TOOL_NAME=$(echo "$EVENT_DATA" | grep -oP '"tool_name":\s*"\K[^"]+' 2>/dev/null || true)
FILE_PATH=$(echo "$EVENT_DATA" | grep -oP '"path":\s*"\K[^"]+' 2>/dev/null || true)

# Only process Edit/Write/MultiEdit tools
if [[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "MultiEdit" ]]; then
    exit 0
fi

[ -z "$FILE_PATH" ] && exit 0

# Auto-format Python files
if [[ "$FILE_PATH" == *.py ]]; then
    command -v black &>/dev/null && black "$FILE_PATH" 2>/dev/null || true
    command -v isort &>/dev/null && isort "$FILE_PATH" 2>/dev/null || true
fi

# Auto-format JS/TS files
if [[ "$FILE_PATH" =~ \.(js|ts|jsx|tsx)$ ]]; then
    command -v prettier &>/dev/null && prettier --write "$FILE_PATH" 2>/dev/null || true
fi

# Auto-format Bash scripts
if [[ "$FILE_PATH" == *.sh ]]; then
    command -v shfmt &>/dev/null && shfmt -w "$FILE_PATH" 2>/dev/null || true
fi

# ----------------------------------------------------------------------------
# tasks.md tracking — detect newly-checked [x] tasks and notify / auto-sentinel
# ----------------------------------------------------------------------------
# Fires only when FILE_PATH is tasks.md (root or speckit spec dir).
# Env vars:
#   DEV_KID_AUTO_SENTINEL=true   → invoke `dev-kid sentinel-run` in background
#                                  for each newly-completed task (opt-in).
#   DEV_KID_AUTO_SENTINEL=false  → (default) just print a notification hint.
#   DEV_KID_HOOKS_ENABLED=false  → skip entirely (already handled above).
if [[ "$(basename "$FILE_PATH")" == "tasks.md" ]] && [ -d .git ] && command -v git &>/dev/null; then
    # Find task IDs that flipped from [ ] to [x] in this edit.
    # git diff HEAD -- "$FILE_PATH" returns lines prefixed with + / -.
    # We grep for ADDED [x] lines (new completions), extract T-IDs.
    NEW_CHECKED=$(git diff HEAD -- "$FILE_PATH" 2>/dev/null \
        | grep -E '^\+-\s*\[x\]' \
        | grep -oE 'T[0-9]{1,4}' \
        | sort -u \
        | tr '\n' ' ')

    if [ -n "$NEW_CHECKED" ]; then
        if [ "${DEV_KID_AUTO_SENTINEL:-false}" = "true" ] && command -v dev-kid &>/dev/null; then
            # Fire sentinel-run per task in background. Logs go to .claude/sentinel-auto.log.
            mkdir -p .claude
            for task_id in $NEW_CHECKED; do
                (dev-kid sentinel-run "$task_id" >> .claude/sentinel-auto.log 2>&1 &)
            done
            echo "ℹ️  dev-kid auto-sentinel triggered for: $NEW_CHECKED (tail .claude/sentinel-auto.log)" >&2
        else
            echo "ℹ️  Newly-completed tasks: $NEW_CHECKED" >&2
            echo "   Run 'dev-kid sentinel-run <ID>' to validate (or set DEV_KID_AUTO_SENTINEL=true)" >&2
        fi
    fi
fi

exit 0
