import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import type { FleetConfig } from "./types"

/**
 * Build the identity prompt string for a given agent.
 */
export function buildIdentityPrompt(
  agentName: string,
  config: FleetConfig,
  botIds: Record<string, string>
): string {
  const agentDef = config.agents[agentName]
  const botId = botIds[agentName] ?? "unknown"
  const channelId = config.discord.channelId

  const lines: string[] = []

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(`You are **${agentName}**, a ${agentDef.role} in the fleet. Bot ID \`${botId}\`.`)
  lines.push("")

  // ── Role ────────────────────────────────────────────────────────────────────
  lines.push("## Role")
  lines.push(agentDef.role)
  lines.push("")

  // ── Team ────────────────────────────────────────────────────────────────────
  lines.push("## Team")
  for (const [name, def] of Object.entries(config.agents)) {
    if (name === agentName) continue
    const peerId = botIds[name] ?? "unknown"
    lines.push(`- ${name} (\`${peerId}\`) — ${def.server} — ${def.role}`)
  }
  lines.push("")

  // ── Channel ─────────────────────────────────────────────────────────────────
  lines.push("## Channel")
  lines.push(`- Channel ID: \`${channelId}\``)
  lines.push("")

  // ── Rules ───────────────────────────────────────────────────────────────────
  lines.push("## Rules")
  lines.push("- Always reply via Discord reply tool")
  lines.push("- Report concisely, conclusions first")
  lines.push("- Acknowledge receipt before starting work")
  lines.push("")

  // ── Discord Formatting ──────────────────────────────────────────────────────
  lines.push("## Discord Formatting")
  lines.push("- Do NOT use markdown tables")
  lines.push("- No HTML tags or image syntax")
  lines.push("- OK to use: bold, italic, code, code blocks, quotes, lists, headings")
  lines.push("- @mention with `<@BOT_ID>`")
  lines.push("- Max 2000 chars per message")

  return lines.join("\n")
}

/**
 * Write the identity prompt to {stateDir}/identity.md, creating the directory
 * if it does not exist.
 */
export function writeBootIdentity(
  agentName: string,
  config: FleetConfig,
  botIds: Record<string, string>,
  stateDir: string
): void {
  mkdirSync(stateDir, { recursive: true })
  const content = buildIdentityPrompt(agentName, config, botIds)
  writeFileSync(join(stateDir, "identity.md"), content, "utf8")
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
