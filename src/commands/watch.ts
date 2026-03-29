import { findConfigDir, loadConfig, sessionName, resolveStateDir } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"
import { readHeartbeat, readRemoteHeartbeat, formatAge, type HeartbeatInfo, type HeartbeatState } from "../core/heartbeat"
import type { RuntimeAdapter } from "../runtime/types"

interface AgentSnapshot {
  name: string
  role: string
  server: string
  state: "on" | "off" | "error"
  heartbeat: HeartbeatState
  ageSec: number | null
  lastLine: string
}

export async function watch(opts: { interval?: number } = {}): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)
  const intervalMs = (opts.interval ?? 5) * 1000

  // Pre-resolve runtimes and sessions
  const agents = Object.entries(config.agents).map(([name, def]) => ({
    name,
    def,
    session: sessionName(config.fleet.name, name),
    runtime: resolveRuntime(name, config),
    stateDir: resolveStateDir(name, config),
    rawStateDir: (def as any).stateDir ?? `~/.fleet/state/${config.fleet.name}-${name}`,
  }))

  const intervalSec = opts.interval ?? 5

  // Main loop
  while (true) {
    // Fix #2: Promise.all returns results in input order — no push race
    const snapshots = await Promise.all(agents.map(async (agent): Promise<AgentSnapshot> => {
      let state: "on" | "off" | "error" = "off"
      let lastLine = ""
      let hb: HeartbeatInfo = { state: "unknown", lastSeen: null, ageSec: null }

      try {
        state = (await agent.runtime.isRunning(agent.session)) ? "on" : "off"
      } catch {
        state = "error"
      }

      // Heartbeat
      try {
        const isRemote = agent.def.server && agent.def.server !== "local" && config.servers?.[agent.def.server]
        if (isRemote) {
          hb = await readRemoteHeartbeat(agent.rawStateDir, config.servers![agent.def.server])
        } else {
          hb = readHeartbeat(agent.stateDir)
        }
      } catch { /* ignore */ }

      // Last output line (only if running)
      if (state === "on") {
        try {
          const output = await agent.runtime.captureOutput(agent.session, 20)
          if (output && output.trim()) {
            const lines = output.split("\n").filter(l => l.trim() !== "")
            for (let i = lines.length - 1; i >= 0; i--) {
              const l = lines[i].trim()
              if (l && !l.startsWith("─") && !l.startsWith("⏵") && l !== "❯" && l.length > 2) {
                lastLine = l.substring(0, 80)
                break
              }
            }
          }
        } catch { /* ignore */ }
      }

      return {
        name: agent.name,
        role: (agent.def as any).role ?? "",
        server: (agent.def as any).server ?? "local",
        state,
        heartbeat: hb.state,
        ageSec: hb.ageSec,
        lastLine,
      }
    }))

    // Render
    render(snapshots, intervalSec)

    // Wait
    await Bun.sleep(intervalMs)
  }
}

// ANSI codes
const CLEAR = "\x1b[2J\x1b[H"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"
const GRAY = "\x1b[90m"

function render(snapshots: AgentSnapshot[], intervalSec: number = 5): void {
  const now = new Date().toLocaleTimeString()
  const onCount = snapshots.filter(s => s.state === "on").length
  const totalCount = snapshots.length

  let out = CLEAR
  out += `${BOLD}fleet watch${RESET}  ${DIM}${now}${RESET}  ${GREEN}${onCount}${RESET}/${totalCount} agents online\n`
  out += `${DIM}${"─".repeat(78)}${RESET}\n`

  // Agent table
  for (const agent of snapshots) {
    const { tag, color } = formatState(agent)
    const server = agent.server !== "local" ? ` ${DIM}(${agent.server})${RESET}` : ""
    const age = agent.state === "on" && agent.ageSec !== null ? ` ${DIM}${formatAge(agent.ageSec)}${RESET}` : ""

    out += `${color}${tag}${RESET}  ${agent.name.padEnd(20)} ${DIM}${agent.role.padEnd(14)}${RESET}${server}${age}\n`
  }

  // Activity feed
  out += `\n${DIM}${"─".repeat(78)}${RESET}\n`
  out += `${BOLD}Activity${RESET}\n`

  const active = snapshots.filter(s => s.state === "on" && s.lastLine)
  if (active.length === 0) {
    out += `${DIM}  No recent activity${RESET}\n`
  } else {
    for (const agent of active) {
      out += `${CYAN}${agent.name.padEnd(18)}${RESET} ${agent.lastLine}\n`
    }
  }

  out += `\n${DIM}Ctrl+C to quit · refreshing every ${intervalSec}s${RESET}`
  process.stdout.write(out)
}

function formatState(agent: AgentSnapshot): { tag: string; color: string } {
  // All tags padded to 7 chars for consistent column alignment
  if (agent.state === "on") {
    if (agent.heartbeat === "alive") return { tag: "[alive]", color: GREEN }
    if (agent.heartbeat === "stale") return { tag: "[stale]", color: YELLOW }
    if (agent.heartbeat === "dead")  return { tag: "[hung?]", color: YELLOW }
    return { tag: "[on]   ", color: GREEN }
  }
  if (agent.state === "error") return { tag: "[err]  ", color: YELLOW }
  return { tag: "[off]  ", color: RED }
}

/**
 * Extract a testable snapshot from agent data (for unit testing the render logic).
 */
export function buildSnapshot(
  name: string,
  role: string,
  server: string,
  state: "on" | "off" | "error",
  heartbeat: HeartbeatState,
  ageSec: number | null,
  lastLine: string,
): AgentSnapshot {
  return { name, role, server, state, heartbeat, ageSec, lastLine }
}

export { formatState, type AgentSnapshot }
