---
name: fleet
description: Manage an AI agent fleet — start, stop, inject roles, check status, and diagnose issues across local and remote servers
user_invocable: true
---

# Fleet — Agent Fleet Manager

You manage a fleet of AI agents across multiple servers. Each agent is a Claude Code session with a Discord channel plugin. All operations go through the `fleet` CLI.

## First-Time Setup

Assume the user has nothing set up. Walk them through one step at a time.

**How to guide:** Be a friendly assistant, not a manual. Show only the current step — don't overwhelm with everything at once. Keep each message short, clear, and focused on one action. After the user completes it, move to the next. The experience should feel light and easy, like a friend helping you set something up over chat.

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
- **Claude Code version** — needs **v2.1.80+** for `--channels` support. Run `claude --version` to check. If older, update: `npm update -g @anthropic-ai/claude-code`. Note: requires claude.ai login (Console/API key auth not supported for Channels).
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
- If yes → continue to Step 3
- If no → tell them:
  1. Open https://discord.com in browser (or Discord app) — log in or create a free account
  2. **Left sidebar, very bottom** → click the green **"+"** button (below all existing servers)
  3. Choose **"Create My Own"** → then **"For me and my friends"**
  4. Name it anything (e.g. "My Fleet") → click **"Create"**
  5. You're now inside your new server. There's a default `#general` channel — that's enough.

**Done when:** User confirms they have a Discord server with at least one text channel.


### Step 3: Create bots, configure, and invite

**Why:** Each agent needs a Discord bot identity. You'll create each bot, grab its token, run `fleet init` to generate config + invite links, then invite the bots.

**IMPORTANT:** After `fleet init` runs, always use its generated invite URLs (they use the correct Application ID). The only exception is the initial setup below, where bots must be invited before init can run — in that case, use the Application ID from the Developer Portal's General Information page.

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
2. You land on the "General Information" page. Note the **Application ID** shown on this page — you'll need it for the invite link.
3. **Left sidebar** → click **"Bot"**
4. **Bot page, top section** → click **"Reset Token"** → confirm → **copy the token immediately**
5. **Bot page, scroll down** to **"Privileged Gateway Intents"** section → toggle **"Message Content Intent" ON** (turns blue) → click **"Save Changes"** at bottom. **This is critical** — without it the bot cannot read messages.
6. Ask the user to paste the token to you now. Save it.
7. Repeat for each bot in the team.

**Invite bots to server BEFORE running fleet init:**

`fleet init` needs the bots to be in the server to auto-detect it. For each bot, build the invite URL using the Application ID from step 2:
```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot&permissions=68608
```
Give the user each URL. For each:
1. Open in browser → **"Add to Server"** dropdown → select their fleet server
2. Click **"Continue"** → **"Authorize"** → complete captcha if shown

**Done when:** User confirms all bots appear as members in their Discord server.

**Run fleet init (generates config + invite links):**

Ask the user what they want to name their fleet (this becomes the tmux session prefix). Then run:

For a simple setup (one server, one channel — most common):
```bash
fleet init --token FIRST_TOKEN --token SECOND_TOKEN --name USER_CHOSEN_NAME
```
Fleet auto-detects the server and picks the first text channel. If the user has multiple servers or wants a specific channel, use interactive mode instead:
```bash
fleet init
```

To specify agent names and roles explicitly:
```bash
fleet init --token T1 --token T2 --name my-fleet --agent lead:local:lead --agent worker:local:worker
```

**Done when:** Output shows "Fleet initialized!" and prints invite URLs for each bot. Verify:
```bash
cat fleet.yaml    # should list your agents
```

**Verify:** `fleet init` should show "Bot joined a server!" for each token. If it says "Bot is not in any server," the user missed the invite step above — go back and invite first.


### Step 4: Start the team

**Why:** This launches each agent as a Claude Code process connected to Discord. They'll come online and start listening.

**Before starting:** Claude Code needs `--dangerously-skip-permissions` to run unattended. Fleet auto-handles the first-run confirmation prompt (sends "y" automatically via tmux). But if a bot doesn't come online after `fleet start`:

1. Check: `fleet status` — is it `[on]` or `[off]`?
2. If `[off]`: run `tmux attach -t <session-name>` (shown in `fleet start` output) to see what's happening
3. If there's a confirmation prompt stuck: type `y` and Enter
4. If Claude Code crashed: check the error, fix it, then `fleet stop <agent>` and `fleet start <agent>`
5. Detach from tmux: `Ctrl+B, D`

```bash
fleet start lead
fleet start worker
fleet status
```

**Done when:** `fleet status` shows `[on]` for each agent. The bots show as online in Discord. User can message @Lead in Discord and get a response.

### Adding more agents later

To add an agent to an existing fleet:

```bash
# Interactive — guides through bot creation + token
fleet add-agent

# Non-interactive
fleet add-agent --token TOKEN --name reviewer --role reviewer
```

This appends to fleet.yaml, saves the token to .env, generates an identity file, and prints the invite URL. The user needs to:
1. Create a new Application at https://discord.com/developers/applications
2. Go to Bot tab → Reset Token → copy
3. **Enable Message Content Intent** (Privileged Gateway Intents section) — critical, without this the bot can't read messages
4. Invite the bot using the invite URL from `fleet add-agent`
5. `fleet start <new-agent>`

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
```bash
fleet apply
```
Starts all agents from fleet.yaml. Skips already-running agents. Use `--json` for machine output.

### "stop all"
Stop each agent sequentially:
```bash
for agent in $(fleet status --json | python3 -c "import json,sys; [print(a['name']) for a in json.load(sys.stdin) if a['state']=='running']"); do fleet stop "$agent"; done
```

### "add agent"
```bash
fleet add-agent
fleet add-agent --token TOKEN --name reviewer --role reviewer
```
Add a new agent to an existing fleet.

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
fleet init --token TOKEN1 --token TOKEN2 --name my-fleet
fleet init --token TOKEN1 --token TOKEN2 --name my-fleet --agent lead:local:lead --agent worker:local:worker
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
