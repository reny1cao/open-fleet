# Fleet Telegram MCP Plugin

## Problem

Fleet agents communicate exclusively through Discord. This works, but it couples the entire system to a single platform. If Discord is down, has rate limits, or a team prefers Telegram, there's no alternative. The plugin architecture already abstracts channel operations behind `ChannelAdapter` — but only Discord implements it.

## Goal

Design a Telegram bot adapter that follows the same contract as the Discord plugin: same `ChannelAdapter` interface, same `AccessConfig` schema, same MCP tool surface, same message routing model. An agent should be configurable to use Telegram instead of (or alongside) Discord with a config change in `fleet.yaml`.

## Current Architecture (Discord)

### Plugin Contract

The Discord plugin is an MCP server that exposes 5 tools to Claude Code:

| Tool | Purpose |
|------|---------|
| `reply` | Send message to channel (with optional reply-to threading and file attachments) |
| `react` | Add emoji reaction to a message |
| `edit_message` | Update a previously sent message |
| `fetch_messages` | Pull channel history (max 100, oldest-first) |
| `download_attachment` | Fetch file attachments by message ID |

### Message Flow

```
Discord WebSocket → Bot receives MESSAGE_CREATE
  → Pre-filter: drop self, drop non-mentions, drop unauthorized
  → Scope resolution: channel:{id} or thread:{id}
  → Format prompt: "Discord mention from {user}. Scope: {scope}. Message: {text}"
  → onMention() callback → Claude processes → calls reply/react tools
  ��� REST API sends response to Discord
```

### Key Integration Points

| Component | File | Purpose |
|-----------|------|---------|
| ChannelAdapter interface | `src/channel/types.ts` | Generic contract for channel operations |
| Discord API client | `src/channel/discord/api.ts` | REST client + ChannelAdapter impl |
| Discord bot (gateway) | `src/channel/discord/bot.ts` | WebSocket message routing |
| Access control | `src/channel/discord/access.ts` | access.json generation |
| Event handling | `src/channel/discord/events.ts` | Mention detection, scope resolution |
| Claude adapter | `src/agents/claude/adapter.ts` | Plugin loading, env vars, wrapper script |
| Plugin patching | `src/commands/patch.ts` | PARTNER_BOT_IDS injection |
| FleetConfig | `src/core/types.ts` | `discord` section in fleet.yaml |

## Telegram Plugin Design

### Concept Mapping

| Discord Concept | Telegram Equivalent | Notes |
|----------------|---------------------|-------|
| Server (guild) | — | Telegram has no server concept; bots join chats directly |
| Channel | Group chat / Supergroup | Groups have a chat ID, analogous to channel ID |
| Thread | Topic (forum mode) | Supergroups with forum mode have topics = threads |
| DM | Private chat | 1:1 with the bot |
| @mention | @bot_username or /command | Telegram bots respond to @mentions or /commands in groups |
| Message ID | message_id (integer) | Telegram uses integer IDs per-chat |
| Emoji reaction | setMessageReaction API | Telegram Bot API 7.0+ supports reactions |
| Bot token | BotFather token | Format: `123456:ABC-DEF...` |
| Webhook / Gateway | Long polling or Webhook | Bot API supports both; webhook is preferred for production |

### ChannelAdapter Implementation

```typescript
// src/channel/telegram/api.ts

export class TelegramApi implements ChannelAdapter {
  private baseUrl: string  // https://api.telegram.org/bot{token}

  async validateToken(token: string): Promise<BotInfo> {
    // GET /getMe → { id, first_name, username }
    // Map to BotInfo: { id: string(id), name: username, appId: string(id) }
  }

  async listServers(token: string): Promise<ServerInfo[]> {
    // Telegram has no servers. Return empty array.
    // Agents don't "join servers" — they're added to chats directly.
    return []
  }

  async listChannels(token: string, serverId: string): Promise<ChannelInfo[]> {
    // Telegram bots can't list all chats they're in.
    // Return channels from fleet.yaml config (pre-configured).
    // Validate each with getChat(chatId) to confirm bot is a member.
  }

  async createChannel(token: string, serverId: string, name: string): Promise<ChannelInfo> {
    // Telegram bots can't create groups.
    // Throw: "Telegram bots cannot create groups. Add the bot to an existing group."
  }

  async getChannelByName(token: string, serverId: string, name: string): Promise<ChannelInfo | null> {
    // Look up by chat ID from config, not by name.
    // Telegram chats are identified by numeric ID, not discoverable by name.
    return null
  }

  generateAccessConfig(opts: AccessConfigOpts): AccessConfig {
    // Same schema as Discord — groups keyed by chat ID, allowFrom by user ID
  }

  inviteUrl(appId: string): string {
    // Return: https://t.me/{bot_username}
  }

  pluginId(): string {
    return "plugin:telegram@claude-plugins-official"
  }
}
```

### Key Differences from Discord

**1. No server/guild concept.** Telegram bots are added to chats directly. The `listServers()` and `createChannel()` methods are no-ops. This simplifies the setup flow but means `fleet init` can't auto-discover chats — they must be pre-configured.

**2. Bots can't list their chats.** Unlike Discord where `GET /users/@me/guilds` returns all servers, Telegram bots have no equivalent. The bot only learns about chats when it receives a message. Fleet.yaml must list chat IDs explicitly.

**3. Mention detection is different.** In Discord, bots check for `<@BOT_ID>` in message content. In Telegram:
- **Groups**: Bot receives messages only when @mentioned or when `/command` is used (unless privacy mode is disabled)
- **Private chats**: Bot receives all messages
- **Forum topics**: Messages include `message_thread_id` for scope isolation

**4. Message IDs are integers, not snowflakes.** Telegram uses sequential integer IDs per-chat, not global unique IDs. The `reply_to` field maps to `reply_to_message_id` in the Bot API.

**5. Reactions are limited.** Telegram Bot API supports reactions but only from a predefined emoji list (no custom emoji). The `react` tool should accept unicode emoji and validate against the allowed set.

### MCP Tool Surface

Same 5 tools, adapted for Telegram:

```typescript
// reply(chat_id, text, reply_to?, files?)
// → sendMessage(chat_id, text, reply_to_message_id?, parse_mode: "Markdown")
// → For files: sendDocument/sendPhoto per attachment
// → Split messages >4096 chars (Telegram limit, vs Discord's 2000)

// react(chat_id, message_id, emoji)
// → setMessageReaction(chat_id, message_id, [{ type: "emoji", emoji }])

// edit_message(chat_id, message_id, text)
// → editMessageText(chat_id, message_id, text)

// fetch_messages(chat_id, limit?, before?)
// → No direct "fetch history" API in Bot API.
// → Workaround: maintain a local message cache (append-only JSONL per chat)
// → Or use getUpdates with offset to replay recent messages

// download_attachment(chat_id, message_id)
// → getFile(file_id) → download from file_path
// → file_id comes from message.document/photo/audio etc.
```

**`fetch_messages` is the hardest adaptation.** The Telegram Bot API has no "get message history" endpoint — bots only see messages as they arrive. Two options:

- **Option A: Local cache.** The plugin maintains a `messages.jsonl` per chat, appending each received message. `fetch_messages` reads from this cache. Simple, but cache is empty on first boot and misses messages sent while the bot was offline.
- **Option B: Telegram Database Library (TDLib).** A C++ library that provides full chat history access. Much more capable but adds a heavy dependency (compiled binary, ~50MB).

**Recommendation: Option A (local cache).** It's consistent with fleet's filesystem-native philosophy. The limitation (no pre-boot history) is acceptable — fleet agents primarily need recent context, not deep history. Document the limitation clearly.

### Message Routing

```
Telegram Bot API (long polling or webhook)
  → Receive Update object
  → Extract: message.chat.id, message.from, message.text, message.message_thread_id
  → Pre-filter:
    - Drop messages from bots (unless in PARTNER_BOT_IDS)
    - In groups: drop if bot not @mentioned and privacy mode is on
    - Check access.json allowFrom for DMs
  → Scope resolution:
    - Private chat: "dm:{userId}"
    - Group: "group:{chatId}"
    - Forum topic: "topic:{chatId}:{threadId}"
  → Format prompt:
    "<channel source=\"plugin:telegram:telegram\" chat_id=\"{chatId}\" message_id=\"{msgId}\" user=\"{firstName}\" user_id=\"{userId}\" ts=\"{timestamp}\">"
  → onMention() callback → Claude processes → calls reply/react/edit tools
```

### fleet.yaml Changes

```yaml
# Current (Discord only):
discord:
  channels:
    dev:
      id: "1484570579129471066"
      workspace: ~/workspace/sysbuilder

# Proposed (multi-channel support):
channels:
  discord:
    dev:
      id: "1484570579129471066"
      workspace: ~/workspace/sysbuilder
    fleet-dev:
      id: "1487433347658682500"
      workspace: ~/workspace/open-fleet
  telegram:
    ops-chat:
      id: "-1001234567890"           # Telegram chat ID (negative for groups)
      workspace: ~/workspace/open-fleet
    alerts:
      id: "-1009876543210"
      workspace: ~/workspace/sysbuilder

# Discord-specific config stays under discord:
discord:
  serverId: "1484935861157236756"
  userId: "553790678379921448"

# Telegram-specific config:
telegram:
  webhookUrl: "https://fleet.example.com/telegram"  # Optional, for webhook mode
```

**Agent channel assignment:**

```yaml
agents:
  John-Carmack:
    role: worker
    tokenEnv: DISCORD_BOT_TOKEN_CODER     # Discord token
    telegramTokenEnv: TELEGRAM_BOT_TOKEN_CODER  # Telegram token (optional)
    channels: [dev, fleet-dev, ops-chat]   # Mix of Discord + Telegram channels
```

The agent adapter resolves channel labels to the correct platform and loads the appropriate plugin(s).

### FleetConfig Type Changes

```typescript
// src/core/types.ts

export interface FleetConfig {
  fleet: { name: string; mission?: string; apiHost?: string; apiPort?: number }
  structure?: OrgStructure

  // New: unified channel registry
  channels?: {
    discord?: Record<string, ChannelDef>
    telegram?: Record<string, ChannelDef>
  }

  // Existing: kept for backward compatibility during migration
  discord: {
    channels: Record<string, ChannelDef>
    serverId?: string
    userId?: string
    notificationBotToken?: string
  }

  // New: Telegram-specific config
  telegram?: {
    webhookUrl?: string     // Optional webhook endpoint
  }

  servers?: Record<string, ServerConfig>
  defaults: { workspace: string; runtime?: string; agentAdapter?: AgentAdapterKind }
  agents: Record<string, AgentDef>
}

// AgentDef extension
export interface AgentDef {
  // ... existing fields
  tokenEnv: string                    // Discord bot token env var
  telegramTokenEnv?: string           // Telegram bot token env var (optional)
  channelPlatforms?: Record<string, "discord" | "telegram">  // Override platform per channel label
}
```

**Backward compatibility:** The existing `discord.channels` path continues to work. The new `channels.discord` / `channels.telegram` structure is additive. Config loading merges both paths.

### Auth Flow

**Discord (current):**
1. Create bot in Discord Developer Portal
2. Copy token → set as env var (`DISCORD_BOT_TOKEN_CODER`)
3. Generate invite URL → add bot to server
4. `fleet init` auto-discovers channels via API

**Telegram (proposed):**
1. Talk to @BotFather on Telegram → `/newbot` → copy token
2. Set as env var (`TELEGRAM_BOT_TOKEN_CODER`)
3. Add bot to desired groups manually (Telegram has no invite URL for groups)
4. Get chat IDs: bot receives an update when added to a group — log the chat ID, or use `getUpdates` to discover it
5. Add chat IDs to `fleet.yaml` under `channels.telegram`

**Key difference:** Discord has API-driven channel discovery (`listServers` → `listChannels`). Telegram doesn't — chat IDs must be obtained manually or from the bot's update stream. A helper command could ease this:

```bash
fleet telegram discover
# Starts polling, prints chat IDs as the bot receives messages
# User adds bot to groups, sends a message, command prints the chat ID
```

### Access Control

Same `access.json` schema, different population:

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["123456789"],
  "groups": {
    "-1001234567890": {
      "requireMention": true,
      "allowFrom": []
    }
  },
  "pending": {}
}
```

- `allowFrom` contains Telegram user IDs (numeric)
- `groups` keyed by Telegram chat ID (negative for groups/supergroups)
- `requireMention` maps to: only respond when @bot_username appears in text
- Partner bot IDs work the same way (allow messages from other fleet bots)

### Plugin Loading

Claude adapter wrapper script gains a conditional plugin load:

```bash
# Current:
claude --channels plugin:discord@claude-plugins-official ...

# With Telegram:
claude --channels plugin:discord@claude-plugins-official \
       --channels plugin:telegram@claude-plugins-official ...

# Or Telegram-only agent:
claude --channels plugin:telegram@claude-plugins-official ...
```

Determined by which token env vars are set for the agent. If both `tokenEnv` and `telegramTokenEnv` are present, both plugins load — the agent operates on both platforms simultaneously.

### Plugin Patching

Same pattern as Discord: `fleet patch` updates `PARTNER_BOT_IDS` in the Telegram plugin with all fleet bot IDs. This allows bot-to-bot messages across platforms (a Discord bot can mention a Telegram bot's user ID in a task notification).

### Notification Routing

`src/tasks/notify.ts` currently sends notifications via Discord. With Telegram support:

1. Resolve the agent's primary channel (first in their `channels` list)
2. Determine platform from channel label → `channels.discord` or `channels.telegram`
3. Send via the correct API client

For cross-platform notifications (e.g., Discord agent assigns a task to a Telegram agent), the notification routes through the recipient's platform, not the sender's.

## What This Does NOT Include

- **Bridging** — no Discord-to-Telegram message forwarding. Agents on different platforms communicate through the task system, not cross-platform chat relay.
- **Inline keyboards / custom buttons** — Telegram supports rich interactive UI (inline keyboards, callback queries). Out of scope for v1 — the plugin exposes the same 5 tools as Discord.
- **Webhook mode implementation** — spec describes both polling and webhook, but v1 uses long polling for simplicity. Webhook adds latency benefits but requires a public URL + TLS.
- **Bot commands menu** — Telegram bots can register `/commands` with BotFather. Out of scope — agents respond to natural language @mentions, not slash commands.
- **Telegram channels (broadcast)** — Telegram "channels" are broadcast-only (one-to-many). Not useful for agent interaction. Only groups/supergroups/private chats are supported.

## Implementation Plan

### Phase 1 — Channel Abstraction (prerequisite)

1. Move `discord.channels` in FleetConfig to `channels.discord` (keep backward compat)
2. Add `channels.telegram` and `telegram` config sections to FleetConfig
3. Update config loader to merge both paths
4. Add `telegramTokenEnv` to AgentDef
5. Update `resolveChannelPlatform()` to map channel labels to platforms

**Effort:** Config + types changes. 2-3 hours.

### Phase 2 — Telegram API Client

1. Create `src/channel/telegram/api.ts` implementing `ChannelAdapter`
2. Implement: `validateToken()`, `generateAccessConfig()`, `pluginId()`, `inviteUrl()`
3. Stub no-ops: `listServers()`, `createChannel()`, `getChannelByName()`
4. `fleet telegram discover` helper command

**Effort:** One file + CLI command. Half a sprint.

### Phase 3 — Telegram MCP Plugin

1. Create the MCP server (parallel to Discord's `server.ts`)
2. Implement 5 tools: reply, react, edit_message, fetch_messages (cached), download_attachment
3. Message routing: long polling → pre-filter → scope resolution → onMention callback
4. Local message cache (JSONL per chat)
5. Access.json integration

**Effort:** Plugin implementation + tests. One sprint.

### Phase 4 — Agent Adapter Integration

1. Update Claude adapter to conditionally load Telegram plugin
2. Update wrapper script env vars (TELEGRAM_BOT_TOKEN, TELEGRAM_STATE_DIR)
3. Update notification routing for cross-platform delivery
4. Update `fleet patch` to handle Telegram plugin
5. Update `fleet init` flow for Telegram setup

**Effort:** Adapter + patching + init changes. Half a sprint.

## Open Questions

1. **Should agents support both platforms simultaneously?** The spec assumes yes (load both plugins if both tokens exist). But this means the agent sees messages from both platforms interleaved — could be confusing. Alternative: one platform per agent, cross-platform via task system only.
2. **Long polling vs webhook?** Long polling is simpler (no public URL needed) but uses more bandwidth and has higher latency. For fleet agents running on a server with a public IP, webhook is better. Should this be configurable per-fleet or hardcoded?
3. **Message cache retention.** The local JSONL cache for `fetch_messages` will grow indefinitely. Should there be a rotation policy (e.g., keep last 1000 messages per chat)?
