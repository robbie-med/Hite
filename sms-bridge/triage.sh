#!/usr/bin/env bash
# Hand unanswered question reports to Claude Code, headless. OFF by default:
# the bridge only calls this when AUTO_TRIAGE=1 in .env; otherwise run it by hand
# or open a Claude Code session in ~/Projects/ite and say "/hite-reports".
# Every run spends tokens, so keep it off until you have watched a few manual runs.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sms-bridge/data
exec 9>sms-bridge/data/triage.lock
flock -n 9 || exit 0                                  # one triage at a time
[ "$(python3 sms-bridge/bridge.py inbox --json)" != "[]" ] || exit 0
{
  echo "=== $(date -Is) triage start ==="
  claude -p "Follow the hite-reports skill in .claude/skills/hite-reports/SKILL.md for every unanswered report in 'python3 sms-bridge/bridge.py inbox'. Reply to each sender with bridge.py send, then ack the ids. Do not push to GitHub; leave fixes committed locally for review." \
    --permission-mode acceptEdits \
    --allowedTools "Read,Edit,Write,Grep,Glob,Bash(python3:*),Bash(node:*),Bash(git add:*),Bash(git commit:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*)"
  echo "=== $(date -Is) triage end ==="
} >> sms-bridge/data/triage.log 2>&1
