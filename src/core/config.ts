import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import type { FleetConfig, AgentDef, ServerConfig, OrgStructure } from "./types"

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

// ── findConfigDir ─────────────────────────────────────────────────────────────

/**
 * Search order:
 *   1. $FLEET_CONFIG env var (must point to a fleet.yaml file)
 *   2. startDir (default: cwd)
 *   3. $FLEET_DIR env var
 *
 * Throws "fleet.yaml not found" if none of the locations have fleet.yaml.
 */
export function findConfigDir(startDir?: string): string {
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

  throw new Error("fleet.yaml not found")
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
  const discordRaw = (raw.discord ?? {}) as Record<string, string>
  if (!discordRaw.channel_id) {
    throw new Error("fleet.yaml: discord.channel_id is required")
  }
  const discord = {
    channelId: discordRaw.channel_id,
    serverId: discordRaw.server_id,
    userId: discordRaw.user_id,
  }

  // ── defaults ──────────────────────────────────────────────────────────────
  const defaultsRaw = (raw.defaults ?? {}) as Record<string, string>
  const defaults = {
    workspace: defaultsRaw.workspace,
    runtime: defaultsRaw.runtime,
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
      role: aRaw.role as string,
      tokenEnv: (aRaw.token_env as string | undefined) ?? deriveTokenEnv(name),
      server: aRaw.server as string,
      identity: aRaw.identity as string,
      workspace: aRaw.workspace as string | undefined,
      stateDir: aRaw.state_dir as string | undefined,
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
      role: def.role,
      token_env: def.tokenEnv,
      server: def.server,
      identity: def.identity,
      ...(def.workspace !== undefined ? { workspace: def.workspace } : {}),
      ...(def.stateDir !== undefined ? { state_dir: def.stateDir } : {}),
    }
  }

  const discord: Record<string, string> = {
    channel_id: config.discord.channelId,
    ...(config.discord.serverId !== undefined ? { server_id: config.discord.serverId } : {}),
    ...(config.discord.userId !== undefined ? { user_id: config.discord.userId } : {}),
  }

  const defaults: Record<string, string> = {
    workspace: config.defaults.workspace,
    ...(config.defaults.runtime !== undefined ? { runtime: config.defaults.runtime } : {}),
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
 *   - If agent is first in agents map: ~/.claude/channels/discord
 *   - Otherwise: ~/.fleet/state/discord-<name>
 */
export function resolveStateDir(agentName: string, config: FleetConfig): string {
  const agent = config.agents[agentName]
  if (!agent) throw new Error(`Agent "${agentName}" not found in config`)

  // Explicit stateDir on the agent
  if (agent.stateDir) return expandHome(agent.stateDir)

  const agentNames = Object.keys(config.agents)
  const isFirst = agentNames[0] === agentName

  if (isFirst) {
    return expandHome("~/.claude/channels/discord")
  }

  return expandHome(`~/.fleet/state/discord-${agentName}`)
}

// ── sessionName ───────────────────────────────────────────────────────────────

/** Returns the tmux session name: <fleetName>-<agentName> */
export function sessionName(fleetName: string, agentName: string): string {
  return `${fleetName}-${agentName}`
}
