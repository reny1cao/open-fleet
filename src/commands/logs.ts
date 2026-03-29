import { findConfigDir, loadConfig, sessionName } from "../core/config"
import { resolveRuntime } from "../runtime/resolve"
import type { RuntimeAdapter } from "../runtime/types"

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

async function captureOne(
  name: string,
  config: any,
  lineCount: number,
): Promise<LogEntry> {
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

  return { agent: name, lines, timestamp: new Date().toISOString() }
}

async function captureLogs(
  agentNames: string[],
  config: any,
  lineCount: number,
  json?: boolean,
): Promise<void> {
  // Parallel capture for all agents (fix #2: avoid sequential SSH round-trips)
  const results = await Promise.all(
    agentNames.map(name => captureOne(name, config, lineCount))
  )

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
  const seen = new Map<string, string[]>()

  // Pre-resolve runtimes (fix #3: don't recreate every poll iteration)
  const runtimes = new Map<string, { runtime: RuntimeAdapter; session: string }>()
  for (const name of agentNames) {
    runtimes.set(name, {
      runtime: resolveRuntime(name, config),
      session: sessionName(config.fleet.name, name),
    })
  }

  // Initial capture
  for (const name of agentNames) {
    const { runtime, session } = runtimes.get(name)!
    try {
      const running = await runtime.isRunning(session)
      if (running) {
        const output = await runtime.captureOutput(session, lineCount)
        const lines = output.split("\n")
        seen.set(name, lines)

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
  const pollInterval = 1000
  while (true) {
    await Bun.sleep(pollInterval)

    for (const name of agentNames) {
      const { runtime, session } = runtimes.get(name)!

      try {
        const running = await runtime.isRunning(session)
        if (!running) continue

        const output = await runtime.captureOutput(session, lineCount)
        const currentLines = output.split("\n")
        const previousLines = seen.get(name) ?? []

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
 * Matches the longest contiguous suffix of `prev` in `current`,
 * then returns everything after that overlap.
 *
 * Fix: uses suffix matching instead of single last-line anchor
 * to handle repeated lines correctly.
 */
export function diffLines(prev: string[], current: string[]): string[] {
  if (prev.length === 0) return current

  const prevClean = prev.filter(l => l.trim() !== "")
  const currClean = current.filter(l => l.trim() !== "")

  if (prevClean.length === 0) return currClean
  if (currClean.length === 0) return []

  // Find the longest suffix of prevClean that appears contiguously in currClean
  // Try matching suffixes of decreasing length
  for (let suffixLen = Math.min(prevClean.length, currClean.length); suffixLen > 0; suffixLen--) {
    const suffix = prevClean.slice(prevClean.length - suffixLen)

    // Search for this suffix in currClean
    for (let start = 0; start <= currClean.length - suffixLen; start++) {
      let match = true
      for (let j = 0; j < suffixLen; j++) {
        if (currClean[start + j] !== suffix[j]) {
          match = false
          break
        }
      }
      if (match) {
        // Found the suffix at position `start` in currClean
        // Everything after start + suffixLen is new
        return currClean.slice(start + suffixLen)
      }
    }
  }

  // No overlap found — all lines are new
  return currClean
}
