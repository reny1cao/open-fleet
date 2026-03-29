import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import type { ServerConfig } from "./types"

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

    // Guard against invalid timestamps (NaN)
    if (isNaN(ageMs)) {
      return { state: "unknown", lastSeen, ageSec: null }
    }

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
  // Atomic write: write to temp file then rename to avoid partial reads
  const target = join(stateDir, HEARTBEAT_FILE)
  const tmp = target + ".tmp"
  writeFileSync(tmp, JSON.stringify(data) + "\n")
  const { renameSync } = require("fs")
  renameSync(tmp, target)
}

/**
 * Read heartbeat from a remote agent via SSH.
 * stateDir should be the raw path with ~ (e.g., "~/.fleet/state/agent")
 * so the remote shell expands ~ to the remote user's home directory.
 */
export async function readRemoteHeartbeat(
  remoteStateDir: string,
  serverConfig: ServerConfig
): Promise<HeartbeatInfo> {
  try {
    const { sshRun } = await import("../runtime/remote")
    // Use the raw path — let the remote shell expand ~
    const path = `${remoteStateDir}/${HEARTBEAT_FILE}`
    const output = await sshRun(serverConfig, `cat '${path}' 2>/dev/null || echo '{}'`)
    const data: HeartbeatData = JSON.parse(output.trim())
    if (!data.timestamp) {
      return { state: "unknown", lastSeen: null, ageSec: null }
    }
    const ageMs = Date.now() - new Date(data.timestamp).getTime()
    if (isNaN(ageMs)) {
      return { state: "unknown", lastSeen: data.timestamp, ageSec: null }
    }
    const ageSec = Math.round(ageMs / 1000)
    let state: HeartbeatState
    if (ageMs < ALIVE_THRESHOLD) state = "alive"
    else if (ageMs < STALE_THRESHOLD) state = "stale"
    else state = "dead"
    return { state, lastSeen: data.timestamp, ageSec }
  } catch {
    return { state: "unknown", lastSeen: null, ageSec: null }
  }
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
