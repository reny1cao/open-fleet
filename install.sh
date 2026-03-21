#!/bin/bash
# install.sh — One-command fleet setup
#
# Does everything needed to get fleet running:
#   1. Installs fleet CLI to PATH
#   2. Checks/installs dependencies (jq, tmux, python3, PyYAML, bun)
#   3. Checks Claude Code login (prompts if needed)
#   4. Installs Discord plugin
#   5. Applies patches
#
# After this, only two steps remain:
#   fleet init     — configure tokens, Discord server, agents
#   fleet start    — launch your fleet
#
# Usage:
#   git clone https://github.com/reny1cao/discord-hq-fleet && cd discord-hq-fleet
#   ./install.sh

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
COMP_DIR_BASH="${BASH_COMPLETION_DIR:-$HOME/.local/share/bash-completion/completions}"
COMP_DIR_ZSH="${ZSH_COMPLETION_DIR:-${ZDOTDIR:-$HOME}/.zfunc}"
CLI_NAME="fleet"
PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/discord/0.0.1"

# ── Helpers ──

ok()   { echo "  ✔ $1"; }
warn() { echo "  ⚠ $1"; }
fail() { echo "  ✘ $1"; }
step() { echo ""; echo "=== $1 ==="; }

detect_pkg_manager() {
  if command -v brew &>/dev/null; then echo "brew"
  elif command -v apt-get &>/dev/null; then echo "apt"
  elif command -v dnf &>/dev/null; then echo "dnf"
  elif command -v pacman &>/dev/null; then echo "pacman"
  else echo ""
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
    *)      warn "Cannot auto-install $pkg — install manually and re-run"
            return 1 ;;
  esac
}

echo ""
echo "Fleet — AI coding agent fleet manager"
echo "Setting up everything you need..."
echo ""

# ════════════════════════════════════════
# Step 1: Fleet CLI + Completions
# ════════════════════════════════════════

step "Step 1/5: Installing fleet CLI"

mkdir -p "$BIN_DIR"
chmod +x "$SCRIPT_DIR/fleet"
ln -sf "$SCRIPT_DIR/fleet" "$BIN_DIR/$CLI_NAME"
ok "fleet → $SCRIPT_DIR/fleet"

# Bash completion
if [[ -n "$BASH_VERSION" ]] || command -v bash &>/dev/null; then
  mkdir -p "$COMP_DIR_BASH"
  if [[ -f "$SCRIPT_DIR/completions/fleet.bash" ]]; then
    ln -sf "$SCRIPT_DIR/completions/fleet.bash" "$COMP_DIR_BASH/$CLI_NAME"
    ok "Bash completion"
  fi
fi

# Zsh completion
if [[ -n "$ZSH_VERSION" ]] || command -v zsh &>/dev/null; then
  mkdir -p "$COMP_DIR_ZSH"
  if [[ -f "$SCRIPT_DIR/completions/_fleet" ]]; then
    ln -sf "$SCRIPT_DIR/completions/_fleet" "$COMP_DIR_ZSH/_$CLI_NAME"
    ok "Zsh completion"
  fi
fi

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR is not in PATH — add to shell profile: export PATH=\"$BIN_DIR:\$PATH\""
fi

# ════════════════════════════════════════
# Step 2: Dependencies
# ════════════════════════════════════════

step "Step 2/5: Dependencies"

for cmd in jq tmux curl; do
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd"
  else
    echo "  Installing $cmd..."
    install_pkg "$cmd" && ok "$cmd installed" || fail "$cmd — install failed"
  fi
done

# Python3
if command -v python3 &>/dev/null; then
  ok "python3"
else
  fail "python3 — not found. Install manually."
fi

# PyYAML
if python3 -c "import yaml" 2>/dev/null; then
  ok "PyYAML"
else
  echo "  Installing PyYAML..."
  pip3 install pyyaml 2>/dev/null && ok "PyYAML installed" || fail "PyYAML — pip3 install pyyaml"
fi

# bun
if command -v bun &>/dev/null; then
  ok "bun"
else
  echo "  Installing bun..."
  curl -fsSL https://bun.sh/install | bash 2>/dev/null
  export PATH="$HOME/.bun/bin:$PATH"
  ok "bun installed"
fi

# Claude Code
if command -v claude &>/dev/null; then
  ok "claude"
else
  fail "Claude Code not found"
  echo "  Install: npm install -g @anthropic-ai/claude-code"
  echo "  Then re-run: ./install.sh"
  exit 1
fi

# Skip onboarding wizard
if [[ ! -f "$HOME/.claude/settings.json" ]]; then
  mkdir -p "$HOME/.claude"
  echo '{}' > "$HOME/.claude/settings.json"
fi

# ════════════════════════════════════════
# Step 3: Claude Code login
# ════════════════════════════════════════

step "Step 3/5: Claude Code login"

is_logged_in() {
  claude auth status 2>/dev/null | grep -q '"loggedIn": true'
}

if is_logged_in; then
  ok "Claude Code is logged in"
else
  fail "Claude Code is not logged in"
  echo ""
  echo "  Run this command to log in:"
  echo ""
  echo "    claude auth login"
  echo ""
  echo "  On a remote server: copy the URL it shows, open in your local browser,"
  echo "  complete login, then re-run ./install.sh to continue."
  echo ""
  exit 1
fi

# ════════════════════════════════════════
# Step 4: Discord plugin
# ════════════════════════════════════════

step "Step 4/5: Discord plugin"

if [[ -f "$PLUGIN_DIR/server.ts" ]]; then
  ok "Discord plugin installed"
else
  echo "  Installing Discord plugin..."
  # The plugin installs when claude runs with --channels, but we can trigger it
  if claude plugin install discord@claude-plugins-official 2>/dev/null; then
    ok "Discord plugin installed"
  elif [[ -f "$PLUGIN_DIR/server.ts" ]]; then
    ok "Discord plugin installed"
  else
    warn "Could not install plugin automatically"
    echo "  It will be installed on first 'fleet start'. Continuing..."
  fi
fi

# ════════════════════════════════════════
# Step 5: Patches
# ════════════════════════════════════════

step "Step 5/5: Discord plugin patches"

if [[ -f "$PLUGIN_DIR/server.ts" ]]; then
  SERVER_TS="$PLUGIN_DIR/server.ts"

  # STATE_DIR
  if grep -q "DISCORD_STATE_DIR" "$SERVER_TS" 2>/dev/null; then
    ok "STATE_DIR patch"
  else
    sed -i.bak "s|const STATE_DIR = join(homedir(), '.claude', 'channels', 'discord')|const STATE_DIR = process.env.DISCORD_STATE_DIR\n  ?? join(homedir(), '.claude', 'channels', 'discord')|" "$SERVER_TS"
    grep -q "DISCORD_STATE_DIR" "$SERVER_TS" && ok "STATE_DIR patch applied" || warn "STATE_DIR patch failed"
  fi

  # PARTNER_BOT_IDS
  if grep -q "PARTNER_BOT_IDS" "$SERVER_TS" 2>/dev/null; then
    ok "PARTNER_BOT_IDS patch"
  else
    sed -i.bak "/client.on('messageCreate'/i\\
const PARTNER_BOT_IDS = new Set([])\\
" "$SERVER_TS"
    sed -i.bak "s|if (msg.author.bot) return|if (msg.author.bot \&\& !PARTNER_BOT_IDS.has(msg.author.id)) return|" "$SERVER_TS"
    grep -q "PARTNER_BOT_IDS" "$SERVER_TS" && ok "PARTNER_BOT_IDS patch applied" || warn "PARTNER_BOT_IDS patch failed"
  fi

  # Presence
  if grep -q 'presence: { status: "online" }' "$SERVER_TS" 2>/dev/null; then
    ok "Presence patch"
  elif grep -q '// presence' "$SERVER_TS" 2>/dev/null; then
    sed -i.bak 's|// presence: { status: .online. }|presence: { status: "online" }|' "$SERVER_TS"
    ok "Presence patch applied"
  else
    ok "Presence: no change needed"
  fi

  rm -f "$PLUGIN_DIR/server.ts.bak"
else
  warn "Discord plugin not found — patches will be applied on first 'fleet start'"
fi

# ════════════════════════════════════════
# Done
# ════════════════════════════════════════

echo ""
echo "════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Next:"
echo "    fleet init         # Configure tokens, Discord server, agents"
echo "    fleet start hub    # Launch your first agent"
echo "════════════════════════════════════════"
echo ""
