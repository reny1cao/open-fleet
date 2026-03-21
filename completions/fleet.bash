#!/bin/bash
# Bash completion for fleet CLI
# Source this file or install via install.sh

_fleet_completions() {
  local cur prev words cword
  _init_completion || return

  local commands="start stop inject status init doctor help version"

  # Find fleet.yaml: check FLEET_CONFIG, then cwd, then relative to fleet binary
  local fleet_yaml=""
  if [[ -n "${FLEET_CONFIG:-}" && -f "$FLEET_CONFIG" ]]; then
    fleet_yaml="$FLEET_CONFIG"
  elif [[ -f "./fleet.yaml" ]]; then
    fleet_yaml="./fleet.yaml"
  else
    local fleet_bin
    fleet_bin=$(command -v fleet 2>/dev/null)
    [[ -L "$fleet_bin" ]] && fleet_bin=$(readlink -f "$fleet_bin")
    local fleet_dir=$(dirname "$fleet_bin" 2>/dev/null)
    [[ -f "$fleet_dir/fleet.yaml" ]] && fleet_yaml="$fleet_dir/fleet.yaml"
  fi

  local agents="" servers="" roles=""
  if [[ -n "$fleet_yaml" && -f "$fleet_yaml" ]]; then
    agents=$(python3 -c "
import yaml, sys
with open(sys.argv[1]) as f:
    d = yaml.safe_load(f)
for a in d.get('agents', {}): print(a)
" "$fleet_yaml" 2>/dev/null | tr '\n' ' ')
    servers=$(python3 -c "
import yaml, sys
with open(sys.argv[1]) as f:
    d = yaml.safe_load(f)
for s in d.get('servers', {}): print(s)
" "$fleet_yaml" 2>/dev/null | tr '\n' ' ')
  fi

  # Roles from identities/roles/ directory
  local roles_dir=""
  if [[ -n "$fleet_yaml" ]]; then
    roles_dir="$(dirname "$fleet_yaml")/identities/roles"
  fi
  if [[ -d "$roles_dir" ]]; then
    roles=$(ls "$roles_dir"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ' ')
  fi

  case "$cword" in
    1)
      COMPREPLY=($(compgen -W "$commands" -- "$cur"))
      ;;
    2)
      case "${words[1]}" in
        start|stop|inject)
          COMPREPLY=($(compgen -W "$agents" -- "$cur"))
          ;;
      esac
      ;;
    *)
      case "${words[1]}" in
        start)
          case "$prev" in
            --role)
              COMPREPLY=($(compgen -W "$roles" -- "$cur"))
              ;;
            --at)
              COMPREPLY=($(compgen -W "local $servers" -- "$cur"))
              ;;
            *)
              COMPREPLY=($(compgen -W "--role --at" -- "$cur"))
              COMPREPLY+=($(compgen -d -- "$cur"))
              ;;
          esac
          ;;
        stop)
          case "$prev" in
            --at)
              COMPREPLY=($(compgen -W "local $servers" -- "$cur"))
              ;;
            *)
              COMPREPLY=($(compgen -W "--at" -- "$cur"))
              ;;
          esac
          ;;
        inject)
          if [[ "$cword" -eq 3 ]]; then
            COMPREPLY=($(compgen -W "$roles" -- "$cur"))
          fi
          ;;
      esac
      ;;
  esac
}

complete -F _fleet_completions fleet
