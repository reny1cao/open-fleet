/**
 * Activity event parser — extracts meaningful events from Claude Code tmux output.
 * Strips noise (ANSI codes, progress bars, blank lines, prompts) and classifies
 * each event by type for the fleet watch activity feed.
 */

export type ActivityType =
  | "discord_in"     // Incoming Discord message
  | "discord_out"    // Outgoing Discord reply/react
  | "bash"           // Shell command
  | "file_op"        // Read/Write/Edit/Glob/Grep
  | "git"            // Git commit/push/pull
  | "test"           // Test run
  | "thinking"       // Agent thinking/working
  | "complete"       // Task completed
  | "error"          // Error
  | "other"          // Unclassified meaningful line

export interface ActivityEvent {
  type: ActivityType
  summary: string       // Short human-readable description
  agent: string         // Agent name
  raw: string           // Original line (cleaned)
  seq: number           // Global sequence for chronological ordering
}

// ANSI escape code stripper
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g

// Global sequence counter for chronological ordering across agents
let _seqCounter = 0

/** Reset sequence counter (for testing). */
export function resetSequence(): void { _seqCounter = 0 }

/**
 * Parse tmux output lines into meaningful activity events.
 * Filters noise and classifies each event. Events are tagged with
 * a global sequence number for chronological interleaving.
 */
export function parseActivity(agent: string, rawLines: string[]): ActivityEvent[] {
  const events: ActivityEvent[] = []

  for (const rawLine of rawLines) {
    const line = rawLine.replace(ANSI_RE, "").trim()
    if (!line) continue

    // Skip noise
    if (isNoise(line)) continue

    const event = classify(agent, line)
    if (event) {
      event.seq = _seqCounter++
      events.push(event)
    }
  }

  return events
}

/**
 * Extract the last N meaningful events from tmux output.
 */
export function extractRecentActivity(agent: string, rawLines: string[], maxEvents: number = 10): ActivityEvent[] {
  const events = parseActivity(agent, rawLines)
  return events.slice(-maxEvents)
}

function isNoise(line: string): boolean {
  // Blank or whitespace-only
  if (!line || line.trim() === "") return true
  // Separator lines
  if (/^[─━═\-]{3,}$/.test(line)) return true
  // Prompt lines
  if (line === "❯" || line === ">") return true
  // Mode indicators
  if (line.startsWith("⏵")) return true
  // Continuation markers
  if (/^… \+\d+ lines/.test(line)) return true
  // "Shell cwd was reset" noise
  if (line.includes("Shell cwd was reset")) return true
  // Indented continuation of multi-line tool args
  if (/^\s{20,}/.test(line)) return true
  // Pure punctuation/brackets
  if (/^[⎿│├└┌┐┘┤┬┴┼\s]+$/.test(line)) return true
  return false
}

function classify(agent: string, line: string): ActivityEvent | null {
  // Incoming Discord message
  const discordIn = line.match(/^← discord · (.+?): (.+)/)
  if (discordIn) {
    const sender = discordIn[1]
    const msg = discordIn[2].substring(0, 60)
    return { type: "discord_in", summary: `${sender}: ${msg}`, agent, raw: line }
  }

  // Outgoing Discord reply
  if (line.startsWith("● plugin:discord:discord - reply")) {
    return { type: "discord_out", summary: "Sent Discord reply", agent, raw: line }
  }

  // Outgoing Discord react
  if (line.startsWith("● plugin:discord:discord - react")) {
    return { type: "discord_out", summary: "Reacted on Discord", agent, raw: line }
  }

  // Sent confirmation
  const sentMatch = line.match(/^⎿\s+sent \(id: (\d+)\)/)
  if (sentMatch) {
    return { type: "discord_out", summary: `Message sent`, agent, raw: line }
  }

  // Git operations
  const gitCommit = line.match(/● Bash\(.*git commit/)
  if (gitCommit) {
    return { type: "git", summary: "Git commit", agent, raw: line }
  }
  const gitPush = line.match(/● Bash\(.*git push/)
  if (gitPush) {
    return { type: "git", summary: "Git push", agent, raw: line }
  }
  const gitPull = line.match(/● Bash\(.*git pull/)
  if (gitPull) {
    return { type: "git", summary: "Git pull", agent, raw: line }
  }

  // Test runs
  const testRun = line.match(/● Bash\(.*(bun test|npm test|pytest|vitest)/)
  if (testRun) {
    return { type: "test", summary: `Running tests`, agent, raw: line }
  }

  // Test results
  const testResult = line.match(/(\d+)\s+(pass|passed)/)
  if (testResult) {
    return { type: "test", summary: `${testResult[1]} tests passed`, agent, raw: line }
  }

  // Bash commands (general)
  const bashCmd = line.match(/^● Bash\((.+?)[\)…]/)
  if (bashCmd) {
    const cmd = bashCmd[1].substring(0, 50)
    return { type: "bash", summary: `$ ${cmd}`, agent, raw: line }
  }

  // File operations
  if (/^● (Read|Write|Edit|Glob|Grep)\(/.test(line)) {
    const op = line.match(/^● (\w+)\((.+?)[\)…]/)?.[0] ?? line.substring(0, 50)
    return { type: "file_op", summary: op.substring(0, 60), agent, raw: line }
  }

  // Thinking/working/completion indicators (Unicode symbols: ✢ ✽ ✻ ●)
  const thinkMatch = line.match(/^[✢✽✻●] (Thinking|Doing|Unravelling|Improvising|Cooked)(.*)/)
  if (thinkMatch) {
    if (thinkMatch[1] === "Cooked") {
      return { type: "complete", summary: `${thinkMatch[1]}${thinkMatch[2]}`, agent, raw: line }
    }
    return { type: "thinking", summary: `${thinkMatch[1]}${thinkMatch[2]}`, agent, raw: line }
  }

  // Agent text output (starts with ●)
  if (line.startsWith("● ")) {
    return { type: "other", summary: line.substring(2, 62), agent, raw: line }
  }

  // Error lines
  if (/^Error:|^error:/i.test(line)) {
    return { type: "error", summary: line.substring(0, 60), agent, raw: line, seq: 0 }
  }

  // Agent output text — meaningful lines that didn't match specific patterns
  // Keep lines that look like agent prose (starts with letter/bullet, min length)
  if (line.length > 10 && /^[A-Za-z←→✓⎇●✢✽✻⎿]/.test(line)) {
    return { type: "other", summary: line.substring(0, 60), agent, raw: line, seq: 0 }
  }

  return null
}
