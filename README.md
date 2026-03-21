# discord-hq-fleet

Command a fleet of Claude Code bots from Discord. One person, multiple servers, zero manual SSH.

```
You (Discord)
 │
 ├── #general ── Sentinel (Hub — dispatches, never works)
 ├── #dev ────── Pilot (local) · Forge (singapore) · Archon (singapore)
 └── #infra ──── Citadel (germany)
```

Each bot is a Claude Code session with a Discord channel plugin. Sentinel receives your messages, dispatches work to specialized bots, and reports back. The bots run across your local machine and remote servers, managed through tmux and SSH.

## Why "Hub never works"

When a Claude Code session does heavy coding, it fills its context window and forgets to reply on Discord. The fix: Sentinel never does real work. It receives messages, spawns background subagents or delegates to other bots via @mention, then relays results. Its context stays clean, so it always responds.

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with the Discord channel plugin installed
- [jq](https://jqlang.github.io/jq/) for JSON parsing
- [tmux](https://github.com/tmux/tmux) for session management
- A Discord server with your bots invited

### Setup

1. **Create Discord bots** at the [Discord Developer Portal](https://discord.com/developers/applications). You need one bot per fleet member. Enable the **Message Content Intent** for each.

2. **Clone and configure:**
   ```bash
   git clone https://github.com/yourname/discord-hq-fleet.git
   cd discord-hq-fleet

   cp .env.example .env          # Fill in your bot tokens
   cp bot-pool.json.example bot-pool.json  # Fill in your bot IDs
   ```

3. **Apply the multi-instance patch** (required if running 2+ bots on the same machine):
   ```bash
   cd ~/.claude/plugins/cache/claude-plugins-official/discord/0.0.1/
   git apply /path/to/discord-hq-fleet/patches/state-dir.patch
   ```
   This adds `DISCORD_STATE_DIR` support — one line that lets multiple bot instances coexist. See [Multi-Instance Isolation](#multi-instance-isolation) for details.

4. **Create identity files** for your bots:
   ```bash
   # Copy the examples and customize
   cp identities/sentinel.md.example identities/sentinel.md
   cp identities/pilot.md.example identities/pilot.md
   # ... edit with your bot names, IDs, and channel IDs
   ```

5. **Start your first bot:**
   ```bash
   ./spawn.sh start sentinel
   # ✅ sentinel 已启动。附加: tmux attach -t hq-sentinel
   ```

## Commands

### Start a bot

```bash
./spawn.sh start <bot>                          # Default location + directory
./spawn.sh start <bot> ~/workspace/project      # Custom working directory
./spawn.sh start <bot> --role writer            # Start with a role overlay
./spawn.sh start <bot> --at singapore           # Override default location
./spawn.sh start forge --at local ~/my-project  # Combine: location + directory
```

### Stop a bot

```bash
./spawn.sh stop <bot>                           # Stop at default location
./spawn.sh stop <bot> --at singapore            # Stop at overridden location
```

### Hot-inject a role

```bash
./spawn.sh inject <bot> writer                  # Add role without restart
./spawn.sh inject <bot> reviewer                # Switch expertise on the fly
```

### Fleet status

```bash
./spawn.sh status
# === HQ Bot Fleet ===
#   ✅ sentinel (local) — tmux attach -t hq-sentinel
#   ✅ pilot (local) — tmux attach -t hq-pilot
#   ✅ archon (singapore)
#   ⬚  forge (singapore)
#   ⚠️  citadel (germany) — SSH unreachable
```

## Identity System

Two-layer design: **base identity** + **role overlay**.

### Base Identity (`identities/<bot>.md`)

Injected automatically on startup. Contains:
- Bot name, Discord username, Bot ID
- Role in the fleet (hub, guide, field-agent, dev-worker, infra-worker)
- Team roster (who to contact for what)
- Channel list with IDs
- Behavioral rules (always reply via Discord, report concisely)
- Discord formatting guide (what renders, what doesn't)

### Role Overlay (`identities/roles/<role>.md`)

Injected on startup with `--role` or hot-injected later with `inject`. Adds domain expertise:

- **writer** — Content creation (blog posts, social media, copywriting)
- **reviewer** — Code review (bug > security > logic > performance)
- **ops** — Server operations (Docker, databases, networking)

Add new roles by creating `identities/roles/<name>.md`. The file is a prompt that starts with "You are now assigned an additional role:" followed by domain-specific principles and procedures.

### How injection works

1. `spawn.sh` starts Claude Code in a tmux session with the Discord plugin
2. Waits for Claude to initialize (polls for "Listening for channel messages")
3. Sends the identity prompt via `tmux send-keys`
4. For remote bots: writes the prompt to a temp file on the server, then injects via SSH

## Multi-Instance Isolation

The Discord plugin hardcodes its state directory to `~/.claude/channels/discord/`. Two bots on the same machine would share `access.json` and conflict.

**The fix — one line:**

```diff
- const STATE_DIR = join(homedir(), '.claude', 'channels', 'discord')
+ const STATE_DIR = process.env.DISCORD_STATE_DIR
+   ?? join(homedir(), '.claude', 'channels', 'discord')
```

When `DISCORD_STATE_DIR` is not set, behavior is unchanged. Set it per bot to isolate state:

```json
{
  "name": "pilot",
  "state_dir": "~/.claude/channels/discord-pilot"
}
```

`spawn.sh` reads `state_dir` from `bot-pool.json` and passes it as an environment variable. All derived paths (access.json, approved users, inbox) inherit from this single variable.

**Caveat:** The `/discord:access` and `/discord:configure` skills have hardcoded paths. For non-default bots, configure access manually instead of using these skills.

## Configuration Files

### `bot-pool.json`

```json
[
  {
    "name": "sentinel",
    "bot_id": "YOUR_BOT_ID",
    "token_env": "DISCORD_BOT_TOKEN_SENTINEL",
    "state_dir": "",
    "default_dir": "~/workspace/automation",
    "location": "local",
    "role": "hub"
  }
]
```

- **name**: Used for tmux session name (`hq-<name>`) and identity file lookup
- **bot_id**: Discord bot ID (from Developer Portal)
- **token_env**: Name of the environment variable holding the bot token
- **state_dir**: Custom state directory (empty = default). Required for 2+ bots on same machine
- **default_dir**: Working directory when none is specified
- **location**: `local`, `singapore`, or `germany` (maps to SSH hosts)
- **role**: Descriptive label

### `.env`

```bash
DISCORD_BOT_TOKEN_SENTINEL=your-token-here
DISCORD_BOT_TOKEN_PILOT=your-token-here
# ... one per bot
```

### SSH Host Mapping

Remote locations are mapped to SSH hosts in `spawn.sh`:

```bash
location_to_ssh() {
  case "$1" in
    singapore) echo "your-singapore-host" ;;
    germany)   echo "your-germany-host" ;;
  esac
}
```

Edit this function to match your SSH config (`~/.ssh/config`).

## Patch Checker

Verify that the Discord plugin patches are applied across all nodes:

```bash
./check-patch.sh
# === Local plugin patch check ===
#   ✅ STATE_DIR env var support
#   ✅ PARTNER_BOT_IDS
#   ✅ presence: online
```

The script checks local and remote nodes via SSH.

## Known Limitations

- **`--channels` flag is required** — Installing the Discord plugin is not enough. Claude Code must be started with `--channels plugin:discord@claude-plugins-official` to receive inbound messages.
- **One bot per session** — The plugin architecture does not support multiple bots in a single Claude Code session. N bots = N sessions.
- **Plugin updates overwrite patches** — After `plugin install discord@claude-plugins-official`, re-apply the state-dir patch.
- **hCaptcha on bot creation** — Creating and inviting Discord bots triggers hCaptcha. Cannot be automated.
- **Bot presence** — Some bots may not show as "online" in Discord unless the `presence: { status: "online" }` patch is applied to `server.ts`.

## Repo Structure

```
discord-hq-fleet/
├── README.md
├── LICENSE
├── .env.example
├── bot-pool.json.example
├── spawn.sh
├── check-patch.sh
├── identities/
│   ├── sentinel.md.example
│   ├── pilot.md.example
│   ├── archon.md.example
│   ├── forge.md.example
│   ├── citadel.md.example
│   ├── _discord-formatting.md
│   └── roles/
│       ├── writer.md
│       ├── reviewer.md
│       └── ops.md
├── skill/
│   └── SKILL.md
├── patches/
│   └── state-dir.patch
└── docs/
    ├── ARCHITECTURE.md
    └── TROUBLESHOOTING.md
```

## License

MIT
