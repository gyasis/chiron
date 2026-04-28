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

# Auto-checkpoint if uncommitted changes exist
if command -v dev-kid &>/dev/null; then
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        dev-kid checkpoint "[PRE-COMPACT] Auto-save" 2>/dev/null || true
    fi
fi

exit 0
