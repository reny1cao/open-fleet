#!/bin/bash
# install.sh — Bootstrap: put fleet CLI on PATH + shell completions
#
# This is the ONLY standalone script. After install, everything goes
# through `fleet <command>`:
#   fleet deps     — check/install dependencies
#   fleet patch    — apply Discord plugin patches
#   fleet init     — interactive setup (tokens, config, identities)
#   fleet doctor   — full health check
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

info() { echo "  ✔ $1"; }
warn() { echo "  ⚠ $1"; }

echo ""
echo "Fleet — AI coding agent fleet manager"
echo "Installing CLI to $BIN_DIR..."
echo ""

# ── Install CLI ──

mkdir -p "$BIN_DIR"
chmod +x "$SCRIPT_DIR/fleet"
ln -sf "$SCRIPT_DIR/fleet" "$BIN_DIR/$CLI_NAME"
info "fleet → $SCRIPT_DIR/fleet"

# ── Install shell completions ──

if [[ -n "$BASH_VERSION" ]] || command -v bash &>/dev/null; then
  mkdir -p "$COMP_DIR_BASH"
  if [[ -f "$SCRIPT_DIR/completions/fleet.bash" ]]; then
    ln -sf "$SCRIPT_DIR/completions/fleet.bash" "$COMP_DIR_BASH/$CLI_NAME"
    info "Bash completion installed"
  fi
fi

if [[ -n "$ZSH_VERSION" ]] || command -v zsh &>/dev/null; then
  mkdir -p "$COMP_DIR_ZSH"
  if [[ -f "$SCRIPT_DIR/completions/_fleet" ]]; then
    ln -sf "$SCRIPT_DIR/completions/_fleet" "$COMP_DIR_ZSH/_$CLI_NAME"
    info "Zsh completion installed"
  fi
fi

# ── Check PATH ──

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR is not in PATH"
  echo "  Add to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
  echo ""
fi

# ── Done ──

echo ""
echo "  Installed. Next steps:"
echo ""
echo "    fleet deps --install    # Install dependencies (jq, tmux, claude, PyYAML)"
echo "    fleet patch             # Apply Discord plugin patches"
echo "    fleet init              # Interactive setup (tokens, Discord, config)"
echo "    fleet doctor            # Verify everything works"
echo ""
