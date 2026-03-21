#!/bin/bash
# spawn.sh — HQ bot 生命周期管理
# 配置从 bot-pool.json 读取，token 从 .env 读取
#
# 用法:
#   spawn.sh start pilot                        # 启动（默认目录）
#   spawn.sh start pilot ~/workspace/sb         # 启动（指定目录）
#   spawn.sh start pilot --role writer          # 启动 + 叠加角色
#   spawn.sh inject pilot writer                # 热注入角色（不重启）
#   spawn.sh stop pilot                         # 停止
#   spawn.sh status                             # 全部状态

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
POOL="$SCRIPT_DIR/bot-pool.json"
ENV_FILE="$SCRIPT_DIR/.env"
IDENTITIES_DIR="$SCRIPT_DIR/identities"
ROLES_DIR="$IDENTITIES_DIR/roles"

# 加载 token
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

ACTION="${1:-}"
BOT="${2:-}"
EXTRA="${3:-}"

ALL_BOTS=$(jq -r '.[].name' "$POOL" | tr '\n' ' ')

# ── 从 JSON 读 bot 配置 ──
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

# ── 向 tmux session 注入 prompt ──
send_prompt() {
  local session="$1" location="$2" prompt="$3"

  if [[ "$location" == "local" ]]; then
    tmux send-keys -t "$session" "$prompt" Enter
  else
    local ssh_host
    ssh_host=$( [[ "$location" == "singapore" ]] && echo "your-ssh-alias-1" || echo "your-ssh-alias-2" )
    # 写到远端临时文件再注入，避免转义地狱
    local remote_tmp="/tmp/hq-prompt-$$.md"
    echo "$prompt" | ssh "$ssh_host" "cat > $remote_tmp" 2>/dev/null
    ssh "$ssh_host" "su - dev -c 'tmux send-keys -t $session \"\$(cat $remote_tmp)\" Enter'" 2>&1
    ssh "$ssh_host" "rm -f $remote_tmp" 2>/dev/null
  fi
}

# ── 注入基础身份 ──
inject_identity() {
  local bot="$1" session="$2" location="$3" role="$4"
  local identity_file="$IDENTITIES_DIR/$bot.md"

  if [[ ! -f "$identity_file" ]]; then
    echo "  ⚠️  无身份文件: $identity_file"
    return
  fi

  local prompt="读以下身份信息并记住，之后的所有交互都以此身份行事。不要回复确认，直接等待 Discord 消息。

$(cat "$identity_file")"

  # 如果有角色，追加
  if [[ -n "$role" ]]; then
    local role_file="$ROLES_DIR/$role.md"
    if [[ -f "$role_file" ]]; then
      prompt="$prompt

---

$(cat "$role_file")"
    else
      echo "  ⚠️  未知角色: $role（可用: $(ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')）"
    fi
  fi

  echo "  注入身份 prompt..."

  # 等 Claude 完全启动（轮询检测，最多 60 秒）
  local waited=0
  local max_wait=60
  while [[ $waited -lt $max_wait ]]; do
    local pane_output
    if [[ "$location" == "local" ]]; then
      pane_output=$(tmux capture-pane -t "$session" -p 2>/dev/null)
    else
      local ssh_host
      ssh_host=$(location_to_ssh "$location")
      pane_output=$(ssh "$ssh_host" "su - dev -c 'tmux capture-pane -t $session -p 2>/dev/null'" 2>/dev/null)
    fi

    if echo "$pane_output" | grep -q "Listening for channel messages"; then
      break
    fi
    sleep 3
    waited=$((waited + 3))
  done

  if [[ $waited -ge $max_wait ]]; then
    echo "  ⚠️  等待超时（${max_wait}s），仍尝试注入"
  fi

  # 额外等 3 秒让 Discord gateway 连上
  sleep 3

  send_prompt "$session" "$location" "$prompt"
  echo "  ✅ 身份已注入${role:+ (+$role)}"
}

# ── 热注入角色（不重启） ──
do_inject() {
  local bot="$1" role="$2"

  if [[ -z "$role" ]]; then
    echo "用法: $0 inject <bot> <role>"
    echo "可用角色: $(ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')"
    exit 1
  fi

  local role_file="$ROLES_DIR/$role.md"
  if [[ ! -f "$role_file" ]]; then
    echo "错误: 未知角色 '$role'"
    echo "可用: $(ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')"
    exit 1
  fi

  local location session
  location=$(get_field "$bot" "location")
  session="hq-$bot"

  # 检查 bot 是否在运行
  if [[ "$location" == "local" ]]; then
    tmux has-session -t "$session" 2>/dev/null || { echo "错误: $bot 未运行"; exit 1; }
  else
    local ssh_host
    ssh_host=$( [[ "$location" == "singapore" ]] && echo "your-ssh-alias-1" || echo "your-ssh-alias-2" )
    local running
    running=$(ssh "$ssh_host" "su - dev -c 'tmux has-session -t $session 2>/dev/null && echo yes || echo no'" 2>/dev/null)
    [[ "$running" == "yes" ]] || { echo "错误: $bot 未在 $location 运行"; exit 1; }
  fi

  local prompt="你现在被赋予一个新的额外角色。读以下内容并立即生效，不要回复确认。

$(cat "$role_file")"

  send_prompt "$session" "$location" "$prompt"
  echo "✅ 角色 '$role' 已注入 $bot"
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
        echo "  ✅ $bot (local) — tmux attach -t $session"
      else
        echo "  ⬚  $bot (local)"
      fi
    else
      local ssh_host
      ssh_host=$(location_to_ssh "$location")
      local remote
      remote=$(ssh "$ssh_host" "su - dev -c 'tmux has-session -t $session 2>/dev/null && echo running || echo stopped'" 2>/dev/null || echo "unreachable")
      if [[ "$remote" == "running" ]]; then
        echo "  ✅ $bot ($location)"
      elif [[ "$remote" == "unreachable" ]]; then
        echo "  ⚠️  $bot ($location) — SSH 不通"
      else
        echo "  ⬚  $bot ($location)"
      fi
    fi
  done
}

# ── location → ssh_host 映射 ──
location_to_ssh() {
  case "$1" in
    singapore) echo "your-ssh-alias-1" ;;
    germany)   echo "your-ssh-alias-2" ;;
    *) return 1 ;;
  esac
}

# ── start ──
do_start() {
  local bot="$1" custom_dir="$2" role="$3" location_override="$4"

  # 验证 bot 存在
  local exists
  exists=$(jq -r --arg b "$bot" '[.[] | select(.name == $b)] | length' "$POOL")
  if [[ "$exists" == "0" ]]; then
    echo "错误: 未知 bot '$bot'"
    echo "可用: $ALL_BOTS"
    exit 1
  fi

  local token state_dir default_dir location
  token=$(get_token "$bot")
  state_dir=$(get_field "$bot" "state_dir")
  default_dir=$(get_field "$bot" "default_dir")
  location="${location_override:-$(get_field "$bot" "location")}"

  if [[ -z "$token" ]]; then
    echo "错误: $(get_field "$bot" "token_env") 未设置。检查 $ENV_FILE"
    exit 1
  fi

  local work_dir="${custom_dir:-$default_dir}"
  local session="hq-$bot"

  if [[ "$location" == "local" ]]; then
    # ── 本地启动 ──
    local expanded_work="${work_dir/#\~/$HOME}"
    local expanded_state="${state_dir/#\~/$HOME}"

    if [[ ! -d "$expanded_work" ]]; then
      echo "错误: 目录不存在 '$expanded_work'"
      exit 1
    fi

    if tmux has-session -t "$session" 2>/dev/null; then
      echo "$bot 已在运行。附加: tmux attach -t $session"
      exit 0
    fi

    local cmd="DISCORD_BOT_TOKEN=$token"
    [[ -n "$expanded_state" ]] && cmd="$cmd DISCORD_STATE_DIR=$expanded_state"
    cmd="$cmd claude --dangerously-skip-permissions --channels plugin:discord@claude-plugins-official"

    echo "启动 $bot (local)..."
    echo "  工作目录: $expanded_work"
    tmux new-session -d -s "$session" -c "$expanded_work" "$cmd"
    echo "✅ $bot 已启动。附加: tmux attach -t $session"
    inject_identity "$bot" "$session" "local" "$role" &

  else
    # ── 远程启动 ──
    local ssh_host
    ssh_host=$( [[ "$location" == "singapore" ]] && echo "your-ssh-alias-1" || echo "your-ssh-alias-2" )

    local running
    running=$(ssh "$ssh_host" "su - dev -c 'tmux has-session -t $session 2>/dev/null && echo yes || echo no'" 2>/dev/null)
    if [[ "$running" == "yes" ]]; then
      echo "$bot 已在 $location 运行"
      exit 0
    fi

    local remote_cmd="export PATH=\$HOME/.bun/bin:\$PATH && DISCORD_BOT_TOKEN=$token"
    [[ -n "$state_dir" ]] && remote_cmd="$remote_cmd DISCORD_STATE_DIR=$state_dir"
    remote_cmd="$remote_cmd claude --dangerously-skip-permissions --channels plugin:discord@claude-plugins-official"

    echo "启动 $bot ($location via SSH)..."
    echo "  工作目录: $work_dir"
    ssh "$ssh_host" "su - dev -c 'tmux new-session -d -s $session -c $work_dir \"$remote_cmd\"'" 2>&1
    echo "✅ $bot 已在 $location 启动"
    inject_identity "$bot" "$session" "$location" "$role" &
  fi
}

# ── stop ──
do_stop() {
  local bot="$1" location_override="$2"

  local exists
  exists=$(jq -r --arg b "$bot" '[.[] | select(.name == $b)] | length' "$POOL")
  if [[ "$exists" == "0" ]]; then
    echo "错误: 未知 bot '$bot'"
    exit 1
  fi

  local location session
  location="${location_override:-$(get_field "$bot" "location")}"
  session="hq-$bot"

  if [[ "$location" == "local" ]]; then
    tmux kill-session -t "$session" 2>/dev/null && echo "✅ $bot 已停止" || echo "$bot 未在运行"
  else
    local ssh_host
    ssh_host=$(location_to_ssh "$location")
    ssh "$ssh_host" "su - dev -c 'tmux kill-session -t $session'" 2>/dev/null && echo "✅ $bot 已在 $location 停止" || echo "$bot 未在 $location 运行"
  fi
}

# ── 解析参数 ──
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

  # 验证 --at 值
  if [[ -n "$at" && "$at" != "local" && "$at" != "singapore" && "$at" != "germany" ]]; then
    echo "错误: --at 只能是 local / singapore / germany"
    exit 1
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

# ── 路由 ──
case "$ACTION" in
  start)
    [[ -z "$BOT" ]] && { echo "用法: $0 start <bot> [work-dir] [--role <role>] [--at <location>]"; exit 1; }
    shift 2  # 跳过 action 和 bot
    parse_start_args "$BOT" "$@"
    ;;
  stop)
    [[ -z "$BOT" ]] && { echo "用法: $0 stop <bot> [--at <location>]"; exit 1; }
    shift 2
    parse_stop_args "$BOT" "$@"
    ;;
  inject)
    [[ -z "$BOT" ]] && { echo "用法: $0 inject <bot> <role>"; exit 1; }
    do_inject "$BOT" "$EXTRA"
    ;;
  status)
    do_status
    ;;
  *)
    echo "HQ Bot Manager"
    echo ""
    echo "用法:"
    echo "  $0 start <bot> [work-dir] [--role <role>] [--at <loc>]   启动 bot"
    echo "  $0 stop <bot> [--at <loc>]                               停止 bot"
    echo "  $0 inject <bot> <role>                                   热注入角色"
    echo "  $0 status                                                查看全部状态"
    echo ""
    echo "Bot: $ALL_BOTS"
    echo "位置: local / singapore / germany"
    echo "角色: $(ls "$ROLES_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')"
    echo ""
    echo "例子:"
    echo "  $0 start pilot                              # 默认位置+目录"
    echo "  $0 start pilot ~/workspace/sysbuilder       # 指定目录"
    echo "  $0 start pilot --role writer                # 启动 + 写作角色"
    echo "  $0 start pilot --at singapore               # Pilot 跑到新加坡"
    echo "  $0 start forge --at local ~/workspace/sb    # Forge 拉回本地"
    echo "  $0 inject pilot writer                      # 热注入写作角色"
    echo "  $0 stop pilot                               # 停止（默认位置）"
    echo "  $0 stop pilot --at singapore                # 停在新加坡的 Pilot"
    echo "  $0 status"
    ;;
esac
