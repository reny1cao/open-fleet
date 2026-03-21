#!/bin/bash
# lib/init.sh — Interactive fleet initialization
#
# Guides user through: token validation → server/channel discovery →
# agent definition → fleet.yaml + .env generation.

DISCORD_API="https://discord.com/api/v10"

# ── Discord API helpers ───────────────────────────────────────────────────────

discord_get() {
  local token="$1" endpoint="$2"
  curl -sf -H "Authorization: Bot $token" "$DISCORD_API$endpoint"
}

validate_token() {
  local token="$1"
  local response
  response=$(discord_get "$token" "/users/@me") || return 1
  echo "$response"
}

get_bot_info() {
  local json="$1"
  local name id
  name=$(echo "$json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['username'])" 2>/dev/null)
  id=$(echo "$json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id'])" 2>/dev/null)
  echo "$name:$id"
}

get_guilds() {
  local token="$1"
  discord_get "$token" "/users/@me/guilds"
}

get_channels() {
  local token="$1" guild_id="$2"
  discord_get "$token" "/guilds/$guild_id/channels"
}

# ── Interactive prompts ───────────────────────────────────────────────────────

prompt() {
  local message="$1" default="${2:-}"
  local ans
  if [[ -n "$default" ]]; then
    read -rp "  $message [$default]: " ans
    echo "${ans:-$default}"
  else
    read -rp "  $message: " ans
    echo "$ans"
  fi
}

prompt_secret() {
  local message="$1"
  local ans
  read -rsp "  $message: " ans
  echo ""
  echo "$ans"
}

confirm() {
  local message="$1"
  local ans
  read -rp "  $message [Y/n]: " ans
  [[ -z "$ans" || "$ans" =~ ^[Yy] ]]
}

# ── Main init flow ────────────────────────────────────────────────────────────

do_init() {
  local target_dir="${1:-$(pwd)}"

  echo ""
  printf "${bold}fleet init${reset} — First-time setup\n"
  echo "──────────────────────────────────"

  # Check if fleet.yaml already exists
  if [[ -f "$target_dir/fleet.yaml" ]]; then
    echo ""
    warn "fleet.yaml already exists in $target_dir"
    if ! confirm "Overwrite?"; then
      echo "  Cancelled."
      exit 0
    fi
  fi

  # ── Step 1: Prerequisites ──
  step "[1/5] Checking prerequisites"

  local missing=()
  for cmd in python3 tmux curl; do
    if command -v "$cmd" &>/dev/null; then
      ok "$cmd"
    else
      fail "$cmd — not found"
      missing+=("$cmd")
    fi
  done

  # Check PyYAML
  if python3 -c "import yaml" 2>/dev/null; then
    ok "PyYAML"
  else
    fail "PyYAML — not installed (pip3 install pyyaml)"
    missing+=("pyyaml")
  fi

  # Check Claude Code
  if command -v claude &>/dev/null; then
    ok "claude"
  else
    warn "claude — not found (optional for init, required for start)"
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo ""
    fail "Missing: ${missing[*]}"
    echo "  Install them first, then re-run fleet init."
    exit 1
  fi

  # ── Step 2: Discord configuration ──
  step "[2/5] Discord configuration"

  local tokens=() bot_names=() bot_ids=()
  local first_token=""

  echo "  Paste your first bot token (creates the connection to Discord)."
  echo "  Get tokens: https://discord.com/developers/applications → Bot → Reset Token"
  echo ""

  local token
  token=$(prompt_secret "Bot token")

  if [[ -z "$token" ]]; then
    fail "No token provided"
    exit 1
  fi

  echo "  Validating..."
  local bot_json
  bot_json=$(validate_token "$token")
  if [[ $? -ne 0 || -z "$bot_json" ]]; then
    fail "Token rejected (invalid or expired)"
    echo "  Check your token and try again."
    exit 1
  fi

  local bot_info name_id bot_name bot_id
  bot_info=$(get_bot_info "$bot_json")
  bot_name="${bot_info%%:*}"
  bot_id="${bot_info##*:}"
  ok "Bot \"$bot_name\" (ID: $bot_id)"

  first_token="$token"
  tokens+=("$token")
  bot_names+=("$bot_name")
  bot_ids+=("$bot_id")

  # Discover server
  echo ""
  echo "  Discovering Discord servers..."
  local guilds_json
  guilds_json=$(get_guilds "$token")

  local guild_count guild_id guild_name
  guild_count=$(echo "$guilds_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  if [[ "$guild_count" == "0" ]]; then
    fail "Bot is not in any server."
    echo "  Invite it first: https://discord.com/oauth2/authorize?client_id=$bot_id&scope=bot&permissions=68608"
    exit 1
  fi

  if [[ "$guild_count" == "1" ]]; then
    guild_id=$(echo "$guilds_json" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
    guild_name=$(echo "$guilds_json" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['name'])" 2>/dev/null)
    ok "Server: $guild_name (ID: $guild_id)"
  else
    echo "  Bot is in $guild_count servers:"
    echo "$guilds_json" | python3 -c "
import json, sys
guilds = json.load(sys.stdin)
for i, g in enumerate(guilds, 1):
    print(f'    {i}. {g[\"name\"]} (ID: {g[\"id\"]})')
" 2>/dev/null
    local choice
    choice=$(prompt "Select server" "1")
    guild_id=$(echo "$guilds_json" | python3 -c "import json,sys; print(json.load(sys.stdin)[int(sys.argv[1])-1]['id'])" "$choice" 2>/dev/null)
    guild_name=$(echo "$guilds_json" | python3 -c "import json,sys; print(json.load(sys.stdin)[int(sys.argv[1])-1]['name'])" "$choice" 2>/dev/null)
    ok "Server: $guild_name (ID: $guild_id)"
  fi

  # Discover channels
  echo ""
  echo "  Fetching channels..."
  local channels_json
  channels_json=$(get_channels "$token" "$guild_id")

  # Show text channels
  echo "$channels_json" | python3 -c "
import json, sys
channels = [c for c in json.load(sys.stdin) if c['type'] == 0]  # text channels only
for c in channels:
    print(f'    #{c[\"name\"]} ({c[\"id\"]})')
" 2>/dev/null

  echo ""
  echo "  Map your channels (paste channel IDs, or press Enter to skip):"

  local ch_general ch_dev ch_infra
  ch_general=$(prompt "general channel ID" "")
  ch_dev=$(prompt "dev channel ID" "")
  ch_infra=$(prompt "infra channel ID" "")

  local user_id
  echo ""
  user_id=$(prompt "Your Discord user ID" "")

  # ── Step 3: Define agents ──
  step "[3/5] Define your fleet"

  local agent_names=() agent_token_envs=() agent_servers=() agent_roles=() agent_state_dirs=()
  local agent_index=1
  local fleet_name

  fleet_name=$(prompt "Fleet name (used as tmux prefix)" "my-fleet")

  # First agent uses the token we already validated
  local agent_name
  agent_name=$(prompt "Agent 1 name" "hub")
  local agent_role
  agent_role=$(prompt "Agent 1 role" "hub")
  local agent_server
  agent_server=$(prompt "Agent 1 server" "local")
  local agent_token_env="DISCORD_BOT_TOKEN_$(echo "$agent_name" | tr '[:lower:]-' '[:upper:]_')"

  agent_names+=("$agent_name")
  agent_token_envs+=("$agent_token_env")
  agent_servers+=("$agent_server")
  agent_roles+=("$agent_role")
  agent_state_dirs+=("")

  # Additional agents
  while confirm "Add another agent?"; do
    agent_index=$((agent_index + 1))

    agent_name=$(prompt "Agent $agent_index name" "worker-$((agent_index - 1))")

    local new_token
    new_token=$(prompt_secret "Agent $agent_index token")

    if [[ -n "$new_token" ]]; then
      echo "  Validating..."
      local new_json new_info new_bot_name new_bot_id
      new_json=$(validate_token "$new_token")
      if [[ $? -ne 0 || -z "$new_json" ]]; then
        fail "Token rejected"
        continue
      fi
      new_info=$(get_bot_info "$new_json")
      new_bot_name="${new_info%%:*}"
      new_bot_id="${new_info##*:}"
      ok "Bot \"$new_bot_name\" (ID: $new_bot_id)"
      tokens+=("$new_token")
      bot_names+=("$new_bot_name")
      bot_ids+=("$new_bot_id")
    fi

    agent_role=$(prompt "Agent $agent_index role" "worker")
    agent_server=$(prompt "Agent $agent_index server" "local")
    agent_token_env="DISCORD_BOT_TOKEN_$(echo "$agent_name" | tr '[:lower:]-' '[:upper:]_')"

    # State dir needed if same machine has multiple bots
    local state_dir=""
    local same_server_count=0
    for s in "${agent_servers[@]}"; do
      [[ "$s" == "$agent_server" ]] && same_server_count=$((same_server_count + 1))
    done
    if [[ $same_server_count -gt 0 ]]; then
      state_dir="~/.fleet/state/discord-$agent_name"
      info "Auto-set state_dir: $state_dir (multi-instance on $agent_server)"
    fi

    agent_names+=("$agent_name")
    agent_token_envs+=("$agent_token_env")
    agent_servers+=("$agent_server")
    agent_roles+=("$agent_role")
    agent_state_dirs+=("$state_dir")

    # If new server, collect SSH info
    if [[ "$agent_server" != "local" ]]; then
      local known_server=false
      # Check if we already collected this server's SSH info
      if grep -q "^  $agent_server:" "$target_dir/fleet.yaml" 2>/dev/null; then
        known_server=true
      fi
      # Simple tracking via a temp var
    fi
  done

  # Collect SSH info for non-local servers
  local unique_servers=()
  for s in "${agent_servers[@]}"; do
    if [[ "$s" != "local" ]]; then
      local already=false
      for u in "${unique_servers[@]}"; do
        [[ "$u" == "$s" ]] && already=true
      done
      $already || unique_servers+=("$s")
    fi
  done

  declare -A server_ssh_hosts server_users
  for s in "${unique_servers[@]}"; do
    echo ""
    info "Server '$s' needs SSH configuration:"
    server_ssh_hosts[$s]=$(prompt "  SSH host for $s (alias or user@host)" "$s")
    server_users[$s]=$(prompt "  Remote user for $s" "dev")
  done

  # ── Step 4: Generate config files ──
  step "[4/5] Generating config files"

  # Generate fleet.yaml
  {
    echo "fleet:"
    echo "  name: $fleet_name"
    echo ""
    echo "discord:"
    echo "  server_id: \"$guild_id\""
    echo "  user_id: \"${user_id:-YOUR_DISCORD_USER_ID}\""
    echo "  channels:"
    [[ -n "$ch_general" ]] && echo "    general: \"$ch_general\""
    [[ -n "$ch_dev" ]] && echo "    dev: \"$ch_dev\""
    [[ -n "$ch_infra" ]] && echo "    infra: \"$ch_infra\""
    echo ""

    if [[ ${#unique_servers[@]} -gt 0 ]]; then
      echo "servers:"
      for s in "${unique_servers[@]}"; do
        echo "  $s:"
        echo "    ssh_host: ${server_ssh_hosts[$s]}"
        echo "    user: ${server_users[$s]}"
      done
      echo ""
    fi

    echo "defaults:"
    echo "  agent: claude-code"
    echo "  runtime: claude"
    echo "  workspace: ~/workspace"
    echo "  channel_plugin: plugin:discord@claude-plugins-official"
    echo "  permissions: dangerously-skip"
    echo ""
    echo "agents:"

    for i in "${!agent_names[@]}"; do
      echo "  ${agent_names[$i]}:"
      echo "    token_env: ${agent_token_envs[$i]}"
      echo "    role: ${agent_roles[$i]}"
      echo "    server: ${agent_servers[$i]}"
      echo "    identity: identities/${agent_names[$i]}.md"
      [[ -n "${agent_state_dirs[$i]}" ]] && echo "    state_dir: ${agent_state_dirs[$i]}"
    done
  } > "$target_dir/fleet.yaml"
  ok "fleet.yaml"

  # Generate .env
  {
    echo "# Discord bot tokens — generated by fleet init"
    for i in "${!agent_names[@]}"; do
      if [[ $i -lt ${#tokens[@]} ]]; then
        echo "${agent_token_envs[$i]}=${tokens[$i]}"
      else
        echo "${agent_token_envs[$i]}=PASTE_TOKEN_HERE"
      fi
    done
  } > "$target_dir/.env"
  ok ".env (${#tokens[@]} token(s))"

  # Generate identity stubs
  mkdir -p "$target_dir/identities"
  for i in "${!agent_names[@]}"; do
    local id_file="$target_dir/identities/${agent_names[$i]}.md"
    if [[ ! -f "$id_file" ]]; then
      local display_name="${agent_names[$i]}"
      local display_role="${agent_roles[$i]}"
      local display_bot_id=""
      [[ $i -lt ${#bot_ids[@]} ]] && display_bot_id="${bot_ids[$i]}"
      {
        echo "You are **${display_name}**, a ${display_role} in the fleet. Bot ID \`${display_bot_id:-YOUR_BOT_ID}\`."
        echo ""
        echo "## Role"
        echo ""
        echo "${display_role}"
        echo ""
        echo "## Team"
        echo ""
        for j in "${!agent_names[@]}"; do
          if [[ $j -ne $i ]]; then
            local peer_id=""
            [[ $j -lt ${#bot_ids[@]} ]] && peer_id="${bot_ids[$j]}"
            echo "- ${agent_names[$j]} (\`${peer_id:-BOT_ID}\`) — ${agent_servers[$j]} — ${agent_roles[$j]}"
          fi
        done
        echo ""
        [[ -n "$user_id" ]] && echo "User: \`$user_id\`"
        echo ""
        echo "## Channels"
        echo ""
        [[ -n "$ch_general" ]] && echo "- #general (\`$ch_general\`)"
        [[ -n "$ch_dev" ]] && echo "- #dev (\`$ch_dev\`)"
        [[ -n "$ch_infra" ]] && echo "- #infra (\`$ch_infra\`)"
        echo ""
        echo "## Rules"
        echo ""
        echo "- **Always reply via Discord reply tool** — terminal output does not reach Discord"
        echo "- Report concisely, conclusions first"
      } > "$id_file"
      ok "identities/${agent_names[$i]}.md"
    else
      info "identities/${agent_names[$i]}.md (already exists, skipped)"
    fi
  done

  # ── Step 5: Patch check ──
  step "[5/5] Discord plugin patches"

  local plugin_dir="$HOME/.claude/plugins/cache/claude-plugins-official/discord/0.0.1"
  if [[ -f "$plugin_dir/server.ts" ]]; then
    if grep -q "DISCORD_STATE_DIR" "$plugin_dir/server.ts" 2>/dev/null; then
      ok "STATE_DIR patch"
    else
      warn "STATE_DIR patch missing — run: fleet doctor"
    fi
    if grep -q "PARTNER_BOT_IDS" "$plugin_dir/server.ts" 2>/dev/null; then
      ok "PARTNER_BOT_IDS patch"
    else
      warn "PARTNER_BOT_IDS patch missing — run: fleet doctor"
    fi
  else
    warn "Discord plugin not installed — run: claude plugin install discord@claude-plugins-official"
  fi

  # ── Done ──
  echo ""
  printf "${bold}✔ Fleet initialized!${reset}\n"
  echo ""
  echo "  Next:"
  echo "    fleet doctor        # verify everything is configured"
  echo "    fleet start ${agent_names[0]}      # start your first agent"
  echo ""

  # Generate OAuth2 invite URLs for bots not yet in the server
  if [[ ${#bot_ids[@]} -gt 0 ]]; then
    echo "  Bot invite URLs (in case you need them):"
    for i in "${!bot_ids[@]}"; do
      echo "    ${bot_names[$i]}: https://discord.com/oauth2/authorize?client_id=${bot_ids[$i]}&scope=bot&permissions=68608"
    done
    echo ""
  fi
}
