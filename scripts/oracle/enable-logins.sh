#!/usr/bin/env bash
# Lets the always-on worker also apply on LinkedIn, Indeed and Naukri, using the sign-ins you exported from your computer.
# If any of those sites shows a sign-in page, a CAPTCHA or a security check to this machine, the application is passed to the assistant on
# your computer (nothing is handed to you, and this machine leaves that site alone for six hours).
#
# 1. On your computer, in the project folder:   npm run assist:export     (it prints the scp command to copy the file here)
# 2. Here, once the file is at ~/assist-state.json:   bash ~/Career-Agent/scripts/oracle/enable-logins.sh
set -euo pipefail
STATE="$HOME/assist-state.json"
ENVF="$HOME/career-agent-worker.env"
[ -f "$STATE" ] || { echo "Copy your exported sign-ins to $STATE first (npm run assist:export on your computer prints the command)."; exit 1; }
chmod 600 "$STATE"
printf 'ASSIST_STORAGE_STATE=%s\nASSIST_PORTALS=linkedin,indeed,naukri\nASSIST_FAILOVER=1\n' "$STATE" > "$ENVF"
chmod 600 "$ENVF"
sudo systemctl restart career-agent-assist
sleep 3
systemctl --no-pager status career-agent-assist | head -8 || true
echo "Done. LinkedIn, Indeed and Naukri are now also handled here, with your computer as the fallback."
echo "Undo:  printf 'ASSIST_ONLY=employer\\n' > ~/career-agent-worker.env && sudo systemctl restart career-agent-assist"
