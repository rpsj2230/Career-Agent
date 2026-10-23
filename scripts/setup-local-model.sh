#!/usr/bin/env bash
# Sets up and checks the local AI model on your Mac, so the assistant keeps answering form questions when the free hosted models run out.
# Run once from the project folder:   bash scripts/setup-local-model.sh            (a model is chosen to fit your Mac's memory)
#   or choose one yourself:           bash scripts/setup-local-model.sh qwen2.5:3b-instruct
# Run it again any time to CHECK that the local model works: it ends with WORKING or NOT WORKING and the reason.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO/.env.local"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"

say() { printf '%s\n' "$*"; }
fail() { say ""; say "NOT WORKING: $*"; exit 1; }

# 1. Ollama (the program that runs the model) must be installed. This script does not install software for you.
if ! command -v ollama >/dev/null 2>&1; then
  fail "Ollama is not installed. Download it from https://ollama.com (a normal Mac app), open it once, then run this script again."
fi
say "1/5 Ollama is installed: $(ollama --version 2>/dev/null | head -1)"

# 2. which model: the one you named, else the one already set, else one that fits this Mac's memory
MODEL="${1:-}"
if [ -z "$MODEL" ] && [ -f "$ENV_FILE" ]; then MODEL="$(grep -E '^LOCAL_MODEL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" )"; fi
if [ -z "$MODEL" ]; then
  MEM_GB=0
  case "$(uname -s)" in
    Darwin) MEM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 )) ;;
    Linux) MEM_GB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1048576 )) ;;
  esac
  if [ "$MEM_GB" -ge 16 ]; then MODEL="qwen2.5:7b-instruct"; else MODEL="qwen2.5:3b-instruct"; fi
  say "2/5 This computer has about ${MEM_GB} GB of memory, so the model is $MODEL"
else
  say "2/5 Model: $MODEL"
fi

# 3. Ollama must be running
if ! curl -sf -m 3 $OLLAMA_URL/api/tags >/dev/null 2>&1; then
  say "3/5 Starting Ollama..."
  if [ "$(uname -s)" = "Darwin" ] && [ -d /Applications/Ollama.app ]; then open -a Ollama; else (nohup ollama serve >/tmp/ollama.log 2>&1 &); fi
  for _ in $(seq 1 30); do curl -sf -m 2 $OLLAMA_URL/api/tags >/dev/null 2>&1 && break; sleep 2; done
  curl -sf -m 3 $OLLAMA_URL/api/tags >/dev/null 2>&1 || fail "Ollama did not start. Open the Ollama app by hand, then run this script again."
else
  say "3/5 Ollama is running"
fi

# 4. the model must be downloaded (once; a few GB)
if ! ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$MODEL"; then
  say "4/5 Downloading $MODEL (once; this can take several minutes)..."
  ollama pull "$MODEL" || fail "the download of $MODEL failed. Check your internet connection and the model name, then run this script again."
else
  say "4/5 $MODEL is already downloaded"
fi

# 5. tell the assistant to use it (a line in .env.local; changed in place, never duplicated)
touch "$ENV_FILE"
if grep -qE '^LOCAL_MODEL=' "$ENV_FILE"; then
  TMP="$(mktemp)"; sed "s|^LOCAL_MODEL=.*|LOCAL_MODEL=$MODEL|" "$ENV_FILE" > "$TMP" && cat "$TMP" > "$ENV_FILE"; rm -f "$TMP"
else
  [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ] && printf '\n' >> "$ENV_FILE"
  printf 'LOCAL_MODEL=%s\n' "$MODEL" >> "$ENV_FILE"
fi
say "5/5 .env.local now says LOCAL_MODEL=$MODEL"

# the check: ask it a real form question and require a sensible answer back
say ""
say "Checking that it answers (the first answer can take a minute while the model loads)..."
START=$(date +%s)
REPLY="$(curl -sf -m 300 $OLLAMA_URL/v1/chat/completions -H 'Content-Type: application/json' -d "{\"model\":\"$MODEL\",\"temperature\":0,\"messages\":[{\"role\":\"user\",\"content\":\"A job application form asks: 'How many years of experience do you have as a project manager?'. The candidate has been a project manager from 2012 to 2024. Reply with only the number of years.\"}]}" 2>&1)" || fail "$MODEL did not answer within 5 minutes. Try the smaller model: bash scripts/setup-local-model.sh qwen2.5:3b-instruct"
SECS=$(( $(date +%s) - START ))
ANSWER="$(printf '%s' "$REPLY" | tr -d '\n' | sed -n 's/.*"content":"\([^"]*\)".*/\1/p' | head -c 200)"
case "$ANSWER" in
  *[0-9]*) say ""; say "WORKING: $MODEL answered \"$ANSWER\" in ${SECS}s."; say "Restart the assistant so it uses it:  bash scripts/autostart/install.sh"; say "Keep the Ollama app open while the assistant runs." ;;
  *) fail "$MODEL answered, but not sensibly (\"$ANSWER\"). Try: bash scripts/setup-local-model.sh qwen2.5:7b-instruct" ;;
esac
