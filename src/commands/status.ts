import { findConfigDir, loadConfig, sessionName } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"

interface AgentStatus {
  name: string
  server: string
  role: string
  state: "on" | "off" | "error"
  session: string
}

export async function status(opts: { json?: boolean }): Promise<void> {
  // 1. Load config
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  // 2. Collect status for each agent (local + remote)
  const results: AgentStatus[] = []

  for (const [name, def] of Object.entries(config.agents)) {
    const session = sessionName(config.fleet.name, name)
    let state: "on" | "off" | "error" = "off"
    try {
      const runtime = resolveRuntime(name, config)
      state = (await runtime.isRunning(session)) ? "on" : "off"
    } catch {
      state = "error"
    }
    results.push({
      name,
      server: def.server ?? "",
      role: def.role,
      state,
      session,
    })
  }

  // 3. JSON output
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // 4. Formatted table output
  const ON = "\x1b[32m[on]\x1b[0m"
  const OFF = "\x1b[31m[off]\x1b[0m"
  const ERR = "\x1b[33m[err]\x1b[0m"

  for (const agent of results) {
    const tag = agent.state === "on" ? ON : agent.state === "error" ? ERR : OFF
    const server = agent.server && agent.server !== "local" ? ` (${agent.server})` : ""
    const attachCmd = `tmux attach -t ${agent.session}`
    console.log(`${tag}  ${agent.name.padEnd(20)} ${agent.role.padEnd(30)}${server}`)
  }
}
