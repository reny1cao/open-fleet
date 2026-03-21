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

# Get the application ID (for OAuth2 invite URLs — more reliable than bot user ID)
get_application_id() {
  local token="$1"
  local app_json
  app_json=$(discord_get "$token" "/oauth2/applications/@me") || { echo ""; return; }
  echo "$app_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null
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
  local ans=""
  local char=""

  printf "  %s: " "$message" >&2

  # Read char-by-char: show ● for each character, support backspace + paste
  while IFS= read -rs -n1 char; do
    # Enter → done
    [[ -z "$char" ]] && break
    # Backspace
    if [[ "$char" == $'\x7f' || "$char" == $'\b' ]]; then
      if [[ -n "$ans" ]]; then
        ans="${ans%?}"
        printf '\b \b' >&2
      fi
    else
      ans+="$char"
      printf '●' >&2
    fi
  done
  echo "" >&2

  # Show masked confirmation
  if [[ ${#ans} -gt 8 ]]; then
    printf "  → received: %s●●●●%s (%d chars)\n" "${ans:0:4}" "${ans: -4}" "${#ans}" >&2
  elif [[ -n "$ans" ]]; then
    printf "  → received: ●●●● (%d chars)\n" "${#ans}" >&2
  fi
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
  # ── Parse flags ──
  local flag_name="" flag_channel="" flag_tokens="" flag_agents="" flag_force=false
  local flag_remote=false
  local target_dir="$(pwd)"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name)    flag_name="$2"; shift 2 ;;
      --channel) flag_channel="$2"; shift 2 ;;
      --token)   flag_tokens="${flag_tokens:+$flag_tokens,}$2"; shift 2 ;;
      --agent)   flag_agents="${flag_agents:+$flag_agents,}$2"; shift 2 ;;
      --force)   flag_force=true; shift ;;
      --remote)  flag_remote=true; shift ;;
      --dir)     target_dir="$2"; shift 2 ;;
      *)         shift ;;
    esac
  done

  # Non-interactive mode: triggered when --token is provided (channel auto-detected)
  local non_interactive=false
  if [[ -n "$flag_tokens" ]]; then
    non_interactive=true
  fi

  if $non_interactive; then
    do_init_noninteractive "$target_dir" "$flag_name" "$flag_channel" "$flag_tokens" "$flag_agents" "$flag_force"
    return
  fi

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

  echo "  How to get a bot token:"
  echo "    1. Go to https://discord.com/developers/applications"
  echo "    2. Click your app → Bot tab → Reset Token → Copy"
  echo "    3. Also enable 'Message Content Intent' (under Privileged Gateway Intents)"
  echo ""
  echo "  Paste the token below and press Enter."
  echo ""

  local token
  token=$(prompt_secret "Bot token")

  if [[ -z "$token" ]]; then
    fail "No token provided"
    exit 1
  fi

  echo "  Validating..."
  local bot_json
  if ! bot_json=$(validate_token "$token") || [[ -z "$bot_json" ]]; then
    fail "Token rejected (invalid or expired)"
    echo "  Check your token and try again."
    exit 1
  fi

  local bot_info name_id bot_name bot_id
  bot_info=$(get_bot_info "$bot_json")
  bot_name="${bot_info%%:*}"
  bot_id="${bot_info##*:}"
  local app_id
  app_id=$(get_application_id "$token")
  [[ -z "$app_id" ]] && app_id="$bot_id"  # fallback to bot user ID
  ok "Bot \"$bot_name\" (App ID: $app_id)"

  first_token="$token"
  tokens+=("$token")
  bot_names+=("$bot_name")
  bot_ids+=("$app_id")

  # Discover server
  echo ""
  echo "  Discovering Discord servers..."
  local guilds_json
  guilds_json=$(get_guilds "$token")

  local guild_count guild_id guild_name
  guild_count=$(echo "$guilds_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  if [[ "$guild_count" == "0" ]]; then
    warn "Bot is not in any server yet."
    echo ""
    echo "  Invite it now — open this link in your browser:"
    echo "  https://discord.com/oauth2/authorize?client_id=$bot_id&scope=bot&permissions=117840"
    echo ""
    echo "  Select your server, click Authorize, then come back here."
    read -rp "  Press Enter after inviting the bot... "

    # Retry discovery
    guilds_json=$(get_guilds "$token")
    guild_count=$(echo "$guilds_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

    if [[ "$guild_count" == "0" ]]; then
      fail "Still not in any server. Check the invite link and try again."
      echo "  You can re-run: fleet init"
      exit 1
    fi
    ok "Bot joined a server!"
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

  # Build channel list (text channels only)
  local channel_names channel_ids
  channel_names=()
  channel_ids=()
  while IFS=: read -r ch_name ch_id; do
    channel_names+=("$ch_name")
    channel_ids+=("$ch_id")
  done < <(echo "$channels_json" | python3 -c "
import json, sys
channels = [c for c in json.load(sys.stdin) if c['type'] == 0]
for c in channels:
    print(f'{c[\"name\"]}:{c[\"id\"]}')
" 2>/dev/null)

  # Show numbered list
  for i in "${!channel_names[@]}"; do
    echo "    $((i+1)). #${channel_names[$i]}"
  done

  echo ""
  echo "  Which channel should the fleet use?"
  local ch_choice
  ch_choice=$(prompt "Select channel number" "1")
  local ch_idx=$((ch_choice - 1))
  local fleet_channel_id="${channel_ids[$ch_idx]}"
  local fleet_channel_name="${channel_names[$ch_idx]}"
  ok "Fleet channel: #$fleet_channel_name"

  # Get server owner ID automatically
  local user_id
  user_id=$(echo "$guilds_json" | python3 -c "
import json, sys
guilds = json.load(sys.stdin)
for g in guilds:
    if g['id'] == sys.argv[1]:
        print(g.get('owner_id', g.get('owner', {}).get('id', '')))
        break
" "$guild_id" 2>/dev/null || echo "")

  if [[ -n "$user_id" ]]; then
    ok "Server owner: $user_id"
  else
    # Fallback: get from guild detail endpoint
    local guild_detail
    guild_detail=$(discord_get "$token" "/guilds/$guild_id")
    user_id=$(echo "$guild_detail" | python3 -c "import json,sys; print(json.load(sys.stdin).get('owner_id',''))" 2>/dev/null || echo "")
    if [[ -n "$user_id" ]]; then
      ok "Server owner: $user_id"
    else
      user_id=$(prompt "Your Discord user ID (could not auto-detect)" "")
    fi
  fi

  # ── Step 3: Define agents ──
  step "[3/5] Define your fleet"

  local agent_names=() agent_token_envs=() agent_servers=() agent_roles=() agent_state_dirs=()
  local agent_index=1
  local fleet_name

  fleet_name=$(prompt "Fleet name (used as tmux prefix)" "my-fleet")

  # Ask for workspace
  local fleet_workspace
  fleet_workspace=$(prompt "Workspace directory (where agents work)" "$(pwd)")

  # First agent uses the token we already validated
  local agent_name
  agent_name=$(prompt "Agent 1 name" "hub")
  local agent_role
  agent_role=$(prompt "Agent 1 role" "hub")
  local agent_server="local"
  if $flag_remote; then
    agent_server=$(prompt "Agent 1 server" "local")
  fi
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
      local new_app_id
      new_app_id=$(get_application_id "$new_token")
      [[ -z "$new_app_id" ]] && new_app_id="$new_bot_id"
      ok "Bot \"$new_bot_name\" (App ID: $new_app_id)"
      tokens+=("$new_token")
      bot_names+=("$new_bot_name")
      bot_ids+=("$new_app_id")
    fi

    agent_role=$(prompt "Agent $agent_index role" "worker")
    agent_server="local"
    if $flag_remote; then
      agent_server=$(prompt "Agent $agent_index server" "local")
    fi
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
    echo "  channel_id: \"$fleet_channel_id\"    # #$fleet_channel_name"
    echo "  user_id: \"${user_id:-YOUR_DISCORD_USER_ID}\""
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
    echo "  workspace: ${fleet_workspace:-~/workspace}"
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
        echo "## Channel"
        echo ""
        echo "- #$fleet_channel_name (\`$fleet_channel_id\`)"
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

  # ── Generate access.json for each bot ──
  # Each bot needs an access.json that allows the user and all other bots
  for i in "${!agent_names[@]}"; do
    local state_dir="${agent_state_dirs[$i]}"
    # Default state dir if not set
    if [[ -z "$state_dir" ]]; then
      state_dir="$HOME/.claude/channels/discord"
    else
      state_dir="${state_dir/#\~/$HOME}"
    fi
    mkdir -p "$state_dir"

    local access_file="$state_dir/access.json"
    if [[ ! -f "$access_file" ]]; then
      # Build allowed users list: user + all bot IDs
      local allowed_json="["
      local first_entry=true
      # Add user
      if [[ -n "$user_id" ]]; then
        allowed_json="$allowed_json\"$user_id\""
        first_entry=false
      fi
      # Add all bot IDs
      for j in "${!bot_ids[@]}"; do
        if [[ $j -ne $i ]]; then  # don't add self
          $first_entry || allowed_json="$allowed_json,"
          allowed_json="$allowed_json\"${bot_ids[$j]}\""
          first_entry=false
        fi
      done
      allowed_json="$allowed_json]"

      cat > "$access_file" <<EOACCESS
{
  "policy": "whitelist",
  "requireMention": true,
  "allowedUserIds": $allowed_json
}
EOACCESS
      ok "access.json for ${agent_names[$i]}"
    else
      info "access.json for ${agent_names[$i]} (already exists)"
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
      echo "    ${bot_names[$i]}: https://discord.com/oauth2/authorize?client_id=${bot_ids[$i]}&scope=bot&permissions=117840"
    done
    echo ""
  fi
}

# ── Non-interactive init ──────────────────────────────────────────────────────
# Usage:
#   fleet init --token TOKEN1 --token TOKEN2 --channel 123 --name my-fleet
#   fleet init --token TOKEN1 --channel 123 --agent hub:local:hub

do_init_noninteractive() {
  local target_dir="$1" fleet_name="${2:-my-fleet}" channel_id="$3" tokens_csv="$4" agents_csv="$5" force="$6"

  # Check existing config
  if [[ -f "$target_dir/fleet.yaml" && "$force" != "true" ]]; then
    echo "Error: fleet.yaml already exists. Use --force to overwrite." >&2
    exit 5
  fi

  # Parse tokens
  IFS=',' read -ra tokens <<< "$tokens_csv"
  if [[ ${#tokens[@]} -eq 0 ]]; then
    echo "Error: at least one --token required" >&2
    exit 2
  fi

  # Validate tokens and get bot info
  local bot_names=() bot_ids=()
  for token in "${tokens[@]}"; do
    local bot_json
    if ! bot_json=$(validate_token "$token") || [[ -z "$bot_json" ]]; then
      echo "Error: token rejected (starts with ${token:0:4}...)" >&2
      exit 4
    fi
    local info
    info=$(get_bot_info "$bot_json")
    bot_names+=("${info%%:*}")
    local app_id
    app_id=$(get_application_id "$token")
    [[ -z "$app_id" ]] && app_id="${info##*:}"
    bot_ids+=("$app_id")
  done

  # Parse agent definitions (format: name:server:role)
  local agent_names=() agent_servers=() agent_roles=()
  if [[ -n "$agents_csv" ]]; then
    IFS=',' read -ra agent_defs <<< "$agents_csv"
    for def in "${agent_defs[@]}"; do
      IFS=':' read -r a_name a_server a_role <<< "$def"
      agent_names+=("${a_name:-agent-$((${#agent_names[@]}+1))}")
      agent_servers+=("${a_server:-local}")
      agent_roles+=("${a_role:-worker}")
    done
  else
    # Default: first token = hub, rest = workers
    agent_names+=("hub")
    agent_servers+=("local")
    agent_roles+=("hub")
    for i in $(seq 2 ${#tokens[@]}); do
      agent_names+=("worker-$((i-1))")
      agent_servers+=("local")
      agent_roles+=("worker")
    done
  fi

  # Get owner ID and auto-detect channel if not provided
  local user_id=""
  local guilds_json guild_id
  guilds_json=$(get_guilds "${tokens[0]}" 2>/dev/null)
  if [[ -n "$guilds_json" ]]; then
    user_id=$(echo "$guilds_json" | python3 -c "import json,sys; g=json.load(sys.stdin); print(g[0].get('owner_id','') if g else '')" 2>/dev/null || echo "")
    guild_id=$(echo "$guilds_json" | python3 -c "import json,sys; g=json.load(sys.stdin); print(g[0]['id'] if g else '')" 2>/dev/null || echo "")
  fi

  # Auto-detect channel if not provided
  if [[ -z "$channel_id" && -n "$guild_id" ]]; then
    local channels_json
    channels_json=$(get_channels "${tokens[0]}" "$guild_id" 2>/dev/null)
    if [[ -n "$channels_json" ]]; then
      channel_id=$(echo "$channels_json" | python3 -c "
import json, sys
channels = [c for c in json.load(sys.stdin) if c['type'] == 0]
print(channels[0]['id'] if channels else '')
" 2>/dev/null || echo "")
    fi
  fi

  # Generate fleet.yaml
  {
    echo "fleet:"
    echo "  name: $fleet_name"
    echo ""
    echo "discord:"
    echo "  channel_id: \"$channel_id\""
    [[ -n "$user_id" ]] && echo "  user_id: \"$user_id\""
    echo ""
    echo "defaults:"
    echo "  agent: claude-code"
    echo "  runtime: claude"
    echo "  workspace: ${fleet_workspace:-~/workspace}"
    echo "  channel_plugin: plugin:discord@claude-plugins-official"
    echo "  permissions: dangerously-skip"
    echo ""
    echo "agents:"
    for i in "${!agent_names[@]}"; do
      local env_name="DISCORD_BOT_TOKEN_$(echo "${agent_names[$i]}" | tr '[:lower:]-' '[:upper:]_')"
      echo "  ${agent_names[$i]}:"
      echo "    token_env: $env_name"
      echo "    role: ${agent_roles[$i]}"
      echo "    server: ${agent_servers[$i]}"
      echo "    identity: identities/${agent_names[$i]}.md"
    done
  } > "$target_dir/fleet.yaml"

  # Generate .env
  {
    echo "# Discord bot tokens — generated by fleet init"
    for i in "${!agent_names[@]}"; do
      local env_name="DISCORD_BOT_TOKEN_$(echo "${agent_names[$i]}" | tr '[:lower:]-' '[:upper:]_')"
      if [[ $i -lt ${#tokens[@]} ]]; then
        echo "$env_name=${tokens[$i]}"
      else
        echo "$env_name=PASTE_TOKEN_HERE"
      fi
    done
  } > "$target_dir/.env"

  # Generate identity stubs
  mkdir -p "$target_dir/identities"
  for i in "${!agent_names[@]}"; do
    local id_file="$target_dir/identities/${agent_names[$i]}.md"
    if [[ ! -f "$id_file" || "$force" == "true" ]]; then
      local display_bot_id=""
      [[ $i -lt ${#bot_ids[@]} ]] && display_bot_id="${bot_ids[$i]}"
      {
        echo "You are **${agent_names[$i]}**, a ${agent_roles[$i]} in the fleet. Bot ID \`${display_bot_id:-YOUR_BOT_ID}\`."
        echo ""
        echo "## Rules"
        echo ""
        echo "- **Always reply via Discord reply tool** — terminal output does not reach Discord"
        echo "- Report concisely, conclusions first"
      } > "$id_file"
    fi
  done

  echo "fleet.yaml, .env, and identities generated in $target_dir"
}

# ── Add agent to existing fleet ──────────────────────────────────────────────
# Usage:
#   fleet add-agent                          # interactive
#   fleet add-agent --token TOKEN --name worker-2 --role worker

do_add_agent() {
  require_config

  local flag_token="" flag_name="" flag_role="" flag_server="local"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --token)  flag_token="$2"; shift 2 ;;
      --name)   flag_name="$2"; shift 2 ;;
      --role)   flag_role="$2"; shift 2 ;;
      --server) flag_server="$2"; shift 2 ;;
      *)        shift ;;
    esac
  done

  echo ""
  printf "${bold}fleet add-agent${reset} — Add a new agent to your fleet\n"
  echo "──────────────────────────────────────"

  # Get token
  local token="$flag_token"
  if [[ -z "$token" ]]; then
    echo ""
    echo "  Create a new bot at https://discord.com/developers/applications"
    echo "    1. Click 'New Application' → name it"
    echo "    2. Bot tab → Reset Token → copy"
    echo "    3. Enable Message Content Intent → Save"
    echo ""
    token=$(prompt_secret "Bot token")
  fi

  if [[ -z "$token" ]]; then
    fail "No token provided"
    exit 2
  fi

  # Validate token
  echo "  Validating..."
  local bot_json
  if ! bot_json=$(validate_token "$token") || [[ -z "$bot_json" ]]; then
    fail "Token rejected"
    exit 2
  fi

  local bot_info bot_name bot_id app_id
  bot_info=$(get_bot_info "$bot_json")
  bot_name="${bot_info%%:*}"
  bot_id="${bot_info##*:}"
  app_id=$(get_application_id "$token")
  [[ -z "$app_id" ]] && app_id="$bot_id"
  ok "Bot \"$bot_name\" (App ID: $app_id)"

  # Get agent name
  local agent_name="${flag_name:-$(prompt "Agent name" "$bot_name")}"

  # Check if agent already exists
  if list_agents | grep -qx "$agent_name"; then
    fail "Agent '$agent_name' already exists in fleet.yaml"
    exit 1
  fi

  # Get role
  local agent_role="${flag_role:-$(prompt "Role" "worker")}"

  # Build token env name
  local token_env="DISCORD_BOT_TOKEN_$(echo "$agent_name" | tr '[:lower:]-' '[:upper:]_')"

  # Check if same server needs state_dir
  local state_dir=""
  local same_server_agents
  same_server_agents=$(python3 -c "
import yaml, sys
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
count = sum(1 for a in data.get('agents', {}).values() if a.get('server','local') == sys.argv[2])
print(count)
" "$FLEET_YAML" "$flag_server" 2>/dev/null || echo "0")

  if [[ "$same_server_agents" -gt 0 ]]; then
    state_dir="~/.fleet/state/discord-$agent_name"
    info "Auto-set state_dir: $state_dir (multi-instance on $flag_server)"
  fi

  # Append to fleet.yaml
  {
    echo "  $agent_name:"
    echo "    token_env: $token_env"
    echo "    role: $agent_role"
    echo "    server: $flag_server"
    echo "    identity: identities/$agent_name.md"
    [[ -n "$state_dir" ]] && echo "    state_dir: $state_dir"
  } >> "$FLEET_YAML"
  ok "Added $agent_name to fleet.yaml"

  # Append to .env
  echo "$token_env=$token" >> "$FLEET_ENV"
  ok "Token saved to .env"

  # Generate identity file
  local id_file="$FLEET_DIR/identities/$agent_name.md"
  mkdir -p "$FLEET_DIR/identities"
  if [[ ! -f "$id_file" ]]; then
    {
      echo "You are **$agent_name**, a $agent_role in the fleet. Bot ID \`$app_id\`."
      echo ""
      echo "## Team"
      echo ""
      for existing in $(list_agents); do
        [[ "$existing" == "$agent_name" ]] && continue
        local peer_role
        peer_role=$(agent_get "$existing" "role" 2>/dev/null || echo "")
        echo "- $existing — $peer_role"
      done
      echo ""
      echo "## Rules"
      echo ""
      echo "- **Always reply via Discord reply tool** — terminal output does not reach Discord"
      echo "- Report concisely, conclusions first"
    } > "$id_file"
    ok "Identity file: identities/$agent_name.md"
  fi

  # Generate access.json
  if [[ -n "$state_dir" ]]; then
    local expanded_state="${state_dir/#\~/$HOME}"
    mkdir -p "$expanded_state"
    local user_id
    user_id=$(yaml_get "discord.user_id" 2>/dev/null || echo "")
    local access_file="$expanded_state/access.json"
    if [[ ! -f "$access_file" ]]; then
      local allowed="["
      local first=true
      [[ -n "$user_id" ]] && { allowed="$allowed\"$user_id\""; first=false; }
      for existing in $(list_agents); do
        [[ "$existing" == "$agent_name" ]] && continue
        local peer_id
        peer_id=$(agent_get "$existing" "token_env" 2>/dev/null)
        # We don't have peer bot IDs easily, skip for now
      done
      allowed="$allowed]"
      cat > "$access_file" <<EOACCESS
{
  "policy": "whitelist",
  "requireMention": true,
  "allowedUserIds": $allowed
}
EOACCESS
      ok "access.json created"
    fi
  fi

  # Print invite URL
  echo ""
  echo "  Invite the bot to your server:"
  echo "  https://discord.com/oauth2/authorize?client_id=$app_id&scope=bot&permissions=117840"
  echo ""
  echo "  Then start it:"
  echo "    fleet start $agent_name"
}
