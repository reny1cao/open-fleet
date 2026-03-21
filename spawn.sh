#!/bin/bash
# spawn.sh — HQ bot lifecycle manager
# Config from bot-pool.json, tokens from .env
#
# Usage:
#   spawn.sh start pilot                        # Start (default location + dir)
#   spawn.sh start pilot ~/workspace/sb         # Start (custom dir)
#   spawn.sh start pilot --role writer          # Start + role overlay
#   spawn.sh inject pilot writer                # Hot-inject role (no restart)
#   spawn.sh stop pilot                         # Stop
#   spawn.sh status                             # Fleet status

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
POOL="$SCRIPT_DIR/bot-pool.json"
ENV_FILE="$SCRIPT_DIR/.env"
IDENTITIES_DIR="$SCRIPT_DIR/identities"
ROLES_DIR="$IDENTITIES_DIR/roles"

# Load tokens
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

ACTION="${1:-}"
BOT="${2:-}"
EXTRA="${3:-}"

ALL_BOTS=$(jq -r '.[].name' "$POOL" | tr '\n' ' ')
ALL_LOCATIONS=$(jq -r '[.[].location] | unique | .[]' "$POOL" | tr '\n' ' ')

# ── Read bot config from JSON ──
get_field() {
  local bot="$1" field="$2"
  jq -r --arg b "$bot" '.[] | select(.name == $b) | .'"$field" "$POOL"
}

get_token() {
  local bot="$1"
  local env_name
  env_name=$(get_field "$bot" "token_env")
  echo "${!env_name}"
}

# ── Resolve location → SSH host from bot-pool.json ──
location_to_ssh() {
  local loc="$1"
  local ssh_host
  ssh_host=$(jq -r --arg l "$loc" '[.[] | select(.location == $l) | .ssh_host] | first // empty' "$POOL")
  if [[ -z "$ssh_host" ]]; then
    echo "Error: no ssh_host configured for location '$loc'" >&2
    return 1
  fi
  echo "$ssh_host"
}

# ── Resolve remote_user for a location (default: current user) ──
location_to_user() {
  local loc="$1"
  local user
  user=$(jq -r --arg l "$loc" '[.[] | select(.location == $l) | .remote_user] | first // empty' "$POOL")
  echo "${user:-$(whoami)}"
}

# ── Run command on remote via SSH, optionally as a specific user ──
remote_cmd() {
  local ssh_host="$1" remote_user="$2" cmd="$3"
  if [[ "$remote_user" == "$(whoami)" || -z "$remote_user" ]]; then
    ssh "$ssh_host" "$cmd" 2>/dev/null
  else
    ssh "$ssh_host" "su - $remote_user -c '$cmd'" 2>/dev/null
  fi
}

# ── Send prompt to tmux session ──
send_prompt() {
  local session="$1" location="$2" prompt="$3"

  if [[ "$location" == "local" ]]; then
    tmux send-keys -t "$session" "$prompt" Enter
  else
    local ssh_host remote_user
    ssh_host=$(location_to_ssh "$location")
    remote_user=$(location_to_user "$location")
    # Write to temp file on remote to avoid escaping hell
    local remote_tmp="/tmp/hq-prompt-$$.md"
    echo "$prompt" | ssh "$ssh_host" "cat > $remote_tmp" 2>/dev/null
    remote_cmd "$ssh_host" "$remote_user" "tmux send-keys -t $session \"\$(cat $remote_tmp)\" Enter" 2>&1
    ssh "$ssh_host" "rm -f $remote_tmp" 2>/dev/null
  fi
}

# ── Inject base identity on startup ──
inject_identity() {
  local bot="$1" session="$2" location="$3" role="$4"
  local identity_file="$IDENTITIES_DIR/$bot.md"

  if [[ ! -f "$identity_file" ]]; then
    echo "  Warning: no identity file: $identity_file"
    return
  fi

  local prompt="Read the following identity and remember it. Act as this identity in all subsequent interactions. Do not reply with confirmation — wait for Discord messages.

$(cat "$identity_file")"

  # Append role if specified
  if [[ -n "$role" ]]; then
    local role_file="$ROLES_DIR/$role.md"
    if [[ -f "$role_file" ]]; then
      prompt="$prompt

---

$(cat "$role_file")"
    else
      echo "  Warning: unknown role: $role (available: $(ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' '))"
    fi
  fi

  echo "  Injecting identity prompt..."

  # Wait for Claude to fully initialize (poll, max 60s)
  local waited=0
  local max_wait=60
  while [[ $waited -lt $max_wait ]]; do
    local pane_output
    if [[ "$location" == "local" ]]; then
      pane_output=$(tmux capture-pane -t "$session" -p 2>/dev/null)
    else
      local ssh_host remote_user
      ssh_host=$(location_to_ssh "$location")
      remote_user=$(location_to_user "$location")
      pane_output=$(remote_cmd "$ssh_host" "$remote_user" "tmux capture-pane -t $session -p 2>/dev/null")
    fi

    if echo "$pane_output" | grep -q "Listening for channel messages"; then
      break
    fi
    sleep 3
    waited=$((waited + 3))
  done

  if [[ $waited -ge $max_wait ]]; then
    echo "  Warning: timeout (${max_wait}s), still attempting injection"
  fi

  # Extra wait for Discord Gateway to connect
  sleep 3

  send_prompt "$session" "$location" "$prompt"
  echo "  Done: identity injected${role:+ (+$role)}"
}

# ── Hot-inject role (no restart) ──
do_inject() {
  local bot="$1" role="$2"

  if [[ -z "$role" ]]; then
    echo "Usage: $0 inject <bot> <role>"
    echo "Available roles: $(ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')"
    exit 1
  fi

  local role_file="$ROLES_DIR/$role.md"
  if [[ ! -f "$role_file" ]]; then
    echo "Error: unknown role '$role'"
    echo "Available: $(ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')"
    exit 1
  fi

  local location session
  location=$(get_field "$bot" "location")
  session="hq-$bot"

  # Check if bot is running
  if [[ "$location" == "local" ]]; then
    tmux has-session -t "$session" 2>/dev/null || { echo "Error: $bot is not running"; exit 1; }
  else
    local ssh_host remote_user
    ssh_host=$(location_to_ssh "$location")
    remote_user=$(location_to_user "$location")
    local running
    running=$(remote_cmd "$ssh_host" "$remote_user" "tmux has-session -t $session 2>/dev/null && echo yes || echo no")
    [[ "$running" == "yes" ]] || { echo "Error: $bot is not running at $location"; exit 1; }
  fi

  local prompt="You are now assigned an additional role. Read the following and apply it immediately. Do not reply with confirmation.

$(cat "$role_file")"

  send_prompt "$session" "$location" "$prompt"
  echo "Done: role '$role' injected into $bot"
}

# ── status ──
do_status() {
  echo "=== HQ Bot Fleet ==="
  for bot in $(jq -r '.[].name' "$POOL"); do
    local location session
    location=$(get_field "$bot" "location")
    session="hq-$bot"

    if [[ "$location" == "local" ]]; then
      if tmux has-session -t "$session" 2>/dev/null; then
        echo "  [on]  $bot (local) — tmux attach -t $session"
      else
        echo "  [off] $bot (local)"
      fi
    else
      local ssh_host remote_user
      ssh_host=$(location_to_ssh "$location")
      remote_user=$(location_to_user "$location")
      local remote
      remote=$(remote_cmd "$ssh_host" "$remote_user" "tmux has-session -t $session 2>/dev/null && echo running || echo stopped" || echo "unreachable")
      if [[ "$remote" == "running" ]]; then
        echo "  [on]  $bot ($location)"
      elif [[ "$remote" == "unreachable" ]]; then
        echo "  [??]  $bot ($location) — SSH unreachable"
      else
        echo "  [off] $bot ($location)"
      fi
    fi
  done
}

# ── start ──
do_start() {
  local bot="$1" custom_dir="$2" role="$3" location_override="$4"

  # Validate bot exists
  local exists
  exists=$(jq -r --arg b "$bot" '[.[] | select(.name == $b)] | length' "$POOL")
  if [[ "$exists" == "0" ]]; then
    echo "Error: unknown bot '$bot'"
    echo "Available: $ALL_BOTS"
    exit 1
  fi

  local token state_dir default_dir location
  token=$(get_token "$bot")
  state_dir=$(get_field "$bot" "state_dir")
  default_dir=$(get_field "$bot" "default_dir")
  location="${location_override:-$(get_field "$bot" "location")}"

  if [[ -z "$token" ]]; then
    echo "Error: $(get_field "$bot" "token_env") not set. Check $ENV_FILE"
    exit 1
  fi

  local work_dir="${custom_dir:-$default_dir}"
  local session="hq-$bot"

  if [[ "$location" == "local" ]]; then
    # ── Local start ──
    local expanded_work="${work_dir/#\~/$HOME}"
    local expanded_state="${state_dir/#\~/$HOME}"

    if [[ ! -d "$expanded_work" ]]; then
      echo "Error: directory does not exist '$expanded_work'"
      exit 1
    fi

    if tmux has-session -t "$session" 2>/dev/null; then
      echo "$bot is already running. Attach: tmux attach -t $session"
      exit 0
    fi

    local cmd="DISCORD_BOT_TOKEN=$token"
    [[ -n "$expanded_state" ]] && cmd="$cmd DISCORD_STATE_DIR=$expanded_state"
    cmd="$cmd claude --dangerously-skip-permissions --channels plugin:discord@claude-plugins-official"

    echo "Starting $bot (local)..."
    echo "  Working directory: $expanded_work"
    tmux new-session -d -s "$session" -c "$expanded_work" "$cmd"
    echo "Done: $bot started. Attach: tmux attach -t $session"
    inject_identity "$bot" "$session" "local" "$role" &

  else
    # ── Remote start ──
    local ssh_host remote_user
    ssh_host=$(location_to_ssh "$location")
    remote_user=$(location_to_user "$location")

    local running
    running=$(remote_cmd "$ssh_host" "$remote_user" "tmux has-session -t $session 2>/dev/null && echo yes || echo no")
    if [[ "$running" == "yes" ]]; then
      echo "$bot is already running at $location"
      exit 0
    fi

    local remote_start="export PATH=\$HOME/.bun/bin:\$PATH && DISCORD_BOT_TOKEN=$token"
    [[ -n "$state_dir" ]] && remote_start="$remote_start DISCORD_STATE_DIR=$state_dir"
    remote_start="$remote_start claude --dangerously-skip-permissions --channels plugin:discord@claude-plugins-official"

    echo "Starting $bot ($location via SSH)..."
    echo "  Working directory: $work_dir"
    remote_cmd "$ssh_host" "$remote_user" "tmux new-session -d -s $session -c $work_dir \"$remote_start\"" 2>&1
    echo "Done: $bot started at $location"
    inject_identity "$bot" "$session" "$location" "$role" &
  fi
}

# ── stop ──
do_stop() {
  local bot="$1" location_override="$2"

  local exists
  exists=$(jq -r --arg b "$bot" '[.[] | select(.name == $b)] | length' "$POOL")
  if [[ "$exists" == "0" ]]; then
    echo "Error: unknown bot '$bot'"
    exit 1
  fi

  local location session
  location="${location_override:-$(get_field "$bot" "location")}"
  session="hq-$bot"

  if [[ "$location" == "local" ]]; then
    tmux kill-session -t "$session" 2>/dev/null && echo "Done: $bot stopped" || echo "$bot is not running"
  else
    local ssh_host remote_user
    ssh_host=$(location_to_ssh "$location")
    remote_user=$(location_to_user "$location")
    remote_cmd "$ssh_host" "$remote_user" "tmux kill-session -t $session" 2>/dev/null && echo "Done: $bot stopped at $location" || echo "$bot is not running at $location"
  fi
}

# ── Parse arguments ──
parse_start_args() {
  local bot="$1"; shift
  local custom_dir="" role="" at=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --role)
        role="$2"; shift 2 ;;
      --at)
        at="$2"; shift 2 ;;
      *)
        custom_dir="$1"; shift ;;
    esac
  done

  # Validate --at against locations in pool
  if [[ -n "$at" ]]; then
    local valid
    valid=$(jq -r --arg l "$at" '[.[] | select(.location == $l)] | length' "$POOL")
    if [[ "$at" != "local" && "$valid" == "0" ]]; then
      echo "Error: unknown location '$at'"
      echo "Available: $ALL_LOCATIONS"
      exit 1
    fi
  fi

  do_start "$bot" "$custom_dir" "$role" "$at"
}

parse_stop_args() {
  local bot="$1"; shift
  local at=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --at)
        at="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  do_stop "$bot" "$at"
}

# ── Route ──
case "$ACTION" in
  start)
    [[ -z "$BOT" ]] && { echo "Usage: $0 start <bot> [work-dir] [--role <role>] [--at <location>]"; exit 1; }
    shift 2  # skip action and bot
    parse_start_args "$BOT" "$@"
    ;;
  stop)
    [[ -z "$BOT" ]] && { echo "Usage: $0 stop <bot> [--at <location>]"; exit 1; }
    shift 2
    parse_stop_args "$BOT" "$@"
    ;;
  inject)
    [[ -z "$BOT" ]] && { echo "Usage: $0 inject <bot> <role>"; exit 1; }
    do_inject "$BOT" "$EXTRA"
    ;;
  status)
    do_status
    ;;
  *)
    echo "HQ Bot Manager"
    echo ""
    echo "Usage:"
    echo "  $0 start <bot> [work-dir] [--role <role>] [--at <loc>]   Start bot"
    echo "  $0 stop <bot> [--at <loc>]                               Stop bot"
    echo "  $0 inject <bot> <role>                                   Hot-inject role"
    echo "  $0 status                                                Fleet status"
    echo ""
    echo "Bots: $ALL_BOTS"
    echo "Locations: $ALL_LOCATIONS"
    echo "Roles: $(ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')"
    echo ""
    echo "Examples:"
    echo "  $0 start pilot                              # Default location + dir"
    echo "  $0 start pilot ~/workspace/project          # Custom directory"
    echo "  $0 start pilot --role writer                # Start with role"
    echo "  $0 start pilot --at singapore               # Override location"
    echo "  $0 start forge --at local ~/workspace/sb    # Relocate + custom dir"
    echo "  $0 inject pilot writer                      # Hot-inject role"
    echo "  $0 stop pilot                               # Stop (default location)"
    echo "  $0 stop pilot --at singapore                # Stop at overridden location"
    echo "  $0 status"
    ;;
esac
