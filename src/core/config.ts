import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import type { FleetConfig, AgentDef, ServerConfig, OrgStructure, ChannelDef, AgentAdapterKind } from "./types"

// ── Helpers ───────────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  if (p === "~") return homedir()
  return p
}

/** snake_case → camelCase (single word boundary conversion) */
function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/** camelCase → snake_case */
function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

/** Derive a default tokenEnv from the agent name: my-bot → DISCORD_BOT_TOKEN_MY_BOT */
function deriveTokenEnv(agentName: string): string {
  return `DISCORD_BOT_TOKEN_${agentName.toUpperCase().replace(/-/g, "_")}`
}

function normalizeAgentAdapter(value: unknown): AgentAdapterKind {
  return value === "codex" ? "codex" : "claude"
}

// ── findConfigDir ─────────────────────────────────────────────────────────────

/**
 * Search order:
 *   1. $FLEET_CONFIG env var (must point to a fleet.yaml file)
 *   2. startDir (default: cwd)
 *   3. $FLEET_DIR env var
 *   4. ~/.fleet/config.json → defaultFleet (global fallback)
 *
 * @param startDir   Override CWD for location 2.
 * @param globalConfigDir  Override ~/.fleet for location 4 (used in tests).
 *
 * Throws "fleet.yaml not found" if none of the locations have fleet.yaml.
 */
export function findConfigDir(startDir?: string, globalConfigDir?: string): string {
  // 1. $FLEET_CONFIG
  const fleetConfig = process.env.FLEET_CONFIG
  if (fleetConfig && existsSync(fleetConfig)) {
    return dirname(fleetConfig)
  }

  // 2. startDir / cwd
  const base = startDir ?? process.cwd()
  if (existsSync(join(base, "fleet.yaml"))) {
    return base
  }

  // 3. $FLEET_DIR
  const fleetDir = process.env.FLEET_DIR
  if (fleetDir && existsSync(join(fleetDir, "fleet.yaml"))) {
    return fleetDir
  }

  // 4. ~/.fleet/config.json → defaultFleet
  const configJsonDir = globalConfigDir ?? join(process.env.HOME ?? homedir(), ".fleet")
  const configJsonPath = join(configJsonDir, "config.json")
  if (existsSync(configJsonPath)) {
    try {
      const { defaultFleet } = JSON.parse(readFileSync(configJsonPath, "utf8"))
      if (defaultFleet && existsSync(join(defaultFleet, "fleet.yaml"))) {
        return defaultFleet
      }
    } catch {}
  }

  throw new Error("fleet.yaml not found. Run 'fleet init' to create one.")
}

// ── writeGlobalConfig ─────────────────────────────────────────────────────────

/** Write ~/.fleet/config.json so fleet commands work from any directory. */
export function writeGlobalConfig(fleetDir: string, fleetName?: string): void {
  const globalDir = join(process.env.HOME ?? homedir(), ".fleet")
  mkdirSync(globalDir, { recursive: true })
  const configPath = join(globalDir, "config.json")

  // Read existing config to preserve fleets registry
  let existing: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try { existing = JSON.parse(readFileSync(configPath, "utf8")) } catch {}
  }

  const fleets = (existing.fleets ?? {}) as Record<string, string>
  if (fleetName) {
    fleets[fleetName] = fleetDir
  }

  writeFileSync(
    configPath,
    JSON.stringify({ defaultFleet: fleetDir, fleets }, null, 2) + "\n"
  )
}

// ── loadConfig ────────────────────────────────────────────────────────────────

export function loadConfig(dir?: string): FleetConfig {
  const configDir = dir ?? findConfigDir()
  const yamlPath = join(configDir, "fleet.yaml")

  if (!existsSync(yamlPath)) {
    throw new Error(`fleet.yaml not found in ${configDir}`)
  }

  const raw = parseYaml(readFileSync(yamlPath, "utf8")) as Record<string, unknown>

  // ── Validate required fields ──────────────────────────────────────────────
  const fleetSection = raw.fleet as Record<string, unknown> | undefined
  if (!fleetSection?.name) {
    throw new Error("fleet.yaml: fleet.name is required")
  }

  const agentsRaw = raw.agents as Record<string, Record<string, unknown>> | undefined
  if (!agentsRaw || Object.keys(agentsRaw).length === 0) {
    throw new Error("fleet.yaml: at least one agent is required")
  }

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
    notificationBotToken: (discordRaw.notification_bot_token ?? discordRaw.notificationBotToken) as string | undefined,
  }

  // ── defaults ──────────────────────────────────────────────────────────────
  const defaultsRaw = (raw.defaults ?? {}) as Record<string, string>
  const defaults = {
    workspace: defaultsRaw.workspace,
    runtime: defaultsRaw.runtime,
    agentAdapter: normalizeAgentAdapter(defaultsRaw.agent_adapter),
  }

  // ── servers ───────────────────────────────────────────────────────────────
  let servers: Record<string, ServerConfig> | undefined
  if (raw.servers) {
    servers = {}
    for (const [name, sRaw] of Object.entries(raw.servers as Record<string, Record<string, string>>)) {
      servers[name] = {
        sshHost: sRaw.ssh_host,
        user: sRaw.user,
      }
    }
  }

  // ── structure ─────────────────────────────────────────────────────────────
  let structure: OrgStructure | undefined
  if (raw.structure) {
    const sRaw = raw.structure as Record<string, unknown>
    structure = {
      topology: sRaw.topology as OrgStructure["topology"],
      lead: sRaw.lead as string | undefined,
    }
  }

  // ── agents ────────────────────────────────────────────────────────────────
  const agents: Record<string, AgentDef> = {}
  for (const [name, aRaw] of Object.entries(agentsRaw)) {
    agents[name] = {
      agentAdapter: normalizeAgentAdapter(aRaw.agent_adapter ?? defaults.agentAdapter),
      role: aRaw.role as string,
      tokenEnv: (aRaw.token_env as string | undefined) ?? deriveTokenEnv(name),
      server: aRaw.server as string,
      identity: aRaw.identity as string,
      workspace: aRaw.workspace as string | undefined,
      stateDir: aRaw.state_dir as string | undefined,
      channels: aRaw.channels as string[] | undefined,
    }
  }

  // ── Validate server references ────────────────────────────────────────────
  const serverNames = servers ? Object.keys(servers) : []
  for (const [name, agent] of Object.entries(agents)) {
    if (agent.server !== "local" && !serverNames.includes(agent.server)) {
      throw new Error(`fleet.yaml: agent "${name}" references server "${agent.server}" which is not defined in servers`)
    }
  }

  return {
    fleet: { name: fleetSection.name as string, mission: fleetSection.mission as string | undefined },
    structure,
    discord,
    servers,
    defaults,
    agents,
  }
}

// ── saveConfig ────────────────────────────────────────────────────────────────

/** Convert camelCase FleetConfig back to snake_case YAML and write to disk. */
export function saveConfig(config: FleetConfig, dir: string): void {
  const agents: Record<string, Record<string, unknown>> = {}
  for (const [name, def] of Object.entries(config.agents)) {
    agents[name] = {
      ...(def.agentAdapter !== undefined && def.agentAdapter !== config.defaults.agentAdapter
        ? { agent_adapter: def.agentAdapter }
        : {}),
      role: def.role,
      token_env: def.tokenEnv,
      server: def.server,
      identity: def.identity,
      ...(def.workspace !== undefined ? { workspace: def.workspace } : {}),
      ...(def.stateDir !== undefined ? { state_dir: def.stateDir } : {}),
      ...(def.channels !== undefined ? { channels: def.channels } : {}),
    }
  }

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
    ...(config.discord.notificationBotToken !== undefined ? { notification_bot_token: config.discord.notificationBotToken } : {}),
  }

  const defaults: Record<string, string> = {
    workspace: config.defaults.workspace,
    ...(config.defaults.runtime !== undefined ? { runtime: config.defaults.runtime } : {}),
    ...(config.defaults.agentAdapter !== undefined && config.defaults.agentAdapter !== "claude"
      ? { agent_adapter: config.defaults.agentAdapter }
      : {}),
  }

  const out: Record<string, unknown> = {
    fleet: {
      name: config.fleet.name,
      ...(config.fleet.mission !== undefined ? { mission: config.fleet.mission } : {}),
    },
    discord,
    defaults,
    agents,
  }

  if (config.structure) {
    out.structure = {
      topology: config.structure.topology,
      ...(config.structure.lead !== undefined ? { lead: config.structure.lead } : {}),
    }
  }

  if (config.servers) {
    const servers: Record<string, Record<string, string>> = {}
    for (const [name, srv] of Object.entries(config.servers)) {
      servers[name] = { ssh_host: srv.sshHost, user: srv.user }
    }
    out.servers = servers
  }

  writeFileSync(join(dir, "fleet.yaml"), stringifyYaml(out))
}

// ── loadEnv ───────────────────────────────────────────────────────────────────

/** Parse .env file (KEY=VALUE lines). Returns empty Record if file missing. */
export function loadEnv(dir: string): Record<string, string> {
  const envPath = join(dir, ".env")
  if (!existsSync(envPath)) return {}

  const result: Record<string, string> = {}
  const content = readFileSync(envPath, "utf8")

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1) // do NOT trim — value may have leading spaces intentionally
    result[key] = value
  }

  return result
}

// ── getToken ──────────────────────────────────────────────────────────────────

/**
 * Resolve the Discord bot token for an agent.
 * Check process.env first, then .env file in dir. Throw if missing.
 */
export function getToken(agentName: string, config: FleetConfig, dir: string): string {
  const agent = config.agents[agentName]
  if (!agent) throw new Error(`Agent "${agentName}" not found in config`)

  const envVarName = agent.tokenEnv

  // 1. process.env
  if (process.env[envVarName]) return process.env[envVarName]!

  // 2. .env file
  const fileEnv = loadEnv(dir)
  if (fileEnv[envVarName]) return fileEnv[envVarName]

  throw new Error(`Token not found: ${envVarName} is not set in process.env or .env file`)
}

// ── resolveStateDir ───────────────────────────────────────────────────────────

/**
 * Resolve the Discord plugin state directory for an agent.
 *   - If agent has explicit stateDir: expand ~ and return it
 *   - Otherwise: ~/.fleet/state/<fleetName>-<agentName>
 */
export function resolveStateDir(agentName: string, config: FleetConfig): string {
  const agent = config.agents[agentName]
  if (!agent) throw new Error(`Agent "${agentName}" not found in config`)

  // Explicit stateDir on the agent
  if (agent.stateDir) return expandHome(agent.stateDir)

  // Default: ~/.fleet/state/<fleetName>-<agentName>
  return expandHome(`~/.fleet/state/${config.fleet.name}-${agentName}`)
}

// ── sessionName ───────────────────────────────────────────────────────────────

/** Returns the tmux session name: <fleetName>-<agentName> */
export function sessionName(fleetName: string, agentName: string): string {
  return `${fleetName}-${agentName}`
}
