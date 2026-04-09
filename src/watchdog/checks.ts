import { findConfigDir, loadConfig, sessionName, resolveStateDir } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"
import { readHeartbeat, readRemoteHeartbeat } from "../core/heartbeat"
import { sshRun } from "../runtime/remote"
import type { FleetConfig } from "../core/types"
import type { HealthCheckResult, WatchdogState } from "./types"
import { getAgentState } from "./state"
import { createHash } from "crypto"
import { classifyTerminalOutput } from "./error-classifier"

function hashOutput(output: string): string {
  return createHash("md5").update(output.trim()).digest("hex").substring(0, 12)
}

// Check if a tmux session is alive (local or remote)
export async function checkSession(
  agentName: string,
  config: FleetConfig,
): Promise<HealthCheckResult> {
  const session = sessionName(config.fleet.name, agentName)
  const runtime = resolveRuntime(agentName, config)

  const running = await runtime.isRunning(session)
  return {
    agent: agentName,
    check: "session",
    status: running ? "healthy" : "critical",
    details: { session, running },
  }
}

// Check heartbeat freshness
export async function checkHeartbeat(
  agentName: string,
  config: FleetConfig,
): Promise<HealthCheckResult> {
  const agentDef = config.agents[agentName]
  const stateDir = resolveStateDir(agentName, config)

  let heartbeat: { state: string; ageSec: number } | null = null
  try {
    if (agentDef.server === "local") {
      heartbeat = readHeartbeat(stateDir)
    } else {
      const serverConfig = config.servers?.[agentDef.server]
      if (serverConfig) {
        heartbeat = await readRemoteHeartbeat(serverConfig, agentDef.stateDir ?? `~/.fleet/state/discord-${agentName}`)
      }
    }
  } catch (err) {
    process.stderr.write(`[watchdog] heartbeat check failed for ${agentName}: ${err instanceof Error ? err.message : err}\n`)
  }

  if (!heartbeat) {
    return { agent: agentName, check: "heartbeat", status: "degraded", details: { state: "unknown" } }
  }

  const status = heartbeat.state === "alive" && heartbeat.ageSec < 120 ? "healthy"
    : heartbeat.ageSec > 300 ? "critical"
    : "degraded"

  return { agent: agentName, check: "heartbeat", status, details: heartbeat }
}

// Check if agent output is stuck (same output for multiple scans)
export async function checkOutputStuck(
  agentName: string,
  config: FleetConfig,
  state: WatchdogState,
): Promise<HealthCheckResult> {
  const session = sessionName(config.fleet.name, agentName)
  const runtime = resolveRuntime(agentName, config)
  const agentState = getAgentState(state, agentName)

  let output: string
  try {
    output = await runtime.captureOutput(session, 20)
  } catch {
    return { agent: agentName, check: "output_stuck", status: "degraded", details: { error: "capture failed" } }
  }

  // Check for thinking/ideating patterns
  const isThinking = /(?:Ideating|Thinking|Osmosing|Brewed|Baked|Crunched|Fluttering|Dilly|Perambulat|Sautéed|Shimmying|Churned|Cogitat).*\d+[ms]/i.test(output)

  const currentHash = hashOutput(output)

  if (currentHash === agentState.lastOutputHash) {
    agentState.outputStaleCount++
  } else {
    agentState.outputStaleCount = 0
  }
  agentState.lastOutputHash = currentHash

  const stuck = agentState.outputStaleCount >= 3
  return {
    agent: agentName,
    check: "output_stuck",
    status: stuck ? "critical" : "healthy",
    details: { isThinking, staleCount: agentState.outputStaleCount, stuck },
  }
}

// Check if Discord plugin is alive by looking for error patterns
export async function checkPlugin(
  agentName: string,
  config: FleetConfig,
): Promise<HealthCheckResult> {
  const session = sessionName(config.fleet.name, agentName)
  const runtime = resolveRuntime(agentName, config)

  let output: string
  try {
    output = await runtime.captureOutput(session, 30)
  } catch {
    return { agent: agentName, check: "plugin", status: "degraded", details: { error: "capture failed" } }
  }

  // Use structured classifier instead of inline regex
  const classified = classifyTerminalOutput(output)
  if (!classified) {
    return { agent: agentName, check: "plugin", status: "healthy", details: {} }
  }

  // Map classifier categories to watchdog error types for backward compat
  const errorType = classified.category === "auth" ? "auth_expired"
    : classified.category === "billing" ? "billing_exhausted"
    : classified.category === "context_overflow" ? "context_overflow"
    : classified.category === "rate_limit" ? "rate_limited"
    : classified.category === "timeout" ? "plugin_timeout"
    : "plugin_crash"

  const status = classified.retryable ? "degraded" : "critical"

  return {
    agent: agentName,
    check: "plugin",
    status,
    details: {
      error: errorType,
      classified: {
        category: classified.category,
        retryable: classified.retryable,
        shouldCompact: classified.shouldCompact,
        shouldAlert: classified.shouldAlert,
        message: classified.message,
      },
    },
  }
}

// Check disk space on the local machine
export async function checkLocalDiskSpace(): Promise<HealthCheckResult> {
  try {
    const result = Bun.spawnSync(["df", "-P", "/"], { stdout: "pipe", stderr: "pipe" })
    const stdout = new TextDecoder().decode(result.stdout)
    const lines = stdout.trim().split("\n")
    if (lines.length < 2) {
      return { agent: "local", check: "disk", status: "degraded", details: { error: "parse failed", raw: stdout } }
    }
    const fields = lines[1].split(/\s+/)
    const pct = parseInt(fields[4]?.replace("%", "") ?? "")
    if (isNaN(pct)) {
      return { agent: "local", check: "disk", status: "degraded", details: { error: "parse failed", raw: stdout } }
    }
    const status = pct >= 95 ? "critical" : pct >= 90 ? "degraded" : "healthy"
    return { agent: "local", check: "disk", status, details: { pct } }
  } catch (err) {
    return { agent: "local", check: "disk", status: "degraded", details: { error: "df failed" } }
  }
}

// Check disk space on a remote server
export async function checkDiskSpace(
  serverName: string,
  config: FleetConfig,
): Promise<HealthCheckResult> {
  const serverConfig = config.servers?.[serverName]
  if (!serverConfig) {
    return { agent: serverName, check: "disk", status: "degraded", details: { error: "no server config" } }
  }

  try {
    const { stdout, ok } = await sshRun(serverConfig, "df -P / | awk 'NR==2{print $5}' | tr -d '%'", { throwOnError: false })
    if (!ok) {
      return { agent: serverName, check: "disk", status: "degraded", details: { error: "ssh failed" } }
    }
    const pct = parseInt(stdout.trim())
    if (isNaN(pct)) {
      return { agent: serverName, check: "disk", status: "degraded", details: { error: "parse failed", raw: stdout } }
    }

    const status = pct >= 95 ? "critical" : pct >= 90 ? "degraded" : "healthy"
    return { agent: serverName, check: "disk", status, details: { pct } }
  } catch (err) {
    return { agent: serverName, check: "disk", status: "critical", details: { error: "ssh_unreachable" } }
  }
}
