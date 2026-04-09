import { readFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { WatchdogState, AgentWatchState, ServerWatchState } from "./types"
import { atomicWriteJsonSync } from "../core/atomic-write"

const WATCHDOG_DIR = join(homedir(), ".fleet", "watchdog")
const STATE_FILE = join(WATCHDOG_DIR, "state.json")

function defaultAgentState(): AgentWatchState {
  return {
    lastHealthy: null,
    consecutiveFailures: 0,
    lastRestart: null,
    restartCooldownUntil: null,
    compactCooldownUntil: null,
    lastOutputHash: null,
    outputStaleCount: 0,
  }
}

function defaultServerState(): ServerWatchState {
  return {
    reachable: true,
    consecutiveSshFailures: 0,
    lastDiskPct: null,
    networkDownSince: null,
  }
}

export function loadState(): WatchdogState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf8"))
    } catch (err) {
      console.warn(`[watchdog] Corrupt state file ${STATE_FILE}, starting fresh: ${err instanceof Error ? err.message : err}`)
    }
  }
  return {
    startedAt: new Date().toISOString(),
    lastTick: new Date().toISOString(),
    agents: {},
    servers: {},
    lastAlerted: {},
  }
}

export function saveState(state: WatchdogState): void {
  mkdirSync(WATCHDOG_DIR, { recursive: true })
  state.lastTick = new Date().toISOString()
  atomicWriteJsonSync(STATE_FILE, state)
}

export function getAgentState(state: WatchdogState, name: string): AgentWatchState {
  if (!state.agents[name]) {
    state.agents[name] = defaultAgentState()
  }
  return state.agents[name]
}

export function getServerState(state: WatchdogState, name: string): ServerWatchState {
  if (!state.servers[name]) {
    state.servers[name] = defaultServerState()
  }
  return state.servers[name]
}

export function isOnCooldown(state: WatchdogState, agent: string): boolean {
  const agentState = state.agents[agent]
  if (!agentState?.restartCooldownUntil) return false
  return new Date(agentState.restartCooldownUntil) > new Date()
}

export function setCooldown(state: WatchdogState, agent: string, seconds: number): void {
  const agentState = getAgentState(state, agent)
  agentState.restartCooldownUntil = new Date(Date.now() + seconds * 1000).toISOString()
  agentState.lastRestart = new Date().toISOString()
}

export function isOnCompactCooldown(state: WatchdogState, agent: string): boolean {
  const agentState = state.agents[agent]
  if (!agentState?.compactCooldownUntil) return false
  return new Date(agentState.compactCooldownUntil) > new Date()
}

export function setCompactCooldown(state: WatchdogState, agent: string, seconds: number): void {
  const agentState = getAgentState(state, agent)
  agentState.compactCooldownUntil = new Date(Date.now() + seconds * 1000).toISOString()
}

export function canAlert(state: WatchdogState, agent: string, eventType: string, dedupSeconds: number): boolean {
  const agentAlerts = state.lastAlerted[agent]
  if (!agentAlerts?.[eventType]) return true
  const lastAlerted = new Date(agentAlerts[eventType])
  return Date.now() - lastAlerted.getTime() > dedupSeconds * 1000
}

export function markAlerted(state: WatchdogState, agent: string, eventType: string): void {
  if (!state.lastAlerted[agent]) state.lastAlerted[agent] = {}
  state.lastAlerted[agent][eventType] = new Date().toISOString()
}
