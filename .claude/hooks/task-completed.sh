#!/usr/bin/env bash
# TaskCompleted Hook - Auto-mark tasks.md, checkpoint, and sync GitHub issues

# Master kill-switch
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi

# Read stdin (contains task metadata from Claude Code's TodoWrite)
read -r EVENT_DATA || true

# Log the event
echo "$(date -Iseconds) TaskCompleted: processing" >> .claude/activity_stream.md 2>/dev/null || true

# ------------------------------------------------------------------
# AUTO-MARK tasks.md [x]
# Extract completed task content from event data and find matching
# dev-kid task in tasks.md, then mark it [x].
# ------------------------------------------------------------------
if [ -f tasks.md ] && [ -n "$EVENT_DATA" ]; then
    python3 - "$EVENT_DATA" <<'PYEOF'
import json, re, sys
from pathlib import Path

event_raw = sys.argv[1] if len(sys.argv) > 1 else ""
tasks_file = Path("tasks.md")

try:
    event = json.loads(event_raw)
except Exception:
    sys.exit(0)

# Claude Code sends: {"todo": {"content": "...", "status": "completed", ...}}
todo = event.get("todo") or event.get("task") or {}
content = todo.get("content") or todo.get("title") or todo.get("description") or ""
if not content:
    sys.exit(0)

content_lower = content.lower().strip()
lines = tasks_file.read_text(encoding="utf-8").split("\n")
changed = False

for i, line in enumerate(lines):
    if "- [ ]" not in line:
        continue
    line_lower = line.lower()
    # Match by explicit task ID (T001, TASK-001, etc.)
    task_id_match = re.search(r'\b([A-Z]+-?\d+)\b', content)
    if task_id_match and task_id_match.group(1).upper() in line.upper():
        lines[i] = line.replace("- [ ]", "- [x]", 1)
        changed = True
        print(f"✅ Auto-marked {task_id_match.group(1)} complete in tasks.md")
        break
    # Match by content similarity (>60% word overlap)
    todo_words = set(re.findall(r'\w+', content_lower))
    line_words = set(re.findall(r'\w+', line_lower))
    if todo_words and len(todo_words & line_words) / len(todo_words) > 0.6:
        lines[i] = line.replace("- [ ]", "- [x]", 1)
        changed = True
        print(f"✅ Auto-marked task complete in tasks.md (content match)")
        break

if changed:
    tasks_file.write_text("\n".join(lines), encoding="utf-8")
PYEOF
fi

# Check if dev-kid is available
if ! command -v dev-kid &>/dev/null; then
    echo '{"status": "skipped", "message": "dev-kid not in PATH"}'
    exit 0
fi

# Auto-sync GitHub issues if tasks.md was modified
if [ -f tasks.md ]; then
    TASKS_MODIFIED=$(git diff --name-only tasks.md 2>/dev/null || echo "")
    TASKS_STAGED=$(git diff --cached --name-only tasks.md 2>/dev/null || echo "")

    if [ -n "$TASKS_MODIFIED" ] || [ -n "$TASKS_STAGED" ]; then
        if [ "${DEV_KID_AUTO_SYNC_GITHUB:-true}" = "true" ]; then
            dev-kid gh-sync 2>/dev/null || true
        fi
    fi
fi

# Create micro-checkpoint if auto-checkpoint enabled
if [ "${DEV_KID_AUTO_CHECKPOINT:-true}" = "true" ]; then
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        dev-kid checkpoint "[TASK-COMPLETE] Auto-checkpoint" 2>/dev/null || true
    fi
fi

echo '{"status": "success", "message": "Task completion processed"}'
exit 0
