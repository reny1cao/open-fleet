#!/bin/bash
# lib/doctor.sh — Fleet health diagnostics
#
# Checks: prerequisites, config, tokens, patches, SSH, remote nodes,
# identities, state dirs.

DISCORD_API="https://discord.com/api/v10"
PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/discord/0.0.1"

do_doctor() {
  require_config

  local pass=0 warnings=0 failures=0

  echo ""
  printf "${bold}fleet doctor${reset} — System health check\n"
  echo "──────────────────────────────────────"

  # ── Prerequisites ──
  step "[Prerequisites]"

  for cmd in python3 tmux jq curl; do
    if command -v "$cmd" &>/dev/null; then
      local ver=""
      case "$cmd" in
        python3) ver="$(python3 --version 2>&1 | awk '{print $2}')" ;;
        tmux)    ver="$(tmux -V 2>/dev/null | awk '{print $2}')" ;;
        jq)      ver="$(jq --version 2>/dev/null)" ;;
        curl)    ver="$(curl --version 2>/dev/null | head -1 | awk '{print $2}')" ;;
      esac
      ok "$cmd${ver:+ $ver}"
      pass=$((pass + 1))
    else
      fail "$cmd — not found"
      failures=$((failures + 1))
    fi
  done

  # PyYAML
  if python3 -c "import yaml" 2>/dev/null; then
    ok "PyYAML"
    pass=$((pass + 1))
  else
    fail "PyYAML — not installed (pip3 install pyyaml)"
    failures=$((failures + 1))
  fi

  # Claude Code
  if command -v claude &>/dev/null; then
    ok "claude"
    pass=$((pass + 1))
  else
    fail "claude — not found (npm install -g @anthropic-ai/claude-code)"
    failures=$((failures + 1))
  fi

  # bun (optional)
  if command -v bun &>/dev/null; then
    ok "bun $(bun --version 2>/dev/null)"
    pass=$((pass + 1))
  else
    warn "bun — not found (optional, needed for plugin dev)"
    warnings=$((warnings + 1))
  fi

  # ── Config ──
  step "[Config]"

  if [[ -f "$FLEET_YAML" ]]; then
    # Validate YAML syntax
    if python3 -c "import yaml; yaml.safe_load(open('$FLEET_YAML'))" 2>/dev/null; then
      ok "fleet.yaml exists and valid YAML"
      pass=$((pass + 1))
    else
      fail "fleet.yaml has invalid YAML syntax"
      failures=$((failures + 1))
    fi
  else
    fail "fleet.yaml not found"
    failures=$((failures + 1))
  fi

  if [[ -f "$FLEET_ENV" ]]; then
    ok ".env exists"
    pass=$((pass + 1))
  else
    fail ".env not found"
    failures=$((failures + 1))
  fi

  # Check all token_env vars have values
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
    ok "All token_env vars have values ($tokens_set/$total_agents)"
    pass=$((pass + 1))
  elif [[ $tokens_set -gt 0 ]]; then
    warn "Some tokens missing ($tokens_set/$total_agents set)"
    warnings=$((warnings + 1))
  else
    fail "No tokens configured ($tokens_set/$total_agents)"
    failures=$((failures + 1))
  fi

  # ── Discord Tokens ──
  step "[Discord Tokens]"

  for agent in $(list_agents); do
    local env_name token_val
    env_name=$(agent_get "$agent" "token_env" 2>/dev/null) || continue
    token_val="${!env_name}"

    if [[ -z "$token_val" || "$token_val" == "PASTE_TOKEN_HERE" ]]; then
      fail "$agent — $env_name not set"
      failures=$((failures + 1))
      continue
    fi

    local response
    response=$(curl -sf -H "Authorization: Bot $token_val" "$DISCORD_API/users/@me" 2>/dev/null)
    if [[ $? -eq 0 && -n "$response" ]]; then
      local bot_name bot_id
      bot_name=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('username','?'))" 2>/dev/null)
      bot_id=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null)
      ok "$agent — token valid (Bot \"$bot_name\", ID $bot_id)"
      pass=$((pass + 1))
    else
      fail "$agent — token rejected (401 Unauthorized)"
      echo "    → Regenerate: https://discord.com/developers/applications"
      failures=$((failures + 1))
    fi
  done

  # ── Discord Plugin Patches ──
  step "[Discord Plugin Patches]"

  if [[ -f "$PLUGIN_DIR/server.ts" ]]; then
    if grep -q "DISCORD_STATE_DIR" "$PLUGIN_DIR/server.ts" 2>/dev/null; then
      ok "STATE_DIR env var support"
      pass=$((pass + 1))
    else
      fail "STATE_DIR patch missing"
      echo "    → Run: ./install.sh (or apply patches/state-dir.patch manually)"
      failures=$((failures + 1))
    fi

    if grep -q "PARTNER_BOT_IDS" "$PLUGIN_DIR/server.ts" 2>/dev/null; then
      ok "PARTNER_BOT_IDS"
      pass=$((pass + 1))
    else
      fail "PARTNER_BOT_IDS patch missing"
      echo "    → Run: ./install.sh (or apply patches/partner-bot-ids.patch manually)"
      failures=$((failures + 1))
    fi

    if grep -q 'presence.*online' "$PLUGIN_DIR/server.ts" 2>/dev/null && ! grep -q '// presence' "$PLUGIN_DIR/server.ts" 2>/dev/null; then
      ok "presence: online"
      pass=$((pass + 1))
    else
      warn "presence: online — not applied (optional)"
      echo "    → Run: ./install.sh (or apply patches/presence.patch)"
      warnings=$((warnings + 1))
    fi
  else
    fail "Discord plugin not installed at $PLUGIN_DIR"
    echo "    → Run: claude plugin install discord@claude-plugins-official"
    failures=$((failures + 1))
  fi

  # ── SSH Connectivity ──
  step "[SSH Connectivity]"

  local has_remote=false
  for server in $(list_servers); do
    has_remote=true
    local ssh_host remote_user
    ssh_host=$(server_ssh_host "$server" 2>/dev/null) || { fail "$server — no ssh_host configured"; failures=$((failures+1)); continue; }
    remote_user=$(server_user "$server")

    if ssh -o ConnectTimeout=5 -o BatchMode=yes "$ssh_host" "echo ok" &>/dev/null; then
      ok "$server ($ssh_host) — reachable, user $remote_user"
      pass=$((pass + 1))
    else
      fail "$server ($ssh_host) — connection failed"
      echo "    → Check: ssh $ssh_host"
      failures=$((failures + 1))
    fi
  done

  if ! $has_remote; then
    info "No remote servers configured (all local)"
  fi

  # ── Remote Nodes ──
  if $has_remote; then
    step "[Remote Nodes]"

    for server in $(list_servers); do
      local ssh_host remote_user
      ssh_host=$(server_ssh_host "$server" 2>/dev/null) || continue
      remote_user=$(server_user "$server")

      # Test SSH first
      if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$ssh_host" "echo ok" &>/dev/null; then
        warn "$server: unreachable, skipped"
        warnings=$((warnings + 1))
        continue
      fi

      # Check claude on remote
      local remote_claude
      remote_claude=$(remote_cmd "$ssh_host" "$remote_user" "command -v claude 2>/dev/null || echo 'NOT_FOUND'")
      if [[ "$remote_claude" != "NOT_FOUND" && -n "$remote_claude" ]]; then
        ok "$server: claude found ($remote_claude)"
        pass=$((pass + 1))
      else
        fail "$server: claude not found"
        failures=$((failures + 1))
      fi

      # Check tmux on remote
      local remote_tmux
      remote_tmux=$(remote_cmd "$ssh_host" "$remote_user" "command -v tmux 2>/dev/null || echo 'NOT_FOUND'")
      if [[ "$remote_tmux" != "NOT_FOUND" && -n "$remote_tmux" ]]; then
        ok "$server: tmux found"
        pass=$((pass + 1))
      else
        fail "$server: tmux not found"
        failures=$((failures + 1))
      fi

      # Check patches on remote
      local remote_plugin_path="/home/$remote_user/.claude/plugins/cache/claude-plugins-official/discord/0.0.1/server.ts"
      local has_state_dir
      has_state_dir=$(remote_cmd "$ssh_host" "$remote_user" "grep -q DISCORD_STATE_DIR $remote_plugin_path 2>/dev/null && echo yes || echo no")
      if [[ "$has_state_dir" == "yes" ]]; then
        ok "$server: Discord plugin patches applied"
        pass=$((pass + 1))
      else
        warn "$server: Discord plugin patches not applied"
        warnings=$((warnings + 1))
      fi
    done
  fi

  # ── Identities ──
  step "[Identities]"

  for agent in $(list_agents); do
    local identity_path
    identity_path=$(agent_get "$agent" "identity" 2>/dev/null) || identity_path="identities/$agent.md"
    [[ "$identity_path" != /* ]] && identity_path="$FLEET_DIR/$identity_path"

    if [[ -f "$identity_path" ]]; then
      local placeholder_count
      placeholder_count=$(grep -c '{{' "$identity_path" 2>/dev/null || echo "0")
      if [[ "$placeholder_count" -gt 0 ]]; then
        warn "$agent — $placeholder_count unresolved {{placeholders}}"
        warnings=$((warnings + 1))
      else
        ok "$agent — $(basename "$identity_path")"
        pass=$((pass + 1))
      fi
    else
      fail "$agent — identity file missing: $identity_path"
      echo "    → Run: fleet init"
      failures=$((failures + 1))
    fi
  done

  # ── State Dirs ──
  step "[State Dirs]"

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
        ok "$agent — $state_dir"
        pass=$((pass + 1))
      else
        warn "$agent — $state_dir does not exist (will be created on first start)"
        warnings=$((warnings + 1))
      fi
    else
      info "$agent — $state_dir (remote, cannot check)"
    fi
  done

  if ! $has_state_dirs; then
    info "No custom state_dirs configured"
  fi

  # ── Summary ──
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

  return $failures
}
