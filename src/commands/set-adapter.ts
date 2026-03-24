import { findConfigDir, loadConfig, saveConfig } from "../core/config"
import type { AgentAdapterKind } from "../core/types"

export async function setAdapter(
  agentName: string,
  adapter: AgentAdapterKind,
  opts: { json?: boolean },
): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agent = config.agents[agentName]
  if (!agent) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  const current = agent.agentAdapter ?? config.defaults.agentAdapter ?? "claude"
  if (current === adapter) {
    if (opts.json) {
      console.log(JSON.stringify({ agent: agentName, adapter, status: "no_change" }))
    } else {
      console.log(`${agentName} is already using ${adapter}`)
    }
    return
  }

  agent.agentAdapter = adapter
  saveConfig(config, configDir)

  if (opts.json) {
    console.log(JSON.stringify({ agent: agentName, from: current, to: adapter, status: "updated" }))
  } else {
    console.log(`Updated ${agentName}: ${current} → ${adapter}`)
  }
}
