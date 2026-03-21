---
name: fleet
description: Manage an AI coding agent fleet — start, stop, inject roles, check status, and diagnose issues across local and remote servers
user_invocable: true
---

# Fleet — Agent Fleet Manager

You manage a fleet of AI coding agents across multiple servers. Each agent is a Claude Code session with a Discord channel plugin. All operations go through the `fleet` CLI.

## First-Time Setup

Guide the user through each step ONE AT A TIME. Assume they have nothing. Explain why each step matters. Wait for confirmation before moving on.

### Step 1: Install fleet CLI

**Why:** Fleet is a shell tool that manages your agent team. This installs it.

```bash
curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash
```

**Done when:** Output shows "Installed. Next steps:" and `fleet help` works in terminal.

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

### Step 3: Create bots and configure fleet

**Why:** Each agent needs a Discord bot identity (name + token). You'll create each bot, grab its token, and feed it to fleet — one at a time.

**What the user needs to provide:** Only bot tokens. Everything else (server, channel, bot name, bot ID) is auto-detected from the token.

Tell the user to open https://discord.com/developers/applications in their browser.

**Create the first bot (lead):**
1. **Top right** of the page → click the blue **"New Application"** button → name it (e.g. "Lead") → click Create
2. You land on the "General Information" page. **Left sidebar** → click **"Bot"** (has a puzzle piece icon)
3. **Bot page, top section** → click **"Reset Token"** → confirm in the popup → **copy the token immediately**
4. **Bot page, scroll down** to **"Privileged Gateway Intents"** section → find **"Message Content Intent"** → toggle it **ON** (turns blue) → scroll to bottom → click **"Save Changes"**
5. Ask the user to paste the token here now

**Create the second bot (worker):**
Repeat steps 1-5 with a different name (e.g. "Worker"). Ask user to paste this token too.

**Once you have all tokens, run fleet init:**

If you're an agent, use non-interactive mode — this is the preferred path:
```bash
fleet init --token FIRST_TOKEN --token SECOND_TOKEN --channel CHANNEL_ID --name my-fleet
```

If you don't have the channel ID yet (user just created the server), use interactive mode:
```bash
fleet init
```
The wizard auto-detects the server from the token, lists channels by number, and generates all config.

**Done when:** Output shows "Fleet initialized!" Verify:
```bash
cat fleet.yaml    # should show your agents
cat .env          # should show your tokens
```

### Step 5: Invite bots to server

**Why:** Bots need permission to join your Discord server. Each bot gets an invite URL.

`fleet init` printed invite URLs at the end. Tell the user to do this for each URL:
1. Open the URL in browser — it goes to a Discord authorization page
2. **"Add to Server"** dropdown (middle of the page) → select their fleet server
3. Click **"Continue"** → then **"Authorize"**
4. Complete the captcha if shown
5. Repeat for each bot

If they lost the URLs, rebuild: `https://discord.com/oauth2/authorize?client_id=BOT_ID&scope=bot&permissions=68608` (replace BOT_ID — find it on the Developer Portal → General Information → Application ID).

**Done when:** User opens Discord, clicks their server name, and sees all bots listed under "Members" in the right sidebar (they'll show as offline — that's normal until Step 6).

### Step 6: Start the team

**Why:** This launches each agent as a Claude Code process connected to Discord. They'll come online and start listening for messages.

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
