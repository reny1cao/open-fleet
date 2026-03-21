#!/bin/bash
# lib/deps.sh — Dependency check and installation
#
# Checks for required tools and installs missing ones.
# Used by: fleet deps

detect_pkg_manager() {
  if command -v brew &>/dev/null; then echo "brew"
  elif command -v apt-get &>/dev/null; then echo "apt"
  elif command -v dnf &>/dev/null; then echo "dnf"
  elif command -v pacman &>/dev/null; then echo "pacman"
  else echo ""
  fi
}

install_pkg() {
  local pkg="$1" pm
  pm=$(detect_pkg_manager)
  case "$pm" in
    brew)   brew install "$pkg" ;;
    apt)    sudo apt-get install -y "$pkg" ;;
    dnf)    sudo dnf install -y "$pkg" ;;
    pacman) sudo pacman -S --noconfirm "$pkg" ;;
    *)      fail "Cannot auto-install $pkg — no supported package manager"
            echo "    Install manually, then re-run."
            return 1 ;;
  esac
}

confirm_install() {
  local ans
  read -rp "  Install now? [Y/n] " ans
  [[ -z "$ans" || "$ans" =~ ^[Yy] ]]
}

do_deps() {
  local auto_install=false
  [[ "${1:-}" == "--install" ]] && auto_install=true

  echo ""
  printf "${bold}fleet deps${reset} — Dependency check\n"
  echo "──────────────────────────────────"

  local missing=() installed=()

  # ── Required ──
  step "[Required]"

  # jq
  if command -v jq &>/dev/null; then
    ok "jq $(jq --version 2>/dev/null || echo '')"
  else
    if $auto_install; then
      echo "  Installing jq..."
      install_pkg jq && ok "jq installed" || fail "jq install failed"
    else
      fail "jq — not found"
      missing+=("jq")
    fi
  fi

  # tmux
  if command -v tmux &>/dev/null; then
    ok "tmux $(tmux -V 2>/dev/null | awk '{print $2}')"
  else
    if $auto_install; then
      echo "  Installing tmux..."
      install_pkg tmux && ok "tmux installed" || fail "tmux install failed"
    else
      fail "tmux — not found"
      missing+=("tmux")
    fi
  fi

  # Python3
  if command -v python3 &>/dev/null; then
    ok "python3 $(python3 --version 2>&1 | awk '{print $2}')"
  else
    fail "python3 — not found"
    missing+=("python3")
  fi

  # PyYAML
  if python3 -c "import yaml" 2>/dev/null; then
    ok "PyYAML"
  else
    if $auto_install; then
      echo "  Installing PyYAML..."
      pip3 install pyyaml 2>/dev/null && ok "PyYAML installed" || fail "PyYAML install failed"
    else
      fail "PyYAML — not installed (pip3 install pyyaml)"
      missing+=("pyyaml")
    fi
  fi

  # curl
  if command -v curl &>/dev/null; then
    ok "curl $(curl --version 2>/dev/null | head -1 | awk '{print $2}')"
  else
    fail "curl — not found"
    missing+=("curl")
  fi

  # Claude Code
  if command -v claude &>/dev/null; then
    ok "claude"
  else
    if $auto_install; then
      if command -v npm &>/dev/null; then
        echo "  Installing Claude Code..."
        npm install -g @anthropic-ai/claude-code 2>/dev/null && ok "claude installed" || fail "claude install failed"
      else
        fail "claude — not found (npm not available for auto-install)"
        echo "    Install: npm install -g @anthropic-ai/claude-code"
      fi
    else
      fail "claude — not found"
      echo "    Install: npm install -g @anthropic-ai/claude-code"
      missing+=("claude")
    fi
  fi

  # ── Optional ──
  step "[Optional]"

  # bun
  if command -v bun &>/dev/null; then
    ok "bun $(bun --version 2>/dev/null)"
  else
    if $auto_install; then
      echo "  Installing bun..."
      curl -fsSL https://bun.sh/install | bash 2>/dev/null
      export PATH="$HOME/.bun/bin:$PATH"
      ok "bun installed"
    else
      warn "bun — not found (needed for Discord plugin)"
      echo "    Install: curl -fsSL https://bun.sh/install | bash"
    fi
  fi

  # ── Skip onboarding wizard ──
  if [[ ! -f "$HOME/.claude/settings.json" ]]; then
    mkdir -p "$HOME/.claude"
    echo '{}' > "$HOME/.claude/settings.json"
    ok "Created ~/.claude/settings.json (skips onboarding wizard)"
  fi

  # ── Discord plugin ──
  step "[Discord Plugin]"

  local plugin_dir="$HOME/.claude/plugins/cache/claude-plugins-official/discord/0.0.1"
  if [[ -f "$plugin_dir/server.ts" ]]; then
    ok "Discord plugin installed"
  else
    if $auto_install; then
      echo "  Installing Discord plugin..."
      # Try official install first
      if claude plugin install discord@claude-plugins-official 2>/dev/null; then
        ok "Discord plugin installed"
      elif command -v git &>/dev/null; then
        # Fallback: clone from GitHub
        echo "  Official install failed, trying GitHub..."
        local tmp_plugin="/tmp/fleet-discord-plugin-$$"
        if git clone --depth=1 https://github.com/anthropics/claude-code-plugins.git "$tmp_plugin" 2>/dev/null; then
          mkdir -p "$plugin_dir"
          cp -r "$tmp_plugin/discord/0.0.1/"* "$plugin_dir/" 2>/dev/null
          rm -rf "$tmp_plugin"
          if [[ -f "$plugin_dir/server.ts" ]]; then
            ok "Discord plugin installed from GitHub"
          else
            fail "Discord plugin install failed"
            missing+=("discord-plugin")
          fi
        else
          fail "Could not download Discord plugin"
          missing+=("discord-plugin")
        fi
      else
        fail "Discord plugin — could not install"
        missing+=("discord-plugin")
      fi
    else
      fail "Discord plugin not installed"
      echo "    Run: fleet deps --install"
      missing+=("discord-plugin")
    fi
  fi

  # ── Claude Code auth ──
  step "[Claude Code Auth]"

  if command -v claude &>/dev/null; then
    if claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
      ok "Claude Code logged in"
    else
      warn "Claude Code not logged in"
      echo "    Run: claude auth login"
      echo "    On remote server: copy the URL, open in local browser, complete login"
    fi
  fi

  # ── Summary ──
  echo ""
  if [[ ${#missing[@]} -eq 0 ]]; then
    echo "  All dependencies satisfied."
  else
    echo "  Missing: ${missing[*]}"
    echo "  Run: fleet deps --install"
  fi
  echo ""
}
