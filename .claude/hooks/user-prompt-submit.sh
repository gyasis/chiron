#!/usr/bin/env bash
# UserPromptSubmit Hook - Inject project context before prompt processing
# Claude Code: stdout text is injected as context into the prompt

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

# Read stdin safely
read -r EVENT_DATA || true

CONTEXT=""

# 1. Current git branch
if git rev-parse --git-dir >/dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
    CONTEXT+="📍 Branch: $BRANCH\n"
fi

# 2. Constitution rules (if exists)
if [ -f memory-bank/shared/.constitution.md ]; then
    SUMMARY=$(head -n 20 memory-bank/shared/.constitution.md | grep -E "^##|^-" | head -n 5 2>/dev/null || true)
    [ -n "$SUMMARY" ] && CONTEXT+="📜 Constitution:\n$SUMMARY\n"
fi

# 3. Task progress (if tasks.md exists)
if [ -f tasks.md ]; then
    TOTAL=$(grep -c "^- \[.\]" tasks.md 2>/dev/null || echo "0")
    COMPLETED=$(grep -c "^- \[x\]" tasks.md 2>/dev/null || echo "0")
    [ "$TOTAL" -gt 0 ] 2>/dev/null && CONTEXT+="📊 Tasks: $COMPLETED/$TOTAL complete\n" || true
    # Inject mandatory task-marking reminder when tasks are in progress
    PENDING=$(grep -c "^- \[ \]" tasks.md 2>/dev/null || echo "0")
    if [ "$PENDING" -gt 0 ] 2>/dev/null; then
        CONTEXT+="⚠️  MANDATORY: After completing ANY task, immediately change its checkbox in tasks.md from [ ] to [x]. The wave executor HALTS if tasks are not marked complete.\n"
    fi
fi

# 4. Current wave (if execution_plan.json exists)
if [ -f execution_plan.json ]; then
    WAVE=$(jq -r '.execution_plan.current_wave // empty' execution_plan.json 2>/dev/null || true)
    [ -n "$WAVE" ] && CONTEXT+="🌊 Wave: $WAVE\n"
fi

# 5. Latest sentinel summary — inject most recent summary.md from .claude/sentinel/
if [ -d .claude/sentinel ]; then
    LATEST_SUMMARY=$(find .claude/sentinel -name "summary.md" 2>/dev/null | xargs ls -t 2>/dev/null | head -n 1 || true)
    if [ -n "$LATEST_SUMMARY" ] && [ -f "$LATEST_SUMMARY" ]; then
        SENTINEL_ID=$(basename "$(dirname "$LATEST_SUMMARY")")
        SUMMARY_CONTENT=$(head -n 30 "$LATEST_SUMMARY" 2>/dev/null || true)
        [ -n "$SUMMARY_CONTENT" ] && CONTEXT+="🛡️ Last sentinel ($SENTINEL_ID):\n$SUMMARY_CONTENT\n"
    fi
fi

# 6. Gentle-Eye stream sources — inject ATEM discovery hint if config exists
GENTLE_EYE_CONFIG="${HOME}/.config/gentle-eye/config.toml"
if [ -f "$GENTLE_EYE_CONFIG" ]; then
    DEFAULT_SOURCE=$(grep -E "^default_source\s*=" "$GENTLE_EYE_CONFIG" 2>/dev/null | head -1 | sed 's/.*=\s*"\(.*\)".*/\1/' || true)
    SOURCE_NAMES=$(grep -E "^\[network\.sources\." "$GENTLE_EYE_CONFIG" 2>/dev/null | sed 's/\[network\.sources\.\(.*\)\]/\1/' | tr '\n' ',' | sed 's/,$//' || true)
    HLS_DIR=$(grep -E "^hls_dir\s*=" "$GENTLE_EYE_CONFIG" 2>/dev/null | head -1 | sed 's/.*=\s*"\(.*\)".*/\1/' || echo "/tmp/atem-hls")

    if [ -n "$SOURCE_NAMES" ]; then
        RELAY_STATUS="unknown"
        CONTAINER=$(grep -A5 "^\[network\.sources\." "$GENTLE_EYE_CONFIG" 2>/dev/null | grep "docker_container" | head -1 | sed 's/.*=\s*"\(.*\)".*/\1/' || true)
        if [ -n "$CONTAINER" ]; then
            if docker inspect --format='{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q "true"; then
                RELAY_STATUS="running ✓"
            else
                RELAY_STATUS="stopped ✗"
            fi
        fi
        CONTEXT+="🎥 Stream Sources: [$SOURCE_NAMES] (default: ${DEFAULT_SOURCE:-$SOURCE_NAMES}) | relay: $RELAY_STATUS\n"
        CONTEXT+="   capture_stream_frame { \"source_name\": \"${DEFAULT_SOURCE:-atem}\" } — ATEM frame\n"
        CONTEXT+="   list_stream_sources — discover all sources\n"
    fi
fi

# Output context (injected into prompt by Claude Code)
if [ -n "$CONTEXT" ]; then
    printf "\n---\n🤖 Project Context:\n${CONTEXT}---\n"
fi

exit 0
