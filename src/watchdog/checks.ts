import { findConfigDir, loadConfig, sessionName, resolveStateDir } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"
import { readHeartbeat, readRemoteHeartbeat } from "../core/heartbeat"
import { sshRun } from "../runtime/remote"
import type { FleetConfig } from "../core/types"
import type { HealthCheckResult, WatchdogState } from "./types"
import { getAgentState } from "./state"
import { createHash } from "crypto"

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
        heartbeat = await readRemoteHeartbeat(agentDef.stateDir ?? `~/.fleet/state/discord-${agentName}`, serverConfig)
      }
    }
  } catch { /* ignore: heartbeat read failure → report as degraded/unknown */ }

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

  const hasError = /ECONNREFUSED|plugin.*disconnected|401.*Unauthorized|authentication_error/i.test(output)
  const has401 = /401|authentication_error|Please run \/login/i.test(output)

  if (has401) {
    return { agent: agentName, check: "plugin", status: "critical", details: { error: "auth_expired" } }
  }
  if (hasError) {
    return { agent: agentName, check: "plugin", status: "critical", details: { error: "plugin_crash" } }
  }
  return { agent: agentName, check: "plugin", status: "healthy", details: {} }
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
