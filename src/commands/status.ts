import { findConfigDir, loadConfig, sessionName } from "../core/config"
import { TmuxLocal } from "../runtime/tmux"

interface AgentStatus {
  name: string
  server: string
  role: string
  state: "on" | "off"
  session: string
}

export async function status(opts: { json?: boolean }): Promise<void> {
  // 1. Load config
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const runtime = new TmuxLocal()

  // 2. Collect status for each agent
  const results: AgentStatus[] = []

  for (const [name, def] of Object.entries(config.agents)) {
    const session = sessionName(config.fleet.name, name)
    const running = await runtime.isRunning(session)
    results.push({
      name,
      server: def.server ?? "",
      role: def.role,
      state: running ? "on" : "off",
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

  for (const agent of results) {
    const tag = agent.state === "on" ? ON : OFF
    const attachCmd = `tmux attach -t ${agent.session}`
    console.log(`${tag}  ${agent.name.padEnd(20)} ${agent.role.padEnd(30)} ${attachCmd}`)
  }
}
