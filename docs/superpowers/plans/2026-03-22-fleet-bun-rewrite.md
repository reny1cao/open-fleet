# Fleet CLI — Bun/TypeScript Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the fleet CLI from bash to Bun/TypeScript — a single compiled binary that manages AI agent fleets via Discord + tmux.

**Architecture:** Org-first model with channel adapter interface. Core types → Discord adapter → tmux runtime → CLI commands. Identity loaded via `--append-system-prompt-file` before channel connects. `bun build --compile` for distribution.

**Tech Stack:** Bun, TypeScript, `yaml` package, Discord REST API via `fetch`, tmux via `Bun.spawn`.

**Spec:** `docs/superpowers/specs/2026-03-22-fleet-bun-rewrite-design.md`

**Repo:** `~/.fleet` (https://github.com/reny1cao/open-fleet)

**Working convention:** TS source lives in `src/`. Bash files in `lib/` are untouched until Phase 4. During coexistence, the TS binary is at `fleet-next`, bash stays at `fleet`.

---

## Phase 1: Core + Start + Stop + Status

### Task 1: Project scaffolding

**Files:**
- Create: `src/index.ts`
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "open-fleet",
  "version": "0.1.0",
  "type": "module",
  "bin": { "fleet-next": "src/index.ts" },
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "bun build --compile --outfile fleet-next src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create minimal entry point**

```typescript
// src/index.ts
#!/usr/bin/env bun

console.log("fleet-next: not yet implemented")
process.exit(0)
```

- [ ] **Step 4: Install deps and verify**

Run: `cd ~/.fleet && bun install`
Expected: lockfile created, no errors

Run: `bun run src/index.ts`
Expected: prints "fleet-next: not yet implemented"

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json bun.lock src/index.ts
git commit -m "scaffold: Bun/TS project with entry point"
```

---

### Task 2: Core types and config loader

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/config.ts`
- Create: `test/config.test.ts`

- [ ] **Step 1: Write failing test for config loading**

```typescript
// test/config.test.ts
import { describe, it, expect } from "bun:test"
import { loadConfig, loadEnv } from "../src/core/config"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"

const TMP = join(import.meta.dir, ".tmp-config-test")

describe("loadConfig", () => {
  it("parses a valid fleet.yaml", () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, "fleet.yaml"), `
fleet:
  name: test-fleet

discord:
  channel_id: "123"

defaults:
  workspace: ~/workspace

agents:
  hub:
    role: lead
    server: local
`)
    const config = loadConfig(TMP)
    expect(config.fleet.name).toBe("test-fleet")
    expect(config.discord.channelId).toBe("123")
    expect(config.agents.hub.role).toBe("lead")
    expect(config.agents.hub.tokenEnv).toBe("DISCORD_BOT_TOKEN_HUB")
    rmSync(TMP, { recursive: true })
  })

  it("throws on missing fleet.yaml", () => {
    expect(() => loadConfig("/nonexistent")).toThrow("fleet.yaml not found")
  })

  it("throws on missing required fields", () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, "fleet.yaml"), "fleet:\n  name: x\n")
    expect(() => loadConfig(TMP)).toThrow()
    rmSync(TMP, { recursive: true })
  })
})

describe("loadEnv", () => {
  it("parses .env file", () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, ".env"), "FOO=bar\nBAZ=qux\n")
    const env = loadEnv(TMP)
    expect(env.FOO).toBe("bar")
    expect(env.BAZ).toBe("qux")
    rmSync(TMP, { recursive: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/.fleet && bun test test/config.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write core types**

```typescript
// src/core/types.ts

export interface FleetConfig {
  fleet: { name: string; mission?: string }
  structure?: OrgStructure
  discord: { channelId: string; serverId?: string; userId?: string }
  servers?: Record<string, ServerConfig>
  defaults: { workspace: string; runtime?: string }
  agents: Record<string, AgentDef>
}

export interface OrgStructure {
  topology: "star" | "hierarchy" | "mesh" | "squad"
  lead?: string
}

export interface AgentDef {
  role: string
  tokenEnv: string
  server: string     // "local" or server name
  identity: string   // path to identity file
  workspace?: string
  stateDir?: string
}

export interface ServerConfig {
  sshHost: string
  user: string
}
```

- [ ] **Step 4: Write config loader**

```typescript
// src/core/config.ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import type { FleetConfig, AgentDef } from "./types"

export function findConfigDir(startDir?: string): string {
  // 1. FLEET_CONFIG env
  const envPath = process.env.FLEET_CONFIG
  if (envPath && existsSync(envPath)) {
    return envPath.endsWith("fleet.yaml")
      ? join(envPath, "..")
      : envPath
  }
  // 2. Current dir
  if (startDir && existsSync(join(startDir, "fleet.yaml"))) return startDir
  const cwd = process.cwd()
  if (existsSync(join(cwd, "fleet.yaml"))) return cwd
  // 3. FLEET_DIR
  const fleetDir = process.env.FLEET_DIR
  if (fleetDir && existsSync(join(fleetDir, "fleet.yaml"))) return fleetDir
  throw new Error("fleet.yaml not found. Run 'fleet init' to create one.")
}

export function loadConfig(dir?: string): FleetConfig {
  const configDir = dir ?? findConfigDir()
  const raw = readFileSync(join(configDir, "fleet.yaml"), "utf8")
  const yaml = parseYaml(raw) as Record<string, any>

  if (!yaml?.fleet?.name) throw new Error("fleet.yaml: missing fleet.name")
  if (!yaml?.agents || Object.keys(yaml.agents).length === 0) {
    throw new Error("fleet.yaml: no agents defined")
  }

  // Normalize agents: derive tokenEnv if not set, fill defaults
  const agents: Record<string, AgentDef> = {}
  for (const [name, raw] of Object.entries(yaml.agents as Record<string, any>)) {
    agents[name] = {
      role: raw.role ?? "worker",
      tokenEnv: raw.token_env ?? `DISCORD_BOT_TOKEN_${name.toUpperCase().replace(/-/g, "_")}`,
      server: raw.server ?? "local",
      identity: raw.identity ?? `identities/${name}.md`,
      workspace: raw.workspace,
      stateDir: raw.state_dir,
    }
  }

  return {
    fleet: { name: yaml.fleet.name, mission: yaml.fleet.mission },
    structure: yaml.structure,
    discord: {
      channelId: yaml.discord?.channel_id ?? "",
      serverId: yaml.discord?.server_id,
      userId: yaml.discord?.user_id,
    },
    servers: yaml.servers
      ? Object.fromEntries(
          Object.entries(yaml.servers as Record<string, any>).map(([k, v]) => [
            k,
            { sshHost: v.ssh_host, user: v.user },
          ])
        )
      : undefined,
    defaults: {
      workspace: yaml.defaults?.workspace ?? "~/workspace",
      runtime: yaml.defaults?.runtime ?? "claude",
    },
    agents,
  }
}

export function saveConfig(config: FleetConfig, dir: string): void {
  // Convert back to YAML-friendly format (snake_case keys)
  const yaml: any = {
    fleet: { name: config.fleet.name },
    discord: { channel_id: config.discord.channelId },
    defaults: { workspace: config.defaults.workspace },
    agents: {} as any,
  }
  if (config.fleet.mission) yaml.fleet.mission = config.fleet.mission
  if (config.structure) yaml.structure = config.structure
  if (config.discord.serverId) yaml.discord.server_id = config.discord.serverId
  if (config.discord.userId) yaml.discord.user_id = config.discord.userId
  if (config.servers) {
    yaml.servers = Object.fromEntries(
      Object.entries(config.servers).map(([k, v]) => [k, { ssh_host: v.sshHost, user: v.user }])
    )
  }
  for (const [name, agent] of Object.entries(config.agents)) {
    yaml.agents[name] = {
      token_env: agent.tokenEnv,
      role: agent.role,
      server: agent.server,
      identity: agent.identity,
    }
    if (agent.stateDir) yaml.agents[name].state_dir = agent.stateDir
    if (agent.workspace) yaml.agents[name].workspace = agent.workspace
  }
  writeFileSync(join(dir, "fleet.yaml"), stringifyYaml(yaml))
}

export function loadEnv(dir: string): Record<string, string> {
  const envPath = join(dir, ".env")
  if (!existsSync(envPath)) return {}
  const env: Record<string, string> = {}
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

export function getToken(agentName: string, config: FleetConfig, dir: string): string {
  const agent = config.agents[agentName]
  if (!agent) throw new Error(`Unknown agent: ${agentName}`)
  // Check process.env first, then .env file
  const token = process.env[agent.tokenEnv] ?? loadEnv(dir)[agent.tokenEnv]
  if (!token) throw new Error(`Token not found: set ${agent.tokenEnv} in .env`)
  return token
}

export function resolveStateDir(agentName: string, config: FleetConfig): string {
  const agent = config.agents[agentName]
  if (agent.stateDir) return agent.stateDir.replace(/^~/, process.env.HOME ?? "~")
  // First agent uses default, others get fleet state dir
  const names = Object.keys(config.agents)
  if (names[0] === agentName) {
    return join(process.env.HOME ?? "~", ".claude", "channels", "discord")
  }
  return join(process.env.HOME ?? "~", ".fleet", "state", `discord-${agentName}`)
}

export function sessionName(fleetName: string, agentName: string): string {
  return `${fleetName}-${agentName}`
}
```

- [ ] **Step 5: Run tests**

Run: `cd ~/.fleet && bun test test/config.test.ts`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/config.ts test/config.test.ts
git commit -m "feat: core types and config loader with tests"
```

---

### Task 3: Discord API client

**Files:**
- Create: `src/channel/types.ts`
- Create: `src/channel/discord/api.ts`
- Create: `test/discord-api.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/discord-api.test.ts
import { describe, it, expect } from "bun:test"
import { DiscordApi } from "../src/channel/discord/api"

describe("DiscordApi", () => {
  // Use an obviously invalid token — validates error handling, not Discord
  const api = new DiscordApi()

  it("rejects invalid tokens", async () => {
    await expect(api.validateToken("invalid")).rejects.toThrow()
  })

  it("builds correct invite URL", () => {
    expect(api.inviteUrl("123456")).toContain("client_id=123456")
    expect(api.inviteUrl("123456")).toContain("permissions=117840")
  })

  it("returns plugin ID", () => {
    expect(api.pluginId()).toBe("plugin:discord@claude-plugins-official")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/.fleet && bun test test/discord-api.test.ts`
Expected: FAIL

- [ ] **Step 3: Write channel types**

```typescript
// src/channel/types.ts

export interface BotInfo {
  id: string
  name: string
  appId: string
}

export interface ServerInfo {
  id: string
  name: string
  ownerId?: string
}

export interface ChannelInfo {
  id: string
  name: string
  type: "text" | "voice" | "category"
}

export interface AccessConfig {
  dmPolicy: "allowlist" | "pairing" | "disabled"
  allowFrom: string[]
  groups: Record<string, { requireMention: boolean; allowFrom: string[] }>
  pending: Record<string, never>
}

export interface AccessConfigOpts {
  channelId: string
  userId?: string
  partnerBotIds: string[]
  requireMention: boolean
}

export interface ChannelAdapter {
  validateToken(token: string): Promise<BotInfo>
  listServers(token: string): Promise<ServerInfo[]>
  listChannels(token: string, serverId: string): Promise<ChannelInfo[]>
  createChannel(token: string, serverId: string, name: string, categoryId?: string): Promise<ChannelInfo>
  getChannelByName(token: string, serverId: string, name: string): Promise<ChannelInfo | null>
  generateAccessConfig(opts: AccessConfigOpts): AccessConfig
  inviteUrl(appId: string): string
  pluginId(): string
}
```

- [ ] **Step 4: Write Discord API client**

```typescript
// src/channel/discord/api.ts
import type { ChannelAdapter, BotInfo, ServerInfo, ChannelInfo, AccessConfig, AccessConfigOpts } from "../types"

const DISCORD_API = "https://discord.com/api/v10"
const TIMEOUT_MS = 5000
const BOT_PERMISSIONS = 117840

async function discordFetch(token: string, endpoint: string, opts?: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${DISCORD_API}${endpoint}`, {
      ...opts,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        ...opts?.headers,
      },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Discord API ${endpoint}: ${res.status} ${res.statusText}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

export class DiscordApi implements ChannelAdapter {
  async validateToken(token: string): Promise<BotInfo> {
    const user = await discordFetch(token, "/users/@me")
    const app = await discordFetch(token, "/oauth2/applications/@me").catch(() => null)
    return {
      id: user.id,
      name: user.username,
      appId: app?.id ?? user.id,
    }
  }

  async listServers(token: string): Promise<ServerInfo[]> {
    const guilds = await discordFetch(token, "/users/@me/guilds")
    return guilds.map((g: any) => ({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
    }))
  }

  async listChannels(token: string, serverId: string): Promise<ChannelInfo[]> {
    const channels = await discordFetch(token, `/guilds/${serverId}/channels`)
    return channels
      .filter((c: any) => c.type === 0 || c.type === 2 || c.type === 4)
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        type: c.type === 0 ? "text" as const : c.type === 2 ? "voice" as const : "category" as const,
      }))
  }

  async createChannel(token: string, serverId: string, name: string, categoryId?: string): Promise<ChannelInfo> {
    const body: any = { name, type: 0 }
    if (categoryId) body.parent_id = categoryId
    const ch = await discordFetch(token, `/guilds/${serverId}/channels`, {
      method: "POST",
      body: JSON.stringify(body),
    })
    return { id: ch.id, name: ch.name, type: "text" }
  }

  async getChannelByName(token: string, serverId: string, name: string): Promise<ChannelInfo | null> {
    const channels = await this.listChannels(token, serverId)
    return channels.find((c) => c.name === name && c.type === "text") ?? null
  }

  generateAccessConfig(opts: AccessConfigOpts): AccessConfig {
    return {
      dmPolicy: "allowlist",
      allowFrom: opts.partnerBotIds,
      groups: {
        [opts.channelId]: {
          requireMention: opts.requireMention,
          allowFrom: [],
        },
      },
      pending: {},
    }
  }

  inviteUrl(appId: string): string {
    return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${BOT_PERMISSIONS}`
  }

  pluginId(): string {
    return "plugin:discord@claude-plugins-official"
  }
}
```

- [ ] **Step 5: Run tests**

Run: `cd ~/.fleet && bun test test/discord-api.test.ts`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/channel/types.ts src/channel/discord/api.ts test/discord-api.test.ts
git commit -m "feat: Discord API client with channel adapter interface"
```

---

### Task 4: Access config generator

**Files:**
- Create: `src/channel/discord/access.ts`
- Create: `test/access.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/access.test.ts
import { describe, it, expect } from "bun:test"
import { writeAccessConfig, readAccessConfig } from "../src/channel/discord/access"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"

const TMP = join(import.meta.dir, ".tmp-access-test")

describe("writeAccessConfig", () => {
  it("writes correct schema", () => {
    mkdirSync(TMP, { recursive: true })
    writeAccessConfig(TMP, {
      channelId: "chan123",
      partnerBotIds: ["bot1", "bot2"],
      requireMention: true,
    })
    const config = readAccessConfig(TMP)
    expect(config.dmPolicy).toBe("allowlist")
    expect(config.allowFrom).toEqual(["bot1", "bot2"])
    expect(config.groups["chan123"].requireMention).toBe(true)
    expect(config.groups["chan123"].allowFrom).toEqual([])
    expect(config.pending).toEqual({})
    rmSync(TMP, { recursive: true })
  })
})
```

- [ ] **Step 2: Run test — verify fail**

Run: `cd ~/.fleet && bun test test/access.test.ts`
Expected: FAIL

- [ ] **Step 3: Write access module**

```typescript
// src/channel/discord/access.ts
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import type { AccessConfig, AccessConfigOpts } from "../types"

export function writeAccessConfig(stateDir: string, opts: AccessConfigOpts): void {
  mkdirSync(stateDir, { recursive: true })
  const config: AccessConfig = {
    dmPolicy: "allowlist",
    allowFrom: opts.partnerBotIds,
    groups: {
      [opts.channelId]: {
        requireMention: opts.requireMention,
        allowFrom: [],
      },
    },
    pending: {},
  }
  writeFileSync(join(stateDir, "access.json"), JSON.stringify(config, null, 2) + "\n")
}

export function readAccessConfig(stateDir: string): AccessConfig {
  return JSON.parse(readFileSync(join(stateDir, "access.json"), "utf8"))
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd ~/.fleet && bun test test/access.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/channel/discord/access.ts test/access.test.ts
git commit -m "feat: access.json generator with correct plugin schema"
```

---

### Task 5: Identity generator

**Files:**
- Create: `src/core/identity.ts`
- Create: `test/identity.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/identity.test.ts
import { describe, it, expect } from "bun:test"
import { buildIdentityPrompt } from "../src/core/identity"
import type { FleetConfig } from "../src/core/types"

describe("buildIdentityPrompt", () => {
  const config: FleetConfig = {
    fleet: { name: "crew" },
    discord: { channelId: "chan123" },
    defaults: { workspace: "~/workspace" },
    agents: {
      pm: { role: "lead", tokenEnv: "T_PM", server: "local", identity: "identities/pm.md" },
      worker: { role: "worker", tokenEnv: "T_W", server: "local", identity: "identities/worker.md" },
    },
  }
  const botIds: Record<string, string> = { pm: "111", worker: "222" }

  it("includes agent name and role", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("**pm**")
    expect(prompt).toContain("lead")
  })

  it("includes team roster with bot IDs", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("worker")
    expect(prompt).toContain("222")
    expect(prompt).not.toContain("111") // don't list self
  })

  it("includes channel info", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("chan123")
  })

  it("includes Discord formatting rules", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("Do NOT use markdown tables")
    expect(prompt).toContain("2000 chars")
  })

  it("includes reply-via-Discord rule", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("Always reply via Discord reply tool")
  })
})
```

- [ ] **Step 2: Run test — verify fail**

Run: `cd ~/.fleet && bun test test/identity.test.ts`
Expected: FAIL

- [ ] **Step 3: Write identity generator**

```typescript
// src/core/identity.ts
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import type { FleetConfig } from "./types"

export function buildIdentityPrompt(
  agentName: string,
  config: FleetConfig,
  botIds: Record<string, string>,
): string {
  const agent = config.agents[agentName]
  const myBotId = botIds[agentName] ?? "YOUR_BOT_ID"

  const lines: string[] = []
  lines.push(`You are **${agentName}**, a ${agent.role} in the fleet. Bot ID \`${myBotId}\`.`)
  lines.push("")
  lines.push("## Role")
  lines.push("")
  lines.push(agent.role)
  lines.push("")

  // Team roster
  const peers = Object.entries(config.agents).filter(([n]) => n !== agentName)
  if (peers.length > 0) {
    lines.push("## Team")
    lines.push("")
    for (const [name, peer] of peers) {
      const peerId = botIds[name] ?? "UNKNOWN"
      lines.push(`- ${name} (\`${peerId}\`) — ${peer.server} — ${peer.role}`)
    }
    lines.push("")
  }

  // Channel
  if (config.discord.channelId) {
    lines.push("## Channel")
    lines.push("")
    lines.push(`- Channel ID: \`${config.discord.channelId}\``)
    lines.push("")
  }

  // Rules
  lines.push("## Rules")
  lines.push("")
  lines.push("- **Always reply via Discord reply tool** — terminal output does not reach Discord")
  lines.push("- Report concisely, conclusions first")
  lines.push("- When you receive a task, acknowledge briefly (react or short reply) before starting work")
  lines.push("")

  // Discord formatting
  lines.push("## Discord Formatting")
  lines.push("")
  lines.push("- Do NOT use markdown tables — Discord doesn't render them")
  lines.push("- Do NOT use HTML tags or image syntax")
  lines.push("- OK to use: **bold**, *italic*, `code`, ```code blocks```, > quotes, - lists, # headings")
  lines.push("- @mention teammates with `<@BOT_ID>`")
  lines.push("- Max 2000 chars per message — split longer messages")

  return lines.join("\n")
}

export function writeBootIdentity(
  agentName: string,
  config: FleetConfig,
  botIds: Record<string, string>,
  stateDir: string,
): void {
  mkdirSync(stateDir, { recursive: true })
  const prompt = buildIdentityPrompt(agentName, config, botIds)
  writeFileSync(join(stateDir, "identity.md"), prompt)
}

export function readRoleOverlay(roleName: string, fleetDir: string): string | null {
  const rolePath = join(fleetDir, "identities", "roles", `${roleName}.md`)
  if (!existsSync(rolePath)) return null
  return readFileSync(rolePath, "utf8")
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd ~/.fleet && bun test test/identity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/identity.ts test/identity.test.ts
git commit -m "feat: identity generator with team roster and formatting rules"
```

---

### Task 6: Tmux runtime adapter

**Files:**
- Create: `src/runtime/types.ts`
- Create: `src/runtime/tmux.ts`

- [ ] **Step 1: Write runtime types**

```typescript
// src/runtime/types.ts

export interface StartOpts {
  session: string
  env: Record<string, string>
  workDir: string
  command: string
}

export interface RuntimeAdapter {
  start(opts: StartOpts): Promise<void>
  stop(session: string): Promise<void>
  isRunning(session: string): Promise<boolean>
  sendKeys(session: string, text: string): Promise<void>
  captureOutput(session: string, lines?: number): Promise<string>
  waitFor(session: string, pattern: RegExp, timeoutMs?: number): Promise<boolean>
}
```

- [ ] **Step 2: Write TmuxLocal adapter**

```typescript
// src/runtime/tmux.ts
import type { RuntimeAdapter, StartOpts } from "./types"

async function run(cmd: string[]): Promise<{ stdout: string; ok: boolean }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  const code = await proc.exited
  return { stdout: stdout.trim(), ok: code === 0 }
}

export class TmuxLocal implements RuntimeAdapter {
  async start(opts: StartOpts): Promise<void> {
    const envPrefix = Object.entries(opts.env)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")
    const fullCmd = `${envPrefix} ${opts.command}`

    const { ok } = await run([
      "tmux", "new-session", "-d", "-s", opts.session, "-c", opts.workDir, fullCmd,
    ])
    if (!ok) throw new Error(`Failed to start tmux session: ${opts.session}`)
  }

  async stop(session: string): Promise<void> {
    await run(["tmux", "kill-session", "-t", session])
  }

  async isRunning(session: string): Promise<boolean> {
    const { ok } = await run(["tmux", "has-session", "-t", session])
    return ok
  }

  async sendKeys(session: string, text: string): Promise<void> {
    await run(["tmux", "send-keys", "-t", session, text, "Enter"])
  }

  async captureOutput(session: string, lines = 50): Promise<string> {
    const { stdout } = await run(["tmux", "capture-pane", "-t", session, "-p", "-S", `-${lines}`])
    return stdout
  }

  async waitFor(session: string, pattern: RegExp, timeoutMs = 30_000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const output = await this.captureOutput(session)
      if (pattern.test(output)) return true
      await Bun.sleep(1000)
    }
    return false
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd ~/.fleet && bun build src/runtime/tmux.ts --no-bundle 2>&1 | head -3`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/runtime/types.ts src/runtime/tmux.ts
git commit -m "feat: tmux runtime adapter — start, stop, waitFor, sendKeys"
```

---

### Task 7: `fleet start` and `fleet stop` commands

**Files:**
- Create: `src/commands/start.ts`
- Create: `src/commands/stop.ts`
- Create: `src/commands/status.ts`

- [ ] **Step 1: Write start command**

```typescript
// src/commands/start.ts
import { loadConfig, getToken, resolveStateDir, sessionName, findConfigDir } from "../core/config"
import { writeBootIdentity } from "../core/identity"
import { writeAccessConfig } from "../channel/discord/access"
import { DiscordApi } from "../channel/discord/api"
import { TmuxLocal } from "../runtime/tmux"

export async function start(agentName: string, opts: { wait?: boolean; role?: string }): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)
  const agent = config.agents[agentName]
  if (!agent) {
    const known = Object.keys(config.agents).join(", ")
    throw new Error(`Unknown agent '${agentName}'. Known: ${known}`)
  }

  const token = getToken(agentName, config, configDir)
  const stateDir = resolveStateDir(agentName, config)
  const expandedStateDir = stateDir.replace(/^~/, process.env.HOME ?? "~")
  const session = sessionName(config.fleet.name, agentName)
  const discord = new DiscordApi()
  const runtime = new TmuxLocal()

  // Check if already running
  if (await runtime.isRunning(session)) {
    console.log(`${agentName} is already running. Attach: tmux attach -t ${session}`)
    return
  }

  // Resolve bot IDs for identity (validate tokens)
  const botIds: Record<string, string> = {}
  for (const [name, def] of Object.entries(config.agents)) {
    try {
      const t = getToken(name, config, configDir)
      const info = await discord.validateToken(t)
      botIds[name] = info.id
    } catch {
      botIds[name] = "UNKNOWN"
    }
  }

  // 1. Write identity
  writeBootIdentity(agentName, config, botIds, expandedStateDir)

  // 2. Write access.json
  const partnerBotIds = Object.entries(botIds)
    .filter(([n]) => n !== agentName)
    .map(([, id]) => id)

  writeAccessConfig(expandedStateDir, {
    channelId: config.discord.channelId,
    partnerBotIds,
    requireMention: true,
  })

  // 3. Resolve workspace
  const workspace = (agent.workspace ?? config.defaults.workspace).replace(/^~/, process.env.HOME ?? "~")

  // 4. Start
  console.log(`Starting ${agentName} (${agent.server})...`)
  console.log(`  Workspace: ${workspace}`)

  await runtime.start({
    session,
    env: {
      DISCORD_BOT_TOKEN: token,
      DISCORD_STATE_DIR: expandedStateDir,
      DISCORD_ACCESS_MODE: "static",
      FLEET_SELF: agentName,
    },
    workDir: workspace,
    command: `claude --dangerously-skip-permissions --append-system-prompt-file ${expandedStateDir}/identity.md --channels ${discord.pluginId()}`,
  })

  // 5. Handle first-run permissions confirmation
  const permPrompt = await runtime.waitFor(session, /bypass|dangerous|permission|y\/n/i, 10_000)
  if (permPrompt) {
    await runtime.sendKeys(session, "y")
  }

  // 6. Wait for ready
  if (opts.wait) {
    console.log("  Waiting for ready...")
    const ready = await runtime.waitFor(session, /Listening for channel messages/, 60_000)
    if (!ready) console.log("  Warning: timeout waiting for channel listener")
  }

  console.log(`  Done: ${session}`)
}
```

- [ ] **Step 2: Write stop command**

```typescript
// src/commands/stop.ts
import { loadConfig, sessionName, findConfigDir } from "../core/config"
import { TmuxLocal } from "../runtime/tmux"

export async function stop(agentName: string): Promise<void> {
  const config = loadConfig()
  if (!config.agents[agentName]) {
    throw new Error(`Unknown agent: ${agentName}`)
  }

  // Block self-stop unless --force
  if (process.env.FLEET_SELF === agentName) {
    throw new Error(`Cannot stop yourself (${agentName}). Use --force to override.`)
  }

  const session = sessionName(config.fleet.name, agentName)
  const runtime = new TmuxLocal()

  if (!(await runtime.isRunning(session))) {
    console.log(`${agentName} is not running`)
    return
  }

  await runtime.stop(session)
  console.log(`Stopped ${agentName}`)
}
```

- [ ] **Step 3: Write status command**

```typescript
// src/commands/status.ts
import { loadConfig, sessionName } from "../core/config"
import { TmuxLocal } from "../runtime/tmux"

interface AgentStatus {
  name: string
  server: string
  role: string
  state: "running" | "stopped"
  session: string
}

export async function status(opts: { json?: boolean }): Promise<void> {
  const config = loadConfig()
  const runtime = new TmuxLocal()
  const results: AgentStatus[] = []

  for (const [name, agent] of Object.entries(config.agents)) {
    const session = sessionName(config.fleet.name, name)
    const running = await runtime.isRunning(session)
    results.push({
      name,
      server: agent.server,
      role: agent.role,
      state: running ? "running" : "stopped",
      session,
    })
  }

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  console.log(`=== ${config.fleet.name} Fleet ===`)
  for (const r of results) {
    const tag = r.state === "running" ? "\x1b[32m[on]\x1b[0m" : "\x1b[31m[off]\x1b[0m"
    const attach = r.state === "running" ? ` — tmux attach -t ${r.session}` : ""
    console.log(`  ${tag}  ${r.name} (${r.server}, ${r.role})${attach}`)
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/start.ts src/commands/stop.ts src/commands/status.ts
git commit -m "feat: start, stop, status commands"
```

---

### Task 8: CLI dispatcher and entry point

**Files:**
- Create: `src/cli.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write CLI dispatcher**

```typescript
// src/cli.ts

import { start } from "./commands/start"
import { stop } from "./commands/stop"
import { status } from "./commands/status"

function usage(): void {
  console.log(`fleet-next — Agent fleet CLI (TypeScript)

Usage:
  fleet-next start <agent> [--wait] [--role <r>]
  fleet-next stop <agent> [--force]
  fleet-next status [--json]
  fleet-next help

Flags:
  --json    Machine-readable output
  --wait    Block until agent is ready
  --force   Override safety checks`)
}

function parseFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function parseFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
}

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2) // skip bun and script path
  const command = args[0]

  try {
    switch (command) {
      case "start": {
        const agent = args[1]
        if (!agent) throw new Error("Usage: fleet-next start <agent>")
        await start(agent, {
          wait: parseFlag(args, "--wait"),
          role: parseFlagValue(args, "--role"),
        })
        break
      }
      case "stop": {
        const agent = args[1]
        if (!agent) throw new Error("Usage: fleet-next stop <agent>")
        await stop(agent)
        break
      }
      case "status":
        await status({ json: parseFlag(args, "--json") })
        break
      case "help":
      case "--help":
      case undefined:
        usage()
        break
      default:
        console.error(`Unknown command: ${command}`)
        usage()
        process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
```

- [ ] **Step 2: Update entry point**

```typescript
// src/index.ts
#!/usr/bin/env bun
import { main } from "./cli"
main(process.argv)
```

- [ ] **Step 3: Test manually**

Run: `cd ~/workspace/qa && bun run ~/.fleet/src/index.ts help`
Expected: prints usage

Run: `cd ~/workspace/qa && bun run ~/.fleet/src/index.ts status`
Expected: shows crew fleet with pm and worker status

- [ ] **Step 4: Build binary and test**

Run: `cd ~/.fleet && bun build --compile --outfile fleet-next src/index.ts`
Expected: compiles successfully

Run: `./fleet-next status`
Expected: same output as bun run

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/index.ts
git commit -m "feat: CLI dispatcher — start, stop, status, help + compiled binary"
```

---

### Task 9: End-to-end test — start agent, verify in Discord

This is the critical integration test. Uses the existing fleet (crew) with real Discord tokens.

- [ ] **Step 1: Stop current bash agents**

Run: `fleet stop pm; fleet stop worker`

- [ ] **Step 2: Start PM with fleet-next**

Run: `cd ~/workspace/qa && ~/.fleet/fleet-next start pm --wait`
Expected: "Starting pm..." → "Done: crew-pm"

- [ ] **Step 3: Verify identity loaded**

Run: `tmux capture-pane -t crew-pm -p -S -30`
Expected: should show "Listening for channel messages" — and NO identity injection via send-keys (identity was in system prompt)

- [ ] **Step 4: Test in Discord**

Message @PM in #general: "who are you and who is on the team?"
Expected: PM responds with its name, role, and lists worker with bot ID

- [ ] **Step 5: Start worker and verify status**

Run: `~/.fleet/fleet-next start worker --wait`
Run: `~/.fleet/fleet-next status`
Expected: both pm and worker show [on]

- [ ] **Step 6: Stop both**

Run: `~/.fleet/fleet-next stop pm && ~/.fleet/fleet-next stop worker`
Expected: both stopped cleanly

- [ ] **Step 7: Commit any fixes from E2E testing**

```bash
git add -A && git commit -m "fix: adjustments from E2E integration test"
```

---

## Phase 2: Remaining Commands

### Task 10: `fleet init` (non-interactive)

**Files:**
- Create: `src/commands/init.ts`

Non-interactive mode only in Phase 2 (interactive comes later). Generates fleet.yaml, .env, identities, access.json.

- [ ] **Step 1: Write init command**

Core flow: parse `--token`, `--name`, `--agent` flags → validate tokens → detect guild/channel → generate all config files → sync partner bot IDs.

Port the logic from `lib/init.sh:do_init_noninteractive()` but using TypeScript types and proper JSON.

- [ ] **Step 2: Test**

Run: `~/.fleet/fleet-next init --token T1 --token T2 --name test-fleet --agent lead:local:lead --agent worker:local:worker --force`
Expected: generates fleet.yaml, .env, identities, access.json

- [ ] **Step 3: Commit**

```bash
git add src/commands/init.ts
git commit -m "feat: fleet init (non-interactive mode)"
```

---

### Task 11: `fleet inject`, `fleet apply`, `fleet add-agent`

**Files:**
- Create: `src/commands/inject.ts`
- Create: `src/commands/apply.ts`
- Create: `src/commands/add-agent.ts`

- [ ] **Step 1: Write inject** — reads role file, sends via `runtime.sendKeys`
- [ ] **Step 2: Write apply** — iterates agents, calls `start` for each
- [ ] **Step 3: Write add-agent** — validates token, appends to fleet.yaml + .env, generates identity + access.json
- [ ] **Step 4: Wire into CLI dispatcher** — add cases to `src/cli.ts`
- [ ] **Step 5: Test each command manually**
- [ ] **Step 6: Commit**

```bash
git add src/commands/inject.ts src/commands/apply.ts src/commands/add-agent.ts src/cli.ts
git commit -m "feat: inject, apply, add-agent commands"
```

---

### Task 12: `fleet doctor`

**Files:**
- Create: `src/commands/doctor.ts`

- [ ] **Step 1: Write doctor** — 9 checks from spec, all with timeouts, structured output
- [ ] **Step 2: Wire into CLI**
- [ ] **Step 3: Test** — `~/.fleet/fleet-next doctor` and `~/.fleet/fleet-next doctor --json`
- [ ] **Step 4: Commit**

```bash
git add src/commands/doctor.ts src/cli.ts
git commit -m "feat: fleet doctor with 9 health checks"
```

---

### Task 13: Partner bot ID sync (TS-based patching)

**Files:**
- Create: `src/commands/patch.ts`

- [ ] **Step 1: Write patch command** — reads .env tokens, validates via Discord API, updates PARTNER_BOT_IDS in server.ts using regex (same approach as bash but no quoting bugs since we're in TS)
- [ ] **Step 2: Test** — `~/.fleet/fleet-next patch`
- [ ] **Step 3: Commit**

```bash
git add src/commands/patch.ts src/cli.ts
git commit -m "feat: partner bot ID sync — TS-based patching"
```

---

## Phase 3: Build + Install

### Task 14: Compiled binary and install script update

**Files:**
- Modify: `package.json` (build script)
- Modify: `install.sh`

- [ ] **Step 1: Build binary**

Run: `cd ~/.fleet && bun build --compile --outfile fleet-next src/index.ts`
Expected: single binary

- [ ] **Step 2: Test binary**

Run: `./fleet-next doctor && ./fleet-next status`
Expected: works without bun runtime

- [ ] **Step 3: Update install.sh** — add step to build TS binary after git clone/pull, symlink `fleet-next`
- [ ] **Step 4: Add .gitignore entries** — `node_modules/`, `fleet-next`, `bun.lock`
- [ ] **Step 5: Commit and push**

```bash
git add install.sh package.json .gitignore
git commit -m "build: compiled binary + install script update"
git push origin master
```

---

## Phase 4: Swap and cleanup (future)

When fleet-next has full parity and has been tested in production:

- Rename `fleet-next` → `fleet`
- Delete `lib/*.sh`
- Update SKILL.md references
- Update ARCHITECTURE.md
- Final push

This phase is not detailed here — it's a straightforward swap once confidence is high.
