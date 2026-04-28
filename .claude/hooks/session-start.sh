#!/usr/bin/env bash
# SessionStart Hook - Restore context from last session
# Claude Code: exit 0 = success

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

read -r EVENT_DATA || true

echo "" >> .claude/activity_stream.md 2>/dev/null || true
echo "### $(date '+%Y-%m-%d %H:%M:%S') - Session Started" >> .claude/activity_stream.md 2>/dev/null || true

# Update AGENT_STATE
if [ -f .claude/AGENT_STATE.json ]; then
    python3 -c "
import json, uuid
from pathlib import Path
from datetime import datetime
f = Path('.claude/AGENT_STATE.json')
try:
    s = json.loads(f.read_text())
    s['session_id'] = str(uuid.uuid4())
    s['status'] = 'active'
    s['last_session_start'] = datetime.now().isoformat()
    f.write_text(json.dumps(s, indent=2))
except Exception:
    pass
" 2>/dev/null || true
fi

# Restore from last snapshot
if command -v dev-kid &>/dev/null && [ -f .claude/session_snapshots/snapshot_latest.json ]; then
    dev-kid recall 2>/dev/null || true
fi

exit 0
