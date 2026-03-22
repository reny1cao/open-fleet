import { findConfigDir, loadConfig } from "../core/config"
import { start } from "./start"

interface ApplyResult {
  name: string
  outcome: "started" | "already_running" | "failed"
  error?: string
}

export async function apply(opts: { json?: boolean }): Promise<void> {
  // 1. Load config
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const results: ApplyResult[] = []

  // 2. For each agent: call start(name, { wait: true }), catch errors
  for (const name of Object.keys(config.agents)) {
    try {
      // Capture stdout to detect "already running" vs fresh start
      // We rely on start() printing "already running" when the session exists;
      // start() returns without throwing in that case too.
      // We need to distinguish — patch: check if it was running before calling start.
      const { TmuxLocal } = await import("../runtime/tmux")
      const { sessionName } = await import("../core/config")
      const runtime = new TmuxLocal()
      const session = sessionName(config.fleet.name, name)
      const wasRunning = await runtime.isRunning(session)

      await start(name, { wait: true })

      if (wasRunning) {
        results.push({ name, outcome: "already_running" })
      } else {
        results.push({ name, outcome: "started" })
      }
    } catch (err) {
      results.push({
        name,
        outcome: "failed",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 3. Print summary
  if (opts.json) {
    // 4. If --json: output structured JSON
    const summary = {
      started: results.filter((r) => r.outcome === "started").length,
      already_running: results.filter((r) => r.outcome === "already_running").length,
      failed: results.filter((r) => r.outcome === "failed").length,
      agents: results,
    }
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  const started = results.filter((r) => r.outcome === "started")
  const alreadyRunning = results.filter((r) => r.outcome === "already_running")
  const failed = results.filter((r) => r.outcome === "failed")

  console.log(
    `Apply complete: ${started.length} started, ${alreadyRunning.length} already running, ${failed.length} failed`
  )

  if (alreadyRunning.length > 0) {
    console.log(`  Already running: ${alreadyRunning.map((r) => r.name).join(", ")}`)
  }

  if (failed.length > 0) {
    console.log("  Failed:")
    for (const r of failed) {
      console.log(`    ${r.name}: ${r.error}`)
    }
  }
}
