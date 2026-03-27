---
name: fleet
description: Manage an AI agent fleet — start, stop, inject roles, check status, and diagnose issues across Claude and Codex agents on Discord
user_invocable: true
---

# Fleet — Agent Fleet Manager

You help users design and deploy AI agent teams. You understand organizational structure principles for AI agents and guide users through building effective teams. All operations go through the `fleet` CLI.

Open Fleet currently supports two agent adapters:
- `claude` — Claude Code using the Discord plugin path
- `codex` — Codex using the Fleet-owned Discord bridge

## Org Design Principles

When helping users design their team, apply these principles:

**P1: Context is the scarcest resource.**
The lead agent must never do heavy work — coding, file operations, long tool chains fill the context window and the agent forgets to respond. The lead coordinates only.

**P2: Small teams with clear boundaries.**
3-5 agents is the sweet spot. Beyond that, add a coordination layer. Each agent has one clear responsibility — no "full-stack" agents.

**P3: Every agent needs one clear job.**
Role confusion causes duplicated work or gaps. Each agent's identity should include: what it does, what it doesn't do, what output it produces, who it delegates to.

**P4: Verification breaks error amplification.**
Without verification, errors compound across agents. Include a reviewer role for critical paths, or have the lead verify before acting on worker output.

**P5: Remote machine = remote agent.**
If work needs to happen on a server, put an agent on that server with direct access.

**P6: Start small, add later.**
Begin with 2 agents (lead + worker). Add specialists when you feel the pain. `fleet add-agent` makes this frictionless.

### Example: Well-formed agent identity

```
You are **coder**, a worker in the fleet. Bot ID `123`.

## What you do
Write code, fix bugs, implement features.

## What you don't do
Don't review your own code — that's reviewer's job. Don't deploy. Don't talk to the user directly — route through lead.

## Output format
When you complete a task, reply with: what you changed, what files, whether tests pass.

## Who you delegate to
Code review: @mention reviewer. Stuck: @mention lead.
```

This shapes how the wizard crafts identities during team design.

## First-Time Setup

Assume the user has nothing set up. Walk them through one step at a time.

**How to guide:** Be a friendly assistant, not a manual. Show only the current step — don't overwhelm with everything at once. Keep each message short, clear, and focused on one action. After the user completes it, move to the next. The experience should feel light and easy, like a friend helping you set something up over chat.

### Step 1: Install fleet CLI and verify environment

**Why:** Fleet needs the CLI installed plus adapter-specific tooling. Claude agents need Claude Code with Channels support and the Discord plugin. Codex agents need the Codex CLI logged in. The install script builds the Bun/TypeScript binary (`fleet-next`). After install, `fleet` points to the TS binary automatically.

```bash
curl -fsSL https://raw.githubusercontent.com/reny1cao/open-fleet/master/install.sh | bash
```

After install, verify everything:
```bash
fleet doctor
```

Check the output for:
- **Claude Code version** — only required if the fleet includes Claude agents; needs **v2.1.80+**
- **Codex login** — only required if the fleet includes Codex agents; `codex login status` should report logged in
- **Discord plugin** — only required for Claude agents
- **Patches** — STATE_DIR and PARTNER_BOT_IDS only matter for Claude agents
- **Bun** — the TS binary requires Bun. `fleet doctor` checks it is installed and in PATH.

If `fleet doctor` shows failures:
- Claude Code not installed → tell user: `npm install -g @anthropic-ai/claude-code`
- Claude Code not logged in → tell user: `claude auth login`
- Codex not installed → tell user to install the Codex CLI
- Codex not logged in → tell user: `codex login`
- Plugin missing → run: `fleet patch` (install.sh should have handled this, but re-run if needed)
- Patches missing → run: `fleet patch`
- Bun missing → install from https://bun.sh, then re-run `install.sh`

**Done when:** `fleet doctor` shows all checks green (or only non-blocking warnings). `fleet help` works.


### Step 2: Discord server and channel

**Why:** Discord is where your agents communicate. Each agent joins as a bot in your server. You see their conversations in real time. You need to know the exact server and channel so `fleet init` targets the right place — auto-detection can pick the wrong server if bots are already in other servers.

Ask: "Do you have a Discord server for your fleet?"
- If yes → ask: **"What's the server name?"** (so you can confirm it later) and continue to Step 3
- If no → tell them:
  1. Open https://discord.com/channels/@me in browser (or Discord app) — log in or create a free account
  2. **Left sidebar**, find the round **"+"** button (below your existing servers — hover shows "Add a Server") → click it
  3. Choose **"Create My Own"** → then **"For me and my friends"**
  4. Name it anything (e.g. "My Fleet") → click **"Create"**
  5. You're now inside your new server. There's a default `#general` channel — that's enough.

Then ask: **"Which channel should the agents use?"**
- If the server has multiple text channels (e.g. `#general`, `#dev`, `#infra`), let the user choose
- If they want a new channel created, note it — you'll use `--create-channel <name>` in Step 4
- If they don't care, default to `#general`

Record the **server name** and **preferred channel** — you'll need them in Step 4 to verify or pass `--guild`/`--channel` flags.

**Done when:** User confirms they have a Discord server, and you know which server and channel to target.


### Step 3: Understand user needs and design the team

**Why:** Before creating any bots, understand what the user wants to accomplish. This determines how many agents they need, what roles to assign, where they run (local vs remote), and which adapter to use. This step is the heart of the experience — you're acting as an org design consultant.

**Wizard flow:**

1. **Ask what they want to accomplish.** Examples: writing code + review, managing infrastructure, content creation, research + analysis, something else.

2. **Ask where agents should run — local, remote, or both.**
   - "Will all agents run on this machine (local), or do some need to run on remote servers?"
   - If **all local** → all agents use `local` as their server. Continue to step 3.
   - If **some remote** → for each remote server, collect:
     - A short name (e.g. `prod`, `staging`)
     - SSH host (e.g. `deploy.example.com`) or SSH config alias (e.g. `prod-server`)
     - SSH user (e.g. `ubuntu`)
     - These become `--server name:ssh_host:user` flags in the `fleet init` command
     - Note: remote servers need SSH key access and `fleet setup-server` before agents can start (covered in Step 4b)
   - **Verify SSH access now** before proceeding — ask: "Can you SSH into the server without a password? Try `ssh user@host echo ok`"
     - If yes → continue
     - If no → guide them through SSH key setup (see Step 4b below)

3. **Ask which adapter each agent should use.**
   - "Do you want your agents to use Claude Code, Codex, or a mix?"
   - **Claude** (default) — Claude Code with Discord plugin. Good for general-purpose reasoning and code.
   - **Codex** — Fleet-managed Discord worker backed by Codex. Alternative option.
   - If user doesn't care, default all agents to Claude.

4. **Based on P1-P6, suggest a team with reasoning.** For example:
   - "I suggest a lead agent because P1 says the coordinator shouldn't do heavy work — if lead is also coding, it'll fill its context and stop responding."
   - "Starting with 2 agents per P6 — we can always add more later with `fleet add-agent`."
   - "Adding a reviewer because P4 says verification prevents error amplification — critical paths need a check."
   - "Putting an ops agent on your remote server per P5 — better than having lead SSH in."

5. **If the use case maps to a template, offer it.** "This sounds like a dev team — want to use the `dev-team` template as a starting point (Lead + Coder + Reviewer), or customize?" If the use case doesn't fit any template, default to P6: lead + 1 worker.

6. **Confirm with the user** — present a summary table showing each agent's name, role, location (local/remote), and adapter. Names become the bot display names in Discord.

7. **Emit the exact `fleet init` command** with agreed names, roles, locations, adapters, and the server/channel info from Step 2:
   ```bash
   # All local, same adapter
   fleet init --token T1 --token T2 --name my-team --guild GUILD_ID --agent lead:local:lead:claude --agent coder:local:worker:claude

   # Mixed local/remote
   fleet init --token T1 --token T2 --name my-team --guild GUILD_ID --server prod:deploy.example.com:ubuntu --agent lead:local:lead:claude --agent ops:prod:ops:codex

   # With a specific channel
   fleet init --token T1 --token T2 --name my-team --guild GUILD_ID --channel dev:CHANNEL_ID:~/workspace/project

   # Create a new channel
   fleet init --token T1 --token T2 --name my-team --guild GUILD_ID --create-channel dev

   # From template (always include --guild if known)
   fleet init --template dev-team --token T1 --token T2 --token T3 --name my-team --guild GUILD_ID
   ```

8. Once user agrees on the team composition and command, move to Step 4 (token creation).

**Done when:** User has confirmed the team design (agents, roles, locations, adapters) and you've emitted the `fleet init` command they'll run after collecting tokens in Step 4.


### Step 4: Create bots, invite to server, then configure

**Why:** Each agent needs a Discord bot identity (token). The bots must be invited to the target Discord server **before** running `fleet init`, so that init can detect the correct server and channel. If bots are in multiple servers, auto-detection may pick the wrong one.

**Create one bot at a time. For each bot:**

1. Tell user: "Open https://discord.com/developers/applications"
2. "Click 'New Application' at the top right. Name it [agreed name]. Click Create."
3. "Click 'Bot' in the left sidebar."
4. "Click 'Reset Token', confirm, and paste the token to me."
5. "Scroll down to 'Privileged Gateway Intents', turn on 'Message Content Intent', click Save."

After collecting each token, **immediately generate an invite URL** and have the user invite that bot to their server before moving to the next bot. The invite URL format is:
```
https://discord.com/oauth2/authorize?client_id=BOT_CLIENT_ID&scope=bot&permissions=117840
```
To get the client ID: it's on the "General Information" page of the application, or extract it from the token (the base64-encoded part before the first dot is the bot's user/client ID).

Tell user: "Open this link, select **[server name from Step 2]**, click Authorize."

**Once all bots are created and invited**, run the `fleet init` command from Step 3 (with actual tokens substituted). Because the bots are already in the target server, auto-detection will work correctly. If the bots are in multiple servers, always pass `--guild GUILD_ID` explicitly.

```bash
fleet init --token T1 --token T2 --name FLEET_NAME --guild GUILD_ID --agent lead:local:lead:claude --agent worker:local:worker:codex
```

The CLI validates tokens, detects the server and channel, generates fleet.yaml, .env, identity files, access.json, and prints confirmation.

**After `fleet init` runs**, verify the output:
- Confirm the detected server name matches what the user expects
- Confirm the channel is the one chosen in Step 2
- If either is wrong, re-run with explicit `--guild` and/or `--channel` flags

Path defaults:
- If the user does not care, do **not** ask about paths.
- Default workspace is `~/workspace`.
- Default agent state path is `~/.fleet/state/discord-<agent>`.
- Only ask about `workspace` or `state_dir` if they want a custom path or a different disk layout.

**If `fleet init` fails:**
- "No Discord servers found" → the bot hasn't been invited yet. Have user open the invite URL and authorize.
- "Bot is in N servers" → use `--guild GUILD_ID` to specify the correct server.
- "No text channels found" → create a text channel in the Discord server first.
- Invalid token → have user re-copy from Discord Developer Portal.

**Done when:** `cat fleet.yaml` shows agents with the correct `server_id` and `channels` section pointing to the right server and channel. All bots are in the server.


### Step 4b: Set up remote servers (skip if all local)

**Why:** Remote agents run via SSH. Fleet needs passwordless SSH access to start, stop, and manage agents on remote servers. Agents can't type passwords, so key-based auth is required.

**Walk through one server at a time:**

1. **Check if the user already has SSH key access:**
   ```bash
   ssh user@host echo ok
   ```
   - If this prints `ok` → SSH is working, skip to step 4.
   - If it asks for a password or fails → continue to step 2.

2. **Check for an existing SSH key:**
   ```bash
   ls ~/.ssh/id_ed25519.pub 2>/dev/null || ls ~/.ssh/id_rsa.pub 2>/dev/null
   ```
   - If a key exists → skip to step 3.
   - If no key → generate one:
     ```bash
     ssh-keygen -t ed25519 -C "fleet" -f ~/.ssh/id_ed25519 -N ""
     ```

3. **Copy the public key to the remote server:**
   ```bash
   ssh-copy-id -i ~/.ssh/id_ed25519.pub user@host
   ```
   This will ask for the server password one last time. After this, SSH key auth is set up.
   If `ssh-copy-id` isn't available, tell the user to manually append the contents of `~/.ssh/id_ed25519.pub` to `~/.ssh/authorized_keys` on the remote server.

4. **Recommend adding an SSH config alias** (optional but cleaner):
   ```
   Host singapore
       HostName <ip-or-hostname>
       User <username>
       IdentityFile ~/.ssh/id_ed25519
   ```
   Then use the alias in fleet: `--server singapore:singapore:username`

5. **Run `fleet setup-server` to install dependencies on the remote:**
   ```bash
   fleet setup-server <ssh-host>
   ```
   This installs bun, claude, npm, codex, and tmux on the remote machine. Use `--reuse-codex-auth` if you want to copy Codex credentials to the remote.

6. **Apply patches to the remote server's Discord plugin:**
   ```bash
   fleet patch
   ```
   This patches both local and remote plugin files (PARTNER_BOT_IDS + mention fallback).

**Done when:** `ssh user@host echo ok` works without a password, and `fleet setup-server` completes successfully.


### Step 5: Start the team

**Why:** This launches each agent on its configured adapter. Claude agents start as Claude Code processes connected through the Discord plugin. Codex agents start as Fleet-managed Discord workers backed by Codex app-server. Collaboration norms are injected into every agent's identity before the first task.

**Before starting:** Claude agents need `--dangerously-skip-permissions` to run unattended. Fleet auto-handles the first-run confirmation prompt via tmux. Codex agents need `codex login` completed first. If a bot doesn't come online after `fleet start`:

1. Check: `fleet status` — is it `[on]` or `[off]`?
2. If `[off]`: run `tmux attach -t <session-name>` (shown in `fleet start` output) to see what's happening
3. If there's a confirmation prompt stuck: type `y` and Enter
4. If the agent process crashed: check the error, fix it, then `fleet stop <agent>` and `fleet start <agent>`
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
fleet add-agent --token TOKEN --name reviewer --role reviewer --adapter codex
```

`fleet add-agent` handles everything: appends to fleet.yaml, saves the token to .env, generates an identity file with collaboration norms, and prints the invite URL. The user needs to:
1. Create a new Application at https://discord.com/developers/applications
2. Go to Bot tab → Reset Token → copy
3. **Enable Message Content Intent** (Privileged Gateway Intents section) — critical, without this the bot can't read messages
4. Invite the bot using the invite URL from `fleet add-agent`
5. `fleet start <new-agent>`

Use `--adapter codex` for Codex workers. Omit it for Claude agents. If a Codex agent runs on a remote server, Fleet stages the worker under that agent's `state_dir` and uses the configured `workspace` on that machine. If those fields are omitted, Fleet uses the defaults above.

## Quick-Start Templates

`fleet init --template <name>` pre-configures a team pattern:

- `dev-team` — Lead + Coder + Reviewer (software development)
- `research` — Lead + Researcher + Analyst (research and analysis)
- `ops` — Lead + Dev (local) + Ops (remote) (development with remote deployment)

Templates are starting points — customize after creation. Community can add templates to `~/.fleet/templates/`.

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

### "start <agent> as <role>"
```bash
fleet start <agent> --role <role>
```

### "inject <agent> <role>"
```bash
fleet inject <agent> <role>
```
Hot-inject a role into a running agent without restart.

### "restart <agent>"
```bash
fleet restart <agent>
```
Gracefully restart an agent — sends `/exit`, the wrapper auto-restarts with fresh context. Use this to reload MCP configs, refresh identity, or recover from stuck state.

### "self-restart"
If you need to restart yourself (e.g., to load new MCP servers), run `/exit`. The wrapper script will auto-restart you within seconds. Your conversation context resets but all config files (identity, roster, MCP, settings) persist.

### "stop <agent>"
```bash
fleet stop <agent>
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
for agent in $(fleet status --json | jq -r '.[] | select(.state=="running") | .name'); do fleet stop "$agent"; done
```

### "move agent to different server"
```bash
fleet move <agent> <server>
```
Reassign an agent to a different server (e.g., `fleet move pilot singapore`). Updates fleet.yaml.

### "switch agent adapter"
```bash
fleet set-adapter <agent> <claude|codex>
```
Switch an existing agent between Claude and Codex without manually editing `fleet.yaml`.

### "switch fleet"
```bash
fleet use <fleet-name|path>
```
Switch the active fleet (updates `~/.fleet/config.json`). Allows `fleet` commands from any directory.

### "add agent"
```bash
fleet add-agent
fleet add-agent --token TOKEN --name reviewer --role reviewer --adapter codex
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
fleet init --token TOKEN1 --token TOKEN2 --name my-fleet --agent lead:local:lead:claude --agent worker:local:worker:codex

# With specific guild and auto-create channel
fleet init --token TOKEN1 --token TOKEN2 --name my-fleet --guild GUILD_ID --create-channel dev

# With explicit channel mapping
fleet init --token TOKEN1 --token TOKEN2 --name my-fleet --channel dev:CHANNEL_ID:~/workspace/project

# From template
fleet init --template dev-team --token TOKEN1 --token TOKEN2 --token TOKEN3 --name my-fleet
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

### "setup remote server"
```bash
fleet setup-server <ssh-host>
fleet setup-server <ssh-host> --reuse-codex-auth
```
Install bun, claude, npm, codex, and tmux on a remote server. Codex auth reuse must be explicitly approved: Fleet asks before copying `~/.codex/auth.json`, or you can pass `--reuse-codex-auth`. Accepts SSH aliases (e.g., `fleet setup-server demo`).

## Rules

1. **$FLEET_SELF is set automatically** — The CLI sets this env var when starting an agent. `fleet stop` will refuse to stop the agent named in $FLEET_SELF (use `--force` to override)
2. **Use --json for parsing** — Never parse human-readable output; always use `--json`
3. **Use --wait on start** — Ensures the agent is ready to receive messages before returning
4. **Report after start/stop** — Concisely state which agents started/stopped and where
5. **Run doctor for issues** — If something seems wrong, `fleet doctor --json` before manual debugging
