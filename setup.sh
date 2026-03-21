#!/usr/bin/env bash
# setup.sh — Guided first-time setup for discord-hq-fleet
# Safe to run multiple times (idempotent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ──────────────────────────────────────────────
green='\033[0;32m'  red='\033[0;31m'  yellow='\033[0;33m'
cyan='\033[0;36m'   bold='\033[1m'    reset='\033[0m'

ok()   { printf "  ${green}✔${reset} %s\n" "$1"; }
skip() { printf "  ${yellow}→${reset} %s (already exists, skipped)\n" "$1"; }
fail() { printf "  ${red}✘${reset} %s\n" "$1"; }
info() { printf "  ${cyan}ℹ${reset} %s\n" "$1"; }

# ── 1. Prerequisites ───────────────────────────────────
echo ""
printf "${bold}discord-hq-fleet setup${reset}\n"
echo "────────────────────────────────"
echo ""
printf "${bold}[1/3] Checking prerequisites...${reset}\n"

missing=()
for cmd in jq tmux bun claude; do
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd"
  else
    fail "$cmd — not found"
    missing+=("$cmd")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo ""
  printf "${red}Missing tools: ${missing[*]}${reset}\n"
  echo ""
  echo "Install them first:"
  for cmd in "${missing[@]}"; do
    case "$cmd" in
      jq)     echo "  brew install jq              # or: sudo apt install jq" ;;
      tmux)   echo "  brew install tmux            # or: sudo apt install tmux" ;;
      bun)    echo "  curl -fsSL https://bun.sh/install | bash" ;;
      claude) echo "  npm install -g @anthropic-ai/claude-code" ;;
    esac
  done
  echo ""
  exit 1
fi

# ── 2. Copy config files ──────────────────────────────
echo ""
printf "${bold}[2/3] Setting up config files...${reset}\n"

files_created=()

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
  files_created+=(".env")
else
  skip ".env"
fi

# bot-pool.json
if [ ! -f bot-pool.json ]; then
  cp bot-pool.json.example bot-pool.json
  ok "Created bot-pool.json from bot-pool.json.example"
  files_created+=("bot-pool.json")
else
  skip "bot-pool.json"
fi

# identities — copy all .example files that don't have a non-example counterpart
for example in identities/*.md.example; do
  target="${example%.example}"
  name="$(basename "$target")"
  if [ ! -f "$target" ]; then
    cp "$example" "$target"
    ok "Created identities/$name"
    files_created+=("identities/$name")
  else
    skip "identities/$name"
  fi
done

# ── 3. Summary ─────────────────────────────────────────
echo ""
printf "${bold}[3/3] Summary${reset}\n"

if [ ${#files_created[@]} -eq 0 ]; then
  info "Everything was already set up. No changes made."
else
  info "Created ${#files_created[@]} file(s): ${files_created[*]}"
fi

echo ""
echo "Next steps:"
echo ""

if [[ " ${files_created[*]} " == *" .env "* ]]; then
  printf "  1. ${yellow}Edit .env${reset} — add your Discord bot tokens\n"
  echo "     Get tokens: https://discord.com/developers/applications → Bot → Reset Token"
else
  echo "  1. .env — already configured"
fi

if [[ " ${files_created[*]} " == *" bot-pool.json "* ]]; then
  printf "  2. ${yellow}Edit bot-pool.json${reset} — replace YOUR_*_BOT_ID with real bot IDs\n"
else
  echo "  2. bot-pool.json — already configured"
fi

has_new_identity=false
for f in "${files_created[@]}"; do
  if [[ "$f" == identities/* ]]; then
    has_new_identity=true
    break
  fi
done

if $has_new_identity; then
  printf "  3. ${yellow}Edit identities/*.md${reset} — fill in bot IDs, user ID, channel IDs\n"
else
  echo "  3. identities/*.md — already configured"
fi

echo "  4. Apply the Discord plugin patch (see README.md)"
echo "  5. Start your first bot:  ./spawn.sh start sentinel"
echo ""
