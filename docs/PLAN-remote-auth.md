# Plan: Seamless Remote Authentication

## Problem

`install.sh` must handle Claude Code authentication on remote/headless servers (no browser) as part of a single command. Currently, `claude auth login --claudeai` on a remote server shows a URL but doesn't provide a way to paste the token back.

## What We Learned (2026-03-21)

### Claude Code Auth Methods (from official docs)

| Method | How | Billing | Use Case |
|--------|-----|---------|----------|
| `claude auth login` | OAuth browser flow | Subscription | Local machine with browser |
| `claude setup-token` | Generate long-lived token locally | Subscription | **Headless/remote servers** |
| `ANTHROPIC_API_KEY` | Console API key | Pay-per-use | CI/CD, scripts |
| SSH port forwarding | `-L 8080:localhost:8080` | Subscription | One-time remote setup |

### Key Findings

1. `claude setup-token` generates a `sk-ant-oat01-...` token (valid 1 year) on a machine with a browser
2. Remote server reads `CLAUDE_CODE_OAUTH_TOKEN` env var — no browser needed
3. Remote server needs `~/.claude.json` with `{"hasCompletedOnboarding": true}` to skip onboarding wizard
4. Env var precedence: Cloud providers > `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` > Subscription OAuth

### What Failed

- `claude auth login --claudeai` in tmux background: can't capture URL reliably (tmux width truncation)
- `claude auth login --claudeai` with tmux attach: user sees URL in one terminal, attach jumps to another
- `claude auth login --claudeai` foreground: URL shows but no stdin prompt for token paste on headless
- Printing URL before attach: user can't see it after attach

## Proposed Solution

### User Flow (single command)

**Local install (has browser):**
```
./install.sh
→ detects local environment
→ runs `claude auth login --claudeai` foreground
→ browser opens, user logs in
→ done
```

**Remote install (headless):**
```
./install.sh
→ detects remote/headless environment (no DISPLAY, SSH_TTY set)
→ detects no CLAUDE_CODE_OAUTH_TOKEN in env
→ prompts: "Remote server detected. You need a setup token."
→ option A: user already has token → paste it → script saves to .bashrc + .claude.json
→ option B: user doesn't have token → script prints instructions:
    "On your local machine (with browser), run: claude setup-token"
    "Then re-run: ./install.sh --token sk-ant-oat01-..."
→ validates token with `claude auth status`
→ continues to Phase 3+
```

**Remote install with token pre-provided:**
```
./install.sh --token sk-ant-oat01-...
→ saves token to ~/.bashrc (CLAUDE_CODE_OAUTH_TOKEN)
→ creates ~/.claude.json with hasCompletedOnboarding: true
→ validates claude auth status
→ continues
```

### Detection Logic

```bash
is_headless() {
  # No display + SSH session = headless
  [[ -z "$DISPLAY" && -n "$SSH_TTY" ]] || [[ -z "$DISPLAY" && -n "$SSH_CONNECTION" ]]
}
```

### Token Storage on Remote

```bash
# Save to .bashrc for persistence
echo 'export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."' >> ~/.bashrc

# Create onboarding bypass
cat > ~/.claude.json << 'EOF'
{"hasCompletedOnboarding": true}
EOF
```

### fleet.yaml Integration (future)

```yaml
# fleet.yaml could store token reference per server
servers:
  singapore:
    ssh_host: sg-dev
    user: dev
    claude_token_env: CLAUDE_CODE_OAUTH_TOKEN  # read from remote .bashrc
  germany:
    ssh_host: de-srv
    user: dev
    claude_token_env: CLAUDE_CODE_OAUTH_TOKEN
```

## What Was Built Today (2026-03-21)

### HQ Skill & Scripts
- Reviewed and optimized `/hq` skill
- spawn.sh rewritten → reads from `bot-pool.json` + `.env`
- Tokens moved from hardcoded to `.env` (gitignored)
- Deleted redundant `status.sh`
- Fixed `check-patch.sh` to include Germany
- Fixed Singapore bun PATH issue (`.bashrc` non-interactive guard)
- Fixed `PARTNER_BOT_IDS` missing Sentinel
- Fixed Pilot/Forge `access.json` missing channel IDs

### Identity System
- 5 identity files (`identities/<bot>.md`)
- 3 role files (`identities/roles/writer.md, reviewer.md, ops.md`)
- Discord formatting rules (`_discord-formatting.md`)
- Identity injection: polls "Listening for channel messages" before injecting
- `--role` flag for startup role overlay
- `inject` command for hot role injection without restart

### Fleet CLI
- `spawn.sh` → `fleet` (no extension, PATH-installable)
- `--at` flag: any bot can run at any location
- Shell completions (bash + zsh)
- `install.sh`: 6-phase guided setup
- `setup.sh`: config template copier

### GitHub Repo
- `discord-hq-fleet` private repo created
- All files sanitized (no real tokens/IDs)
- README + ARCHITECTURE + TROUBLESHOOTING docs
- `fleet.yaml.example` for declarative topology
- Patches for multi-instance isolation + bot-to-bot comms

### Research
- Competitive landscape analysis (CrewAI, AutoGen, LangGraph, MetaGPT, OpenClaw, herdctl)
- Positioning: "operating model, not framework" / "380 lines of bash, not 90K lines of Python"
- Anthropic Agent Teams: single-machine only, cross-server is our unique space
- Content planning for public launch (tweet + WeChat article)

### Bot Fleet Operations
- Started Pilot, Archon, Forge successfully
- GitHub SSH configured for Singapore + Germany
- Nuremberg: created dev user, installed bun + Claude Code + jq
- Cloned repo on Nuremberg, ran setup.sh successfully

## Next Steps

1. [ ] Implement remote auth flow in `install.sh` (this plan)
2. [ ] Test full install on Nuremberg end-to-end
3. [ ] Finalize project name (npm-available, agent-agnostic)
4. [ ] Public launch: tweet + WeChat article
5. [ ] Make repo public when ready
