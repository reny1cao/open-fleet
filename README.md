# Open Fleet

Let your agents work as a team — anywhere.

Open Fleet puts a team of AI agents in your Discord. You talk, they work — across any number of machines, but it feels like one room.

Built on [Claude Code Channels](https://docs.anthropic.com/en/docs/claude-code). Currently supports Claude Code, designed to support any agent.

## Get Started

**Paste this into your Claude Code:**

> Install Open Fleet and help me set up an agent team: run `curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash` then read `~/.fleet/skill/SKILL.md` and follow the setup instructions.

We recommend starting with 2-3 agents. Each agent needs its own Discord bot application.

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
fleet status                     # Who's online (with heartbeat health)
fleet logs <agent>               # Tail an agent's output
fleet logs --all                 # Unified stream from all agents
fleet watch                      # Live dashboard — status + activity feed
fleet inject <agent> <role>      # Change an agent's role
fleet add-agent                  # Add a new agent to the fleet
fleet set-adapter <agent> codex  # Switch an existing agent to Codex or Claude
fleet doctor                     # Diagnose issues
fleet init                       # Set up a new fleet
```

All commands support `--json` for machine-readable output.

## Remote Servers

Remote agents run through SSH + tmux. Claude and Codex agents can both run on configured remote servers.

Defaults:
- Workspace defaults to `~/workspace`
- Agent state defaults to `~/.fleet/state/discord-<agent>`

Override `workspace` or `state_dir` per agent only when you need a custom layout.

## Team Knowledge

Drop files in `~/.fleet/docs/knowledge/` to share learnings across the fleet. Every agent inherits them automatically on boot — no restart needed.

```bash
# Add a new rule
echo "Always use MERGE not CREATE for Neo4j relationships" > ~/.fleet/docs/knowledge/neo4j-rules.md

# Next agent boot picks it up automatically
```

Filename = topic, content = rules. Agents see all knowledge docs in their context every turn.

## Contribute

Open Fleet currently supports Claude Code and Codex on Discord. The goal remains: **support every agent, every platform.**

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
