#!/usr/bin/env bash
# SessionEnd Hook - Finalize session and create snapshot
# Claude Code: exit 0 = success

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

read -r EVENT_DATA || true

echo "" >> .claude/activity_stream.md 2>/dev/null || true
echo "### $(date '+%Y-%m-%d %H:%M:%S') - Session Ended" >> .claude/activity_stream.md 2>/dev/null || true

# Update AGENT_STATE
if [ -f .claude/AGENT_STATE.json ]; then
    python3 -c "
import json
from pathlib import Path
from datetime import datetime
f = Path('.claude/AGENT_STATE.json')
try:
    s = json.loads(f.read_text())
    s['status'] = 'finalized'
    s['last_session_end'] = datetime.now().isoformat()
    f.write_text(json.dumps(s, indent=2))
except Exception:
    pass
" 2>/dev/null || true
fi

if command -v dev-kid &>/dev/null; then
    dev-kid finalize 2>/dev/null || true
fi

exit 0
