import type { FleetConfig, AgentAdapterKind } from "../core/types"
import type { RuntimeAdapter } from "../runtime/types"

export interface StartAgentOptions {
  wait?: boolean
  role?: string
  json?: boolean
}

export interface StartAgentContext {
  agentName: string
  configDir: string
  config: FleetConfig
  runtime: RuntimeAdapter
  token: string
  session: string
  stateDir: string
  opts: StartAgentOptions
}

export interface AgentAdapter {
  readonly kind: AgentAdapterKind
  start(ctx: StartAgentContext): Promise<void>
}
