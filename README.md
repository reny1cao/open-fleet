# Fleet

Command a fleet of AI coding agents from Discord. One person, multiple servers, zero SSH.

```
You (Discord)
 │
 ├── #general ── Hub (dispatcher — receives tasks, never does heavy work)
 ├── #dev ────── Worker-1 (local) · Worker-2 (staging)
 └── #infra ──── Worker-3 (production)
```

Each agent is a Claude Code session with a Discord channel plugin, managed via tmux and SSH. The hub receives your messages, delegates to workers, and reports back.

## Why "Hub never works"

When a Claude Code session does heavy coding, it fills its context window and forgets to reply on Discord. The fix: the hub never does real work. It dispatches to workers via @mention and relays results. Its context stays clean, so it always responds.

## Quick Start

### 1. Install (2 minutes)

```bash
git clone https://github.com/reny1cao/discord-hq-fleet.git
cd discord-hq-fleet
./setup.sh
```

`setup.sh` installs dependencies (jq, tmux, bun, Claude Code), applies Discord plugin patches, creates config templates, and adds `fleet` to your PATH.

### 2. Create Discord bots (5 minutes)

Go to the [Discord Developer Portal](https://discord.com/developers/applications):

1. Click **New Application** → name it (e.g. "Hub")
2. Go to **Bot** tab → click **Reset Token** → copy it
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. Repeat for each agent you want (minimum 2: one hub + one worker)

### 3. Configure (3 minutes)

```bash
fleet init
```

`fleet init` walks you through:
- Pasting bot tokens (validated via Discord API)
- Selecting your Discord server
- Mapping channels
- Generating `fleet.yaml` and `.env`

Or configure manually:

```bash
cp fleet.yaml.example fleet.yaml   # Edit: servers, agents, Discord IDs
cp .env.example .env               # Paste bot tokens
```

### 4. Invite bots to your server

`fleet init` generates invite links. Or build them manually:

```
https://discord.com/oauth2/authorize?client_id=YOUR_BOT_ID&scope=bot&permissions=68608
```

### 5. Start your fleet

```bash
fleet apply               # Start all agents from fleet.yaml
fleet status              # See who's online

# === my-fleet Fleet ===
#   [on]  hub (local, hub) — tmux attach -t my-fleet-hub
#   [on]  worker-1 (local, worker)
#   [off] worker-2 (staging, worker)
```

## Commands

```bash
fleet apply                                  # Start all agents from fleet.yaml
fleet start <agent>                          # Start at default server
fleet start <agent> --wait --json            # Wait for ready, JSON output
fleet start <agent> --role writer            # Start with role overlay
fleet start <agent> --at staging             # Override server location
fleet stop <agent>                           # Stop
fleet stop <agent> --at staging              # Stop at overridden location
fleet inject <agent> <role>                  # Hot-inject role (no restart)
fleet status                                 # Fleet overview
fleet status --json                          # Machine-readable JSON
fleet doctor                                 # Diagnose issues
fleet doctor --json                          # JSON diagnostics
fleet deps --install                         # Check/install dependencies
fleet patch                                  # Apply Discord plugin patches
fleet init                                   # Interactive setup
fleet init --token T --channel C --name N    # Non-interactive (for agents)
fleet help                                   # Show usage
```

### Flags

| Flag | Commands | Purpose |
|------|----------|---------|
| `--json` | status, start, stop, apply, doctor | Machine-readable JSON output |
| `--wait` | start, apply | Wait for identity injection before returning |
| `--force` | stop | Override FLEET_SELF protection |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error (unknown agent, missing args) |
| 2 | Config error (missing fleet.yaml, bad token) |
| 3 | Runtime error (SSH unreachable) |
| 5 | Conflict (already running, stopping yourself) |

## Configuration

### `fleet.yaml`

Single source of truth for your fleet topology:

```yaml
fleet:
  name: my-fleet                     # tmux prefix: my-fleet-<agent>

discord:
  server_id: "123456789"
  user_id: "987654321"               # your Discord user ID
  channels:
    general: "111111111"
    dev: "222222222"

servers:
  staging:
    ssh_host: staging-server         # SSH config alias
    user: dev                        # remote user

defaults:
  agent: claude-code
  runtime: claude
  workspace: ~/workspace
  channel_plugin: plugin:discord@claude-plugins-official

agents:
  hub:
    token_env: DISCORD_BOT_TOKEN_HUB
    role: hub
    server: local
    identity: identities/hub.md
  worker-1:
    token_env: DISCORD_BOT_TOKEN_WORKER1
    role: worker
    server: staging
    identity: identities/worker-1.md
```

### `.env`

```bash
DISCORD_BOT_TOKEN_HUB=your-token-here
DISCORD_BOT_TOKEN_WORKER1=your-token-here
```

## Identity System

Two-layer design: **base identity** + **role overlay**.

**Base identity** (`identities/<agent>.md`) — injected on startup. Contains the agent's name, team roster, channel list, and behavioral rules.

**Role overlay** (`identities/roles/<role>.md`) — adds domain expertise. Hot-inject without restart:

```bash
fleet inject worker-1 writer      # Now it writes content
fleet inject worker-1 reviewer    # Switch to code review mode
```

Built-in roles: `writer`, `reviewer`, `ops`. Add your own by creating `identities/roles/<name>.md`.

## Adding a Remote Server

1. Set up SSH access to your server (`~/.ssh/config`)
2. Install Claude Code on the remote server
3. Add to `fleet.yaml`:

```yaml
servers:
  production:
    ssh_host: prod-server
    user: deploy

agents:
  worker-prod:
    token_env: DISCORD_BOT_TOKEN_PROD
    role: worker
    server: production
```

4. Run `fleet start worker-prod`

## Multi-Instance on Same Machine

Running 2+ agents on one machine requires separate Discord plugin state directories:

```yaml
agents:
  hub:
    server: local
    # No state_dir needed — uses default
  worker-1:
    server: local
    state_dir: ~/.fleet/state/discord-worker1   # Isolated state
```

This requires the `state-dir` patch (applied automatically by `setup.sh`).

## Using as a Skill

Agents can manage the fleet from within conversations using the `/fleet` skill:

```bash
cp -r skill/ ~/.claude/skills/fleet/
```

Now any agent can run `/fleet status`, `/fleet start worker-2`, etc. The `FLEET_SELF` environment variable prevents an agent from stopping itself.

## Security

Agents run with `--dangerously-skip-permissions` (required for unattended operation). Mitigations:

- Run agents under a dedicated OS user with limited permissions
- Configure `access.json` to restrict who can message each bot
- Keep tokens in `.env` (gitignored)
- Identity rules like "confirm before destructive operations" provide soft guardrails

## Diagnostics

```bash
fleet doctor
```

Checks: prerequisites (python3, tmux, jq, claude, PyYAML), config validity, token verification via Discord API, plugin patches, SSH connectivity, remote node readiness, identity files, and state directories.

## Known Limitations

- Plugin updates overwrite patches — re-run `setup.sh` after updates
- Creating Discord bots requires manual Developer Portal interaction (hCaptcha)
- One bot per tmux session (N agents = N sessions)
- Bot presence requires the `presence` patch

## License

MIT
