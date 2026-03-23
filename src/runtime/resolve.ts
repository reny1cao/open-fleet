import type { FleetConfig } from "../core/types"
import type { RuntimeAdapter } from "./types"
import { TmuxLocal } from "./tmux"
import { TmuxRemote } from "./remote"

/**
 * Resolve the correct runtime adapter for an agent.
 * Local agents → TmuxLocal, remote agents → TmuxRemote via SSH.
 */
export function resolveRuntime(agentName: string, config: FleetConfig): RuntimeAdapter {
  const agentDef = config.agents[agentName]
  if (!agentDef) throw new Error(`Unknown agent: "${agentName}"`)

  if (agentDef.server === "local") return new TmuxLocal()

  const serverConfig = config.servers?.[agentDef.server]
  if (!serverConfig) {
    throw new Error(`Server "${agentDef.server}" not defined in fleet.yaml servers`)
  }
  return new TmuxRemote(serverConfig)
}
