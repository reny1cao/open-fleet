import { findConfigDir, loadConfig, saveConfig } from "../core/config"

export async function move(
  agentName: string,
  server: string,
  opts: { json?: boolean }
): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agent = config.agents[agentName]
  if (!agent) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  // Validate server
  if (server !== "local") {
    const serverNames = config.servers ? Object.keys(config.servers) : []
    if (!serverNames.includes(server)) {
      throw new Error(
        `Server "${server}" not defined in fleet.yaml servers. Available: local, ${serverNames.join(", ")}`
      )
    }
  }

  const oldServer = agent.server
  if (oldServer === server) {
    if (opts.json) {
      console.log(JSON.stringify({ agent: agentName, server, status: "no_change" }))
    } else {
      console.log(`${agentName} is already on ${server}`)
    }
    return
  }

  agent.server = server
  saveConfig(config, configDir)

  if (opts.json) {
    console.log(JSON.stringify({ agent: agentName, from: oldServer, to: server, status: "moved" }))
  } else {
    console.log(`Moved ${agentName}: ${oldServer} → ${server}`)
  }
}
