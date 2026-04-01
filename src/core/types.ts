export type AgentAdapterKind = "claude" | "codex"

export interface ChannelDef {
  id: string
  workspace?: string
}

export interface FleetConfig {
  fleet: { name: string; mission?: string; apiHost?: string; apiPort?: number }
  structure?: OrgStructure
  discord: {
    channels: Record<string, ChannelDef>
    serverId?: string
    userId?: string
  }
  servers?: Record<string, ServerConfig>
  defaults: { workspace: string; runtime?: string; agentAdapter?: AgentAdapterKind }
  agents: Record<string, AgentDef>
}

export interface OrgStructure {
  topology: "star" | "hierarchy" | "mesh" | "squad"
  lead?: string
}

export interface AgentDef {
  agentAdapter?: AgentAdapterKind
  role: string
  tokenEnv: string
  server: string
  identity: string
  workspace?: string
  stateDir?: string
  channels?: string[]
}

export interface ServerConfig {
  sshHost: string
  user: string
}

export interface BotEntry {
  id: string
  displayName: string
}

/** Bot IDs map: agent name → { id, displayName } */
export type BotIdsMap = Record<string, BotEntry>
