import { findConfigDir, loadConfig, sessionName } from "../core/config"
import { getAgentAdapterKind } from "../agents/resolve"
import { resolveRuntime } from "../runtime/resolve"
import { start } from "./start"

export async function restart(
  agentName: string,
  opts?: { json?: boolean }
): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agentDef = config.agents[agentName]
  if (!agentDef) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  const session = sessionName(config.fleet.name, agentName)
  const runtime = resolveRuntime(agentName, config)
  const adapterKind = getAgentAdapterKind(agentName, config)

  if (!(await runtime.isRunning(session))) {
    throw new Error(`Agent "${agentName}" is not running`)
  }

  if (adapterKind === "codex") {
    await runtime.stop(session)
    await start(agentName, { wait: false, json: opts?.json })
    if (!opts?.json) {
      console.log(`Restarted ${agentName}`)
    }
    return
  }

  // Send /exit to Claude Code — the wrapper script auto-restarts
  await runtime.sendKeys(session, "/exit")

  if (opts?.json) {
    console.log(JSON.stringify({ agent: agentName, status: "restarting" }))
  } else {
    console.log(`Restarting ${agentName} (sent /exit, wrapper will auto-restart)`)
  }
}
