/**
 * Heartbeat tick — polls agent heartbeat files and broadcasts SSE events.
 * Runs every 15s when there are SSE clients connected.
 */

import { findConfigDir, loadConfig, resolveStateDir, sessionName } from "../core/config"
import { readHeartbeat, readRemoteHeartbeat } from "../core/heartbeat"
import { loadState, getAgentState } from "../watchdog/state"
import { broadcast, clientCount } from "./sse"

interface AgentHeartbeatState {
  name: string
  status: string
  heartbeat: { state: string; lastSeen: string | null; ageSec: number }
}

let lastStates = new Map<string, string>()

async function tick(): Promise<void> {
  // Skip if no clients are listening
  if (clientCount() === 0) return

  try {
    const configDir = findConfigDir()
    const config = loadConfig(configDir)
    const watchdogState = loadState()

    for (const [name, def] of Object.entries(config.agents)) {
      let heartbeat
      const isRemote = def.server !== "local" && config.servers?.[def.server]
      if (isRemote) {
        const serverConfig = config.servers![def.server]
        const rawStateDir = def.stateDir ?? `~/.fleet/state/${config.fleet.name}-${name}`
        heartbeat = await readRemoteHeartbeat(rawStateDir, serverConfig)
      } else {
        const stateDir = resolveStateDir(name, config)
        heartbeat = readHeartbeat(stateDir)
      }

      const agentWatch = getAgentState(watchdogState, name)
      let status = heartbeat.state
      if (heartbeat.state === "dead" && agentWatch.consecutiveFailures === 0) {
        status = "off"
      }

      // Always broadcast heartbeat so dashboard stays fresh
      broadcast("agent:heartbeat", {
        agent: name,
        state: heartbeat.state,
        status,
        lastSeen: heartbeat.lastSeen,
        ageSec: heartbeat.ageSec,
      })

      // Broadcast status change event if status changed since last tick
      const prevStatus = lastStates.get(name)
      if (prevStatus && prevStatus !== status) {
        broadcast("agent:status", {
          agent: name,
          from: prevStatus,
          to: status,
        })
      }
      lastStates.set(name, status)
    }
  } catch (err) {
    // Don't crash the tick — log and continue
    console.error("[heartbeat-tick]", err instanceof Error ? err.message : err)
  }
}

const HEARTBEAT_INTERVAL = 15_000

/** Start the heartbeat polling loop */
export function startHeartbeatTick(): void {
  // Run first tick immediately
  tick()
  setInterval(tick, HEARTBEAT_INTERVAL)
}
