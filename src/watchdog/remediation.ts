import { sessionName } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"
import { start } from "../commands/start"
import type { FleetConfig } from "../core/types"
import type { WatchdogState, WatchdogConfig } from "./types"
import { logEvent, createEvent } from "./log"
import { isOnCooldown, setCooldown, isOnCompactCooldown, setCompactCooldown, getAgentState } from "./state"

export async function restartAgent(
  agentName: string,
  reason: string,
  state: WatchdogState,
  config: WatchdogConfig,
): Promise<boolean> {
  if (config.dryRun) {
    console.log(`[watchdog] DRY RUN: would restart ${agentName} (${reason})`)
    logEvent(createEvent("restart_initiated", "warn", { agent: agentName, details: { reason, dryRun: true }, action: "restart", actionResult: "skipped" }))
    return false
  }

  if (isOnCooldown(state, agentName)) {
    console.log(`[watchdog] ${agentName}: on cooldown, skipping restart`)
    return false
  }

  logEvent(createEvent("restart_initiated", "warn", { agent: agentName, details: { reason }, action: "restart" }))

  try {
    await start(agentName, { wait: true, json: false })
    setCooldown(state, agentName, config.thresholds.restartCooldown)
    getAgentState(state, agentName).consecutiveFailures = 0
    logEvent(createEvent("restart_completed", "info", { agent: agentName, action: "restart", actionResult: "success" }))
    console.log(`[watchdog] ${agentName}: restarted (${reason})`)
    return true
  } catch (err) {
    logEvent(createEvent("restart_failed", "critical", {
      agent: agentName,
      details: { reason, error: err instanceof Error ? err.message : String(err) },
      action: "restart",
      actionResult: "failed",
    }))
    console.error(`[watchdog] ${agentName}: restart failed — ${err instanceof Error ? err.message : err}`)
    return false
  }
}

export async function sendCompact(
  agentName: string,
  reason: string,
  state: WatchdogState,
  config: WatchdogConfig,
  fleetConfig: FleetConfig,
): Promise<boolean> {
  if (config.dryRun) {
    console.log(`[watchdog] DRY RUN: would compact ${agentName} (${reason})`)
    return false
  }

  if (isOnCompactCooldown(state, agentName)) {
    console.log(`[watchdog] ${agentName}: on compact cooldown, skipping`)
    return false
  }

  const session = sessionName(fleetConfig.fleet.name, agentName)
  const runtime = resolveRuntime(agentName, fleetConfig)

  logEvent(createEvent("compact_initiated", "info", { agent: agentName, details: { reason }, action: "compact" }))

  try {
    await runtime.sendKeys(session, "/compact")
    setCompactCooldown(state, agentName, config.thresholds.compactCooldown)
    console.log(`[watchdog] ${agentName}: compacted (${reason})`)
    return true
  } catch (err) {
    console.error(`[watchdog] ${agentName}: compact failed — ${err instanceof Error ? err.message : err}`)
    return false
  }
}

export async function sendExitToAgent(
  agentName: string,
  reason: string,
  state: WatchdogState,
  config: WatchdogConfig,
  fleetConfig: FleetConfig,
): Promise<boolean> {
  if (config.dryRun) {
    console.log(`[watchdog] DRY RUN: would send /exit to ${agentName} (${reason})`)
    return false
  }

  if (isOnCooldown(state, agentName)) {
    console.log(`[watchdog] ${agentName}: on cooldown, skipping /exit`)
    return false
  }

  const session = sessionName(fleetConfig.fleet.name, agentName)
  const runtime = resolveRuntime(agentName, fleetConfig)

  logEvent(createEvent("restart_initiated", "warn", { agent: agentName, details: { reason, method: "/exit" }, action: "send_exit" }))

  try {
    await runtime.sendKeys(session, "/exit")
    setCooldown(state, agentName, config.thresholds.restartCooldown)
    console.log(`[watchdog] ${agentName}: sent /exit, wrapper will restart (${reason})`)
    return true
  } catch (err) {
    console.error(`[watchdog] ${agentName}: /exit failed — ${err instanceof Error ? err.message : err}`)
    return false
  }
}
