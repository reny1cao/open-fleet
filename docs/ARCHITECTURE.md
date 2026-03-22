# Architecture

## Design Principles

### 1. Hub Never Works

The single most important architectural decision. When a Claude Code session performs heavy tasks (coding, file operations, long tool chains), it fills its context window and loses track of its Discord obligations. The bot literally forgets to reply.

**Solution:** The hub agent never performs real work. Its entire job is:

```
Receive Discord message
  → Spawn background subagent (Agent tool, run_in_background=true)
  → Wait for <task-notification>
  → Reply on Discord with results
```

For cross-machine tasks:

```
Receive Discord message
  → @mention the appropriate remote bot on Discord
  → Remote bot executes (also via subagent)
  → Remote bot replies on Discord
  → Hub relays to user
```

This keeps the hub's context window clean and responsive at all times.

### 2. N Bots = N Sessions

We investigated running multiple bots in a single Claude Code session. Five blocking factors make it impossible:

1. `--channels` loads the same plugin only once per session
2. MCP server names are fixed (`"discord"`) — two servers would collide
3. Tool names collide — both expose `reply`, `react`, `fetch_messages`
4. Notifications carry no bot identifier — Claude can't tell which bot received a message
5. `--channels` doesn't accept the same plugin twice

**Conclusion:** Each bot requires its own Claude Code process. This is a fundamental constraint of the plugin architecture, not a design choice.

### 3. Thin Management Layer

An early blueprint proposed a full platform: Redis state management, unified gateway service, agent registry with health checks. We rejected it:

- Discord's plugin is already a gateway — rebuilding one is redundant
- Claude Code sessions aren't microservices — you can't spawn/kill them in milliseconds
- A CLI + tmux + SSH covers 95% of fleet management needs
- Complexity should live in the bots' prompts (identity files), not in infrastructure

`fleet` is ~2K lines of Bun/TypeScript. That's the entire management layer.

## System Topology

```
┌─────────────────────────────────────────────────────┐
│                   Discord Server                     │
│                                                      │
│  #general    #dev         #infra                     │
│  Hub         Worker B     Hub                        │
│  (all bots   Worker C     Worker D                   │
│   listen)                                            │
└──────┬───────┬────────────┬─────────────────────────┘
       │       │            │
  ┌────▼────┐ ┌▼─────────┐ │
  │Local Mac│ │Remote VPS │ │
  │         │ │           │ │
  │Hub      │ │Worker B   │ ┌▼──────────┐
  │Worker A │ │Worker C   │ │Remote VPS │
  │         │ │           │ │Worker D   │
  └─────────┘ └───────────┘ └───────────┘

  Each box = tmux sessions running Claude Code + Discord plugin
  Communication = Discord messages (@mentions)
  Management = fleet (local tmux / remote SSH + tmux)
```

Agent names and roles are defined in `fleet.yaml` — the fleet ships with no hardcoded agent identities. You name and describe each agent when you run `fleet init` or `fleet add-agent`.

## Bot Roles

Role names are user-defined. Common patterns:

- **Hub (Lead):** Dispatch only. Receives all user messages, routes to the right bot. Uses `Agent(run_in_background=true)` for local tasks, @mentions for remote tasks. Never does heavy work that fills context.
- **Local worker:** Full access to local codebase — reads files, greps, analyzes, sends precise instructions to remote bots.
- **Remote worker:** General-purpose execution on a remote server. Receives instructions → executes → reports results back to Discord.

Roles are assigned via identity files (`identities/<name>.md`). The `fleet add-agent` command generates these automatically from a template.

## Identity Injection

### How it works

Identity is loaded via Claude Code's `--append-system-prompt-file` flag. The fleet CLI passes the agent's identity file path at process startup — no tmux send-keys, no polling, no race condition.

```
fleet start <bot>
  │
  ├── Resolve identity file: identities/<bot>.md
  │   (+ role overlay appended if --role specified)
  │
  └── Launch Claude Code in tmux:
        claude --channels ... \
               --append-system-prompt-file identities/<bot>.md
```

The identity is part of the system prompt from the very first message. The bot knows who it is before any Discord message arrives.

### Role overlay

`fleet inject <bot> <role>` sends a role overlay to a running bot without restarting. The prompt starts with "You are now assigned an additional role" — Claude appends the new expertise to its existing identity.

For a clean role injection at start time, use `--role`:

```bash
fleet start worker --role reviewer
```

The CLI concatenates `identities/<bot>.md` and `identities/roles/reviewer.md` into a single temp file and passes it via `--append-system-prompt-file`.

## Multi-Instance Isolation

### The Problem

The Discord plugin stores its state (access control, approved users, message inbox) at a hardcoded path:

```
~/.claude/channels/discord/
├── access.json
├── approved/
├── .env
└── inbox/
```

Two bots on the same machine would read/write the same `access.json`, use the same token, and conflict.

### The Solution

One line added to the plugin's `server.ts`:

```typescript
const STATE_DIR = process.env.DISCORD_STATE_DIR
  ?? join(homedir(), '.claude', 'channels', 'discord')
```

- No env var set → original behavior (backwards compatible)
- `DISCORD_STATE_DIR=~/.claude/channels/discord-pilot` → fully isolated state

`fleet` reads the `state_dir` field from the agent's entry in `fleet.yaml` and passes it as `DISCORD_STATE_DIR` when starting the Claude Code process. The `fleet init` and `fleet add-agent` commands set this automatically for every agent after the first.

### Why CLAUDE_PLUGIN_DATA doesn't help

The plugin framework provides `${CLAUDE_PLUGIN_DATA}` for per-plugin persistent storage. But:

1. The Discord plugin doesn't use it (the directory is empty)
2. Even if it did, it's per-plugin, not per-session — all instances of `discord@claude-plugins-official` would share the same directory

### What breaks

The `/discord:access` and `/discord:configure` skills have hardcoded paths to `~/.claude/channels/discord/`. Using these skills in a non-default bot session will modify the wrong files. Workaround: configure non-default bots manually.

## Communication Flow

### User → Bot (direct task)

```
User posts in #general: "Check disk usage on the VPS"
  → Hub receives (it monitors #general)
  → Hub @mentions Ops in #general: "Check disk usage"
  → Ops executes `df -h` on remote VPS
  → Ops replies in #general with results
  → User sees the reply directly
```

### User → Bot (development task)

```
User posts in #general: "Add rate limiting to the API"
  → Hub receives, routes to Lead
  → Hub @mentions Lead in #dev: "Add rate limiting to the API"
  → Lead reads local codebase, writes implementation plan
  → Lead @mentions Coder in #dev: specific instructions with file paths
  → Coder implements on remote server
  → Coder replies in #dev: diff + test results
  → Lead reviews, requests changes or approves
  → Hub summarizes outcome in #general for user
```

## Star Topology (Why Not Others)

We evaluated four organizational models:

- **Star (Hub-and-spoke):** One coordinator, N workers. Chosen.
- **Hierarchy (Tree):** Multiple management layers. Overkill for a small fleet.
- **Mesh:** Everyone talks to everyone. Chaotic, no single point of command.
- **Squad:** Parallel teams with leads. Useful at scale, unnecessary now.

Star topology works because:
- One person is giving orders — only one entry point needed
- A single hub agent keeps routing simple
- Any bot can talk to any other via @mention if needed (escape hatch)
- Easy to reason about: user → Hub → the right bot
