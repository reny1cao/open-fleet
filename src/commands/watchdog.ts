import { runDaemon } from "../watchdog/daemon"
import type { WatchdogConfig } from "../watchdog/types"
import { DEFAULT_CONFIG } from "../watchdog/types"

export async function watchdog(opts: {
  interval?: number
  dryRun?: boolean
  verbose?: boolean
  noAlert?: boolean
}): Promise<void> {
  const config: WatchdogConfig = {
    ...DEFAULT_CONFIG,
    dryRun: opts.dryRun ?? false,
    verbose: opts.verbose ?? false,
    noAlert: opts.noAlert ?? false,
  }

  if (opts.interval) {
    config.intervals.localHeartbeat = opts.interval
  }

  await runDaemon(config)
}
