import type { FleetConfig, AgentAdapterKind } from "../core/types"
import type { AgentAdapter } from "./types"
import { ClaudeAgentAdapter } from "./claude/adapter"
import { CodexAgentAdapter } from "./codex/adapter"

export function getAgentAdapterKind(agentName: string, config: FleetConfig): AgentAdapterKind {
  const agentDef = config.agents[agentName]
  if (!agentDef) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }
  return agentDef.agentAdapter ?? config.defaults.agentAdapter ?? "claude"
}

export function resolveAgentAdapter(agentName: string, config: FleetConfig): AgentAdapter {
  const kind = getAgentAdapterKind(agentName, config)

  switch (kind) {
    case "claude":
      return new ClaudeAgentAdapter()
    case "codex":
      return new CodexAgentAdapter()
    default:
      throw new Error(`Unsupported agent adapter: ${kind}`)
  }
}
