/**
 * Heartbeat tick — polls agent heartbeat files every 15s, caches full agent
 * state for GET /agents/summary, and broadcasts SSE events for live updates.
 *
 * Always runs (not gated on SSE client count) since the summary endpoint
 * needs the cache regardless of whether anyone is streaming events.
 */

import { findConfigDir, loadConfig, resolveStateDir } from "../core/config"
import { readHeartbeat, readRemoteHeartbeat } from "../core/heartbeat"
import { loadState, getAgentState } from "../watchdog/state"
import { loadTaskStore } from "../tasks/store"
import { broadcast, clientCount } from "./sse"

export interface CachedAgent {
  name: string
  role: string
  server: string
  workspace: string
  channels?: unknown
  status: string
  heartbeat: { state: string; lastSeen: string | null; ageSec: number }
  watchdog: {
    lastHealthy: string | null
    consecutiveFailures: number
    lastRestart: string | null
    outputStaleCount: number
  }
  activeTasks: { id: string; title: string; status: string; priority: string; startedAt?: string }[]
  recentActivity: { timestamp: string; taskId: string; type: string; text: string }[]
  dailyStats: { completed: number; events: number }
}

interface AgentSummaryCache {
  agents: CachedAgent[]
  updatedAt: string
}

let cache: AgentSummaryCache | null = null
let lastStates = new Map<string, string>()

/** Get the cached agent summary. Returns null if no tick has run yet. */
export function getAgentSummaryCache(): AgentSummaryCache | null {
  return cache
}

async function tick(): Promise<void> {
  try {
    const configDir = findConfigDir()
    const config = loadConfig(configDir)
    const watchdogState = loadState()
    const taskStore = loadTaskStore()
    const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()

    const agents: CachedAgent[] = []

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

      // Active tasks
      const active = taskStore.tasks
        .filter(t => t.assignee === name && (t.status === "in_progress" || t.status === "review"))
        .map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, startedAt: t.startedAt }))

      // Recent activity: last 5 events from this agent
      const recentEvents: { timestamp: string; taskId: string; type: string; text: string }[] = []
      for (const task of taskStore.tasks) {
        for (const note of task.notes) {
          if (note.author === name) {
            recentEvents.push({ timestamp: note.timestamp, taskId: task.id, type: note.type, text: note.text })
          }
        }
      }
      recentEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

      // Daily stats
      const todayCompleted = taskStore.tasks.filter(t => t.assignee === name && t.completedAt && t.completedAt >= todayStart).length
      const todayEvents = recentEvents.filter(e => e.timestamp >= todayStart).length

      agents.push({
        name,
        role: def.role,
        server: def.server,
        workspace: def.workspace ?? config.defaults.workspace,
        channels: def.channels,
        status,
        heartbeat: {
          state: heartbeat.state,
          lastSeen: heartbeat.lastSeen,
          ageSec: heartbeat.ageSec,
        },
        watchdog: {
          lastHealthy: agentWatch.lastHealthy,
          consecutiveFailures: agentWatch.consecutiveFailures,
          lastRestart: agentWatch.lastRestart,
          outputStaleCount: agentWatch.outputStaleCount,
        },
        activeTasks: active,
        recentActivity: recentEvents.slice(0, 5),
        dailyStats: { completed: todayCompleted, events: todayEvents },
      })

      // Broadcast SSE events if clients are listening
      if (clientCount() > 0) {
        broadcast("agent:heartbeat", {
          agent: name,
          state: heartbeat.state,
          status,
          lastSeen: heartbeat.lastSeen,
          ageSec: heartbeat.ageSec,
        })

        const prevStatus = lastStates.get(name)
        if (prevStatus && prevStatus !== status) {
          broadcast("agent:status", {
            agent: name,
            from: prevStatus,
            to: status,
          })
        }
      }
      lastStates.set(name, status)
    }

    cache = { agents, updatedAt: new Date().toISOString() }
  } catch (err) {
    console.error("[heartbeat-tick]", err instanceof Error ? err.message : err)
  }
}

const HEARTBEAT_INTERVAL = 15_000

/** Start the heartbeat polling loop */
export function startHeartbeatTick(): void {
  tick()
  setInterval(tick, HEARTBEAT_INTERVAL)
}
