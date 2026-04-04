import { findConfigDir, loadConfig } from "../core/config"
import type { FleetConfig } from "../core/types"
import type { WatchdogConfig, HealthCheckResult } from "./types"
import { loadState, saveState, getAgentState, getServerState } from "./state"
import { logEvent, createEvent } from "./log"
import { checkSession, checkHeartbeat, checkOutputStuck, checkPlugin, checkDiskSpace, checkLocalDiskSpace } from "./checks"
import { restartAgent, sendExitToAgent, sendCompact } from "./remediation"
import { alertDiscord } from "./alert"

export async function runDaemon(config: WatchdogConfig): Promise<void> {
  const state = loadState()
  state.startedAt = new Date().toISOString()
  logEvent(createEvent("watchdog_start", "info", { details: { config } }))
  console.log("[watchdog] Started")

  let lastOutputScan = 0
  let lastRemoteOutputScan = 0
  let lastDiskCheck = 0
  let lastPatchCheck = 0
  let lastTick = Date.now()

  const shutdown = () => {
    logEvent(createEvent("watchdog_stop", "info"))
    console.log("\n[watchdog] Stopped")
    saveState(state)
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  while (true) {
    try {
    const now = Date.now()

    // Detect Mac wake from sleep (tick took way longer than expected)
    const elapsed = now - lastTick
    if (elapsed > config.intervals.localHeartbeat * 1000 * 4) {
      console.log(`[watchdog] Detected wake from sleep (${Math.round(elapsed / 1000)}s gap)`)
      logEvent(createEvent("mac_wake", "warn", { details: { gapSeconds: Math.round(elapsed / 1000) } }))
    }
    lastTick = now

    let fleetConfig: FleetConfig
    try {
      const configDir = findConfigDir()
      fleetConfig = loadConfig(configDir)
    } catch (err) {
      console.error(`[watchdog] Cannot load config: ${err instanceof Error ? err.message : err}`)
      await Bun.sleep(config.intervals.localHeartbeat * 1000)
      continue
    }

    const agents = Object.entries(fleetConfig.agents)
    const servers = new Set(
      agents.filter(([, def]) => def.server !== "local").map(([, def]) => def.server)
    )

    // ── Session + heartbeat checks (every tick) ─────────────────────────
    for (const [name, def] of agents) {
      const result = await checkSession(name, fleetConfig)

      if (result.status === "critical") {
        const agentState = getAgentState(state, name)
        agentState.consecutiveFailures++

        if (agentState.consecutiveFailures >= 2) {
          console.log(`[watchdog] ${name}: session dead (${agentState.consecutiveFailures} checks)`)
          logEvent(createEvent("agent_dead", "critical", { agent: name, server: def.server }))

          const restarted = await restartAgent(name, "session dead", state, config)
          if (!restarted) {
            await alertDiscord("critical", name, "agent_dead",
              `Agent session is dead and could not be restarted.\nServer: ${def.server}`,
              state, config)
          }
        }
      } else {
        const agentState = getAgentState(state, name)
        agentState.consecutiveFailures = 0
        agentState.lastHealthy = new Date().toISOString()
      }

      // Heartbeat freshness check
      const hbResult = await checkHeartbeat(name, fleetConfig)
      if (hbResult.status === "critical") {
        console.log(`[watchdog] ${name}: heartbeat dead (${hbResult.details.ageSec ?? "unknown"}s old)`)
        logEvent(createEvent("agent_dead", "warn", { agent: name, server: def.server, details: hbResult.details }))
      }
    }

    // ── Plugin / auth checks (every tick for local, less for remote) ─────
    for (const [name, def] of agents) {
      const isLocal = def.server === "local"
      // Skip remote agents if server is unreachable
      if (!isLocal) {
        const serverState = getServerState(state, def.server)
        if (!serverState.reachable) continue
      }

      const pluginResult = await checkPlugin(name, fleetConfig)

      if (pluginResult.status === "critical") {
        const errorType = pluginResult.details.error as string
        if (errorType === "auth_expired") {
          console.log(`[watchdog] ${name}: auth expired`)
          logEvent(createEvent("auth_expired", "critical", { agent: name, server: def.server }))
          await alertDiscord("critical", name, "auth_expired",
            `Auth token expired — 401 from API. Please re-login on ${def.server}.`,
            state, config)
        } else {
          console.log(`[watchdog] ${name}: plugin error — ${errorType}`)
          logEvent(createEvent("plugin_crash", "warn", { agent: name, server: def.server, details: pluginResult.details }))
          await sendExitToAgent(name, "plugin crash", state, config, fleetConfig)
        }
      }
    }

    // ── Output stuck scan ────────────────────────────────────────────────
    const shouldScanLocal = now - lastOutputScan > config.intervals.localOutputScan * 1000
    const shouldScanRemote = now - lastRemoteOutputScan > config.intervals.remoteOutputScan * 1000

    for (const [name, def] of agents) {
      const isLocal = def.server === "local"
      if (isLocal && !shouldScanLocal) continue
      if (!isLocal && !shouldScanRemote) continue
      if (!isLocal) {
        const serverState = getServerState(state, def.server)
        if (!serverState.reachable) continue
      }

      const stuckResult = await checkOutputStuck(name, fleetConfig, state)

      if (stuckResult.status === "critical") {
        console.log(`[watchdog] ${name}: stuck (${(stuckResult.details as any).staleCount} scans)`)
        logEvent(createEvent("agent_stuck", "warn", { agent: name, server: def.server, details: stuckResult.details }))

        // Try /compact first, then /exit if that doesn't help
        const agentState = getAgentState(state, name)
        if (agentState.outputStaleCount <= config.thresholds.stuckScans + 1) {
          await sendCompact(name, "stuck — trying compact", state, config, fleetConfig)
        } else {
          await sendExitToAgent(name, "stuck — compact didn't help", state, config, fleetConfig)
        }
      }
    }
    if (shouldScanLocal) lastOutputScan = now
    if (shouldScanRemote) lastRemoteOutputScan = now

    // ── Disk space check (local + remote) ────────────────────────────────
    if (now - lastDiskCheck > config.intervals.diskCheck * 1000) {
      // Local disk
      const localDisk = await checkLocalDiskSpace()
      const localPct = localDisk.details.pct as number | undefined
      if (localPct !== undefined) {
        if (localPct >= 95) {
          await alertDiscord("critical", "local", "disk_critical",
            `Local disk usage at ${localPct}%. Agents may fail.`,
            state, config)
        } else if (localPct >= 90) {
          await alertDiscord("warn", "local", "disk_warning",
            `Local disk usage at ${localPct}%. Consider cleanup.`,
            state, config)
        }
      }

      // Remote servers
      for (const serverName of servers) {
        const diskResult = await checkDiskSpace(serverName, fleetConfig)
        const serverState = getServerState(state, serverName)

        if (diskResult.status === "critical" && diskResult.details.error === "ssh_unreachable") {
          serverState.consecutiveSshFailures++
          if (serverState.consecutiveSshFailures >= 2 && serverState.reachable) {
            serverState.reachable = false
            serverState.networkDownSince = new Date().toISOString()
            console.log(`[watchdog] ${serverName}: network down`)
            logEvent(createEvent("network_down", "critical", { server: serverName }))
            await alertDiscord("critical", serverName, "network_down",
              `Cannot reach ${serverName} via SSH. Remote agents may be offline.`,
              state, config)
          }
        } else {
          if (!serverState.reachable) {
            serverState.reachable = true
            serverState.consecutiveSshFailures = 0
            console.log(`[watchdog] ${serverName}: network restored`)
            logEvent(createEvent("network_restored", "info", { server: serverName }))
          }
          serverState.consecutiveSshFailures = 0

          const pct = diskResult.details.pct as number | undefined
          if (pct !== undefined) {
            serverState.lastDiskPct = pct
            if (pct >= 95) {
              await alertDiscord("critical", serverName, "disk_critical",
                `Disk usage at ${pct}% on ${serverName}. Agents may fail.`,
                state, config)
            } else if (pct >= 90) {
              await alertDiscord("warn", serverName, "disk_warning",
                `Disk usage at ${pct}% on ${serverName}. Consider cleanup.`,
                state, config)
            }
          }
        }
      }
      lastDiskCheck = now
    }

    // ── Patch check ──────────────────────────────────────────────────────
    if (now - lastPatchCheck > config.intervals.patchCheck * 1000) {
      try {
        const { patch } = await import("../commands/patch")
        await patch({ json: true })
      } catch { /* ignore: patching is optional maintenance */ }
      lastPatchCheck = now
    }

    // ── Save state and sleep ─────────────────────────────────────────────
    saveState(state)

    if (config.verbose) {
      const online = agents.filter(([name]) => {
        const as = state.agents[name]
        return as && as.consecutiveFailures === 0
      }).length
      console.log(`[watchdog] tick — ${online}/${agents.length} healthy`)
    }

    } catch (err) {
      console.error(`[watchdog] Unhandled error in daemon loop: ${err instanceof Error ? err.message : err}`)
      logEvent(createEvent("watchdog_stop", "critical", { details: { error: err instanceof Error ? err.message : String(err) } }))
      saveState(state)
    }

    await Bun.sleep(config.intervals.localHeartbeat * 1000)
  }
}
