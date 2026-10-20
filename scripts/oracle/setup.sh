#!/usr/bin/env bash
# Sets up a second apply worker on a small always-on Linux machine (for example an Oracle Cloud "Always Free" Ubuntu instance).
# It applies to employers' own pages (sites that need no sign-in), headless, around the clock. If it is down or busy, the assistant on your
# computer takes over any application that has waited more than 90 minutes. LinkedIn, Indeed and Naukri stay on your computer.
#
# Run it on the machine, as a normal user (not root), from an empty home folder:
#   curl -fsSL https://raw.githubusercontent.com/rpsj2230/Career-Agent/main/scripts/oracle/setup.sh -o setup.sh && bash setup.sh
set -euo pipefail

[ "$(id -u)" -ne 0 ] || { echo "Run this as a normal user (for example ubuntu), not root."; exit 1; }
REPO_URL="${REPO_URL:-https://github.com/rpsj2230/Career-Agent.git}"
DIR="$HOME/Career-Agent"

echo "== 1/6 System packages"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates ufw unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "== 2/6 Node 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "== 3/6 The program"
[ -d "$DIR/.git" ] && git -C "$DIR" pull --ff-only || git clone "$REPO_URL" "$DIR"
cd "$DIR"
npm ci
npx playwright install --with-deps chromium

echo "== 4/6 Your settings (typed here, stored only on this machine, readable only by you)"
ENVF="$DIR/.env.local"
if [ ! -f "$ENVF" ]; then
  read -rp "SUPABASE_URL: " SUPABASE_URL
  read -rsp "SUPABASE_SERVICE_ROLE_KEY (hidden): " SUPABASE_SERVICE_ROLE_KEY; echo
  read -rsp "CRON_SECRET (hidden): " CRON_SECRET; echo
  umask 177
  printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\nCRON_SECRET=%s\n' "$SUPABASE_URL" "$SUPABASE_SERVICE_ROLE_KEY" "$CRON_SECRET" > "$ENVF"
fi
chmod 600 "$ENVF"

echo "== 5/6 Firewall: nothing may connect in except SSH"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw --force enable

echo "== 6/6 Start it now and at every boot"
UNIT=/etc/systemd/system/career-agent-assist.service
sudo tee "$UNIT" >/dev/null <<UN
[Unit]
Description=Career Agent apply worker (employer pages)
After=network-online.target
Wants=network-online.target
[Service]
User=$USER
WorkingDirectory=$DIR
Environment=NODE_OPTIONS=--conditions=react-server
Environment=ASSIST_MODE=auto
Environment=ASSIST_WATCH=1
Environment=ASSIST_ONLY=employer
Environment=ASSIST_HEADLESS=1
Environment=ASSIST_NO_HEARTBEAT=1
Environment=ASSIST_WORKER=oracle
Environment=ASSIST_POLL_MINUTES=5
ExecStart=$(command -v npx) tsx --env-file=$ENVF worker/assist.ts
Restart=on-failure
RestartSec=30
Nice=10
NoNewPrivileges=true
ProtectSystem=full
[Install]
WantedBy=multi-user.target
UN
sudo systemctl daemon-reload
sudo systemctl enable --now career-agent-assist
sleep 5
systemctl --no-pager status career-agent-assist | head -12 || true
echo
echo "Done. Watch it with:  journalctl -u career-agent-assist -f"
echo "Stop it with:         sudo systemctl disable --now career-agent-assist"
