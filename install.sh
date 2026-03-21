#!/bin/bash
# install.sh — Install fleet CLI and shell completions
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
COMP_DIR_BASH="${BASH_COMPLETION_DIR:-$HOME/.local/share/bash-completion/completions}"
COMP_DIR_ZSH="${ZSH_COMPLETION_DIR:-${ZDOTDIR:-$HOME}/.zfunc}"
CLI_NAME="fleet"

echo "Fleet installer"
echo ""

# Check dependencies
for dep in jq tmux; do
  if ! command -v "$dep" &>/dev/null; then
    echo "Error: $dep is required but not installed"
    exit 1
  fi
done

if ! command -v claude &>/dev/null; then
  echo "Warning: claude (Claude Code) not found in PATH"
  echo "  Install from: https://docs.anthropic.com/en/docs/claude-code"
  echo ""
fi

# Create bin directory
mkdir -p "$BIN_DIR"

# Symlink fleet CLI
chmod +x "$SCRIPT_DIR/fleet"
ln -sf "$SCRIPT_DIR/fleet" "$BIN_DIR/$CLI_NAME"
echo "Linked: $BIN_DIR/$CLI_NAME -> $SCRIPT_DIR/fleet"

# Install bash completion
if [[ -n "$BASH_VERSION" ]] || command -v bash &>/dev/null; then
  mkdir -p "$COMP_DIR_BASH"
  ln -sf "$SCRIPT_DIR/completions/fleet.bash" "$COMP_DIR_BASH/$CLI_NAME"
  echo "Bash completion: $COMP_DIR_BASH/$CLI_NAME"
fi

# Install zsh completion
if [[ -n "$ZSH_VERSION" ]] || command -v zsh &>/dev/null; then
  mkdir -p "$COMP_DIR_ZSH"
  ln -sf "$SCRIPT_DIR/completions/_fleet" "$COMP_DIR_ZSH/_$CLI_NAME"
  echo "Zsh completion: $COMP_DIR_ZSH/_$CLI_NAME"
  echo ""
  echo "For zsh, ensure your .zshrc contains:"
  echo "  fpath=(~/.zfunc \$fpath)"
  echo "  autoload -Uz compinit && compinit"
fi

# Copy config templates if not yet configured
if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
  echo ""
  echo "Next steps:"
  echo "  cp .env.example .env              # Fill in bot tokens"
  echo "  cp bot-pool.json.example bot-pool.json  # Fill in bot IDs + SSH hosts"
  echo "  $CLI_NAME status                  # Verify setup"
fi

echo ""
echo "Done. Run '$CLI_NAME --help' to get started."

# Check if BIN_DIR is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo "Warning: $BIN_DIR is not in your PATH."
  echo "  Add to your shell profile: export PATH=\"$BIN_DIR:\$PATH\""
fi
