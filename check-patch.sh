#!/bin/bash
# check-patch.sh — 检查所有节点的 Discord 插件补丁状态

PLUGIN_PATH=".claude/plugins/cache/claude-plugins-official/discord/0.0.1/server.ts"

check_node() {
  local label="$1" plugin="$2"
  echo "=== $label 插件补丁检查 ==="

  if grep -q "DISCORD_STATE_DIR" "$plugin" 2>/dev/null; then
    echo "  ✅ STATE_DIR env var 支持"
  else
    echo "  ❌ STATE_DIR env var 缺失 — 需要重新打补丁"
  fi

  if grep -q "PARTNER_BOT_IDS" "$plugin" 2>/dev/null; then
    echo "  ✅ PARTNER_BOT_IDS"
  else
    echo "  ❌ PARTNER_BOT_IDS 缺失 — 需要重新打补丁"
  fi

  if grep -q 'presence.*online' "$plugin" 2>/dev/null; then
    echo "  ✅ presence: online"
  else
    echo "  ⬚  presence: online 未设置"
  fi
  echo ""
}

# 本地
check_node "本地" "$HOME/$PLUGIN_PATH"

# 远程节点
for host_label in "your-ssh-alias-1:Remote 1" "your-ssh-alias-2:Remote 2"; do
  host="${host_label%%:*}"
  label="${host_label##*:}"

  REMOTE=$(ssh "$host" "
    PLUGIN=/home/dev/$PLUGIN_PATH
    echo '=== $label 插件补丁检查 ==='
    if grep -q 'DISCORD_STATE_DIR' \$PLUGIN 2>/dev/null; then
      echo '  ✅ STATE_DIR env var 支持'
    else
      echo '  ❌ STATE_DIR env var 缺失'
    fi
    if grep -q 'PARTNER_BOT_IDS' \$PLUGIN 2>/dev/null; then
      echo '  ✅ PARTNER_BOT_IDS'
    else
      echo '  ❌ PARTNER_BOT_IDS 缺失'
    fi
    if grep -q 'presence.*online' \$PLUGIN 2>/dev/null; then
      echo '  ✅ presence: online'
    else
      echo '  ⬚  presence: online 未设置'
    fi
  " 2>&1) || REMOTE="  ⚠️  SSH 不通"
  echo "=== $label 插件补丁检查 ==="
  echo "$REMOTE" | grep -v "^==="
  echo ""
done
