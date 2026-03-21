# Architecture

## Design Principles

### 1. Hub Never Works

The single most important architectural decision. When a Claude Code session performs heavy tasks (coding, file operations, long tool chains), it fills its context window and loses track of its Discord obligations. The bot literally forgets to reply.

**Solution:** Sentinel (the Hub) never performs real work. Its entire job is:

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
  → Sentinel relays to user
```

This keeps Sentinel's context window clean and responsive at all times.

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
- A shell script + tmux + SSH covers 95% of fleet management needs
- Complexity should live in the bots' prompts (identity files), not in infrastructure

`spawn.sh` is ~380 lines of bash. That's the entire management layer.

## System Topology

```
┌─────────────────────────────────────────────────────┐
│                   Discord Server                     │
│                                                      │
│  #general    #dev         #infra                     │
│  Sentinel    Pilot        Sentinel                   │
│  (all bots   Forge        Citadel                    │
│   listen)    Archon                                  │
└──────┬───────┬────────────┬─────────────────────────┘
       │       │            │
  ┌────▼────┐ ┌▼─────────┐ │
  │Local Mac│ │Singapore  │ │
  │         │ │VPS        │ │
  │Sentinel │ │Archon     │ ┌▼──────────┐
  │Pilot    │ │Forge      │ │Germany VPS│
  │         │ │           │ │Citadel    │
  └─────────┘ └───────────┘ └───────────┘

  Each box = tmux sessions running Claude Code + Discord plugin
  Communication = Discord messages (@mentions)
  Management = spawn.sh (local tmux / remote SSH + tmux)
```

## Bot Roles

### Sentinel (Hub)

- **Location:** Local machine
- **Purpose:** Dispatch only. Receives all user messages, routes to the right bot.
- **Key behavior:** Uses `Agent(run_in_background=true)` for local tasks, @mentions for remote tasks.
- **Never does:** File editing, coding, server operations, anything that fills context.

### Pilot (Guide)

- **Location:** Local machine
- **Purpose:** Reads local code, writes plans, reviews PRs, then sends instructions to remote bots via Discord.
- **Advantage:** Full access to local codebase — can read files, grep, analyze before giving precise instructions.
- **Pattern:** Read code locally → write specific instructions (file paths, commands, expected output) → post to #dev for Forge/Archon.

### Archon (Field Agent)

- **Location:** Remote server (e.g., Singapore)
- **Purpose:** General-purpose execution on the remote server. Operations, debugging, data tasks.
- **Pattern:** Receives instructions → executes on server → reports results back to Discord.

### Forge (Dev Worker)

- **Location:** Remote server (e.g., Singapore)
- **Purpose:** Focused coding. Receives development instructions from Pilot, writes code, runs tests.
- **Pattern:** Pilot sends spec → Forge implements → reports diff and test results.

### Citadel (Infra Worker)

- **Location:** Remote server (e.g., Germany)
- **Purpose:** Infrastructure operations. Docker, databases, networking, monitoring.
- **Key behavior:** Confirms before destructive operations (delete containers, modify networks).

## Identity Injection

### Timing

```
spawn.sh start <bot>
  │
  ├── Start Claude Code in tmux with DISCORD_BOT_TOKEN
  │
  ├── Poll tmux output for "Listening for channel messages" (max 60s)
  │   (Claude Code initialization + Discord Gateway IDENTIFY)
  │
  ├── Wait 3 more seconds (Gateway stabilization)
  │
  └── tmux send-keys "<identity prompt>"
      │
      ├── Base identity (identities/<bot>.md)
      │   "Read this identity and remember it..."
      │
      └── + Role overlay if --role specified (identities/roles/<role>.md)
          "You are now assigned an additional role..."
```

### Remote Injection

For remote bots, the prompt can't be sent directly via `tmux send-keys` (shell escaping nightmare across SSH). Instead:

1. Write the full prompt to a temp file on the remote server via SSH pipe
2. Use `tmux send-keys` on the remote to inject from that file
3. Clean up the temp file

### Hot Injection

`spawn.sh inject <bot> <role>` sends a role overlay to a running bot without restarting. The prompt starts with "You are now assigned an additional role" — Claude appends the new expertise to its existing identity.

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

`spawn.sh` reads `state_dir` from `bot-pool.json` and passes it as an environment variable when starting the Claude Code process.

### Why CLAUDE_PLUGIN_DATA doesn't help

The plugin framework provides `${CLAUDE_PLUGIN_DATA}` for per-plugin persistent storage. But:

1. The Discord plugin doesn't use it (the directory is empty)
2. Even if it did, it's per-plugin, not per-session — all instances of `discord@claude-plugins-official` would share the same directory

### What breaks

The `/discord:access` and `/discord:configure` skills have hardcoded paths to `~/.claude/channels/discord/`. Using these skills in a non-default bot session will modify the wrong files. Workaround: configure non-default bots manually.

## Communication Flow

### User → Bot (direct task)

```
User posts in #general: "Check disk usage on Singapore"
  → Sentinel receives (it monitors #general)
  → Sentinel @mentions Archon in #general: "Check disk usage"
  → Archon executes `df -h` on Singapore VPS
  → Archon replies in #general with results
  → User sees the reply directly
```

### User → Bot (development task)

```
User posts in #general: "Add rate limiting to the API"
  → Sentinel receives, routes to Pilot
  → Sentinel @mentions Pilot in #dev: "Add rate limiting to the API"
  → Pilot reads local codebase, writes implementation plan
  → Pilot @mentions Forge in #dev: specific instructions with file paths
  → Forge implements on remote server
  → Forge replies in #dev: diff + test results
  → Pilot reviews, requests changes or approves
  → Sentinel summarizes outcome in #general for user
```

## Star Topology (Why Not Others)

We evaluated four organizational models:

- **Star (Hub-and-spoke):** One coordinator, N workers. Chosen.
- **Hierarchy (Tree):** Multiple management layers. Overkill for a small fleet.
- **Mesh:** Everyone talks to everyone. Chaotic, no single point of command.
- **Squad:** Parallel teams with leads. Useful at scale, unnecessary now.

Star topology works because:
- One person is giving orders — only one entry point needed
- Sentinel as the single hub keeps routing simple
- Any bot can talk to any other via @mention if needed (escape hatch)
- Easy to reason about: user → Sentinel → the right bot
