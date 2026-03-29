import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"

const HEARTBEAT_FILE = "heartbeat.json"

/** Thresholds in milliseconds */
const ALIVE_THRESHOLD = 60_000    // < 60s = alive
const STALE_THRESHOLD = 300_000   // < 5min = stale, >= 5min = dead

export type HeartbeatState = "alive" | "stale" | "dead" | "unknown"

export interface HeartbeatInfo {
  state: HeartbeatState
  lastSeen: string | null        // ISO timestamp
  ageSec: number | null          // seconds since last heartbeat
}

interface HeartbeatData {
  timestamp: string
  pid?: number
}

/** Read the heartbeat file for an agent and determine liveness. */
export function readHeartbeat(stateDir: string): HeartbeatInfo {
  const path = join(stateDir, HEARTBEAT_FILE)
  if (!existsSync(path)) {
    return { state: "unknown", lastSeen: null, ageSec: null }
  }

  try {
    const data: HeartbeatData = JSON.parse(readFileSync(path, "utf8"))
    const lastSeen = data.timestamp
    const ageMs = Date.now() - new Date(lastSeen).getTime()
    const ageSec = Math.round(ageMs / 1000)

    let state: HeartbeatState
    if (ageMs < ALIVE_THRESHOLD) {
      state = "alive"
    } else if (ageMs < STALE_THRESHOLD) {
      state = "stale"
    } else {
      state = "dead"
    }

    return { state, lastSeen, ageSec }
  } catch {
    return { state: "unknown", lastSeen: null, ageSec: null }
  }
}

/** Write a heartbeat file (called from the wrapper script via a helper). */
export function writeHeartbeat(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true })
  const data: HeartbeatData = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
  }
  writeFileSync(join(stateDir, HEARTBEAT_FILE), JSON.stringify(data) + "\n")
}

/**
 * Generate a shell snippet that writes heartbeat in the background.
 * This gets injected into the agent wrapper script.
 */
export function heartbeatShellSnippet(stateDir: string): string[] {
  const hbFile = join(stateDir, HEARTBEAT_FILE)
  return [
    "# Heartbeat — write timestamp every 30s",
    `HEARTBEAT_FILE="${hbFile}"`,
    `mkdir -p "$(dirname "$HEARTBEAT_FILE")"`,
    '(_fleet_heartbeat() {',
    '  while true; do',
    '    echo "{\\"timestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\"}" > "$HEARTBEAT_FILE"',
    '    sleep 30',
    '  done',
    '}) &',
    'HEARTBEAT_PID=$!',
    'trap "kill $HEARTBEAT_PID 2>/dev/null" EXIT',
    "",
  ]
}

/** Format age in human-readable form. */
export function formatAge(ageSec: number | null): string {
  if (ageSec === null) return "never"
  if (ageSec < 60) return `${ageSec}s ago`
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`
  return `${Math.floor(ageSec / 3600)}h ago`
}
