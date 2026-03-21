#!/bin/bash
# check-patch.sh — Check Discord plugin patch status across all nodes
# Reads remote hosts from bot-pool.json (ssh_host + remote_user fields)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
POOL="$SCRIPT_DIR/bot-pool.json"
PLUGIN_PATH=".claude/plugins/cache/claude-plugins-official/discord/0.0.1/server.ts"

check_node() {
  local label="$1" plugin="$2"
  echo "=== $label patch check ==="

  if grep -q "DISCORD_STATE_DIR" "$plugin" 2>/dev/null; then
    echo "  [ok] STATE_DIR env var"
  else
    echo "  [!!] STATE_DIR env var missing — re-apply state-dir.patch"
  fi

  if grep -q "PARTNER_BOT_IDS" "$plugin" 2>/dev/null; then
    echo "  [ok] PARTNER_BOT_IDS"
  else
    echo "  [!!] PARTNER_BOT_IDS missing — re-apply partner-bot-ids.patch"
  fi

  if grep -q 'presence.*online' "$plugin" 2>/dev/null; then
    echo "  [ok] presence: online"
  else
    echo "  [--] presence: online not set"
  fi
  echo ""
}

# Local
check_node "Local" "$HOME/$PLUGIN_PATH"

# Remote nodes — read unique (ssh_host, remote_user, location) from bot-pool.json
jq -r '[.[] | select(.location != "local" and .ssh_host != null) | {ssh_host, remote_user, location}] | unique_by(.ssh_host) | .[] | "\(.ssh_host):\(.remote_user // ""):\(.location)"' "$POOL" | while IFS=: read -r host user location; do
  home_dir="/home/${user:-$(whoami)}"

  REMOTE=$(ssh "$host" "
    PLUGIN=$home_dir/$PLUGIN_PATH
    if grep -q 'DISCORD_STATE_DIR' \$PLUGIN 2>/dev/null; then
      echo '  [ok] STATE_DIR env var'
    else
      echo '  [!!] STATE_DIR env var missing'
    fi
    if grep -q 'PARTNER_BOT_IDS' \$PLUGIN 2>/dev/null; then
      echo '  [ok] PARTNER_BOT_IDS'
    else
      echo '  [!!] PARTNER_BOT_IDS missing'
    fi
    if grep -q 'presence.*online' \$PLUGIN 2>/dev/null; then
      echo '  [ok] presence: online'
    else
      echo '  [--] presence: online not set'
    fi
  " 2>&1) || REMOTE="  [??] SSH unreachable"
  echo "=== $location ($host) patch check ==="
  echo "$REMOTE"
  echo ""
done
