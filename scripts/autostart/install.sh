#!/usr/bin/env bash
# Start the Career Agent apply assistant by itself whenever you sign in (macOS and Linux).
# Run once from the project folder:  bash scripts/autostart/install.sh      Remove it:  bash scripts/autostart/install.sh --remove
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NPM="$(command -v npm || true)"
[ -n "$NPM" ] || { echo "npm was not found. Install Node 22 first."; exit 1; }
[ -f "$REPO/.env.local" ] || { echo "Create $REPO/.env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first."; exit 1; }

case "$(uname -s)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/com.career-agent.assistant.plist"
    if [ "${1:-}" = "--remove" ]; then launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "Removed."; exit 0; fi
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.career-agent.assistant</string>
  <key>ProgramArguments</key><array><string>$NPM</string><string>run</string><string>assist:watch</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NPM"):/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.career-agent/assistant.log</string>
  <key>StandardErrorPath</key><string>$HOME/.career-agent/assistant.log</string>
</dict></plist>
PL
    mkdir -p "$HOME/.career-agent"; launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"
    echo "Installed. The assistant now starts when you sign in. Log: ~/.career-agent/assistant.log" ;;
  Linux)
    DIR="$HOME/.config/systemd/user"; UNIT="$DIR/career-agent-assistant.service"
    if [ "${1:-}" = "--remove" ]; then systemctl --user disable --now career-agent-assistant 2>/dev/null || true; rm -f "$UNIT"; echo "Removed."; exit 0; fi
    mkdir -p "$DIR" "$HOME/.career-agent"
    cat > "$UNIT" <<UN
[Unit]
Description=Career Agent apply assistant
[Service]
WorkingDirectory=$REPO
Environment=PATH=$(dirname "$NPM"):/usr/local/bin:/usr/bin:/bin
ExecStart=$NPM run assist:watch
Restart=always
RestartSec=30
StandardOutput=append:$HOME/.career-agent/assistant.log
StandardError=append:$HOME/.career-agent/assistant.log
[Install]
WantedBy=default.target
UN
    systemctl --user daemon-reload; systemctl --user enable --now career-agent-assistant
    echo "Installed. The assistant now starts when you sign in. Log: ~/.career-agent/assistant.log" ;;
  *) echo "Use scripts/autostart/install.ps1 on Windows."; exit 1 ;;
esac
