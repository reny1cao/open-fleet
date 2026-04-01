import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import type { FleetConfig } from "./types"

function isManager(agentName: string, config: FleetConfig): boolean {
  return config.structure?.lead === agentName
}

/**
 * Build the fixed identity prompt (loaded once via --append-system-prompt-file).
 * Contains: name, role, rules, formatting. Does NOT contain team roster —
 * roster lives in CLAUDE.md for dynamic updates.
 */
export function buildIdentityPrompt(
  agentName: string,
  config: FleetConfig,
  botIds: Record<string, string>,
  displayNames?: Record<string, string>,
): string {
  const agentDef = config.agents[agentName]
  const botId = botIds[agentName] ?? "unknown"
  const myDisplayName = displayNames?.[agentName] ?? agentName

  const lines: string[] = []

  lines.push(`You are **${myDisplayName}** (${agentName}), a ${agentDef.role} in the fleet. Bot ID \`${botId}\`.`)
  lines.push("")

  lines.push("## Role")
  lines.push(agentDef.role)
  lines.push("")

  // Only show channels this agent is scoped to
  const myChannels = agentDef.channels
  lines.push("## Channels")
  for (const [label, ch] of Object.entries(config.discord.channels)) {
    if (myChannels && !myChannels.includes(label)) continue
    const ws = ch.workspace ? ` — workspace: ${ch.workspace}` : ""
    lines.push(`- **#${label}** (channel \`${ch.id}\`)${ws}`)
  }
  lines.push("")
  lines.push("When you receive a message, check which channel it came from. Work in the corresponding workspace directory.")
  lines.push("")

  lines.push("## Rules")
  lines.push("- **Always reply via Discord reply tool** — terminal output does not reach Discord")
  lines.push("")

  lines.push("## How to Collaborate")
  lines.push("")
  lines.push("**When you receive a message:**")
  lines.push("Immediately react with an emoji or short reply (\"On it\", \"Looking into this\"). The sender needs to know you received the message. Never start working silently.")
  lines.push("")
  lines.push("**When you finish a task:**")
  lines.push("Reply with the result. Be concise — conclusions first, details after.")
  lines.push("")
  lines.push("**When you can't do something:**")
  lines.push("Say so immediately. State what went wrong and what you need. Don't go silent on failure.")
  lines.push("")
  lines.push("**When you need a teammate:**")
  lines.push("@mention them directly — without @mention they won't receive the message. Include: what you need, what format you expect. Keep it concise — their context is limited.")
  lines.push("")

  lines.push("## Task Workflow")
  lines.push("")
  lines.push("The fleet uses `fleet task` for task tracking. Tasks survive compaction and restarts.")
  lines.push("")
  lines.push("**On startup:** Your active tasks are injected into your context at boot. Run `fleet task list --mine` to refresh if needed.")
  lines.push("")
  lines.push("**When you receive a task assignment:**")
  lines.push("```")
  lines.push("fleet task update <task-id> --status in_progress")
  lines.push("```")
  lines.push("")
  lines.push("**When you finish a task:**")
  lines.push("```")
  lines.push('fleet task update <task-id> --status done --result \'{"summary":"what you did","commits":["abc123"]}\'')
  lines.push("```")
  lines.push("")
  lines.push("**When you're stuck:**")
  lines.push("```")
  lines.push('fleet task update <task-id> --status blocked --reason "why you are blocked"')
  lines.push("```")
  lines.push("")
  lines.push("**To see the full team board:** `fleet task board`")
  lines.push("**To see task details:** `fleet task show <task-id>`")
  lines.push("")

  if (isManager(agentName, config)) {
    lines.push("## Fleet Management")
    lines.push("")
    lines.push("You are the team coordinator. Use the `/fleet` skill for all fleet operations (start/stop agents, check status, diagnose issues, inject roles).")
    lines.push("")
    lines.push("**Your responsibilities:**")
    lines.push("- When you receive a task from the user, decide: handle it yourself (simple) or delegate to a teammate")
    lines.push("- If delegating, @mention the teammate with clear instructions")
    lines.push("- If a teammate doesn't respond, use `/fleet` to check if they're online and start them if needed")
    lines.push("- You may suggest adding agents or changing roles to the user, but don't execute without their approval")
    lines.push("")
  }

  lines.push("## Discord Formatting")
  lines.push("- Do NOT use markdown tables — Discord doesn't render them")
  lines.push("- Do NOT use HTML tags or image syntax")
  lines.push("- OK to use: **bold**, *italic*, `code`, ```code blocks```, > quotes, - lists, # headings")
  lines.push("- @mention teammates using the mention syntax from your roster in CLAUDE.md")
  lines.push("- Max 2000 chars per message — split longer messages")

  return lines.join("\n")
}

/**
 * Build the dynamic roster CLAUDE.md content.
 * This file is placed in each agent's stateDir/.claude/CLAUDE.md and is
 * re-read by Claude Code on every turn — so updates are picked up live.
 */
export function buildRosterClaudeMd(
  agentName: string,
  config: FleetConfig,
  botIds: Record<string, string>,
  displayNames?: Record<string, string>,
): string {
  const lines: string[] = []
  const myDef = config.agents[agentName]
  const myChannels = myDef?.channels
  const myDisplayName = displayNames?.[agentName] ?? agentName
  const isLead = myDef?.role === "lead"

  lines.push("# Fleet Team Roster")
  lines.push("")
  lines.push(`You are **${myDisplayName}** (${agentName}).`)
  lines.push("")

  // Show which channels this agent operates in
  if (myChannels) {
    lines.push("## Your channels")
    for (const ch of myChannels) {
      const chDef = config.discord.channels[ch]
      if (chDef) {
        const ws = chDef.workspace ? ` — workspace: ${chDef.workspace}` : ""
        lines.push(`- **#${ch}** (channel \`${chDef.id}\`)${ws}`)
      }
    }
    lines.push("")
  }

  // Collect visible peers (share at least one channel)
  const teamMembers: Array<{ name: string; def: typeof myDef; peerId: string; peerDisplay: string }> = []
  const otherLeads: typeof teamMembers = []

  for (const [name, def] of Object.entries(config.agents)) {
    if (name === agentName) continue
    const peerChannels = def.channels
    if (myChannels && peerChannels) {
      const shared = myChannels.some(ch => peerChannels.includes(ch))
      if (!shared) continue
    }
    const peerId = botIds[name] ?? "unknown"
    const peerDisplay = displayNames?.[name] ?? name
    const entry = { name, def, peerId, peerDisplay }

    // Separate team members from other leads
    if (def.role === "lead" && isLead) {
      otherLeads.push(entry)
    } else {
      teamMembers.push(entry)
    }
  }

  // Show team members
  if (teamMembers.length > 0) {
    lines.push(isLead ? "## Your team" : "## Your teammates")
    for (const { name, def, peerId, peerDisplay } of teamMembers) {
      lines.push(`- **${peerDisplay}** (${name}) — ${def.role} — mention: \`<@${peerId}>\``)
    }
    lines.push("")
  }

  // Show other leads (only visible to leads)
  if (otherLeads.length > 0) {
    lines.push("## Other leads")
    for (const { name, def, peerId, peerDisplay } of otherLeads) {
      // Figure out which channels the other lead manages
      const theirChannels = def.channels?.filter(ch => !myChannels?.includes(ch)) ?? []
      const scope = theirChannels.length > 0 ? ` — leads #${theirChannels.join(", #")}` : ""
      lines.push(`- **${peerDisplay}** (${name})${scope} — mention: \`<@${peerId}>\``)
    }
    lines.push("")
  }

  if (teamMembers.length === 0 && otherLeads.length === 0) {
    lines.push("(no teammates yet)")
    lines.push("")
  }

  // How to work
  lines.push("## How to work")
  lines.push("- **All communication happens via Discord** — use the reply tool to send messages")
  lines.push("- **@mention to reach someone** — without @mention they won't see your message. Use the mention syntax from the roster above")
  lines.push("- **Ack immediately** — when you receive a task, react or reply right away so the sender knows you're on it")
  lines.push("- **Report results via Discord** — your terminal output is invisible to others")
  if (isLead) {
    lines.push("")
    lines.push("**As a lead:**")
    lines.push("- Break down tasks and delegate to your team members")
    lines.push("- Only @mention agents listed above — other teams have their own lead")
    lines.push("- If a task belongs to another team, @mention their lead in #command")
    lines.push("- Verify results before reporting back to the user")
    lines.push("- Create tasks: `fleet task create \"title\" --assign Agent-Name --priority high --workspace ~/path`")
    lines.push("- Track progress: `fleet task board` and `fleet task recap --since 2h`")
    lines.push("- Reassign if needed: `fleet task update <id> --assign New-Agent`")
  } else {
    lines.push("")
    lines.push("**As a worker:**")
    lines.push("- You receive tasks from your lead — complete them and reply with results")
    lines.push("- If you need help, @mention a teammate or your lead")
    lines.push("- When done, reply with: what you did, what files changed, and whether it works")
    lines.push("- Always update task status: `fleet task update <id> --status in_progress` when starting, `--status done --result '...'` when finished")
  }

  return lines.join("\n")
}

/**
 * Write the fixed identity prompt to {stateDir}/identity.md.
 */
export function writeBootIdentity(
  agentName: string,
  config: FleetConfig,
  botIds: Record<string, string>,
  stateDir: string,
  displayNames?: Record<string, string>,
): void {
  mkdirSync(stateDir, { recursive: true })
  const content = buildIdentityPrompt(agentName, config, botIds, displayNames)
  writeFileSync(join(stateDir, "identity.md"), content, "utf8")
}

/**
 * Write the dynamic roster to {stateDir}/.claude/CLAUDE.md.
 * Claude Code re-reads this file every turn, so changes take effect immediately.
 */
export function writeRoster(
  agentName: string,
  config: FleetConfig,
  botIds: Record<string, string>,
  stateDir: string,
  displayNames?: Record<string, string>,
): void {
  const claudeDir = join(stateDir, ".claude")
  mkdirSync(claudeDir, { recursive: true })
  const content = buildRosterClaudeMd(agentName, config, botIds, displayNames)
  writeFileSync(join(claudeDir, "CLAUDE.md"), content, "utf8")
}

/**
 * Update the roster CLAUDE.md for ALL agents in the fleet.
 * Called after add-agent so running agents pick up new teammates.
 */
export function updateAllRosters(
  config: FleetConfig,
  botIds: Record<string, string>,
  resolveStateDirFn: (name: string, config: FleetConfig) => string
): void {
  for (const name of Object.keys(config.agents)) {
    const stateDir = resolveStateDirFn(name, config)
    writeRoster(name, config, botIds, stateDir)
  }
}

/**
 * Read the role overlay markdown for a given role name.
 * Returns the file content, or null if the file doesn't exist.
 */
export function readRoleOverlay(roleName: string, fleetDir: string): string | null {
  const filePath = join(fleetDir, "identities", "roles", `${roleName}.md`)
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, "utf8")
}

