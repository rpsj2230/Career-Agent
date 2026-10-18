#!/usr/bin/env bash
# Career Agent: set up the apply assistant on a Mac with ONE command.
#
#   curl -fsSL https://raw.githubusercontent.com/rpsj2230/Career-Agent/main/scripts/mac-setup.sh | bash
#
# It installs what is missing (Node.js 22), downloads the project to the folder set in DIR below, installs it, asks you for your two Supabase
# values, checks everything, helps you sign in to the job portals, and (if you want) makes the assistant start by itself.
# It is safe to run again at any time: it only fills in what is missing. Nothing is sent anywhere except to your own Supabase project.
set -euo pipefail

DIR="${CAREER_AGENT_DIR:-/Users/rupash/Library/CloudStorage/GoogleDrive-rupash@verzdesign.com/My Drive/Laptop Folders/E Drive/RP/AI Work/Career Job Agent}"
[ -d "/Users/rupash" ] || DIR="${CAREER_AGENT_DIR:-$HOME/Career-Agent}"
REPO_URL="${CAREER_AGENT_REPO:-https://github.com/rpsj2230/Career-Agent.git}"
CLONE_BRANCH="${CAREER_AGENT_BRANCH:-}"
b() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '   \033[32mOK\033[0m  %s\n' "$*"; }
die() { printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

# the questions need your keyboard even when this script is piped from curl
if [ -r /dev/tty ]; then TTY=/dev/tty; else die "No keyboard available. Open Terminal and paste the command there."; fi
ask() { local a; printf '%s ' "$1" >"$TTY"; read -r a <"$TTY" || a=""; printf '%s' "$a"; }
yes_no() { local a; a="$(ask "$1 [y/n]")"; case "$a" in y|Y|yes|YES) return 0;; *) return 1;; esac; }

[ "$(uname -s)" = "Darwin" ] || printf 'Note: this script is written for a Mac; continuing anyway.\n'

b "1/7  Developer tools (git)"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  die "A window asked to install the Apple developer tools. Click Install, wait until it finishes (a few minutes), then run the same command again."
fi
ok "git is available ($(git --version))"

# Homebrew paths (Apple Silicon and Intel), if Homebrew is installed
for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$p" ] && eval "$("$p" shellenv)" && break; done

node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]; }

b "2/7  Node.js 22"
if ! node_ok; then
  if command -v brew >/dev/null 2>&1; then
    echo "   Installing Node.js with Homebrew..."
    brew install node
  else
    echo "   Installing Node.js with nvm (no administrator password needed)..."
    export NVM_DIR="$HOME/.nvm"
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash; fi
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm alias default 22 >/dev/null
    # make new Terminal windows find it too
    for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
      grep -q 'NVM_DIR' "$rc" 2>/dev/null || printf '\nexport NVM_DIR="$HOME/.nvm"\n[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\n' >> "$rc"
    done
  fi
fi
node_ok || die "Node.js 22 or newer could not be installed. Install it from https://nodejs.org (LTS), then run this command again."
ok "Node $(node --version), npm $(npm --version)"

# Folders that sync to the cloud (Google Drive, Dropbox, iCloud, OneDrive)
is_synced() { case "$1" in *"/Library/CloudStorage/"*|*"/Mobile Documents/"*|*"/Dropbox"*|*"/OneDrive"*|*"/Google Drive"*) return 0;; *) return 1;; esac; }

# Put the project in $DIR; if that folder already holds other files, use a sub-folder called Career-Agent inside it.
download() {
  local target="$1"
  if [ -d "$target/.git" ]; then git -C "$target" pull --ff-only; return; fi
  if [ -d "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
    if [ -d "$target/Career-Agent/.git" ]; then target="$target/Career-Agent"; git -C "$target" pull --ff-only; DIR="$target"; return; fi
    echo "   The folder is not empty, so the project goes into a sub-folder called Career-Agent."
    target="$target/Career-Agent"
  fi
  mkdir -p "$(dirname "$target")"
  if [ -n "$CLONE_BRANCH" ]; then git clone --branch "$CLONE_BRANCH" "$REPO_URL" "$target"; else git clone "$REPO_URL" "$target"; fi
  DIR="$target"
}

b "3/7  Downloading the project to $DIR"
download "$DIR"
cd "$DIR"
ok "project is up to date in $DIR"

b "4/7  Installing it (a few minutes)"
install_deps() {
  npm ci --no-audit --no-fund --no-progress
  [ -n "${CAREER_AGENT_SKIP_BROWSER:-}" ] || npx playwright install chromium
}
if ! install_deps; then
  if is_synced "$DIR"; then
    printf '\n   Installing inside a cloud-synced folder did not work (these folders cannot hold some of the files the program needs).\n   Installing the program in %s instead; your synced folder keeps the code.\n' "$HOME/Career-Agent"
    rm -rf node_modules
    SYNCED_COPY="$DIR"; DIR="$HOME/Career-Agent"
    download "$DIR"; cd "$DIR"
    install_deps
  else
    die "The install failed. Scroll up for the first error line and send it to Claude."
  fi
fi
ok "installed"

b "5/7  Your Supabase connection"
# The service_role key is a secret: inside a cloud-synced folder it would be uploaded, so the real file is kept in your home folder
# and .env.local in the project is only a shortcut (symbolic link) to it.
if is_synced "$DIR"; then ENVFILE="$HOME/.career-agent/env"; mkdir -p "$HOME/.career-agent"; else ENVFILE="$DIR/.env.local"; fi
link_env() { [ "$ENVFILE" = "$DIR/.env.local" ] || ln -sf "$ENVFILE" "$DIR/.env.local"; }
has_env() { link_env; [ -f "$ENVFILE" ] && grep -q '^SUPABASE_URL=https://' "$ENVFILE" && grep -q '^SUPABASE_SERVICE_ROLE_KEY=.\{40,\}' "$ENVFILE"; }
if has_env && ! yes_no "   Your Supabase settings already exist. Replace them?"; then
  ok "keeping the existing settings"
else
  cat >"$TTY" <<'MSG'
   In Supabase open your project, then Project Settings > API, and copy two things:
     - Project URL            (looks like https://abcdefgh.supabase.co)
     - service_role key       (the long secret key, NOT the "anon" key)
MSG
  while :; do url="$(ask "   Paste the Project URL and press Enter:")"; url="${url%/}"; case "$url" in https://*.supabase.co) break;; *) echo "   That does not look like https://xxxx.supabase.co, try again." >"$TTY";; esac; done
  while :; do printf '   Paste the service_role key (it stays hidden) and press Enter: ' >"$TTY"; read -rs key <"$TTY" || key=""; printf '\n' >"$TTY"; [ "${#key}" -ge 40 ] && break; echo "   That key looks too short, try again." >"$TTY"; done
  umask 077
  printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$url" "$key" > "$ENVFILE"
  chmod 600 "$ENVFILE"; link_env
  ok "saved to $ENVFILE (only you can read it; it is never uploaded)"
fi

b "6/7  Check"
npm run --silent assist:check || true

b "7/7  Job portal sign-in and autostart"
if yes_no "   Open the browser now so you can sign in to LinkedIn / Naukri / Indeed (one time)?"; then
  npm run --silent assist:login || true
fi
if yes_no "   Start the assistant automatically whenever you sign in to this Mac?"; then
  bash scripts/autostart/install.sh || echo "   Could not install the autostart; you can start it by hand with: cd \"$DIR\" && npm run assist:watch"
fi

cat <<DONE

The project is in: $DIR

All set. What to do next, in the app (https://career-agent-sand.vercel.app):
  1. Settings > Auto-Apply: switch on, and in Application limits switch on
     "Let the apply assistant on my computer press Submit by itself" (keep the limits low).
  2. Applications > the Apply assistant card turns green within a minute of the assistant running.

Useful commands (run them in Terminal after:  cd "$DIR"):
  npm run assist:check   shows what is ready and what is missing
  npm run assist:login   sign in to the job portals again
  npm run assist:watch   run the assistant now (the autostart does this for you)
  Log of the automatic assistant: ~/.career-agent/assistant.log
DONE
