---
name: fleet
description: Manage an AI coding agent fleet — start, stop, inject roles, check status, and diagnose issues across local and remote servers
user_invocable: true
---

# Fleet — Agent Fleet Manager

You manage a fleet of AI coding agents across multiple servers. Each agent is a Claude Code session with a Discord channel plugin. All operations go through the `fleet` CLI.

## First-Time Setup

Guide the user through each step ONE AT A TIME. Assume they have nothing. Explain why each step matters. Wait for confirmation before moving on.

### Step 1: Install fleet CLI and verify environment

**Why:** Fleet needs the CLI installed, Claude Code with Channels support, the Discord plugin, and patches applied. The install script handles all of this.

```bash
curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash
```

After install, verify everything:
```bash
fleet doctor
```

Check the output for:
- **Claude Code version** — must be recent enough to support `--channels` flag. Run `claude --version` — needs 1.0.0+
- **Discord plugin** — `fleet doctor` checks if `server.ts` exists at the plugin path
- **Patches** — STATE_DIR and PARTNER_BOT_IDS must show as applied

If `fleet doctor` shows failures:
- Claude Code not installed → tell user: `npm install -g @anthropic-ai/claude-code`
- Claude Code not logged in → tell user: `claude auth login`
- Plugin missing → run: `fleet patch` (install.sh should have handled this, but re-run if needed)
- Patches missing → run: `fleet patch`

**Done when:** `fleet doctor` shows all checks green (or only non-blocking warnings). `fleet help` works.

### Step 2: Discord server

**Why:** Discord is where your agents communicate. Each agent joins as a bot in your server. You see their conversations in real time.

Ask: "Do you have a Discord server for your fleet?"
- If yes → ask for the server name to confirm, then continue
- If no → tell them:
  1. Open https://discord.com in browser (or Discord app) — log in or create a free account
  2. **Left sidebar, very bottom** → click the green **"+"** button (below all existing servers)
  3. Choose **"Create My Own"** → then **"For me and my friends"**
  4. Name it anything (e.g. "My Fleet") → click **"Create"**
  5. You're now inside your new server. There's a default `#general` channel — that's enough.

**Done when:** User tells you the server name and confirms they can see the `#general` channel.

### Step 3: Create bots, configure, and invite

**Why:** Each agent needs a Discord bot identity. You'll create each bot, grab its token, run `fleet init` to generate config + invite links, then invite the bots.

**IMPORTANT:** Do NOT generate invite URLs yourself. Only use the URLs that `fleet init` prints — it uses the correct Application ID from the Discord API. Manually constructed URLs may use the wrong ID and show "Unknown Application."

**What the user provides:** Only bot tokens. Everything else (server, channel, bot name, Application ID, invite URLs) is auto-detected by `fleet init`.

**First, help the user decide their team structure.** Ask:

> How do you want your team to work? Common patterns:
> - **Lead + Worker** — one understands your intent and delegates, one executes (recommended for getting started)
> - **Lead + Coder + Reviewer** — adds a dedicated code reviewer
> - **Custom** — you decide each agent's role

Based on their choice, you know how many bots to create and what to name them.

Tell the user to open https://discord.com/developers/applications in their browser.

**For each bot in the team:**
1. **Top right** of the page → click the blue **"New Application"** button → name it based on its role (e.g. "Lead", "Worker", "Reviewer"). This name becomes the bot's display name in Discord.
2. You land on the "General Information" page. **Left sidebar** → click **"Bot"** (puzzle piece icon)
3. **Bot page, top section** → click **"Reset Token"** → confirm → **copy the token immediately**
4. **Bot page, scroll down** to **"Privileged Gateway Intents"** section → toggle **"Message Content Intent" ON** (turns blue) → click **"Save Changes"** at bottom
5. Ask the user to paste the token to you now. Save it.
6. Repeat for each bot in the team.

**Run fleet init (generates config + invite links):**

As an agent, prefer non-interactive mode:
```bash
fleet init --token FIRST_TOKEN --token SECOND_TOKEN --name my-fleet
```
Fleet auto-detects the Discord server and channel from the token. If multiple servers/channels exist, it picks the first — use interactive `fleet init` instead if the user wants to choose.

**Done when:** Output shows "Fleet initialized!" and prints invite URLs for each bot. Verify:
```bash
cat fleet.yaml    # should list your agents
```

**Invite the bots using the URLs from fleet init:**

Give the user each invite URL that `fleet init` printed. For each one:
1. Open the URL in browser → Discord authorization page
2. **"Add to Server"** dropdown (middle of page) → select their fleet server
3. Click **"Continue"** → **"Authorize"** → complete captcha if shown

**Done when:** User confirms they see all bots as members in their Discord server (right sidebar → Members list). Bots show as offline — that's normal until Step 4.

### Step 4: Start the team

**Why:** This launches each agent as a Claude Code process connected to Discord. They'll come online and start listening.

**Before starting:** Claude Code needs `--dangerously-skip-permissions` to run unattended. To avoid a first-run confirmation prompt, pre-configure it:

```bash
# Check if settings already allow it
cat ~/.claude/settings.json

# If not, the agent can add the permission:
# Read the current settings, add the bypass permission, write back
```

If the user hasn't run Claude Code with `--dangerously-skip-permissions` before, help them:
1. Run `claude --dangerously-skip-permissions` once in their terminal
2. Accept the one-time confirmation when prompted
3. Exit Claude Code (`/exit`)
4. Now `fleet start` will work without prompts

Alternatively, if `fleet start` succeeds but the bot doesn't come online:
1. Run `tmux attach -t <session-name>` (shown in fleet start output)
2. If there's a confirmation prompt, accept it
3. Detach with `Ctrl+B, D`

```bash
fleet start lead
fleet start worker
fleet status
```

**Done when:** `fleet status` shows `[on]` for each agent. The bots show as online in Discord. User can message @Lead in Discord and get a response.

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
