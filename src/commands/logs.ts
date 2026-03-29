import { findConfigDir, loadConfig, sessionName } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"

interface LogEntry {
  agent: string
  lines: string[]
  timestamp: string
}

export async function logs(
  agentName: string | undefined,
  opts: { lines?: number; all?: boolean; follow?: boolean; json?: boolean } = {},
): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)
  const lineCount = opts.lines ?? 50

  // Determine which agents to capture
  const agentNames: string[] = []
  if (opts.all) {
    agentNames.push(...Object.keys(config.agents))
  } else if (agentName) {
    if (!config.agents[agentName]) {
      throw new Error(`Agent "${agentName}" not found in fleet config`)
    }
    agentNames.push(agentName)
  } else {
    throw new Error("Usage: fleet logs <agent> [--lines N] [--follow] [--json]\n       fleet logs --all [--lines N] [--json]")
  }

  if (opts.follow) {
    await followLogs(agentNames, config, lineCount, opts.json)
  } else {
    await captureLogs(agentNames, config, lineCount, opts.json)
  }
}

async function captureLogs(
  agentNames: string[],
  config: any,
  lineCount: number,
  json?: boolean,
): Promise<void> {
  const results: LogEntry[] = []

  for (const name of agentNames) {
    const session = sessionName(config.fleet.name, name)
    const runtime = resolveRuntime(name, config)

    let lines: string[] = []
    try {
      const running = await runtime.isRunning(session)
      if (!running) {
        lines = [`[session not running]`]
      } else {
        const output = await runtime.captureOutput(session, lineCount)
        lines = output.split("\n")
      }
    } catch (err) {
      lines = [`[error: ${err instanceof Error ? err.message : err}]`]
    }

    results.push({
      agent: name,
      lines,
      timestamp: new Date().toISOString(),
    })
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // Formatted output
  const multiAgent = agentNames.length > 1
  for (const entry of results) {
    if (multiAgent) {
      console.log(`\n\x1b[36m━━━ ${entry.agent} ━━━\x1b[0m`)
    }
    for (const line of entry.lines) {
      if (multiAgent) {
        console.log(`\x1b[90m${entry.agent.padEnd(16)}\x1b[0m ${line}`)
      } else {
        console.log(line)
      }
    }
  }
}

async function followLogs(
  agentNames: string[],
  config: any,
  lineCount: number,
  json?: boolean,
): Promise<void> {
  // Track previously seen content to only show new lines
  const seen = new Map<string, string[]>()

  // Initial capture
  for (const name of agentNames) {
    const session = sessionName(config.fleet.name, name)
    const runtime = resolveRuntime(name, config)
    try {
      const running = await runtime.isRunning(session)
      if (running) {
        const output = await runtime.captureOutput(session, lineCount)
        const lines = output.split("\n")
        seen.set(name, lines)

        // Print initial output
        if (json) {
          console.log(JSON.stringify({ agent: name, lines, timestamp: new Date().toISOString() }))
        } else {
          const prefix = agentNames.length > 1 ? `\x1b[90m${name.padEnd(16)}\x1b[0m ` : ""
          for (const line of lines) {
            console.log(`${prefix}${line}`)
          }
        }
      }
    } catch {
      // Skip agents we can't reach
    }
  }

  // Poll loop
  const pollInterval = 1000 // 1 second
  while (true) {
    await Bun.sleep(pollInterval)

    for (const name of agentNames) {
      const session = sessionName(config.fleet.name, name)
      const runtime = resolveRuntime(name, config)

      try {
        const running = await runtime.isRunning(session)
        if (!running) continue

        const output = await runtime.captureOutput(session, lineCount)
        const currentLines = output.split("\n")
        const previousLines = seen.get(name) ?? []

        // Find new lines by comparing against previous capture
        const newLines = diffLines(previousLines, currentLines)
        if (newLines.length > 0) {
          seen.set(name, currentLines)
          if (json) {
            console.log(JSON.stringify({ agent: name, lines: newLines, timestamp: new Date().toISOString() }))
          } else {
            const prefix = agentNames.length > 1 ? `\x1b[90m${name.padEnd(16)}\x1b[0m ` : ""
            for (const line of newLines) {
              console.log(`${prefix}${line}`)
            }
          }
        }
      } catch {
        // Skip unreachable agents
      }
    }
  }
}

/**
 * Find new lines by comparing previous and current captures.
 * Looks for the longest suffix of `prev` that appears in `current`,
 * then returns everything after that overlap.
 */
export function diffLines(prev: string[], current: string[]): string[] {
  if (prev.length === 0) return current

  // Filter out empty trailing lines for comparison
  const prevClean = prev.filter(l => l.trim() !== "")
  const currClean = current.filter(l => l.trim() !== "")

  if (prevClean.length === 0) return currClean
  if (currClean.length === 0) return []

  // Find the longest matching overlap
  const lastPrev = prevClean[prevClean.length - 1]
  let overlapEnd = -1
  for (let i = currClean.length - 1; i >= 0; i--) {
    if (currClean[i] === lastPrev) {
      overlapEnd = i
      break
    }
  }

  if (overlapEnd === -1) {
    // No overlap found — all lines are new
    return currClean
  }

  // Return lines after the overlap point
  return currClean.slice(overlapEnd + 1)
}
