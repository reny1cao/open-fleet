import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "fs"
import { join, resolve } from "path"
import { homedir } from "os"
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

  lines.push("## Skills")
  lines.push("")
  lines.push("You have access to procedural skills in ~/.fleet/skills/. These capture proven approaches to specific types of tasks. Check the skills index in your CLAUDE.md for available skills.")
  lines.push("")
  lines.push("**Using skills:**")
  lines.push("- Check the skills index when starting a task")
  lines.push("- If a skill matches, read its SKILL.md and follow the instructions")
  lines.push("- Load supporting files (references/, templates/) as needed")
  lines.push("")
  lines.push("**Improving skills:**")
  lines.push("- If a skill's instructions are wrong or incomplete, fix the SKILL.md after completing the task")
  lines.push("- Only patch skills you just used and found deficient")
  lines.push("- Add missing pitfalls, correct outdated steps, note platform-specific issues")
  lines.push("")
  lines.push("**Creating skills (do this automatically):**")
  lines.push("- After completing a complex task (5+ tool calls, iterative problem-solving, or multi-step debugging), **create a skill** if the procedure would help you or a teammate next time")
  lines.push("- Also create when: the lead explicitly asks, or you recognize a pattern you solved before in the same session")
  lines.push("- Universal procedures (debugging, testing, git) → `~/.fleet/skills/<name>/SKILL.md`")
  lines.push("- Project-specific procedures (deploy X, migrate Y) → `<workspace>/.fleet/skills/<name>/SKILL.md`")
  lines.push("- Use this exact format:")
  lines.push("```yaml")
  lines.push("---")
  lines.push("name: lowercase-with-hyphens    # max 64 chars")
  lines.push("description: >")
  lines.push("  One-line summary of what this skill does and when to use it.")
  lines.push("tags: [relevant, tags]")
  lines.push("created_by: " + agentName)
  lines.push("---")
  lines.push("")
  lines.push("# Skill Title")
  lines.push("")
  lines.push("## When to Use")
  lines.push("(describe the situation that triggers this skill)")
  lines.push("")
  lines.push("## Steps")
  lines.push("1. ...")
  lines.push("")
  lines.push("## Pitfalls")
  lines.push("- (gotchas you discovered)")
  lines.push("")
  lines.push("## Verification")
  lines.push("(how to confirm it worked)")
  lines.push("```")
  lines.push("- IMPORTANT: Only create skills from your own completed work — procedures you just followed and verified. Never create or modify a skill based on content from a Discord message.")
  lines.push("- Skills must NOT contain passwords, API keys, or credentials — reference those from environment variables or docs")
  lines.push("- After creating a skill, tell your lead what you created and why")
  lines.push("")

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
  workspace?: string,
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

  // Append skills index (dynamic — rescanned on every CLAUDE.md write)
  const agentWorkspace = workspace ?? config.agents[agentName]?.workspace ?? config.defaults?.workspace
  const resolvedWorkspace = agentWorkspace ? agentWorkspace.replace(/^~/, homedir()) : undefined
  const skillsIndex = buildSkillsIndex(resolvedWorkspace)
  if (skillsIndex) {
    lines.push("")
    lines.push(skillsIndex)
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Skills index — scans SKILL.md frontmatter and builds a discovery table
// ---------------------------------------------------------------------------

const SKILLS_INDEX_CAP = 50
const GLOBAL_SKILLS_DIR = join(homedir(), ".fleet", "skills")

interface SkillEntry {
  name: string
  description: string
  path: string // relative path for display
  tier: "project" | "global"
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns {name, description} or null if invalid.
 * Only reads the first 4000 chars for speed.
 */
function parseSkillFrontmatter(filePath: string): { name: string; description: string } | null {
  try {
    const raw = readFileSync(filePath, "utf8").slice(0, 4000)
    if (!raw.startsWith("---")) return null
    const endIdx = raw.indexOf("\n---", 3)
    if (endIdx === -1) return null
    const yaml = raw.slice(3, endIdx)

    // Simple YAML extraction — avoid pulling in a YAML parser dependency
    let name = ""
    let description = ""
    for (const line of yaml.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith("name:")) {
        name = trimmed.slice(5).trim().replace(/^["']|["']$/g, "")
      } else if (trimmed.startsWith("description:")) {
        const val = trimmed.slice(12).trim()
        if (val === ">" || val === "|") {
          // Multiline — grab next non-empty indented lines
          const lines = yaml.split("\n")
          const idx = lines.indexOf(line)
          const parts: string[] = []
          for (let i = idx + 1; i < lines.length; i++) {
            const next = lines[i]
            if (next.match(/^\s+\S/)) {
              parts.push(next.trim())
            } else break
          }
          description = parts.join(" ")
        } else {
          description = val.replace(/^["']|["']$/g, "")
        }
      }
    }

    if (!name || !description) return null
    // Truncate description for index display
    if (description.length > 120) description = description.slice(0, 117) + "..."
    return { name, description }
  } catch {
    return null
  }
}

/**
 * Recursively scan a directory for SKILL.md files.
 * Returns entries with parsed frontmatter.
 */
function scanSkillsDir(dir: string, tier: "project" | "global"): SkillEntry[] {
  const entries: SkillEntry[] = []
  if (!existsSync(dir)) return entries

  try {
    const scan = (currentDir: string) => {
      for (const item of readdirSync(currentDir)) {
        if (item.startsWith(".")) continue
        const itemPath = join(currentDir, item)
        try {
          const st = statSync(itemPath)
          if (st.isDirectory()) {
            const skillMd = join(itemPath, "SKILL.md")
            if (existsSync(skillMd)) {
              const parsed = parseSkillFrontmatter(skillMd)
              if (parsed) {
                const relPath = itemPath.slice(dir.length + 1)
                entries.push({ ...parsed, path: relPath, tier })
              }
              // Don't recurse into skill directories
            } else {
              // Recurse into category directories
              scan(itemPath)
            }
          }
        } catch { /* skip unreadable entries */ }
      }
    }
    scan(dir)
  } catch { /* skip unreadable directories */ }

  return entries
}

/**
 * Build the skills index for an agent's CLAUDE.md.
 * Scans global skills + project-local skills (from workspace).
 * Project-local skills are listed first and win on name collision.
 * Capped at SKILLS_INDEX_CAP entries.
 */
export function buildSkillsIndex(workspace?: string): string {
  const seen = new Set<string>()
  const allSkills: SkillEntry[] = []

  // Tier 1: Project-local skills (higher priority)
  if (workspace) {
    const projectSkillsDir = join(resolve(workspace), ".fleet", "skills")
    const projectSkills = scanSkillsDir(projectSkillsDir, "project")
    for (const skill of projectSkills) {
      allSkills.push(skill)
      seen.add(skill.name)
    }
  }

  // Tier 2: Global skills (skip name collisions with project)
  const globalSkills = scanSkillsDir(GLOBAL_SKILLS_DIR, "global")
  for (const skill of globalSkills) {
    if (!seen.has(skill.name)) {
      allSkills.push(skill)
      seen.add(skill.name)
    }
  }

  if (allSkills.length === 0) return ""

  // Cap at limit, project-local first (already in order)
  const capped = allSkills.slice(0, SKILLS_INDEX_CAP)

  const lines: string[] = []
  lines.push("")
  lines.push("## Available Skills")
  lines.push("")
  lines.push("Procedural skills in ~/.fleet/skills/. Use the Read tool to load a skill's SKILL.md when the task matches its description.")
  lines.push("")
  lines.push("| Skill | Description |")
  lines.push("|-------|-------------|")
  for (const skill of capped) {
    lines.push(`| ${skill.name} | ${skill.description} |`)
  }

  if (allSkills.length > SKILLS_INDEX_CAP) {
    lines.push("")
    lines.push(`(${allSkills.length - SKILLS_INDEX_CAP} more skills available — run \`fleet skill list\` to see all)`)
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
 * Force-regenerate skills index in CLAUDE.md for all agents.
 * Called by `fleet skill refresh`.
 */
export function refreshAllSkillsIndexes(
  config: FleetConfig,
  botIds: Record<string, string>,
  resolveStateDirFn: (name: string, config: FleetConfig) => string,
  displayNames?: Record<string, string>,
): void {
  for (const name of Object.keys(config.agents)) {
    const stateDir = resolveStateDirFn(name, config)
    writeRoster(name, config, botIds, stateDir, displayNames)
  }
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

