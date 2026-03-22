#!/bin/bash
# lib/patch.sh — Discord plugin patch management
#
# Applies required patches to the Discord plugin's server.ts.
# Used by: fleet patch

PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/discord/0.0.1"

# Sync PARTNER_BOT_IDS in server.ts with all bot IDs from fleet.yaml + .env
# Called after patch, init, and add-agent to keep bot-to-bot messaging working
sync_partner_bot_ids() {
  local server_ts="$PLUGIN_DIR/server.ts"
  [[ -f "$server_ts" ]] || return 0
  grep -q "PARTNER_BOT_IDS" "$server_ts" || return 0

  # Collect bot IDs by validating tokens from .env
  local env_file="${FLEET_ENV:-$FLEET_DIR/.env}"
  [[ -f "$env_file" ]] || return 0

  local ids=()
  while IFS='=' read -r key val; do
    [[ "$key" == DISCORD_BOT_TOKEN_* && -n "$val" && "$val" != "PASTE_TOKEN_HERE" ]] || continue
    local bot_json
    bot_json=$(curl -sf -H "Authorization: Bot $val" "https://discord.com/api/v10/users/@me" 2>/dev/null) || continue
    local bot_id
    bot_id=$(echo "$bot_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null) || continue
    [[ -n "$bot_id" ]] && ids+=("$bot_id")
  done < "$env_file"

  [[ ${#ids[@]} -eq 0 ]] && return 0

  # Build the new Set content
  local set_content=""
  for id in "${ids[@]}"; do
    set_content="${set_content}  '${id}',\n"
  done

  # Replace the PARTNER_BOT_IDS block
  python3 -c "
import re, sys
with open(sys.argv[1], 'r') as f:
    content = f.read()
# Match: const PARTNER_BOT_IDS = new Set([\n...\n])
pattern = r'const PARTNER_BOT_IDS = new Set\(\[.*?\]\)'
replacement = 'const PARTNER_BOT_IDS = new Set([\n${set_content}])'
new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
with open(sys.argv[1], 'w') as f:
    f.write(new_content)
" "$server_ts"

  $JSON_OUTPUT 2>/dev/null && return 0
  $QUIET_OUTPUT 2>/dev/null && return 0
  echo "  Updated PARTNER_BOT_IDS with ${#ids[@]} bot ID(s)"
}

do_patch() {
  local specific="${1:-all}"  # all, state-dir, partner-bot-ids, presence

  echo ""
  printf "${bold}fleet patch${reset} — Discord plugin patches\n"
  echo "──────────────────────────────────────"

  local server_ts="$PLUGIN_DIR/server.ts"

  if [[ ! -f "$server_ts" ]]; then
    fail "Discord plugin not found at $PLUGIN_DIR"
    echo "    Install first: claude plugin install discord@claude-plugins-official"
    exit 1
  fi

  ok "Plugin found: $server_ts"

  local applied=0 skipped=0 failed=0

  # ── STATE_DIR patch ──
  if [[ "$specific" == "all" || "$specific" == "state-dir" ]]; then
    echo ""
    info "state-dir: DISCORD_STATE_DIR env var support"
    if grep -q "DISCORD_STATE_DIR" "$server_ts" 2>/dev/null; then
      ok "Already applied"
      skipped=$((skipped + 1))
    else
      sed -i.bak "s|const STATE_DIR = join(homedir(), '.claude', 'channels', 'discord')|const STATE_DIR = process.env.DISCORD_STATE_DIR\n  ?? join(homedir(), '.claude', 'channels', 'discord')|" "$server_ts"
      if grep -q "DISCORD_STATE_DIR" "$server_ts"; then
        ok "Applied"
        applied=$((applied + 1))
      else
        fail "Failed — apply manually: patches/state-dir.patch"
        failed=$((failed + 1))
      fi
    fi
  fi

  # ── PARTNER_BOT_IDS patch ──
  if [[ "$specific" == "all" || "$specific" == "partner-bot-ids" ]]; then
    echo ""
    info "partner-bot-ids: Allow bot-to-bot messaging"
    if grep -q "PARTNER_BOT_IDS" "$server_ts" 2>/dev/null; then
      ok "Already applied"
      skipped=$((skipped + 1))
    else
      # Insert PARTNER_BOT_IDS set before messageCreate handler
      sed -i.bak "/client.on('messageCreate'/i\\
// Allow messages from partner bots (fleet collaboration).\\
// Loop safety: requireMention in group config means only explicit @mentions trigger.\\
const PARTNER_BOT_IDS = new Set([\\
  // Add your bot IDs here, e.g.: '123456789012345678',\\
])\\
" "$server_ts"
      # Replace the bot filter
      sed -i.bak "s|if (msg.author.bot) return|if (msg.author.bot \&\& !PARTNER_BOT_IDS.has(msg.author.id)) return|" "$server_ts"
      if grep -q "PARTNER_BOT_IDS" "$server_ts"; then
        ok "Applied"
        warn "Add your bot IDs to PARTNER_BOT_IDS in server.ts"
        applied=$((applied + 1))
      else
        fail "Failed — apply manually: patches/partner-bot-ids.patch"
        failed=$((failed + 1))
      fi
    fi
  fi

  # ── Presence patch ──
  if [[ "$specific" == "all" || "$specific" == "presence" ]]; then
    echo ""
    info "presence: Show bots as online in Discord"
    if grep -q 'presence: { status: "online" }' "$server_ts" 2>/dev/null; then
      ok "Already applied"
      skipped=$((skipped + 1))
    elif grep -q "// presence" "$server_ts" 2>/dev/null; then
      sed -i.bak 's|// presence: { status: .online. }|presence: { status: "online" }|' "$server_ts"
      if grep -q 'presence: { status: "online" }' "$server_ts"; then
        ok "Applied"
        applied=$((applied + 1))
      else
        fail "Failed — apply manually: patches/presence.patch"
        failed=$((failed + 1))
      fi
    else
      warn "Presence line not found (format may differ)"
      skipped=$((skipped + 1))
    fi
  fi

  # Clean up backup files
  rm -f "$PLUGIN_DIR/server.ts.bak"

  # If fleet.yaml exists, auto-populate PARTNER_BOT_IDS with all fleet bot IDs
  if [[ -f "${FLEET_YAML:-}" ]] && grep -q "PARTNER_BOT_IDS" "$server_ts" 2>/dev/null; then
    sync_partner_bot_ids
  fi

  # ── Summary ──
  echo ""
  echo "──────────────────────────────────────"
  local summary=""
  [[ $applied -gt 0 ]] && summary="${summary}${applied} applied"
  [[ $skipped -gt 0 ]] && summary="${summary}${summary:+, }${skipped} already present"
  [[ $failed -gt 0 ]] && summary="${summary}${summary:+, }${failed} failed"
  echo "  $summary"
  echo ""

  return $failed
}
