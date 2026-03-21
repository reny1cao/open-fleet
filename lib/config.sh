#!/bin/bash
# lib/config.sh — Read fleet.yaml configuration
#
# Resolves fleet.yaml location and provides accessor functions.
# Uses Python3 + PyYAML for YAML parsing (widely available).

# ── Resolve config location ──────────────────────────────────────────────────

resolve_fleet_dir() {
  if [[ -n "${FLEET_CONFIG:-}" && -f "$FLEET_CONFIG" ]]; then
    dirname "$FLEET_CONFIG"
  elif [[ -f "./fleet.yaml" ]]; then
    pwd
  elif [[ -f "$FLEET_DIR/fleet.yaml" ]]; then
    echo "$FLEET_DIR"
  else
    echo ""
  fi
}

FLEET_DIR="${FLEET_DIR:-$(resolve_fleet_dir)}"
FLEET_YAML="${FLEET_DIR:+$FLEET_DIR/fleet.yaml}"
FLEET_ENV="${FLEET_DIR:+$FLEET_DIR/.env}"

# Load .env if present
[[ -n "$FLEET_ENV" && -f "$FLEET_ENV" ]] && source "$FLEET_ENV"

# ── YAML query helpers ────────────────────────────────────────────────────────

# Generic dotted-path query: yaml_get "agents.hub.token_env"
yaml_get() {
  local query="$1"
  [[ -z "$FLEET_YAML" || ! -f "$FLEET_YAML" ]] && return 1
  python3 -c "
import yaml, json, sys
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
val = data
for key in sys.argv[2].split('.'):
    if val is None or not isinstance(val, dict):
        val = None
        break
    val = val.get(key)
if val is None:
    sys.exit(1)
elif isinstance(val, (dict, list)):
    print(json.dumps(val))
else:
    print(val)
" "$FLEET_YAML" "$query" 2>/dev/null
}

# Get a field for a specific agent
agent_get() {
  local agent="$1" field="$2"
  yaml_get "agents.$agent.$field"
}

# Get a field with fallback to defaults section
agent_get_or_default() {
  local agent="$1" field="$2"
  local val
  val=$(agent_get "$agent" "$field") && echo "$val" && return
  yaml_get "defaults.$field"
}

# List all agent names
list_agents() {
  [[ -z "$FLEET_YAML" || ! -f "$FLEET_YAML" ]] && return 1
  python3 -c "
import yaml, sys
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
for name in data.get('agents', {}):
    print(name)
" "$FLEET_YAML" 2>/dev/null
}

# List all server names (excluding implicit "local")
list_servers() {
  [[ -z "$FLEET_YAML" || ! -f "$FLEET_YAML" ]] && return 1
  python3 -c "
import yaml, sys
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
for name in data.get('servers', {}):
    print(name)
" "$FLEET_YAML" 2>/dev/null
}

# ── Derived accessors ─────────────────────────────────────────────────────────

# Get the tmux prefix (default: "fleet")
tmux_prefix() {
  yaml_get "fleet.name" 2>/dev/null || yaml_get "defaults.tmux_prefix" 2>/dev/null || echo "fleet"
}

# Get tmux session name for an agent
session_name() {
  local agent="$1"
  echo "$(tmux_prefix)-$agent"
}

# Get the bot token from environment
get_token() {
  local agent="$1"
  local env_name
  env_name=$(agent_get "$agent" "token_env") || return 1
  echo "${!env_name}"
}

# Get SSH host for a server location
server_ssh_host() {
  local server="$1"
  yaml_get "servers.$server.ssh_host"
}

# Get remote user for a server location
server_user() {
  local server="$1"
  local user
  user=$(yaml_get "servers.$server.user" 2>/dev/null) && echo "$user" && return
  whoami
}

# Get the channel plugin string
channel_plugin() {
  yaml_get "defaults.channel_plugin" 2>/dev/null || echo "plugin:discord@claude-plugins-official"
}

# Get the runtime binary
runtime_binary() {
  yaml_get "defaults.runtime" 2>/dev/null || echo "claude"
}

# ── Validation ────────────────────────────────────────────────────────────────

require_config() {
  if [[ -z "$FLEET_YAML" || ! -f "$FLEET_YAML" ]]; then
    echo "Error: fleet.yaml not found."
    echo "Run 'fleet init' to create one, or set FLEET_CONFIG=/path/to/fleet.yaml"
    exit 1
  fi
}
