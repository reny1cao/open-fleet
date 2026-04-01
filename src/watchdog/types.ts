export type WatchdogEventType =
  | "agent_stuck"
  | "agent_dead"
  | "plugin_crash"
  | "auth_expired"
  | "disk_warning"
  | "disk_critical"
  | "patch_missing"
  | "network_down"
  | "network_restored"
  | "context_pressure"
  | "watchdog_start"
  | "watchdog_stop"
  | "restart_initiated"
  | "restart_completed"
  | "restart_failed"
  | "compact_initiated"
  | "mac_wake"

export interface WatchdogEvent {
  timestamp: string
  type: WatchdogEventType
  agent?: string
  server: string
  severity: "info" | "warn" | "critical"
  details: Record<string, unknown>
  action: string | null
  actionResult: "success" | "failed" | "skipped" | null
}

export interface AgentWatchState {
  lastHealthy: string | null
  consecutiveFailures: number
  lastRestart: string | null
  restartCooldownUntil: string | null
  compactCooldownUntil: string | null
  lastOutputHash: string | null
  outputStaleCount: number
}

export interface ServerWatchState {
  reachable: boolean
  consecutiveSshFailures: number
  lastDiskPct: number | null
  networkDownSince: string | null
}

export interface WatchdogState {
  startedAt: string
  lastTick: string
  agents: Record<string, AgentWatchState>
  servers: Record<string, ServerWatchState>
  lastAlerted: Record<string, Record<string, string>>
}

export interface HealthCheckResult {
  agent: string
  check: string
  status: "healthy" | "degraded" | "critical"
  details: Record<string, unknown>
}

export interface WatchdogConfig {
  intervals: {
    localHeartbeat: number
    localOutputScan: number
    remoteHeartbeat: number
    remoteOutputScan: number
    diskCheck: number
    patchCheck: number
  }
  thresholds: {
    stuckScans: number
    restartCooldown: number
    compactCooldown: number
    diskWarnPct: number
    diskCritPct: number
    alertDedup: number
  }
  alertChannel?: string
  dryRun: boolean
  verbose: boolean
  noAlert: boolean
}

export const DEFAULT_CONFIG: WatchdogConfig = {
  intervals: {
    localHeartbeat: 15,
    localOutputScan: 30,
    remoteHeartbeat: 30,
    remoteOutputScan: 60,
    diskCheck: 300,
    patchCheck: 600,
  },
  thresholds: {
    stuckScans: 3,
    restartCooldown: 300,
    compactCooldown: 1800,
    diskWarnPct: 90,
    diskCritPct: 95,
    alertDedup: 3600,
  },
  dryRun: false,
  verbose: false,
  noAlert: false,
}
