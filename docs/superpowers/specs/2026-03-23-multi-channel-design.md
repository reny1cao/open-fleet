# Multi-Channel Support

## Problem

Fleet currently supports one Discord channel per fleet (`discord.channel_id`). Users with multiple projects want separate channels per project within the same fleet, sharing the same agent team.

## Decision

All agents join all channels. `requireMention: true` prevents noise — agents only respond when @mentioned. PM routes tasks naturally by @mentioning teammates in the appropriate channel.

Per-agent channel filtering is explicitly deferred — not needed with `requireMention` and a small team.

## Schema Change

### fleet.yaml

```yaml
# New format
discord:
  channels:
    store:
      id: "111111"
      workspace: ~/workspace/store
    quant:
      id: "222222"
      workspace: ~/workspace/st-stock-quant
  server_id: "999999"
  user_id: "888888"
```

Each channel has a label (human-readable, used in identity), an `id` (Discord channel ID), and an optional `workspace` (project directory).

### Backward Compatibility

Old `channel_id: "xxx"` format is supported. `loadConfig()` normalizes it to:

```yaml
channels:
  default:
    id: "xxx"
```

`saveConfig()` always writes the new `channels` format.

## Type Changes

### `src/core/types.ts`

```typescript
export interface ChannelDef {
  id: string
  workspace?: string
}

export interface FleetConfig {
  fleet: { name: string; mission?: string }
  structure?: OrgStructure
  discord: {
    channels: Record<string, ChannelDef>
    serverId?: string
    userId?: string
  }
  servers?: Record<string, ServerConfig>
  defaults: { workspace: string; runtime?: string }
  agents: Record<string, AgentDef>
}
```

### `src/channel/types.ts`

```typescript
export interface AccessConfigOpts {
  channels: Record<string, ChannelDef>  // was: channelId: string
  userId?: string
  partnerBotIds: string[]
  requireMention: boolean
}
```

## Code Changes (6 files)

### 1. `src/core/types.ts`
- Add `ChannelDef` interface
- Change `discord.channelId: string` to `discord.channels: Record<string, ChannelDef>`

### 2. `src/core/config.ts` — `loadConfig()`
- If YAML has `channel_id` (old format), normalize to `channels: { default: { id } }`
- If YAML has `channels` (new format), parse as `Record<string, ChannelDef>`
- Validate: at least one channel entry
- `saveConfig()`: always write `channels` format (camelCase → snake_case)

### 3. `src/channel/discord/access.ts` — `writeAccessConfig()`
- Accept `channels: Record<string, ChannelDef>` instead of single `channelId`
- Generate `groups` entry for each channel:

```json
{
  "groups": {
    "111111": { "requireMention": true, "allowFrom": [] },
    "222222": { "requireMention": true, "allowFrom": [] }
  }
}
```

### 4. `src/core/identity.ts` — `buildIdentityPrompt()`
- Replace single `## Channel` section with multi-channel section:

```markdown
## Channels
- **#store** (channel `111111`) — workspace: ~/workspace/store
- **#quant** (channel `222222`) — workspace: ~/workspace/st-stock-quant

When you receive a message, check which channel it came from.
Work in the corresponding workspace directory.
```

### 5. `src/commands/start.ts`
- Pass `config.discord.channels` to `writeAccessConfig()` instead of single channel ID
- No other changes needed

### 6. `src/commands/init.ts`
- Non-interactive: accept `--channel label:id:workspace` (repeatable)
  - Single `--channel 111111` still works (becomes `default` label, no workspace)
- Interactive: loop to add channels until empty line
- Build `channels` map instead of single `channelId`

## What Does Not Change

- **Runtime** (`tmux.ts`, `remote.ts`): no changes — tmux/SSH layer is channel-agnostic
- **Discord plugin**: no changes — `groups` already supports multiple channels
- **Roster CLAUDE.md**: no changes — roster is agent-level, not channel-level
- **`--add-dir`**: still points to `defaults.workspace` (parent dir) — agents access all project dirs
- **`fleet start` command flow**: unchanged aside from passing channels instead of channelId
- **`fleet status`, `fleet stop`, `fleet doctor`**: no changes needed

## Agent Behavior

1. Agent starts with `--add-dir ~/workspace` (access to all subdirectories)
2. Identity includes channel-workspace mapping
3. Message arrives from Discord with a `chat_id` (channel ID)
4. Agent matches `chat_id` to its channel list → knows which project/workspace
5. Agent works in the corresponding directory
6. Agent replies in the same channel

## Migration

Existing `fleet.yaml` files with `channel_id` continue to work unchanged. `loadConfig()` normalizes on read. Users can optionally run `fleet init` with multiple `--channel` args to set up multi-channel from scratch, or manually edit `fleet.yaml` to add channels.

## Testing

- `config.test.ts`: test old format normalization, new format parsing, validation
- `access.test.ts`: test multi-channel groups generation
- `identity.test.ts`: test multi-channel identity section
