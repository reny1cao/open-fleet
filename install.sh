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

# Parse install.sh arguments
AUTH_METHOD="--claudeai"
for arg in "$@"; do
  case "$arg" in
    --console) AUTH_METHOD="--console" ;;
    --sso)     AUTH_METHOD="--sso" ;;
    --claudeai) AUTH_METHOD="--claudeai" ;;
    --help|-h)
      echo "Usage: ./install.sh [--claudeai | --console | --sso]"
      echo ""
      echo "Options:"
      echo "  --claudeai   Claude subscription login (default)"
      echo "  --console    Anthropic Console / API billing login"
      echo "  --sso        SSO enterprise login"
      exit 0 ;;
  esac
done

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

# ── Skip onboarding wizard ──
# Claude Code shows a theme/setup wizard on first run if settings.json is missing.
# Pre-creating an empty one skips it for headless/automated use.
if [[ ! -f "$HOME/.claude/settings.json" ]]; then
  mkdir -p "$HOME/.claude"
  echo '{}' > "$HOME/.claude/settings.json"
  info "Created ~/.claude/settings.json (skips onboarding wizard)"
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
  echo "  Auth method: $AUTH_METHOD"
  echo "  Override with: ./install.sh --console  or  ./install.sh --sso"
  echo ""

  # Start login in background tmux with wide window (prevents URL truncation)
  tmux new-session -d -s "$LOGIN_SESSION" -x 250 -y 50 "claude auth login $AUTH_METHOD 2>&1; echo ''; echo 'Login complete. This window will close automatically.'; sleep 5"

  # Poll tmux pane to capture the login URL before attaching
  # -J joins wrapped lines so URLs split across lines are captured whole
  url_found=""
  waited=0
  echo "  Waiting for login URL..."

  while [[ $waited -lt 30 && -z "$url_found" ]]; do
    sleep 2
    waited=$((waited + 2))
    pane=$(tmux capture-pane -t "$LOGIN_SESSION" -p -J 2>/dev/null || true)
    url_found=$(echo "$pane" | tr -d '[:space:]' | grep -oE 'https://[^[:space:]]+' | head -1 || true)
    if [[ -z "$url_found" ]]; then
      url_found=$(echo "$pane" | grep -oE 'https://[^ ]+' | head -1 || true)
    fi
  done

  # Always print the full URL clearly before attaching
  echo ""
  echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if [[ -n "$url_found" ]]; then
    echo "  Open this URL in your browser:"
    echo ""
    echo "  $url_found"
    open_url "$url_found" && echo "" && info "Browser opened automatically" || true
  else
    echo "  Could not capture URL automatically."
    echo "  Look for the URL in the login session below."
  fi
  echo ""
  echo "  After logging in, paste the token into the session below."
  echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # tmux attach blocks until the session ends (login complete + sleep 5)
  tmux attach -t "$LOGIN_SESSION" 2>/dev/null || true

  echo ""
  echo "  ─── Back to installer ───"
  echo ""

  # Clean up in case session is still around
  tmux kill-session -t "$LOGIN_SESSION" 2>/dev/null || true

  # Verify login succeeded
  if is_logged_in; then
    info "Login successful!"
  else
    warn "Login not detected after session ended"
    echo "  Run 'claude auth login' manually, then re-run this script"
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
