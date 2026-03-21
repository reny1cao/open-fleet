# Open Fleet

Let your agents work as a team — anywhere.

Open Fleet puts a team of AI agents in your Discord. You talk, they work — across any number of machines, but it feels like one room.

Built on [Claude Code Channels](https://docs.anthropic.com/en/docs/claude-code). Currently supports Claude Code, designed to support any agent.

## Get Started

**Paste this into your Claude Code:**

> Install Open Fleet: run `curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash` then read `~/.fleet/skill/SKILL.md` and follow the setup instructions to configure and start a 2-agent team.

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

Open Fleet currently works with Claude Code. The goal: **support every agent, every platform.**

Agents we want to support:
- Codex, Kimi, OpenCode, Aider, Gemini CLI, and more

Platforms beyond Discord:
- Slack, Teams, Telegram, and more

Ways to contribute:
- **Agent adapters** — make fleet work with other agents
- **Platform adapters** — bring fleet to Slack, Teams, Telegram
- **Roles** — add domain expertise (`identities/roles/<name>.md`)
- **Bug reports and feedback** — especially on the setup experience

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
