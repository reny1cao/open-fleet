import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { WatchdogEvent } from "./types"

const WATCHDOG_DIR = join(homedir(), ".fleet", "watchdog")
const LOG_FILE = join(WATCHDOG_DIR, "events.jsonl")
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB

export function logEvent(event: WatchdogEvent): void {
  mkdirSync(WATCHDOG_DIR, { recursive: true })

  // Rotate if too large
  if (existsSync(LOG_FILE)) {
    try {
      const size = statSync(LOG_FILE).size
      if (size > MAX_LOG_SIZE) {
        const backup = LOG_FILE + ".1"
        try { renameSync(backup, backup + ".old") } catch {}
        renameSync(LOG_FILE, backup)
        try { unlinkSync(backup + ".old") } catch {}
      }
    } catch {}
  }

  appendFileSync(LOG_FILE, JSON.stringify(event) + "\n")
}

export function createEvent(
  type: WatchdogEvent["type"],
  severity: WatchdogEvent["severity"],
  opts: {
    agent?: string
    server?: string
    details?: Record<string, unknown>
    action?: string | null
    actionResult?: WatchdogEvent["actionResult"]
  } = {}
): WatchdogEvent {
  return {
    timestamp: new Date().toISOString(),
    type,
    agent: opts.agent,
    server: opts.server ?? "local",
    severity,
    details: opts.details ?? {},
    action: opts.action ?? null,
    actionResult: opts.actionResult ?? null,
  }
}
