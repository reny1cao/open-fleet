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
  server: string
  identity: string
  workspace?: string
  stateDir?: string
}

export interface ServerConfig {
  sshHost: string
  user: string
}
