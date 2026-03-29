import { findConfigDir, loadConfig, sessionName, resolveStateDir } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"
import { readHeartbeat, readRemoteHeartbeat, formatAge, type HeartbeatInfo, type HeartbeatState } from "../core/heartbeat"
import { extractRecentActivity, type ActivityEvent } from "../core/activity"
import type { RuntimeAdapter } from "../runtime/types"

interface AgentSnapshot {
  name: string
  role: string
  server: string
  state: "on" | "off" | "error"
  heartbeat: HeartbeatState
  ageSec: number | null
  lastLine: string
  events: ActivityEvent[]
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

      // Capture output and parse events (only if running)
      let events: ActivityEvent[] = []
      if (state === "on") {
        try {
          const output = await agent.runtime.captureOutput(agent.session, 50)
          if (output && output.trim()) {
            const lines = output.split("\n")
            events = extractRecentActivity(agent.name, lines, 10)
            // Set lastLine from latest event
            if (events.length > 0) {
              lastLine = events[events.length - 1].summary.substring(0, 80)
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
        events,
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

  // Activity feed — merged and sorted by type importance
  out += `\n${DIM}${"─".repeat(78)}${RESET}\n`
  out += `${BOLD}Activity${RESET}\n`

  // Collect all events, sort chronologically by sequence, keep last 10
  const allEvents: ActivityEvent[] = []
  for (const snap of snapshots) {
    allEvents.push(...snap.events)
  }
  allEvents.sort((a, b) => a.seq - b.seq)
  const recentEvents = allEvents.slice(-10)

  if (recentEvents.length === 0) {
    out += `${DIM}  No recent activity${RESET}\n`
  } else {
    for (const event of recentEvents) {
      const icon = eventIcon(event.type)
      out += `${CYAN}${event.agent.padEnd(18)}${RESET} ${icon} ${event.summary}\n`
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

function eventIcon(type: ActivityEvent["type"]): string {
  switch (type) {
    case "discord_in":  return "←"
    case "discord_out": return "→"
    case "bash":        return "$"
    case "file_op":     return "📄"
    case "git":         return "⎇"
    case "test":        return "✓"
    case "thinking":    return "…"
    case "complete":    return "✓"
    case "error":       return "✗"
    case "other":       return "·"
  }
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
  events: ActivityEvent[] = [],
): AgentSnapshot {
  return { name, role, server, state, heartbeat, ageSec, lastLine, events }
}

export { formatState, type AgentSnapshot }
