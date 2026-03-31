import { findConfigDir, loadConfig, sessionName } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"

export async function clear(
  agentName: string | undefined,
  opts?: { all?: boolean; json?: boolean }
): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agents = opts?.all
    ? Object.keys(config.agents)
    : agentName
      ? [agentName]
      : []

  if (agents.length === 0) {
    throw new Error("Usage: fleet clear <agent> or fleet clear --all")
  }

  for (const name of agents) {
    const agentDef = config.agents[name]
    if (!agentDef) {
      if (!opts?.all) throw new Error(`Unknown agent: "${name}"`)
      continue
    }

    const session = sessionName(config.fleet.name, name)
    const runtime = resolveRuntime(name, config)

    if (!(await runtime.isRunning(session))) {
      if (opts?.json) {
        console.log(JSON.stringify({ agent: name, status: "not_running" }))
      } else {
        console.log(`${name}: not running — skipped`)
      }
      continue
    }

    // Send /clear to Claude Code — resets context without restarting
    // Plugin stays alive, patches survive
    await runtime.sendKeys(session, "/clear")

    if (opts?.json) {
      console.log(JSON.stringify({ agent: name, status: "cleared" }))
    } else {
      console.log(`${name}: context cleared`)
    }
  }
}
