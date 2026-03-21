#!/bin/bash
# install.sh — One-command fleet setup
# Installs dependencies, Discord plugin, patches, CLI, and completions.
# The only manual step: Claude Code login (if not already logged in).
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
COMP_DIR_BASH="${BASH_COMPLETION_DIR:-$HOME/.local/share/bash-completion/completions}"
COMP_DIR_ZSH="${ZSH_COMPLETION_DIR:-${ZDOTDIR:-$HOME}/.zfunc}"
CLI_NAME="fleet"
PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/discord/0.0.1"
PATCHES_DIR="$SCRIPT_DIR/patches"

# ── Helpers ──

info()  { echo "  [ok] $1"; }
warn()  { echo "  [!!] $1"; }
step()  { echo ""; echo "=== $1 ==="; }
ask()   { echo ""; read -rp "  $1 [Y/n] " ans; [[ -z "$ans" || "$ans" =~ ^[Yy] ]]; }

detect_pkg_manager() {
  if command -v brew &>/dev/null; then
    echo "brew"
  elif command -v apt-get &>/dev/null; then
    echo "apt"
  elif command -v dnf &>/dev/null; then
    echo "dnf"
  elif command -v pacman &>/dev/null; then
    echo "pacman"
  else
    echo ""
  fi
}

install_pkg() {
  local pkg="$1" pm
  pm=$(detect_pkg_manager)
  case "$pm" in
    brew)   brew install "$pkg" ;;
    apt)    sudo apt-get install -y "$pkg" ;;
    dnf)    sudo dnf install -y "$pkg" ;;
    pacman) sudo pacman -S --noconfirm "$pkg" ;;
    *)      warn "Cannot auto-install $pkg — no supported package manager found"
            warn "Install $pkg manually, then re-run this script"
            exit 1 ;;
  esac
}

echo "Fleet — AI coding agent fleet manager"
echo "One-command setup. You only need to log in to Claude Code yourself."

# ══════════════════════════════════════════
# Phase 1: Dependencies
# ══════════════════════════════════════════

step "Phase 1: Dependencies"

# jq
if command -v jq &>/dev/null; then
  info "jq $(jq --version 2>/dev/null || echo '')"
else
  echo "  Installing jq..."
  install_pkg jq
  info "jq installed"
fi

# tmux
if command -v tmux &>/dev/null; then
  info "tmux $(tmux -V 2>/dev/null || echo '')"
else
  echo "  Installing tmux..."
  install_pkg tmux
  info "tmux installed"
fi

# bun (needed for Discord plugin)
if command -v bun &>/dev/null; then
  info "bun $(bun --version 2>/dev/null || echo '')"
else
  echo "  Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  info "bun installed"
fi

# Claude Code
if command -v claude &>/dev/null; then
  info "claude found"
else
  warn "Claude Code not found"
  echo "  Install: npm install -g @anthropic-ai/claude-code"
  echo "  Docs: https://docs.anthropic.com/en/docs/claude-code"
  if ask "Install Claude Code via npm now?"; then
    npm install -g @anthropic-ai/claude-code
    info "Claude Code installed"
  else
    warn "Claude Code is required. Install it and re-run this script."
    exit 1
  fi
fi

# ══════════════════════════════════════════
# Phase 2: Claude Code login
# ══════════════════════════════════════════

step "Phase 2: Claude Code login"

LOGIN_SESSION="fleet-login-$$"
LOGIN_TIMEOUT=300  # 5 minutes

is_logged_in() {
  claude auth status 2>/dev/null | grep -q '"loggedIn": true'
}

open_url() {
  local url="$1"
  if [[ "$(uname)" == "Darwin" ]]; then
    open "$url" 2>/dev/null && return 0
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$url" 2>/dev/null && return 0
  fi
  return 1
}

if is_logged_in; then
  info "Claude Code is authenticated"
else
  echo "  Not logged in. Starting login flow..."
  echo ""
  echo "  Claude Code supports multiple auth methods:"
  echo "    1) Claude subscription (claude.ai) — default"
  echo "    2) Anthropic Console (API billing) — use: claude auth login --console"
  echo "    3) SSO — use: claude auth login --sso"
  echo ""
  echo "  Proceeding with Claude subscription (--claudeai)..."
  echo "  To use a different method, Ctrl+C and run the command above manually."
  echo ""

  # --claudeai skips the interactive method picker
  # The login process outputs a URL that the user must open in a browser
  tmux new-session -d -s "$LOGIN_SESSION" "claude auth login --claudeai 2>&1; sleep 10"

  # Poll tmux pane for a URL
  url_found=""
  waited=0
  echo "  Waiting for login URL..."

  while [[ $waited -lt 30 && -z "$url_found" ]]; do
    sleep 2
    waited=$((waited + 2))
    pane=$(tmux capture-pane -t "$LOGIN_SESSION" -p 2>/dev/null || true)
    url_found=$(echo "$pane" | grep -oE 'https://[^ ]+' | head -1 || true)
  done

  if [[ -n "$url_found" ]]; then
    echo ""
    if open_url "$url_found"; then
      info "Browser opened automatically"
    else
      # Remote or headless — print URL for user
      echo "  ┌─────────────────────────────────────────────┐"
      echo "  │  Open this URL in your browser:             │"
      echo "  └─────────────────────────────────────────────┘"
      echo ""
      echo "  $url_found"
    fi
    echo ""
    echo "  Complete the login in your browser."
    echo "  This script will detect it automatically..."
    echo ""
  else
    warn "Could not capture login URL from tmux"
    echo "  Try running 'claude login' manually in another terminal"
    echo "  This script will detect when you're logged in..."
    echo ""
  fi

  # Poll auth status until logged in or timeout
  waited=0
  while [[ $waited -lt $LOGIN_TIMEOUT ]]; do
    if is_logged_in; then
      info "Login detected!"
      # Clean up tmux session
      tmux kill-session -t "$LOGIN_SESSION" 2>/dev/null || true
      break
    fi
    sleep 3
    waited=$((waited + 3))

    # Show a dot every 15 seconds so user knows we're alive
    if (( waited % 15 == 0 )); then
      echo "  ... still waiting (${waited}s / ${LOGIN_TIMEOUT}s)"
    fi
  done

  if ! is_logged_in; then
    tmux kill-session -t "$LOGIN_SESSION" 2>/dev/null || true
    warn "Login timed out after ${LOGIN_TIMEOUT}s"
    echo "  Run 'claude login' manually, then re-run this script"
    exit 1
  fi
fi

# ══════════════════════════════════════════
# Phase 3: Discord plugin
# ══════════════════════════════════════════

step "Phase 3: Discord plugin"

if [[ -f "$PLUGIN_DIR/server.ts" ]]; then
  info "Discord plugin already installed"
else
  echo "  Installing Discord plugin..."
  claude plugin install discord@claude-plugins-official 2>&1 || true
  if [[ -f "$PLUGIN_DIR/server.ts" ]]; then
    info "Discord plugin installed"
  else
    warn "Plugin install may have failed — check manually with: claude plugin list"
  fi
fi

# ══════════════════════════════════════════
# Phase 4: Patches
# ══════════════════════════════════════════

step "Phase 4: Patching server.ts"

if [[ ! -f "$PLUGIN_DIR/server.ts" ]]; then
  warn "server.ts not found at $PLUGIN_DIR — skipping patches"
  warn "Install the Discord plugin first, then re-run"
else
  SERVER_TS="$PLUGIN_DIR/server.ts"

  # state-dir patch
  if grep -q "DISCORD_STATE_DIR" "$SERVER_TS" 2>/dev/null; then
    info "STATE_DIR patch already applied"
  else
    echo "  Applying state-dir patch..."
    # Direct sed — more reliable than git apply on a non-git directory
    sed -i.bak "s|const STATE_DIR = join(homedir(), '.claude', 'channels', 'discord')|const STATE_DIR = process.env.DISCORD_STATE_DIR\n  ?? join(homedir(), '.claude', 'channels', 'discord')|" "$SERVER_TS"
    if grep -q "DISCORD_STATE_DIR" "$SERVER_TS"; then
      info "STATE_DIR patch applied"
    else
      warn "STATE_DIR patch failed — apply manually from patches/state-dir.patch"
    fi
  fi

  # partner-bot-ids patch
  if grep -q "PARTNER_BOT_IDS" "$SERVER_TS" 2>/dev/null; then
    info "PARTNER_BOT_IDS patch already applied"
  else
    echo "  Applying partner-bot-ids patch..."
    # Insert PARTNER_BOT_IDS set before messageCreate handler, and change the filter
    sed -i.bak "/client.on('messageCreate'/i\\
// Allow messages from partner bots (fleet collaboration).\\
// Loop safety: requireMention in group config means only explicit @mentions trigger.\\
const PARTNER_BOT_IDS = new Set([\\
  // Add your bot IDs here, e.g.: '123456789012345678',\\
])\\
" "$SERVER_TS"
    # Replace the bot filter
    sed -i.bak "s|if (msg.author.bot) return|if (msg.author.bot \&\& !PARTNER_BOT_IDS.has(msg.author.id)) return|" "$SERVER_TS"
    if grep -q "PARTNER_BOT_IDS" "$SERVER_TS"; then
      info "PARTNER_BOT_IDS patch applied"
      warn "Remember to add your bot IDs to the PARTNER_BOT_IDS set in server.ts"
    else
      warn "PARTNER_BOT_IDS patch failed — apply manually from patches/partner-bot-ids.patch"
    fi
  fi

  # presence patch
  if grep -q "presence.*status.*online" "$SERVER_TS" 2>/dev/null && ! grep -q "// presence" "$SERVER_TS" 2>/dev/null; then
    info "Presence patch already applied"
  else
    echo "  Applying presence patch..."
    sed -i.bak 's|// presence: { status: .online. }|presence: { status: "online" }|' "$SERVER_TS"
    if grep -q 'presence: { status: "online" }' "$SERVER_TS"; then
      info "Presence patch applied"
    else
      # Might already be uncommented or format differs
      info "Presence patch: no change needed or format differs"
    fi
  fi

  # Clean up backup files
  rm -f "$PLUGIN_DIR/server.ts.bak"
fi

# ══════════════════════════════════════════
# Phase 5: Config templates
# ══════════════════════════════════════════

step "Phase 5: Configuration"

if [[ -f "$SCRIPT_DIR/.env" ]]; then
  info ".env exists"
else
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  info "Created .env from template — fill in your bot tokens"
fi

if [[ -f "$SCRIPT_DIR/bot-pool.json" ]]; then
  info "bot-pool.json exists"
else
  cp "$SCRIPT_DIR/bot-pool.json.example" "$SCRIPT_DIR/bot-pool.json"
  info "Created bot-pool.json from template — fill in bot IDs + SSH hosts"
fi

# ══════════════════════════════════════════
# Phase 6: CLI + Completions
# ══════════════════════════════════════════

step "Phase 6: CLI installation"

mkdir -p "$BIN_DIR"
chmod +x "$SCRIPT_DIR/fleet"
chmod +x "$SCRIPT_DIR/check-patch.sh"
ln -sf "$SCRIPT_DIR/fleet" "$BIN_DIR/$CLI_NAME"
info "$BIN_DIR/$CLI_NAME -> $SCRIPT_DIR/fleet"

# Bash completion
if [[ -n "$BASH_VERSION" ]] || command -v bash &>/dev/null; then
  mkdir -p "$COMP_DIR_BASH"
  ln -sf "$SCRIPT_DIR/completions/fleet.bash" "$COMP_DIR_BASH/$CLI_NAME"
  info "Bash completion installed"
fi

# Zsh completion
if [[ -n "$ZSH_VERSION" ]] || command -v zsh &>/dev/null; then
  mkdir -p "$COMP_DIR_ZSH"
  ln -sf "$SCRIPT_DIR/completions/_fleet" "$COMP_DIR_ZSH/_$CLI_NAME"
  info "Zsh completion installed"
fi

# Check PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR is not in PATH"
  echo "  Add to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
fi

# ══════════════════════════════════════════
# Done
# ══════════════════════════════════════════

step "Setup complete"
echo ""
echo "  What was automated:"
echo "    - Dependencies (jq, tmux, bun)"
echo "    - Discord plugin installation"
echo "    - server.ts patches (state-dir, partner-bot-ids, presence)"
echo "    - Config templates (.env, bot-pool.json)"
echo "    - CLI + shell completions"
echo ""
echo "  What you still need to do:"
echo "    1. Edit .env — add your Discord bot tokens"
echo "    2. Edit bot-pool.json — add bot IDs, SSH hosts, locations"
echo "    3. Edit server.ts PARTNER_BOT_IDS — add all your bot IDs"
echo "    4. Create identity files: cp identities/sentinel.md.example identities/sentinel.md"
echo "    5. Run: fleet status"
echo ""
