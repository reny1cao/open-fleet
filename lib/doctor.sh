#!/bin/bash
# lib/doctor.sh — Fleet health diagnostics
#
# Checks: prerequisites, config, tokens, patches, SSH, remote nodes,
# identities, state dirs. Supports --json for agent consumption.

DOCTOR_DISCORD_API="https://discord.com/api/v10"
DOCTOR_PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/discord/0.0.1"

# JSON result accumulator
_doctor_results=""

_doctor_add() {
  local category="$1" name="$2" status="$3" message="${4:-}"
  local entry
  entry=$(json_obj "category" "$category" "name" "$name" "status" "$status" "message" "$message")
  if [[ -n "$_doctor_results" ]]; then
    _doctor_results="$_doctor_results,$entry"
  else
    _doctor_results="$entry"
  fi
}

do_doctor() {
  require_config

  local pass=0 warnings=0 failures=0
  _doctor_results=""

  if ! $JSON_OUTPUT; then
    echo ""
    printf "${bold}fleet doctor${reset} — System health check\n"
    echo "──────────────────────────────────────"
  fi

  # ── Prerequisites ──
  $JSON_OUTPUT || step "[Prerequisites]"

  for cmd in python3 tmux jq curl; do
    if command -v "$cmd" &>/dev/null; then
      local ver=""
      case "$cmd" in
        python3) ver="$(python3 --version 2>&1 | awk '{print $2}')" ;;
        tmux)    ver="$(tmux -V 2>/dev/null | awk '{print $2}')" ;;
        jq)      ver="$(jq --version 2>/dev/null)" ;;
        curl)    ver="$(curl --version 2>/dev/null | head -1 | awk '{print $2}')" ;;
      esac
      $JSON_OUTPUT || ok "$cmd${ver:+ $ver}"
      _doctor_add "prerequisites" "$cmd" "pass" "$ver"
      pass=$((pass + 1))
    else
      $JSON_OUTPUT || fail "$cmd — not found"
      _doctor_add "prerequisites" "$cmd" "fail" "not found"
      failures=$((failures + 1))
    fi
  done

  if python3 -c "import yaml" 2>/dev/null; then
    $JSON_OUTPUT || ok "PyYAML"
    _doctor_add "prerequisites" "pyyaml" "pass"
    pass=$((pass + 1))
  else
    $JSON_OUTPUT || fail "PyYAML — not installed (pip3 install pyyaml)"
    _doctor_add "prerequisites" "pyyaml" "fail" "not installed"
    failures=$((failures + 1))
  fi

  if command -v claude &>/dev/null; then
    $JSON_OUTPUT || ok "claude"
    _doctor_add "prerequisites" "claude" "pass"
    pass=$((pass + 1))
  else
    $JSON_OUTPUT || fail "claude — not found (npm install -g @anthropic-ai/claude-code)"
    _doctor_add "prerequisites" "claude" "fail" "not found"
    failures=$((failures + 1))
  fi

  if command -v bun &>/dev/null; then
    $JSON_OUTPUT || ok "bun $(bun --version 2>/dev/null)"
    _doctor_add "prerequisites" "bun" "pass"
    pass=$((pass + 1))
  else
    $JSON_OUTPUT || warn "bun — not found (optional, needed for plugin dev)"
    _doctor_add "prerequisites" "bun" "warn" "not found (optional)"
    warnings=$((warnings + 1))
  fi

  # ── Config ──
  $JSON_OUTPUT || step "[Config]"

  if [[ -f "$FLEET_YAML" ]]; then
    if python3 -c "import yaml; yaml.safe_load(open('$FLEET_YAML'))" 2>/dev/null; then
      $JSON_OUTPUT || ok "fleet.yaml exists and valid YAML"
      _doctor_add "config" "fleet.yaml" "pass"
      pass=$((pass + 1))
    else
      $JSON_OUTPUT || fail "fleet.yaml has invalid YAML syntax"
      _doctor_add "config" "fleet.yaml" "fail" "invalid YAML syntax"
      failures=$((failures + 1))
    fi
  else
    $JSON_OUTPUT || fail "fleet.yaml not found"
    _doctor_add "config" "fleet.yaml" "fail" "not found"
    failures=$((failures + 1))
  fi

  if [[ -f "$FLEET_ENV" ]]; then
    $JSON_OUTPUT || ok ".env exists"
    _doctor_add "config" ".env" "pass"
    pass=$((pass + 1))
  else
    $JSON_OUTPUT || fail ".env not found"
    _doctor_add "config" ".env" "fail" "not found"
    failures=$((failures + 1))
  fi

  local total_agents=0 tokens_set=0
  for agent in $(list_agents); do
    total_agents=$((total_agents + 1))
    local env_name
    env_name=$(agent_get "$agent" "token_env" 2>/dev/null) || continue
    local token_val="${!env_name}"
    if [[ -n "$token_val" && "$token_val" != "PASTE_TOKEN_HERE" ]]; then
      tokens_set=$((tokens_set + 1))
    fi
  done

  if [[ $tokens_set -eq $total_agents && $total_agents -gt 0 ]]; then
    $JSON_OUTPUT || ok "All token_env vars have values ($tokens_set/$total_agents)"
    _doctor_add "config" "tokens" "pass" "$tokens_set/$total_agents"
    pass=$((pass + 1))
  elif [[ $tokens_set -gt 0 ]]; then
    $JSON_OUTPUT || warn "Some tokens missing ($tokens_set/$total_agents set)"
    _doctor_add "config" "tokens" "warn" "$tokens_set/$total_agents set"
    warnings=$((warnings + 1))
  else
    $JSON_OUTPUT || fail "No tokens configured ($tokens_set/$total_agents)"
    _doctor_add "config" "tokens" "fail" "$tokens_set/$total_agents"
    failures=$((failures + 1))
  fi

  # ── Discord Tokens ──
  $JSON_OUTPUT || step "[Discord Tokens]"

  for agent in $(list_agents); do
    local env_name token_val
    env_name=$(agent_get "$agent" "token_env" 2>/dev/null) || continue
    token_val="${!env_name}"

    if [[ -z "$token_val" || "$token_val" == "PASTE_TOKEN_HERE" ]]; then
      $JSON_OUTPUT || fail "$agent — $env_name not set"
      _doctor_add "discord_tokens" "$agent" "fail" "token not set"
      failures=$((failures + 1))
      continue
    fi

    local response
    if response=$(curl -sf -H "Authorization: Bot $token_val" "$DOCTOR_DISCORD_API/users/@me" 2>/dev/null) && [[ -n "$response" ]]; then
      local bot_name bot_id
      bot_name=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('username','?'))" 2>/dev/null)
      bot_id=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null)
      $JSON_OUTPUT || ok "$agent — token valid (Bot \"$bot_name\", ID $bot_id)"
      _doctor_add "discord_tokens" "$agent" "pass" "Bot $bot_name ($bot_id)"
      pass=$((pass + 1))
    else
      $JSON_OUTPUT || { fail "$agent — token rejected (401 Unauthorized)"; echo "    → Regenerate: https://discord.com/developers/applications"; }
      _doctor_add "discord_tokens" "$agent" "fail" "token rejected"
      failures=$((failures + 1))
    fi
  done

  # ── Discord Plugin Patches ──
  $JSON_OUTPUT || step "[Discord Plugin Patches]"

  if [[ -f "$DOCTOR_PLUGIN_DIR/server.ts" ]]; then
    if grep -q "DISCORD_STATE_DIR" "$DOCTOR_PLUGIN_DIR/server.ts" 2>/dev/null; then
      $JSON_OUTPUT || ok "STATE_DIR env var support"
      _doctor_add "patches" "state_dir" "pass"
      pass=$((pass + 1))
    else
      $JSON_OUTPUT || { fail "STATE_DIR patch missing"; echo "    → Run: fleet patch"; }
      _doctor_add "patches" "state_dir" "fail" "missing"
      failures=$((failures + 1))
    fi

    if grep -q "PARTNER_BOT_IDS" "$DOCTOR_PLUGIN_DIR/server.ts" 2>/dev/null; then
      $JSON_OUTPUT || ok "PARTNER_BOT_IDS"
      _doctor_add "patches" "partner_bot_ids" "pass"
      pass=$((pass + 1))
    else
      $JSON_OUTPUT || { fail "PARTNER_BOT_IDS patch missing"; echo "    → Run: fleet patch"; }
      _doctor_add "patches" "partner_bot_ids" "fail" "missing"
      failures=$((failures + 1))
    fi

    if grep -q 'presence.*online' "$DOCTOR_PLUGIN_DIR/server.ts" 2>/dev/null && ! grep -q '// presence' "$DOCTOR_PLUGIN_DIR/server.ts" 2>/dev/null; then
      $JSON_OUTPUT || ok "presence: online"
      _doctor_add "patches" "presence" "pass"
      pass=$((pass + 1))
    else
      $JSON_OUTPUT || { warn "presence: online — not applied (optional)"; echo "    → Run: fleet patch presence"; }
      _doctor_add "patches" "presence" "warn" "not applied (optional)"
      warnings=$((warnings + 1))
    fi
  else
    $JSON_OUTPUT || { fail "Discord plugin not installed at $DOCTOR_PLUGIN_DIR"; echo "    → Run: claude plugin install discord@claude-plugins-official"; }
    _doctor_add "patches" "plugin" "fail" "not installed"
    failures=$((failures + 1))
  fi

  # ── SSH Connectivity ──
  $JSON_OUTPUT || step "[SSH Connectivity]"

  local has_remote=false
  for server in $(list_servers); do
    has_remote=true
    local ssh_host remote_user
    ssh_host=$(server_ssh_host "$server" 2>/dev/null) || { $JSON_OUTPUT || fail "$server — no ssh_host configured"; _doctor_add "ssh" "$server" "fail" "no ssh_host"; failures=$((failures+1)); continue; }
    remote_user=$(server_user "$server")

    if ssh -o ConnectTimeout=5 -o BatchMode=yes "$ssh_host" "echo ok" &>/dev/null; then
      $JSON_OUTPUT || ok "$server ($ssh_host) — reachable, user $remote_user"
      _doctor_add "ssh" "$server" "pass" "reachable"
      pass=$((pass + 1))
    else
      $JSON_OUTPUT || { fail "$server ($ssh_host) — connection failed"; echo "    → Check: ssh $ssh_host"; }
      _doctor_add "ssh" "$server" "fail" "connection failed"
      failures=$((failures + 1))
    fi
  done

  if ! $has_remote; then
    $JSON_OUTPUT || info "No remote servers configured (all local)"
  fi

  # ── Remote Nodes ──
  if $has_remote; then
    $JSON_OUTPUT || step "[Remote Nodes]"

    for server in $(list_servers); do
      local ssh_host remote_user
      ssh_host=$(server_ssh_host "$server" 2>/dev/null) || continue
      remote_user=$(server_user "$server")

      if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$ssh_host" "echo ok" &>/dev/null; then
        $JSON_OUTPUT || warn "$server: unreachable, skipped"
        _doctor_add "remote_nodes" "$server" "warn" "unreachable"
        warnings=$((warnings + 1))
        continue
      fi

      local remote_claude
      remote_claude=$(remote_cmd "$ssh_host" "$remote_user" "command -v claude 2>/dev/null || echo 'NOT_FOUND'")
      if [[ "$remote_claude" != "NOT_FOUND" && -n "$remote_claude" ]]; then
        $JSON_OUTPUT || ok "$server: claude found ($remote_claude)"
        _doctor_add "remote_nodes" "${server}_claude" "pass"
        pass=$((pass + 1))
      else
        $JSON_OUTPUT || fail "$server: claude not found"
        _doctor_add "remote_nodes" "${server}_claude" "fail" "not found"
        failures=$((failures + 1))
      fi

      local remote_tmux
      remote_tmux=$(remote_cmd "$ssh_host" "$remote_user" "command -v tmux 2>/dev/null || echo 'NOT_FOUND'")
      if [[ "$remote_tmux" != "NOT_FOUND" && -n "$remote_tmux" ]]; then
        $JSON_OUTPUT || ok "$server: tmux found"
        _doctor_add "remote_nodes" "${server}_tmux" "pass"
        pass=$((pass + 1))
      else
        $JSON_OUTPUT || fail "$server: tmux not found"
        _doctor_add "remote_nodes" "${server}_tmux" "fail" "not found"
        failures=$((failures + 1))
      fi

      local remote_plugin_path="/home/$remote_user/.claude/plugins/cache/claude-plugins-official/discord/0.0.1/server.ts"
      local has_state_dir
      has_state_dir=$(remote_cmd "$ssh_host" "$remote_user" "grep -q DISCORD_STATE_DIR $remote_plugin_path 2>/dev/null && echo yes || echo no")
      if [[ "$has_state_dir" == "yes" ]]; then
        $JSON_OUTPUT || ok "$server: Discord plugin patches applied"
        _doctor_add "remote_nodes" "${server}_patches" "pass"
        pass=$((pass + 1))
      else
        $JSON_OUTPUT || warn "$server: Discord plugin patches not applied"
        _doctor_add "remote_nodes" "${server}_patches" "warn" "not applied"
        warnings=$((warnings + 1))
      fi
    done
  fi

  # ── Identities ──
  $JSON_OUTPUT || step "[Identities]"

  for agent in $(list_agents); do
    local identity_path
    identity_path=$(agent_get "$agent" "identity" 2>/dev/null) || identity_path="identities/$agent.md"
    [[ "$identity_path" != /* ]] && identity_path="$FLEET_DIR/$identity_path"

    if [[ -f "$identity_path" ]]; then
      local placeholder_count
      placeholder_count=$(grep -c '{{' "$identity_path" 2>/dev/null || echo "0")
      if [[ "$placeholder_count" -gt 0 ]]; then
        $JSON_OUTPUT || warn "$agent — $placeholder_count unresolved {{placeholders}}"
        _doctor_add "identities" "$agent" "warn" "$placeholder_count unresolved placeholders"
        warnings=$((warnings + 1))
      else
        $JSON_OUTPUT || ok "$agent — $(basename "$identity_path")"
        _doctor_add "identities" "$agent" "pass"
        pass=$((pass + 1))
      fi
    else
      $JSON_OUTPUT || { fail "$agent — identity file missing: $identity_path"; echo "    → Run: fleet init"; }
      _doctor_add "identities" "$agent" "fail" "missing"
      failures=$((failures + 1))
    fi
  done

  # ── State Dirs ──
  $JSON_OUTPUT || step "[State Dirs]"

  local has_state_dirs=false
  for agent in $(list_agents); do
    local state_dir
    state_dir=$(agent_get "$agent" "state_dir" 2>/dev/null) || continue
    [[ -z "$state_dir" ]] && continue
    has_state_dirs=true

    local expanded="${state_dir/#\~/$HOME}"
    local server
    server=$(agent_get "$agent" "server" 2>/dev/null || echo "local")

    if [[ "$server" == "local" ]]; then
      if [[ -d "$expanded" ]]; then
        $JSON_OUTPUT || ok "$agent — $state_dir"
        _doctor_add "state_dirs" "$agent" "pass"
        pass=$((pass + 1))
      else
        $JSON_OUTPUT || warn "$agent — $state_dir does not exist (will be created on first start)"
        _doctor_add "state_dirs" "$agent" "warn" "directory does not exist"
        warnings=$((warnings + 1))
      fi
    else
      $JSON_OUTPUT || info "$agent — $state_dir (remote, cannot check)"
      _doctor_add "state_dirs" "$agent" "pass" "remote, not checked"
    fi
  done

  if ! $has_state_dirs; then
    $JSON_OUTPUT || info "No custom state_dirs configured"
  fi

  # ── Output ──
  if $JSON_OUTPUT; then
    echo "{ \"pass\": $pass, \"warnings\": $warnings, \"failures\": $failures, \"checks\": [$_doctor_results] }"
  else
    echo ""
    echo "──────────────────────────────────────"
    printf "  ${green}$pass passed${reset}"
    [[ $warnings -gt 0 ]] && printf ", ${yellow}$warnings warnings${reset}"
    [[ $failures -gt 0 ]] && printf ", ${red}$failures failed${reset}"
    echo ""

    if [[ $failures -gt 0 ]]; then
      echo "  Fix the ✘ items, then run fleet doctor again."
    elif [[ $warnings -gt 0 ]]; then
      echo "  Warnings are non-blocking. Fleet should work."
    else
      echo "  All checks passed. Ready to go!"
    fi
    echo ""
  fi

  return $failures
}
