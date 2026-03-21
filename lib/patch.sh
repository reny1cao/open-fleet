#!/bin/bash
# lib/patch.sh — Discord plugin patch management
#
# Applies required patches to the Discord plugin's server.ts.
# Used by: fleet patch

PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/discord/0.0.1"

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
