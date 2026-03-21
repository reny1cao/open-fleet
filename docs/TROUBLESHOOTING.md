# Troubleshooting

Common issues and solutions, earned the hard way.

## 1. Bot is "listening" but not responding to messages

**Symptom:** `fleet status` shows the bot is running, but @mentioning it in Discord gets no response.

**Causes (check in order):**

1. **Missing `--channels` flag** — `enabledPlugins` in settings.json is not enough. The bot must be started with `--channels plugin:discord@claude-plugins-official`.

2. **`access.json` missing or wrong schema** — The Discord plugin's `gate()` function requires a specific schema. For guild (server) messages, the channel ID must be in `groups`. The correct schema is:
   ```json
   {
     "dmPolicy": "allowlist",
     "allowFrom": ["user-id", "other-bot-id"],
     "groups": {
       "CHANNEL_ID": {
         "requireMention": true,
         "allowFrom": []
       }
     },
     "pending": {}
   }
   ```
   Common mistakes: using `policy` instead of `dmPolicy`, `allowedUserIds` instead of `allowFrom`, or missing the `groups` key entirely. Without `groups`, all guild messages are silently dropped.

3. **`allowFrom` missing sender's ID** — If a bot is messaging another bot, the receiver's DM `allowFrom` must include the sender's bot ID. For guild channels, `allowFrom: []` in the group policy means "accept from anyone".

4. **Discord plugin process not running** — Check with: `ps aux | grep "bun.*discord" | grep -v grep`. If missing, likely a dependency issue (bun not in PATH).

5. **`bun` not in PATH** — Common on remote servers. `.bashrc` non-interactive guard blocks PATH exports. Fix: add bun to `.profile` or prepend `export PATH=$HOME/.bun/bin:$PATH` before the claude command.

6. **`PARTNER_BOT_IDS` missing fleet bot IDs** — The Discord plugin drops all bot messages unless the sender's ID is in `PARTNER_BOT_IDS` (in `server.ts`). `fleet init` patches this automatically, but if you added bots manually, update the set.

## 2. Bots can't talk to each other

**Symptom:** Human messages work, but bot-to-bot @mentions are ignored.

**Cause:** `server.ts` has `if (msg.author.bot) return` which drops ALL bot messages.

**Fix:** Apply the `partner-bot-ids.patch` — adds a whitelist of allowed bot IDs.

## 3. Two bots on the same machine conflict

**Symptom:** Second bot overwrites first bot's access.json or token.

**Cause:** `STATE_DIR` is hardcoded to `~/.claude/channels/discord/`.

**Fix:** `fleet init` handles this automatically — the second+ agent on the same server gets `state_dir: ~/.fleet/state/discord-<name>` in fleet.yaml. The `DISCORD_STATE_DIR` env var is set when `fleet start` launches the agent. To fix manually, add `state_dir` to the agent in fleet.yaml.

## 4. Identity injection doesn't land

**Symptom:** Bot starts but doesn't know its name/role.

**Causes:**
- Bot wasn't fully initialized when injection fired (fleet now polls for readiness)
- Remote bot's Discord plugin failed to start (check bun in PATH)
- tmux session crashed during injection

**Debug:** `tmux capture-pane -t hq-<bot> -p | tail -30` to see what the bot received.

## 5. `fleet status` shows "SSH unreachable"

**Symptom:** Remote bot shows as unreachable.

**Causes:**
- SSH config not set up (`~/.ssh/config` needs the host alias)
- Server is down
- Tailscale disconnected (if using Tailscale for connectivity)

**Debug:** `ssh <host-alias> echo ok` to test connectivity.

## 6. Discord Gateway "fighting"

**Symptom:** Bot intermittently connects/disconnects.

**Cause:** Two sessions using the same bot token. Discord Gateway allows only one active connection per token.

**Fix:** Each bot must have its own unique token. Never reuse tokens across sessions.

## Diagnostic commands

```bash
# Check bot token validity
curl -s -H "Authorization: Bot <TOKEN>" https://discord.com/api/v10/users/@me | jq .username

# Check Gateway connection
lsof -i -P -n -p <server.ts PID> | grep ESTABLISHED

# Check which guilds a bot is in
curl -s -H "Authorization: Bot <TOKEN>" https://discord.com/api/v10/users/@me/guilds | jq '.[].name'

# Check if patches are applied
grep "PARTNER_BOT_IDS" ~/.claude/plugins/cache/claude-plugins-official/discord/0.0.1/server.ts
grep "DISCORD_STATE_DIR" ~/.claude/plugins/cache/claude-plugins-official/discord/0.0.1/server.ts

# Check access.json (first agent uses default path, others use state_dir)
cat ~/.claude/channels/discord/access.json | jq .
cat ~/.fleet/state/discord-<agent>/access.json | jq .

# Verify access.json has correct schema (must have groups with channel ID)
jq '.groups | keys' ~/.claude/channels/discord/access.json
```
