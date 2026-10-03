#!/usr/bin/env bash
# Install (or refresh) the hite-sms-bridge user service. Safe to re-run.
#   ./install.sh          copy the unit, reload systemd; enable+start only if .env exists
#   ./install.sh --off    stop and disable the service
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT=hite-sms-bridge.service
DEST="$HOME/.config/systemd/user/$UNIT"

if [ "${1:-}" = "--off" ]; then
  systemctl --user disable --now "$UNIT" 2>/dev/null || true
  echo "$UNIT stopped and disabled"; exit 0
fi

python3 -c "import slixmpp" 2>/dev/null || pip install --user -q slixmpp
mkdir -p "$(dirname "$DEST")" "$HERE/data"
cp "$HERE/$UNIT" "$DEST"
systemctl --user daemon-reload
echo "installed $DEST"

if [ -f "$HERE/.env" ]; then
  python3 "$HERE/bridge.py" test
  systemctl --user enable --now "$UNIT"
  sleep 3
  systemctl --user --no-pager --lines=5 status "$UNIT" || true
else
  echo "no $HERE/.env yet: copy .env.example, fill in the JMP account, then re-run this script"
  echo "(the unit is installed but left disabled)"
fi
