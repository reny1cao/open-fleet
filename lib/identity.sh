#!/bin/bash
# lib/identity.sh — Identity and role injection

IDENTITIES_DIR="${FLEET_DIR}/identities"
ROLES_DIR="${IDENTITIES_DIR}/roles"

# Inject base identity (+ optional role) after startup
inject_identity() {
  local agent="$1" session="$2" server="$3" role="$4"

  # Resolve identity file
  local identity_path
  identity_path=$(agent_get "$agent" "identity" 2>/dev/null) || identity_path="identities/$agent.md"

  # Make path absolute relative to FLEET_DIR
  [[ "$identity_path" != /* ]] && identity_path="$FLEET_DIR/$identity_path"

  if [[ ! -f "$identity_path" ]]; then
    $JSON_OUTPUT || $QUIET_OUTPUT || echo "  Warning: no identity file: $identity_path"
    return
  fi

  local prompt="Read the following identity and remember it. Act as this identity in all subsequent interactions. Do not reply with confirmation — wait for Discord messages.

$(cat "$identity_path")"

  # Append role if specified
  if [[ -n "$role" ]]; then
    local role_file="$ROLES_DIR/$role.md"
    if [[ -f "$role_file" ]]; then
      prompt="$prompt

---

$(cat "$role_file")"
    else
      $JSON_OUTPUT || $QUIET_OUTPUT || echo "  Warning: unknown role: $role (available: $(available_roles))"
    fi
  fi

  $JSON_OUTPUT || $QUIET_OUTPUT || echo "  Injecting identity..."

  # Wait for Claude to fully initialize (poll, max 60s)
  local waited=0 max_wait=60
  while [[ $waited -lt $max_wait ]]; do
    local pane_output
    if [[ "$server" == "local" ]]; then
      pane_output=$(tmux capture-pane -t "$session" -p 2>/dev/null)
    else
      local ssh_host remote_user
      ssh_host=$(server_ssh_host "$server")
      remote_user=$(server_user "$server")
      pane_output=$(remote_cmd "$ssh_host" "$remote_user" "tmux capture-pane -t $session -p 2>/dev/null")
    fi

    if echo "$pane_output" | grep -q "Listening for channel messages"; then
      break
    fi
    sleep 3
    waited=$((waited + 3))
  done

  if [[ $waited -ge $max_wait ]]; then
    $JSON_OUTPUT || $QUIET_OUTPUT || echo "  Warning: timeout (${max_wait}s), still attempting injection"
  fi

  # Extra wait for Discord Gateway to connect
  sleep 3

  send_prompt "$session" "$server" "$prompt"
  $JSON_OUTPUT || $QUIET_OUTPUT || echo "  Done: identity injected${role:+ (+$role)}"
}

# Hot-inject a role into a running agent
hot_inject_role() {
  local agent="$1" role="$2"

  if [[ -z "$role" ]]; then
    echo "Usage: fleet inject <agent> <role>"
    echo "Available roles: $(available_roles)"
    exit 1
  fi

  local role_file="$ROLES_DIR/$role.md"
  if [[ ! -f "$role_file" ]]; then
    echo "Error: unknown role '$role'"
    echo "Available: $(available_roles)"
    exit 1
  fi

  local server session
  server=$(agent_get "$agent" "server") || server="local"
  session=$(session_name "$agent")

  if ! session_exists "$session" "$server"; then
    echo "Error: $agent is not running"
    exit 1
  fi

  local prompt="You are now assigned an additional role. Read the following and apply it immediately. Do not reply with confirmation.

$(cat "$role_file")"

  send_prompt "$session" "$server" "$prompt"
  echo "Done: role '$role' injected into $agent"
}

# List available role names
available_roles() {
  if [[ -d "$ROLES_DIR" ]]; then
    ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' '
  fi
}
