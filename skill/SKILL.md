---
name: fleet
description: Manage an AI coding agent fleet — start, stop, inject roles, check status, and diagnose issues across local and remote servers
user_invocable: true
---

# Fleet — Agent Fleet Manager

You manage a fleet of AI coding agents across multiple servers. Each agent is a Claude Code session with a Discord channel plugin. All operations go through the `fleet` CLI.

## First-Time Setup

Guide the user through each step. Assume they have nothing — no Discord server, no bots, no tokens.

### Step 1: Install fleet CLI
```bash
curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash
```

### Step 2: Discord server
Ask the user: "Do you have a Discord server for your fleet?"
- If yes: continue to Step 3
- If no: tell them to create one at https://discord.com/channels/@me — click "+" on the left sidebar to create a server. Come back when done.

### Step 3: Create Discord bots
Tell the user to go to https://discord.com/developers/applications and for each agent (minimum 2):
1. Click **New Application** → give it a name
2. Go to **Bot** tab → click **Reset Token** → copy the token (save it, only shown once)
3. Scroll down → enable **Message Content Intent** under Privileged Gateway Intents

### Step 4: Configure fleet
Once the user has tokens, run:
```bash
fleet init
```
This walks them through pasting tokens, selecting their Discord server, and naming agents.

For non-interactive setup (if you already have tokens and channel ID):
```bash
fleet init --token TOKEN1 --token TOKEN2 --channel CHANNEL_ID --name my-fleet
```

### Step 5: Invite bots
`fleet init` prints OAuth2 invite URLs. Tell the user to open each URL in their browser, select their server, and click Authorize.

### Step 6: Start the team
```bash
fleet start lead
fleet start worker
fleet status
```

The agents are now live in Discord. Message @Lead to give it a task.

## Discovery

```bash
fleet status          # Who's online, who's offline
fleet help            # Available commands
fleet doctor          # Full health check
```

## Commands

### "start <agent>"
```bash
fleet start <agent>
```

### "start <agent> at <path>"
```bash
fleet start <agent> <path>
```

### "start <agent> as <role>"
```bash
fleet start <agent> --role <role>
```

### "relocate <agent> to <server>"
```bash
fleet start <agent> --at <server>
```
Override the agent's default server location.

### Combine flags
```bash
fleet start worker --at staging ~/workspace/project --role writer
```
`--at`, `--role`, and workspace can be combined freely.

### "inject <agent> <role>"
```bash
fleet inject <agent> <role>
```
Hot-inject a role into a running agent without restart.

### "stop <agent>"
```bash
fleet stop <agent>
```
If the agent was started with `--at`, also pass `--at`:
```bash
fleet stop <agent> --at <server>
```

### "status"
```bash
fleet status
```

### "start all"
Run `start` for each agent sequentially. Skip agents already running.

### "stop all"
Run `stop` for each agent sequentially.

### "diagnose"
```bash
fleet doctor
```
Full health check: prerequisites, config, tokens, patches, SSH, remote nodes, identities.

### "initialize"
```bash
# Interactive (human)
fleet init

# Non-interactive (agent)
fleet init --token TOKEN1 --token TOKEN2 --channel 123456 --name my-fleet
fleet init --token TOKEN1 --channel 123456 --agent hub:local:hub --agent worker:staging:worker
```

## Agent-Friendly Flags

All commands support:
- `--json` — machine-readable JSON output (use this when parsing results)
- `--wait` — on `fleet start`, wait for identity injection to complete before returning
- `--force` — override safety checks (e.g., stopping yourself)

```bash
fleet status --json                    # JSON array of agent states
fleet start hub --json --wait          # JSON result, sync wait for ready
fleet stop worker --json               # JSON result
fleet doctor --json                    # JSON with pass/fail/checks array
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error (unknown agent, missing args) |
| 2 | Config error (missing fleet.yaml, bad token) |
| 3 | Runtime error (SSH unreachable) |
| 5 | Conflict (already running, or stopping yourself) |

## Roles

Available roles in `identities/roles/`:
- **writer** — Content creation
- **reviewer** — Code review
- **ops** — Server operations

Add new roles by creating `identities/roles/<name>.md`.

## Rules

1. **$FLEET_SELF is set automatically** — The CLI sets this env var when starting an agent. `fleet stop` will refuse to stop the agent named in $FLEET_SELF (use `--force` to override)
2. **Use --json for parsing** — Never parse human-readable output; always use `--json`
3. **Use --wait on start** — Ensures the agent is ready to receive messages before returning
4. **Report after start/stop** — Concisely state which agents started/stopped and where
5. **Use --at for non-default servers** — Stopping without it looks at the default server
6. **Run doctor for issues** — If something seems wrong, `fleet doctor --json` before manual debugging
