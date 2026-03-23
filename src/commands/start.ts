import { findConfigDir, loadConfig, getToken, resolveStateDir, sessionName } from "../core/config"
import type { RuntimeAdapter } from "../runtime/types"
import { resolveRuntime } from "../runtime/resolve"
import { resolveAgentAdapter } from "../agents/resolve"

export async function start(
  agentName: string,
  opts: { wait?: boolean; role?: string; json?: boolean }
): Promise<void> {
  // 1. Find config dir and load config; throw if agent unknown
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agentDef = config.agents[agentName]
  if (!agentDef) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  // 2. Get token for this agent
  const token = getToken(agentName, config, configDir)

  // 3. Resolve state dir (expand ~ to HOME)
  const expandedStateDir = resolveStateDir(agentName, config)

  // 4. Get session name
  const session = sessionName(config.fleet.name, agentName)

  // 5. Check if already running
  const runtime: RuntimeAdapter = resolveRuntime(agentName, config)
  if (await runtime.isRunning(session)) {
    if (opts.json) {
      console.log(JSON.stringify({ agent: agentName, session, status: "already_running" }))
    } else {
      console.log(`Agent "${agentName}" is already running (session: ${session})`)
    }
    return
  }

  const adapter = resolveAgentAdapter(agentName, config)
  await adapter.start({
    agentName,
    configDir,
    config,
    runtime,
    token,
    session,
    stateDir: expandedStateDir,
    opts,
  })
}
