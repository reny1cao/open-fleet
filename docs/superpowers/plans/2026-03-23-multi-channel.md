# Multi-Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support multiple Discord channels per fleet, each mapped to a project workspace.

**Architecture:** Replace `discord.channelId: string` with `discord.channels: Record<string, ChannelDef>` across types, config, access, identity, start, and init. No runtime/plugin changes needed — Discord plugin's `groups` already supports multiple channels.

**Tech Stack:** Bun, TypeScript, bun:test

**Spec:** `docs/superpowers/specs/2026-03-23-multi-channel-design.md`

**Pre-existing test failure:** `findConfigDir > throws when fleet.yaml cannot be found anywhere` — fails because `~/.fleet/config.json` exists on the dev machine. Not related to this feature.

---

### Task 1: Update types

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/channel/types.ts`

- [ ] **Step 1: Update `src/core/types.ts`**

Add `ChannelDef` and change `discord` field:

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

- [ ] **Step 2: Update `src/channel/types.ts`**

Change `AccessConfigOpts` from single channelId to channels map:

```typescript
import type { ChannelDef } from "../core/types"

export interface AccessConfigOpts {
  channels: Record<string, ChannelDef>
  userId?: string
  partnerBotIds: string[]
  requireMention: boolean
}
```

- [ ] **Step 3: Verify TypeScript compiles (expect errors in downstream files)**

Run: `cd ~/.fleet && bunx tsc --noEmit 2>&1 | head -30`

This WILL show errors in config.ts, access.ts, identity.ts, start.ts, init.ts, add-agent.ts, api.ts — that's expected. We fix them in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts src/channel/types.ts
git commit -m "refactor: ChannelDef type — multi-channel support"
```

---

### Task 2: Update config.ts (loadConfig + saveConfig)

**Files:**
- Modify: `src/core/config.ts`
- Modify: `test/config.test.ts`

- [ ] **Step 1: Update test fixtures and assertions in `test/config.test.ts`**

Replace `VALID_FLEET_YAML` — change `channel_id: "111222333"` to channels format:

```yaml
discord:
  channels:
    default:
      id: "111222333"
  server_id: "999888777"
  user_id: "555444333"
```

Replace `MINIMAL_FLEET_YAML` similarly:

```yaml
discord:
  channels:
    default:
      id: "123"
```

Update all test YAML strings that use `channel_id` to use `channels` format.

Update assertions: `config.discord.channelId` → `config.discord.channels.default.id`. Example:

```typescript
expect(config.discord.channels["default"].id).toBe("111222333")
```

Add new test for multi-channel parsing:

```typescript
it("parses multiple channels with workspace", () => {
  const yaml = `\
fleet:
  name: test-fleet
discord:
  channels:
    store:
      id: "111"
      workspace: ~/workspace/store
    quant:
      id: "222"
      workspace: ~/workspace/quant
defaults:
  workspace: ~/workspace
agents:
  hub:
    role: hub
    server: local
    identity: identities/hub.md
`
  writeFileSync(join(dir, "fleet.yaml"), yaml)
  const config = loadConfig(dir)
  expect(Object.keys(config.discord.channels)).toHaveLength(2)
  expect(config.discord.channels["store"].id).toBe("111")
  expect(config.discord.channels["store"].workspace).toBe("~/workspace/store")
  expect(config.discord.channels["quant"].id).toBe("222")
})
```

Add validation test:

```typescript
it("throws when discord.channels is empty", () => {
  const yaml = `\
fleet:
  name: broken
discord:
  channels: {}
defaults:
  workspace: ~/workspace
agents:
  hub:
    role: hub
    server: local
    identity: identities/hub.md
`
  writeFileSync(join(dir, "fleet.yaml"), yaml)
  expect(() => loadConfig(dir)).toThrow()
})
```

Update saveConfig round-trip test assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/.fleet && bun test test/config.test.ts 2>&1`
Expected: FAIL (loadConfig still reads `channel_id`)

- [ ] **Step 3: Update `loadConfig()` in `src/core/config.ts`**

Replace the discord parsing block (lines 114-122):

```typescript
// ── discord ───────────────────────────────────────────────────────────────
const discordRaw = (raw.discord ?? {}) as Record<string, unknown>
const channelsRaw = discordRaw.channels as Record<string, Record<string, string>> | undefined
if (!channelsRaw || Object.keys(channelsRaw).length === 0) {
  throw new Error("fleet.yaml: discord.channels is required (channel_id no longer supported — use channels format)")
}
const channels: Record<string, ChannelDef> = {}
for (const [label, chRaw] of Object.entries(channelsRaw)) {
  channels[label] = {
    id: chRaw.id,
    workspace: chRaw.workspace,
  }
}
const discord = {
  channels,
  serverId: discordRaw.server_id as string | undefined,
  userId: discordRaw.user_id as string | undefined,
}
```

Add `ChannelDef` to the imports from `./types`.

- [ ] **Step 4: Update `saveConfig()` in `src/core/config.ts`**

Replace the discord serialization block (lines 200-204):

```typescript
const channelsOut: Record<string, Record<string, string>> = {}
for (const [label, ch] of Object.entries(config.discord.channels)) {
  channelsOut[label] = {
    id: ch.id,
    ...(ch.workspace !== undefined ? { workspace: ch.workspace } : {}),
  }
}

const discord: Record<string, unknown> = {
  channels: channelsOut,
  ...(config.discord.serverId !== undefined ? { server_id: config.discord.serverId } : {}),
  ...(config.discord.userId !== undefined ? { user_id: config.discord.userId } : {}),
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/.fleet && bun test test/config.test.ts 2>&1`
Expected: all config tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/config.ts test/config.test.ts
git commit -m "feat: loadConfig/saveConfig support multi-channel"
```

---

### Task 3: Update access.ts

**Files:**
- Modify: `src/channel/discord/access.ts`
- Modify: `test/access.test.ts`

- [ ] **Step 1: Update test fixtures in `test/access.test.ts`**

Change all `writeAccessConfig` calls from `channelId: "xxx"` to `channels: { default: { id: "xxx" } }`.

Add multi-channel test:

```typescript
it("generates groups entry for each channel", () => {
  dir = makeTempDir()
  writeAccessConfig(dir, {
    channels: {
      store: { id: "111" },
      quant: { id: "222" },
    },
    partnerBotIds: ["bot1"],
    requireMention: true,
  })
  const cfg = readAccessConfig(dir)
  expect(Object.keys(cfg.groups)).toHaveLength(2)
  expect(cfg.groups["111"]).toBeDefined()
  expect(cfg.groups["222"]).toBeDefined()
  expect(cfg.groups["111"].requireMention).toBe(true)
  expect(cfg.groups["222"].requireMention).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/.fleet && bun test test/access.test.ts 2>&1`
Expected: FAIL (writeAccessConfig still expects `channelId`)

- [ ] **Step 3: Update `writeAccessConfig()` in `src/channel/discord/access.ts`**

```typescript
import type { AccessConfig, AccessConfigOpts } from "../types"
import type { ChannelDef } from "../../core/types"

export function writeAccessConfig(stateDir: string, opts: AccessConfigOpts): void {
  mkdirSync(stateDir, { recursive: true })

  const groups: Record<string, { requireMention: boolean; allowFrom: string[] }> = {}
  for (const ch of Object.values(opts.channels)) {
    groups[ch.id] = {
      requireMention: opts.requireMention,
      allowFrom: [],
    }
  }

  const config: AccessConfig = {
    dmPolicy: "allowlist",
    allowFrom: [...opts.partnerBotIds, ...(opts.userId ? [opts.userId] : [])],
    groups,
    pending: {},
  }

  writeFileSync(join(stateDir, "access.json"), JSON.stringify(config, null, 2))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/.fleet && bun test test/access.test.ts 2>&1`
Expected: all access tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/channel/discord/access.ts test/access.test.ts
git commit -m "feat: writeAccessConfig generates multi-channel groups"
```

---

### Task 4: Update identity.ts

**Files:**
- Modify: `src/core/identity.ts`
- Modify: `test/identity.test.ts`

- [ ] **Step 1: Update test config fixtures in `test/identity.test.ts`**

Change `discord: { channelId: "chan123" }` to:

```typescript
discord: { channels: { default: { id: "chan123" } } }
```

Do this for both `config` and `managerConfig`.

Update the "contains channel info" test:

```typescript
it("contains channel info", () => {
  const prompt = buildIdentityPrompt("pm", config, botIds)
  expect(prompt).toContain("chan123")
  expect(prompt).toContain("Channels")
})
```

Add multi-channel identity test:

```typescript
it("lists all channels with workspace mapping", () => {
  const multiConfig: FleetConfig = {
    ...config,
    discord: {
      channels: {
        store: { id: "111", workspace: "~/workspace/store" },
        quant: { id: "222", workspace: "~/workspace/quant" },
      },
    },
  }
  const prompt = buildIdentityPrompt("pm", multiConfig, botIds)
  expect(prompt).toContain("#store")
  expect(prompt).toContain("111")
  expect(prompt).toContain("~/workspace/store")
  expect(prompt).toContain("#quant")
  expect(prompt).toContain("222")
  expect(prompt).toContain("~/workspace/quant")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/.fleet && bun test test/identity.test.ts 2>&1`
Expected: FAIL (buildIdentityPrompt still reads `config.discord.channelId`)

- [ ] **Step 3: Update `buildIdentityPrompt()` in `src/core/identity.ts`**

Replace the `## Channel` section (lines 33-35) with:

```typescript
lines.push("## Channels")
for (const [label, ch] of Object.entries(config.discord.channels)) {
  const ws = ch.workspace ? ` — workspace: ${ch.workspace}` : ""
  lines.push(`- **#${label}** (channel \`${ch.id}\`)${ws}`)
}
lines.push("")
lines.push("When you receive a message, check which channel it came from. Work in the corresponding workspace directory.")
lines.push("")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/.fleet && bun test test/identity.test.ts 2>&1`
Expected: all identity tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/identity.ts test/identity.test.ts
git commit -m "feat: identity includes multi-channel workspace mapping"
```

---

### Task 5: Update command files (start.ts, init.ts, add-agent.ts, api.ts, cli.ts)

**Files:**
- Modify: `src/commands/start.ts`
- Modify: `src/commands/add-agent.ts`
- Modify: `src/channel/discord/api.ts`
- Modify: `src/commands/init.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Update `src/commands/start.ts`**

Change the `writeAccessConfig` call (around line 101) from `channelId` to `channels`:

```typescript
writeAccessConfig(expandedStateDir, {
  channels: config.discord.channels,
  partnerBotIds,
  requireMention: true,
  userId: config.discord.userId,
})
```

- [ ] **Step 2: Update `src/commands/add-agent.ts`**

Change the `writeAccessConfig` call (around line 95) — same pattern:

```typescript
writeAccessConfig(stateDir, {
  channels: config.discord.channels,
  partnerBotIds,
  requireMention: true,
  userId: config.discord.userId,
})
```

- [ ] **Step 3: Update `src/channel/discord/api.ts` `generateAccessConfig()`**

Replace the method (around line 128):

```typescript
generateAccessConfig(opts: AccessConfigOpts): AccessConfig {
  const { channels, userId, partnerBotIds, requireMention } = opts

  const groups: Record<string, { requireMention: boolean; allowFrom: string[] }> = {}
  for (const ch of Object.values(channels)) {
    groups[ch.id] = {
      requireMention,
      allowFrom: [],
    }
  }

  return {
    dmPolicy: "allowlist",
    allowFrom: [...partnerBotIds, ...(userId ? [userId] : [])],
    groups,
    pending: {},
  }
}
```

Note: harmonized with `writeAccessConfig` — top-level `allowFrom` includes partnerBotIds + userId, group `allowFrom` is empty.

- [ ] **Step 4: Update `src/cli.ts`**

Add `--channel` to the array collection loop (line 50-54), alongside `--token` and `--agent`:

```typescript
const tokens: string[] = []
const agents: string[] = []
const channelArgs: string[] = []
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--token" && args[i + 1]) { tokens.push(args[++i]); continue }
  if (args[i] === "--name" && args[i + 1]) { /* handled by parseFlagValue */ continue }
  if (args[i] === "--agent" && args[i + 1]) { agents.push(args[++i]); continue }
  if (args[i] === "--channel" && args[i + 1]) { channelArgs.push(args[++i]); continue }
}
```

Pass `channelArgs` to `init()`:

```typescript
await init({ tokens, name, agents: agents.length > 0 ? agents : undefined, channel: channelArgs.length > 0 ? channelArgs : undefined, force: parseFlag(args, "--force"), json: parseFlag(args, "--json"), template })
```

Update usage string: `--channel label:id[:workspace]` (repeatable).

- [ ] **Step 5: Update `src/commands/init.ts`**

Change `opts.channel` type from `string` to `string[]`:

```typescript
export async function init(opts: {
  tokens: string[]
  name: string
  agents?: string[]
  channel?: string[]     // was: string
  force?: boolean
  json?: boolean
  template?: string
}): Promise<void> {
```

Add `ChannelDef` import:

```typescript
import type { FleetConfig, AgentDef, ChannelDef } from "../core/types"
```

Replace the channel detection block (section 5, around lines 133-150) with:

```typescript
// ── 5. Parse channels ─────────────────────────────────────────────────
let channels: Record<string, ChannelDef>
if (opts.channel && opts.channel.length > 0) {
  channels = {}
  for (const ch of opts.channel) {
    const parts = ch.split(":")
    if (parts.length === 2) {
      channels[parts[0]] = { id: parts[1] }
    } else if (parts.length === 3) {
      channels[parts[0]] = { id: parts[1], workspace: parts[2] }
    } else {
      throw new Error(`Invalid --channel format "${ch}": expected "label:id" or "label:id:workspace"`)
    }
  }
} else {
  log("Detecting channel…")
  const allChannels = await discord.listChannels(tokens[0], guildId)
  const textChannel = allChannels.find((ch) => ch.type === "text")
  if (!textChannel) {
    throw new Error("No text channels found. Create one in Discord, or pass --channel label:id")
  }
  channels = { default: { id: textChannel.id } }
  log(`  Using channel: #${textChannel.name} (${textChannel.id})`)
}
```

Note: auto-detect uses `default` as label (not the Discord channel name — avoids special char issues in YAML keys).

Replace the FleetConfig builder (around line 170):

```typescript
const config: FleetConfig = {
  fleet: { name },
  discord: {
    channels,
    serverId: guildId,
    ...(ownerId !== undefined ? { userId: ownerId } : {}),
  },
  defaults: {
    workspace: "~/workspace",
  },
  agents,
}
```

Replace the `writeAccessConfig` call inside the agent loop (around line 224):

```typescript
writeAccessConfig(stateDir, {
  channels,
  partnerBotIds,
  requireMention: true,
  userId: config.discord.userId,
})
```

Replace the summary output (around lines 237-248). JSON mode:

```typescript
console.log(JSON.stringify({
  fleet: name,
  agents: agentSpecs.map((s) => s.name),
  channels: Object.fromEntries(
    Object.entries(channels).map(([label, ch]) => [label, ch.id])
  ),
  files: writtenFiles,
}))
```

Text mode:

```typescript
console.log(`Channels :`)
for (const [label, ch] of Object.entries(channels)) {
  const ws = ch.workspace ? ` → ${ch.workspace}` : ""
  console.log(`  #${label} (${ch.id})${ws}`)
}
```

Replace `interactiveInit()` channel prompting (around line 310, before delegating to `init()`):

```typescript
// Step 4: Channels
console.log("")
console.log("  Channels (label:id or label:id:workspace, empty line when done):")
const channelArgs: string[] = []
while (true) {
  const ch = await ask(`  Channel ${channelArgs.length + 1}: `)
  if (!ch.trim()) break
  channelArgs.push(ch.trim())
}

rl.close()

await init({
  tokens, name, agents,
  channel: channelArgs.length > 0 ? channelArgs : undefined,
  force: false,
})
```

- [ ] **Step 6: Run all tests**

Run: `cd ~/.fleet && bun test 2>&1`
Expected: all tests PASS (except the pre-existing findConfigDir test)

- [ ] **Step 7: Commit**

```bash
git add src/commands/start.ts src/commands/init.ts src/commands/add-agent.ts src/channel/discord/api.ts src/cli.ts
git commit -m "feat: all commands use multi-channel config"
```

---

### Task 6: Update fleet.yaml and rebuild

**Files:**
- Modify: `~/workspace/qa/fleet.yaml`

- [ ] **Step 1: Update `~/workspace/qa/fleet.yaml`**

Replace:
```yaml
discord:
  channel_id: "1484935861769601169"
```

With:
```yaml
discord:
  channels:
    crew:
      id: "1484935861769601169"
```

(Use `crew` as the label since it's the general team channel. More channels can be added later.)

- [ ] **Step 2: Rebuild the binary**

Run: `cd ~/.fleet && bun run build && cp fleet-next ~/.local/bin/fleet`

- [ ] **Step 3: Smoke test**

Run: `fleet status` — should work with the new config format.

- [ ] **Step 4: Commit fleet.yaml**

```bash
cd ~/workspace/qa && git add fleet.yaml
git commit -m "feat: fleet.yaml uses multi-channel format"
```

- [ ] **Step 5: Commit fleet source**

```bash
cd ~/.fleet && git add -A && git commit -m "build: rebuild fleet-next with multi-channel support"
```
