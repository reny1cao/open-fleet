#!/bin/bash
# install.sh — One-command fleet setup
#
# Two ways to run:
#   curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash
#   git clone ... && cd fleet && ./install.sh
#
# What it does:
#   1. Clones repo (if run via curl)
#   2. Installs fleet CLI to PATH
#   3. Builds fleet-next (TypeScript binary)
#   4. Checks/installs dependencies
#   5. Checks Claude Code login
#   6. Installs Discord plugin + patches
#
# After this:
#   fleet init     — configure tokens, Discord, agents
#   fleet start    — launch your fleet

set -eo pipefail

REPO_URL="https://github.com/reny1cao/open-fleet.git"
INSTALL_DIR="${FLEET_INSTALL_DIR:-$HOME/.fleet}"
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
echo "Fleet — Let your AI agents work as a team"
echo ""

# ════════════════════════════════════════
# Step 0: Get the repo
# ════════════════════════════════════════

# Detect if we're inside the repo or running via curl pipe
if [[ -f "$(dirname "${BASH_SOURCE[0]:-$0}" 2>/dev/null)/fleet" ]]; then
  # Running from inside the repo (./install.sh)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
else
  # Running via curl pipe or from outside the repo
  step "Step 0: Downloading fleet"

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "  Updating existing installation..."
    git -C "$INSTALL_DIR" pull --quiet 2>/dev/null || true
    ok "Updated $INSTALL_DIR"
  else
    if ! command -v git &>/dev/null; then
      fail "git is required. Install git first."
      exit 1
    fi
    echo "  Cloning to $INSTALL_DIR..."
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    ok "Cloned to $INSTALL_DIR"
  fi
  SCRIPT_DIR="$INSTALL_DIR"
fi

# ════════════════════════════════════════
# Step 1: Fleet CLI + Completions
# ════════════════════════════════════════

step "Step 1/6: Installing fleet CLI"

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
# Step 2: Build fleet-next (TypeScript)
# ════════════════════════════════════════

step "Step 2/6: Building fleet-next (TypeScript)"

if command -v bun &>/dev/null; then
  (cd "$SCRIPT_DIR" && bun install --frozen-lockfile 2>/dev/null && bun build --compile --outfile fleet-next src/index.ts 2>/dev/null)
  if [[ -f "$SCRIPT_DIR/fleet-next" ]]; then
    ln -sf "$SCRIPT_DIR/fleet-next" "$BIN_DIR/fleet-next"
    ok "fleet-next built and linked"
  else
    warn "fleet-next build failed — bash fleet still available"
  fi
else
  warn "bun not found — fleet-next will be built after bun is installed"
fi

# ════════════════════════════════════════
# Step 3: Dependencies
# ════════════════════════════════════════

step "Step 3/6: Dependencies"

for cmd in tmux curl; do
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd"
  else
    echo "  Installing $cmd..."
    install_pkg "$cmd" && ok "$cmd installed" || fail "$cmd — install failed"
  fi
done

# bun
if command -v bun &>/dev/null; then
  ok "bun"
else
  echo "  Installing bun..."
  curl -fsSL https://bun.sh/install | bash 2>/dev/null
  export PATH="$HOME/.bun/bin:$PATH"
  ok "bun installed"
fi

# Retry fleet-next build if bun was just installed
if [[ ! -f "$SCRIPT_DIR/fleet-next" ]] && command -v bun &>/dev/null; then
  echo "  Building fleet-next (bun now available)..."
  (cd "$SCRIPT_DIR" && bun install --frozen-lockfile 2>/dev/null && bun build --compile --outfile fleet-next src/index.ts 2>/dev/null)
  if [[ -f "$SCRIPT_DIR/fleet-next" ]]; then
    ln -sf "$SCRIPT_DIR/fleet-next" "$BIN_DIR/fleet-next"
    ok "fleet-next built and linked"
  fi
fi

# Claude Code
if command -v claude &>/dev/null; then
  ok "claude"
else
  fail "Claude Code not found"
  echo "  Install: npm install -g @anthropic-ai/claude-code"
  echo "  Then re-run: $0"
  exit 1
fi

# Skip onboarding wizard
if [[ ! -f "$HOME/.claude/settings.json" ]]; then
  mkdir -p "$HOME/.claude"
  echo '{}' > "$HOME/.claude/settings.json"
fi

# ════════════════════════════════════════
# Step 4: Claude Code login
# ════════════════════════════════════════

step "Step 4/6: Claude Code login"

is_logged_in() {
  claude auth status 2>/dev/null | grep -q '"loggedIn": true'
}

if is_logged_in; then
  ok "Claude Code is logged in"
else
  fail "Claude Code is not logged in"
  echo ""
  echo "  Run:  claude auth login"
  echo ""
  echo "  Then re-run: $0"
  exit 1
fi

# ════════════════════════════════════════
# Step 5: Discord plugin
# ════════════════════════════════════════

step "Step 5/6: Discord plugin"

if [[ -f "$PLUGIN_DIR/server.ts" ]]; then
  ok "Discord plugin installed"
else
  echo "  Installing Discord plugin..."
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
# Step 6: Patches
# ════════════════════════════════════════

step "Step 6/6: Discord plugin patches"

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
echo "    fleet init         # Configure tokens + agents"
echo "    fleet start hub    # Launch your first agent"
echo ""
echo "  Both 'fleet' (bash) and 'fleet-next' (TypeScript) are available."
echo "  fleet-next is recommended — faster, no Python dependency."
echo "════════════════════════════════════════"
echo ""
