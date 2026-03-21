# Open Fleet

Let your coding agents work as a team — anywhere.

```
You (Discord)
 │
 └── #dev ── Hub (dispatches) · Worker (executes) · Worker-2 (reviews)
```

Open Fleet is a CLI that spins up coding agents on any machine and lets them collaborate through Discord. One agent dispatches tasks, others execute. Add more agents when you need them, wherever you need them.

Built on [Claude Code Channels](https://docs.anthropic.com/en/docs/claude-code). Currently supports Claude Code, designed to support any coding agent.

## Why

A single coding agent gets overwhelmed — context fills up, it stops responding. The fix: don't make one agent do everything. Split the work. The dispatcher (hub) stays responsive because it never does heavy work. Workers go deep.

## Quick Start (5 minutes)

### 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash
```

Or clone manually:
```bash
git clone https://github.com/reny1cao/open-fleet.git
cd open-fleet
./install.sh
```

### 2. Create 2 Discord bots

Go to [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application** → name it "Hub" → **Bot** tab → **Reset Token** → copy
2. Enable **Message Content Intent** (under Privileged Gateway Intents)
3. Repeat for a second bot called "Worker"

### 3. Set up your fleet

```bash
fleet init
```

Paste your tokens, pick a channel, name your agents. Done.

### 4. Invite bots to your Discord server

`fleet init` prints invite links. Click each one, select your server, authorize.

### 5. Start your team

```bash
fleet start hub
fleet start worker
fleet status

# === my-fleet Fleet ===
#   [on]  hub (local, hub)
#   [on]  worker (local, worker)
```

Message `@Hub` in your Discord channel. It dispatches to Worker, who does the work and reports back.

## Scale up: add remote servers

Once you outgrow a single machine, fleet scales to any number of servers:

```yaml
# fleet.yaml
servers:
  staging:
    ssh_host: my-staging-server
    user: dev

agents:
  hub:
    token_env: DISCORD_BOT_TOKEN_HUB
    role: hub
    server: local
  worker-remote:
    token_env: DISCORD_BOT_TOKEN_WORKER
    role: worker
    server: staging
```

```bash
fleet init --remote          # Enable multi-server configuration
fleet start worker-remote    # Starts on staging via SSH
```

No changes to the hub. It dispatches the same way whether workers are local or remote.

## Commands

```bash
# Core
fleet start <agent>                   # Start an agent
fleet stop <agent>                    # Stop an agent
fleet apply                           # Start all agents from fleet.yaml
fleet status                          # Who's online

# Setup
fleet init                            # Interactive setup (local mode)
fleet init --remote                   # Interactive setup (multi-server)
fleet init --token T --channel C      # Non-interactive (for agents/scripts)

# Maintenance
fleet inject <agent> <role>           # Hot-inject role (no restart)
fleet doctor                          # Health diagnostics
fleet deps --install                  # Check/install dependencies
fleet patch                           # Apply Discord plugin patches

# Flags (any command)
--json                                # Machine-readable output
--wait                                # Wait for agent to be ready (start)
--quiet                               # Minimal output
--force                               # Override safety checks (stop)
```

## Agent-Friendly

Fleet is designed for both humans and AI agents:

```bash
# Agent can set up a fleet programmatically
fleet init --token $TOKEN1 --token $TOKEN2 --channel $CHAN --name my-team

# Agent can check fleet status
fleet status --json
# [{"name":"hub","state":"running","server":"local","role":"hub"}]

# Agent can start with sync wait
fleet start worker --wait --json
# {"agent":"worker","state":"started","server":"local"}

# FLEET_SELF prevents agents from stopping themselves
fleet stop hub   # Refused if FLEET_SELF=hub
```

Install the `/fleet` skill so any agent can manage the team:
```bash
cp -r skill/ ~/.claude/skills/fleet/
```

## Identity System

Two layers: **base identity** + **role overlay**.

**Base identity** — injected on startup. Contains the agent's name, team roster, and behavioral rules.

**Role overlay** — hot-injectable domain expertise:

```bash
fleet inject worker writer      # Content creation mode
fleet inject worker reviewer    # Code review mode
fleet inject worker ops         # Server operations mode
```

Add custom roles by creating `identities/roles/<name>.md`.

## How It Works

1. `fleet start` launches Claude Code in a tmux session with the Discord channel plugin
2. Waits for Claude Code to initialize (polls for "Listening for channel messages")
3. Injects the identity prompt (team roster, channels, behavioral rules)
4. The agent is now live on Discord, ready to receive tasks

Multiple agents on the same machine use isolated state directories (`DISCORD_STATE_DIR`) to avoid conflicts. This requires a one-line patch to the Discord plugin, applied automatically by `fleet patch`.

## Configuration

### fleet.yaml

```yaml
fleet:
  name: my-fleet

discord:
  channel_id: "123456789"
  user_id: "987654321"

defaults:
  agent: claude-code
  runtime: claude
  workspace: ~/workspace

agents:
  hub:
    token_env: DISCORD_BOT_TOKEN_HUB
    role: hub
    server: local
  worker:
    token_env: DISCORD_BOT_TOKEN_WORKER
    role: worker
    server: local
    state_dir: ~/.fleet/state/discord-worker
```

### .env

```bash
DISCORD_BOT_TOKEN_HUB=your-hub-token
DISCORD_BOT_TOKEN_WORKER=your-worker-token
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error |
| 2 | Config error |
| 3 | Runtime error |
| 5 | Conflict (already running / stopping self) |

## Security

Agents run with `--dangerously-skip-permissions` (required for unattended operation). Mitigations:

- Run under a dedicated OS user with limited permissions
- Configure Discord `access.json` to restrict who can message bots
- Keep tokens in `.env` (gitignored)

## Known Limitations

- Discord plugin updates overwrite patches — re-run `fleet patch`
- Bot creation requires Discord Developer Portal (cannot be automated)
- One agent per tmux session
- Claude Code only (v0.1)

## License

MIT
