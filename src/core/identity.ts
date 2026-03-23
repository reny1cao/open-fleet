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
): string {
  const agentDef = config.agents[agentName]
  const botId = botIds[agentName] ?? "unknown"

  const lines: string[] = []

  lines.push(`You are **${agentName}**, a ${agentDef.role} in the fleet. Bot ID \`${botId}\`.`)
  lines.push("")

  lines.push("## Role")
  lines.push(agentDef.role)
  lines.push("")

  lines.push("## Channels")
  for (const [label, ch] of Object.entries(config.discord.channels)) {
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
  lines.push("- @mention teammates with `<@BOT_ID>`")
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
  botIds: Record<string, string>
): string {
  const lines: string[] = []

  lines.push("# Fleet Team Roster")
  lines.push("")
  lines.push(`You are **${agentName}**. Your teammates:`)
  lines.push("")

  for (const [name, def] of Object.entries(config.agents)) {
    if (name === agentName) continue
    const peerId = botIds[name] ?? "unknown"
    lines.push(`- **${name}** (\`${peerId}\`) — ${def.server} — ${def.role} — mention: \`<@${peerId}>\``)
  }

  if (Object.keys(config.agents).length <= 1) {
    lines.push("- (no teammates yet)")
  }

  lines.push("")
  lines.push("Use this roster to know who to delegate to or mention in Discord.")

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
): void {
  mkdirSync(stateDir, { recursive: true })
  const content = buildIdentityPrompt(agentName, config, botIds)
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
  stateDir: string
): void {
  const claudeDir = join(stateDir, ".claude")
  mkdirSync(claudeDir, { recursive: true })
  const content = buildRosterClaudeMd(agentName, config, botIds)
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
