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

- A Discord server with your bots created and invited
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) logged in (the only manual step)

Everything else (`jq`, `tmux`, `bun`, Discord plugin, patches) is installed automatically.

### Setup

1. **Create Discord bots** at the [Discord Developer Portal](https://discord.com/developers/applications). You need one bot per fleet member. Enable the **Message Content Intent** for each.

2. **One command:**
   ```bash
   git clone https://github.com/reny1cao/discord-hq-fleet.git
   cd discord-hq-fleet
   ./install.sh
   ```

   The installer automatically:
   - Installs missing dependencies (jq, tmux, bun via your package manager)
   - Installs the Claude Code Discord plugin
   - Patches `server.ts` for multi-instance isolation + bot-to-bot communication + presence
   - Copies config templates (`.env`, `bot-pool.json`)
   - Installs the `fleet` CLI to `~/.local/bin/` with shell completions

   The only thing it can't do for you: **log in to Claude Code**. If you haven't logged in yet, the installer pauses and tells you to run `claude` in another terminal.

3. **Configure:**
   ```bash
   # Edit these with your bot tokens, IDs, and SSH hosts
   nano .env
   nano bot-pool.json

   # Add your bot IDs to the PARTNER_BOT_IDS set in server.ts
   nano ~/.claude/plugins/cache/claude-plugins-official/discord/0.0.1/server.ts
   ```

4. **Create identity files** for your bots:
   ```bash
   cp identities/sentinel.md.example identities/sentinel.md
   cp identities/pilot.md.example identities/pilot.md
   # ... edit with your bot names, IDs, and channel IDs
   ```

5. **Start your first bot:**
   ```bash
   fleet start sentinel
   # Done: sentinel started. Attach: tmux attach -t hq-sentinel
   ```

## Commands

### Start a bot

```bash
fleet start <bot>                          # Default location + directory
fleet start <bot> ~/workspace/project      # Custom working directory
fleet start <bot> --role writer            # Start with a role overlay
fleet start <bot> --at singapore           # Override default location
fleet start forge --at local ~/my-project  # Combine: location + directory
```

### Stop a bot

```bash
fleet stop <bot>                           # Stop at default location
fleet stop <bot> --at singapore            # Stop at overridden location
```

### Hot-inject a role

```bash
fleet inject <bot> writer                  # Add role without restart
fleet inject <bot> reviewer                # Switch expertise on the fly
```

### Fleet status

```bash
fleet status
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

1. `fleet` starts Claude Code in a tmux session with the Discord plugin
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

`fleet` reads `state_dir` from `bot-pool.json` and passes it as an environment variable. All derived paths (access.json, approved users, inbox) inherit from this single variable.

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
    "default_dir": "~/workspace",
    "location": "local",
    "role": "hub"
  },
  {
    "name": "archon",
    "bot_id": "YOUR_BOT_ID",
    "token_env": "DISCORD_BOT_TOKEN_ARCHON",
    "state_dir": "",
    "default_dir": "~/workspace",
    "location": "singapore",
    "ssh_host": "your-singapore-host",
    "remote_user": "dev",
    "role": "field-agent"
  }
]
```

- **name**: Used for tmux session name (`hq-<name>`) and identity file lookup
- **bot_id**: Discord bot ID (from Developer Portal)
- **token_env**: Name of the environment variable holding the bot token
- **state_dir**: Custom state directory (empty = default). Required for 2+ bots on same machine
- **default_dir**: Working directory when none is specified
- **location**: Any string label (e.g. `local`, `singapore`, `germany`). `local` means this machine; anything else is remote via SSH
- **ssh_host**: SSH host alias (from `~/.ssh/config`) for remote locations. Not needed for `local`
- **remote_user**: User to run commands as on remote servers (via `su -`). Defaults to current user if omitted. Not needed for `local`
- **role**: Descriptive label

### `.env`

```bash
DISCORD_BOT_TOKEN_SENTINEL=your-token-here
DISCORD_BOT_TOKEN_PILOT=your-token-here
# ... one per bot
```

Locations and SSH mappings are configured directly in `bot-pool.json` via `ssh_host` and `remote_user` fields — no need to edit `fleet`.

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

## Security

### `--dangerously-skip-permissions`

Every bot is launched with `--dangerously-skip-permissions`. This flag disables Claude Code's interactive permission prompts for file edits, shell commands, and other tool calls.

**Why it's needed:** Bots run unattended in tmux sessions with no human at the terminal. Without this flag, Claude Code would prompt for confirmation on every file write or command execution — and with nobody to press "y", the bot would hang indefinitely.

**What this means:**

- The bot can read, write, and delete any file accessible to its OS user
- The bot can execute arbitrary shell commands without confirmation
- On remote servers, this includes Docker, databases, and system services

**Mitigations:**

- Run bots under a dedicated OS user with limited permissions (not root)
- Use `default_dir` in `bot-pool.json` to scope each bot's working directory
- Keep bot tokens in `.env` (gitignored) and never commit them
- The Discord plugin's access control (`access.json`) limits who can send messages to each bot — configure this before exposing bots to shared servers
- Review the identity files: behavioral rules like "confirm before destructive operations" provide a soft guardrail, but they are not a security boundary

## Known Limitations

- **`--channels` flag is required** — Installing the Discord plugin is not enough. Claude Code must be started with `--channels plugin:discord@claude-plugins-official` to receive inbound messages.
- **One bot per session** — The plugin architecture does not support multiple bots in a single Claude Code session. N bots = N sessions.
- **Plugin updates overwrite patches** — After `plugin install discord@claude-plugins-official`, re-apply the state-dir patch.
- **hCaptcha on bot creation** — Creating and inviting Discord bots triggers hCaptcha. Cannot be automated.
- **Bot presence** — Some bots may not show as "online" in Discord unless the `presence: { status: "online" }` patch is applied to `server.ts`.

## Repo Structure

```
discord-hq-fleet/
├── fleet                       # Main CLI (symlinked by install.sh)
├── install.sh                  # Installer (symlink + completions)
├── completions/
│   ├── fleet.bash              # Bash tab completion
│   └── _fleet                  # Zsh tab completion
├── .env.example
├── bot-pool.json.example
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
│   ├── state-dir.patch
│   └── presence.patch
├── docs/
│   ├── ARCHITECTURE.md
│   └── TROUBLESHOOTING.md
├── LICENSE
└── README.md
```

## License

MIT
