#!/bin/bash
# Bash completion for fleet CLI
# Source this file or install via install.sh

_fleet_completions() {
  local cur prev words cword
  _init_completion || return

  local commands="start stop inject status"

  # Find the pool file relative to the fleet binary
  local fleet_bin
  fleet_bin=$(command -v fleet 2>/dev/null)
  if [[ -L "$fleet_bin" ]]; then
    fleet_bin=$(readlink -f "$fleet_bin")
  fi
  local pool_dir
  pool_dir=$(dirname "$fleet_bin" 2>/dev/null)
  local pool="$pool_dir/bot-pool.json"

  local bots="" roles="" locations=""
  if [[ -f "$pool" ]]; then
    bots=$(jq -r '.[].name' "$pool" 2>/dev/null | tr '\n' ' ')
    locations=$(jq -r '[.[].location] | unique | .[]' "$pool" 2>/dev/null | tr '\n' ' ')
  fi

  local roles_dir="$pool_dir/identities/roles"
  if [[ -d "$roles_dir" ]]; then
    roles=$(ls "$roles_dir"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')
  fi

  case "$cword" in
    1)
      # First arg: subcommand
      COMPREPLY=($(compgen -W "$commands" -- "$cur"))
      ;;
    2)
      # Second arg: bot name (for start/stop/inject)
      case "${words[1]}" in
        start|stop|inject)
          COMPREPLY=($(compgen -W "$bots" -- "$cur"))
          ;;
      esac
      ;;
    *)
      # Subsequent args: context-dependent
      case "${words[1]}" in
        start)
          case "$prev" in
            --role)
              COMPREPLY=($(compgen -W "$roles" -- "$cur"))
              ;;
            --at)
              COMPREPLY=($(compgen -W "local $locations" -- "$cur"))
              ;;
            *)
              COMPREPLY=($(compgen -W "--role --at" -- "$cur"))
              # Also complete directories
              COMPREPLY+=($(compgen -d -- "$cur"))
              ;;
          esac
          ;;
        stop)
          case "$prev" in
            --at)
              COMPREPLY=($(compgen -W "local $locations" -- "$cur"))
              ;;
            *)
              COMPREPLY=($(compgen -W "--at" -- "$cur"))
              ;;
          esac
          ;;
        inject)
          # Third arg for inject: role name
          if [[ "$cword" -eq 3 ]]; then
            COMPREPLY=($(compgen -W "$roles" -- "$cur"))
          fi
          ;;
      esac
      ;;
  esac
}

complete -F _fleet_completions fleet
