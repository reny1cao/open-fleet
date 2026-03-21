# Open Fleet

Let your coding agents work as a team — anywhere.

One agent talks to you and understands what needs to happen. The others do the work — coding, reviewing, deploying — across any number of machines. They coordinate through Discord.

Currently supports [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Designed to support any coding agent.

## Get Started

**Tell your Claude Code:**

> Install Open Fleet and set up a 2-agent team on this machine. Repo: https://github.com/reny1cao/open-fleet

**Or do it yourself:**

```bash
curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash
fleet init
fleet start lead
fleet start worker
```

You'll need 2 Discord bot tokens ([how to create them](https://discord.com/developers/applications)). `fleet init` walks you through it.

## What You Get

```
You ──→ Lead (understands your intent, delegates, tests)
          ├──→ Worker-1 (writes code)
          ├──→ Worker-2 (reviews PRs)
          └──→ Worker-3 (manages infra on a remote server)
```

- **One machine or many** — start local, add remote servers when you need them
- **Hot-swap roles** — `fleet inject worker reviewer` changes what an agent does, no restart
- **Agent-friendly** — `--json` output, non-interactive setup, agents can manage the fleet themselves

## Commands

```bash
fleet start <agent>              # Start an agent
fleet stop <agent>               # Stop an agent
fleet apply                      # Start all agents
fleet status                     # Who's online
fleet inject <agent> <role>      # Change an agent's role
fleet doctor                     # Diagnose issues
fleet init                       # Set up a new fleet
```

All commands support `--json` for machine-readable output.

## Add a Remote Server

```yaml
# fleet.yaml
servers:
  staging:
    ssh_host: my-server
    user: dev

agents:
  worker-remote:
    token_env: DISCORD_BOT_TOKEN_WORKER
    role: worker
    server: staging
```

```bash
fleet start worker-remote    # Starts on the remote server via SSH
```

## Contribute

Open Fleet currently works with Claude Code. The goal: **support every coding agent** — Codex, Aider, Gemini CLI, and whatever comes next.

Ways to contribute:
- **Agent adapters** — make fleet work with other coding agents
- **Roles** — add domain expertise (`identities/roles/<name>.md`)
- **Channel adapters** — Slack, Teams, beyond Discord
- **Bug reports and feedback** — especially on the setup experience

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
