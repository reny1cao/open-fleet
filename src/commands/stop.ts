import { findConfigDir, loadConfig, sessionName } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"

export async function stop(
  agentName: string,
  opts?: { force?: boolean; json?: boolean }
): Promise<void> {
  // 1. Load config; throw if agent unknown
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agentDef = config.agents[agentName]
  if (!agentDef) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  // 2. Block self-stop unless --force
  if (process.env.FLEET_SELF === agentName && !opts?.force) {
    throw new Error(
      `Cannot stop self ("${agentName}"). Use --force to override.`
    )
  }

  // 3. Get session name, check if running (local or remote)
  const session = sessionName(config.fleet.name, agentName)
  const runtime = resolveRuntime(agentName, config)

  if (!(await runtime.isRunning(session))) {
    if (opts?.json) {
      console.log(JSON.stringify({ agent: agentName, status: "not_running" }))
    } else {
      console.log(`Agent "${agentName}" is not running`)
    }
    return
  }

  // 4. Stop the session
  await runtime.stop(session)
  if (opts?.json) {
    console.log(JSON.stringify({ agent: agentName, status: "stopped" }))
  } else {
    console.log(`Stopped ${agentName}`)
  }
}
