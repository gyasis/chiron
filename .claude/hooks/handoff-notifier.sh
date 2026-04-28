#!/usr/bin/env bash
# handoff-notifier.sh — surface pending dev-kid Claude Code handoff requests
# into Claude Code's context so this session can auto-react.
#
# Wired into:
#   UserPromptSubmit hook (every prompt — Claude sees pending handoffs)
#   PostToolUse hook (after dev-kid execute may have created new requests)
#   SessionStart hook (so a resumed session immediately knows about backlog)
#
# Output is captured by Claude Code as context — Claude is expected to
# auto-process pending handoffs (run /devkid.handoff-process or read each
# request and call dev-kid handoff-complete).

# Master kill-switch (matches other dev-kid hooks)
if [ "${DEV_KID_HOOKS_ENABLED:-true}" = "false" ]; then
    exit 0
fi
if [ "${DEV_KID_HANDOFF_NOTIFIER:-true}" = "false" ]; then
    exit 0
fi

# Find the project root by walking up looking for .claude/ or .git/
project_root="$(pwd)"
while [ "$project_root" != "/" ]; do
    if [ -d "$project_root/.claude" ] || [ -d "$project_root/.git" ]; then
        break
    fi
    project_root="$(dirname "$project_root")"
done
[ "$project_root" = "/" ] && exit 0

sentinel_root="$project_root/.claude/sentinel"
[ ! -d "$sentinel_root" ] && exit 0

# Find pending handoffs (request.json exists, complete.json does not)
pending_count=0
declare -a pending_ids=()
declare -a pending_descs=()
declare -a pending_costs=()

for sentinel_dir in "$sentinel_root"/SENTINEL-*; do
    [ -d "$sentinel_dir" ] || continue
    handoff_dir="$sentinel_dir/handoff"
    request_file="$handoff_dir/request.json"
    complete_file="$handoff_dir/complete.json"
    if [ -f "$request_file" ] && [ ! -f "$complete_file" ]; then
        task_id=$(basename "$sentinel_dir" | sed 's/^SENTINEL-//')
        # Extract task description and cumulative cost from JSON via python (avoid jq dependency)
        info=$(python3 -c "
import json, sys
try:
    d = json.load(open('$request_file'))
    desc = (d.get('task_description') or '')[:80]
    cost = d.get('cumulative_cost_so_far', 0.0)
    budget = d.get('cumulative_budget', 0.0)
    print(f'{desc}|{cost:.2f}|{budget:.2f}')
except Exception:
    print('|0.00|0.00')
" 2>/dev/null)
        IFS='|' read -r desc cost_so_far budget <<< "$info"
        pending_ids+=("$task_id")
        pending_descs+=("$desc")
        pending_costs+=("\$$cost_so_far of \$$budget")
        pending_count=$((pending_count + 1))
    fi
done

[ "$pending_count" -eq 0 ] && exit 0

# Surface to Claude Code as a system reminder (UserPromptSubmit hook flavor)
echo "<system-reminder>"
echo "🤝 dev-kid: $pending_count pending Claude Code handoff request(s) — these waves are PAUSED waiting for you to handle them:"
echo ""
for i in "${!pending_ids[@]}"; do
    echo "  • ${pending_ids[$i]} (${pending_costs[$i]} spent so far): ${pending_descs[$i]}"
    echo "    request: .claude/sentinel/SENTINEL-${pending_ids[$i]}/handoff/request.json"
done
echo ""
echo "Suggested action: invoke /devkid.handoff-process to read each request, do the work, mark complete."
echo "OR read each request.json directly, apply the fix, then run \`dev-kid handoff-complete <task_id> --notes \"<what you did>\"\`."
echo "Each handoff completion unblocks one paused wave."
echo "</system-reminder>"
exit 0
