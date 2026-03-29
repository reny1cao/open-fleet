import { findConfigDir, loadConfig, sessionName, resolveStateDir } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"
import { readHeartbeat, readRemoteHeartbeat, formatAge, type HeartbeatState, type HeartbeatInfo } from "../core/heartbeat"

interface AgentStatus {
  name: string
  server: string
  role: string
  state: "on" | "off" | "error"
  session: string
  heartbeat: HeartbeatState
  lastSeen: string | null
  ageSec: number | null
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

    // Read heartbeat (local or remote)
    const stateDir = resolveStateDir(name, config)
    const isRemote = def.server && def.server !== "local" && config.servers?.[def.server]
    let hb: HeartbeatInfo
    if (isRemote) {
      hb = await readRemoteHeartbeat(stateDir, config.servers![def.server])
    } else {
      hb = readHeartbeat(stateDir)
    }

    results.push({
      name,
      server: def.server ?? "",
      role: def.role,
      state,
      session,
      heartbeat: hb.state,
      lastSeen: hb.lastSeen,
      ageSec: hb.ageSec,
    })
  }

  // 3. JSON output
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // 4. Formatted table output
  const ON = "\x1b[32m"
  const OFF = "\x1b[31m"
  const YELLOW = "\x1b[33m"
  const DIM = "\x1b[2m"
  const RESET = "\x1b[0m"

  for (const agent of results) {
    // Determine display state combining tmux + heartbeat
    let tag: string
    let color: string
    if (agent.state === "on") {
      if (agent.heartbeat === "alive") {
        tag = "[alive]"
        color = ON
      } else if (agent.heartbeat === "stale") {
        tag = "[stale]"
        color = YELLOW
      } else if (agent.heartbeat === "dead") {
        tag = "[hung?]"
        color = YELLOW
      } else {
        // tmux running but no heartbeat file yet
        tag = "[on]"
        color = ON
      }
    } else if (agent.state === "error") {
      tag = "[err]"
      color = YELLOW
    } else {
      tag = "[off]"
      color = OFF
    }

    const server = agent.server && agent.server !== "local" ? ` (${agent.server})` : ""
    const age = agent.state === "on" ? `  ${DIM}${formatAge(agent.ageSec)}${RESET}` : ""
    console.log(`${color}${tag}${RESET}  ${agent.name.padEnd(20)} ${agent.role.padEnd(30)}${server}${age}`)
  }
}
