#!/bin/bash
# lib/remote.sh — SSH and remote command execution

# Run a command on a remote server, optionally as a specific user
remote_cmd() {
  local ssh_host="$1" remote_user="$2" cmd="$3"
  if [[ "$remote_user" == "$(whoami)" || -z "$remote_user" ]]; then
    ssh -o ConnectTimeout=5 "$ssh_host" "$cmd" 2>/dev/null
  else
    ssh -o ConnectTimeout=5 "$ssh_host" "su - $remote_user -c '$cmd'" 2>/dev/null
  fi
}

# Send a prompt string to a tmux session (local or remote)
send_prompt() {
  local session="$1" server="$2" prompt="$3"

  if [[ "$server" == "local" ]]; then
    tmux send-keys -t "$session" "$prompt" Enter
  else
    local ssh_host remote_user
    ssh_host=$(server_ssh_host "$server") || return 1
    remote_user=$(server_user "$server")
    # Write to temp file on remote to avoid escaping issues
    local remote_tmp="/tmp/fleet-prompt-$$.md"
    echo "$prompt" | ssh -o ConnectTimeout=5 "$ssh_host" "cat > $remote_tmp" 2>/dev/null
    remote_cmd "$ssh_host" "$remote_user" "tmux send-keys -t $session \"\$(cat $remote_tmp)\" Enter" 2>&1
    ssh -o ConnectTimeout=5 "$ssh_host" "rm -f $remote_tmp" 2>/dev/null
  fi
}

# Check if a tmux session exists (local or remote)
session_exists() {
  local session="$1" server="$2"

  if [[ "$server" == "local" ]]; then
    tmux has-session -t "$session" 2>/dev/null
  else
    local ssh_host remote_user result
    ssh_host=$(server_ssh_host "$server") || return 1
    remote_user=$(server_user "$server")
    result=$(remote_cmd "$ssh_host" "$remote_user" "tmux has-session -t $session 2>/dev/null && echo yes || echo no" || echo "unreachable")
    [[ "$result" == "yes" ]]
  fi
}

# Get session state: "running", "stopped", or "unreachable"
session_state() {
  local session="$1" server="$2"

  if [[ "$server" == "local" ]]; then
    tmux has-session -t "$session" 2>/dev/null && echo "running" || echo "stopped"
  else
    local ssh_host remote_user result
    ssh_host=$(server_ssh_host "$server") || { echo "unreachable"; return; }
    remote_user=$(server_user "$server")
    result=$(remote_cmd "$ssh_host" "$remote_user" "tmux has-session -t $session 2>/dev/null && echo running || echo stopped" || echo "unreachable")
    echo "$result"
  fi
}
