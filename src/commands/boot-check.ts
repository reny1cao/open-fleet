import { existsSync, readFileSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { findConfigDir, loadConfig, getToken, resolveStateDir } from "../core/config"
import { writeBootIdentity, writeRoster } from "../core/identity"
import { writeAccessConfig } from "../channel/discord/access"
import { DiscordApi } from "../channel/discord/api"
import { loadWikiSections, buildProjectWiki } from "../core/wiki"
import { resolvePluginPath, PLUGIN_CACHE_ROOT, PLUGIN_MARKETPLACE_ROOT } from "../core/claude-plugin"
import type { FleetConfig } from "../core/types"

export interface BootCheckResult {
  step: string
  status: "pass" | "fail" | "warn" | "fixed"
  message: string
}

// ── Plugin resolution (shared with doctor/patch) ────────────────────────────

// Plugin path resolution imported from ../core/claude-plugin

// ── Boot-check steps ────────────────────────────────────────────────────────

async function checkAndRegenerateAccess(
  agentName: string,
  config: FleetConfig,
  stateDir: string,
  botIds: Record<string, string>,
  log: (...args: unknown[]) => void,
): Promise<BootCheckResult> {
  const agentDef = config.agents[agentName]
  const partnerBotIds = Object.entries(botIds)
    .filter(([name]) => name !== agentName)
    .map(([, id]) => id)
    .filter((id) => id !== "UNKNOWN")

  const agentChannelScopes = agentDef.channels
  const scopedChannels = agentChannelScopes
    ? Object.fromEntries(
        Object.entries(config.discord.channels)
          .filter(([label]) => agentChannelScopes.includes(label))
      )
    : config.discord.channels

  writeAccessConfig(stateDir, {
    channels: scopedChannels,
    partnerBotIds,
    requireMention: true,
    userId: config.discord.userId,
  })

  const channelCount = Object.keys(scopedChannels).length
  return {
    step: "access.json",
    status: "fixed",
    message: `Regenerated from fleet.yaml (${channelCount} channels, ${partnerBotIds.length} partner bots)`,
  }
}

function checkPluginIntegrity(log: (...args: unknown[]) => void): BootCheckResult {
  const pluginPath = resolvePluginPath()
  if (!pluginPath) {
    return { step: "plugin", status: "fail", message: "Discord plugin server.ts not found" }
  }

  const content = readFileSync(pluginPath, "utf8")

  const hasPartnerBotIds = content.includes("PARTNER_BOT_IDS")
  const hasStateDir = content.includes("DISCORD_STATE_DIR")
  const hasMentionFallback = content.includes("msg.content.includes(`<@${client.user.id}>`")

  const issues: string[] = []
  if (!hasPartnerBotIds) issues.push("PARTNER_BOT_IDS missing")
  if (!hasStateDir) issues.push("STATE_DIR missing")
  if (!hasMentionFallback) issues.push("mention fallback missing")

  if (issues.length === 0) {
    return { step: "plugin", status: "pass", message: "All patches intact" }
  }

  return {
    step: "plugin",
    status: "warn",
    message: `Plugin needs patching: ${issues.join(", ")}. Run \`fleet patch\` to fix.`,
  }
}

function checkIdentity(stateDir: string): BootCheckResult {
  const identityPath = join(stateDir, "identity.md")
  if (!existsSync(identityPath)) {
    return { step: "identity", status: "fail", message: "identity.md missing" }
  }

  const stat = statSync(identityPath)
  if (stat.size === 0) {
    return { step: "identity", status: "fail", message: "identity.md is empty" }
  }

  return { step: "identity", status: "pass", message: `identity.md OK (${stat.size} bytes)` }
}

function logBootCommand(
  agentName: string,
  stateDir: string,
  env: Record<string, string>,
): BootCheckResult {
  const redactedEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (/token|secret|key|password/i.test(key)) {
      redactedEnv[key] = value.slice(0, 4) + "..." + value.slice(-4)
    } else {
      redactedEnv[key] = value
    }
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    agent: agentName,
    stateDir,
    env: redactedEnv,
  }

  const logPath = join(stateDir, "boot.log")
  const { appendFileSync } = require("fs")
  appendFileSync(logPath, JSON.stringify(logEntry) + "\n", "utf8")

  return { step: "boot-log", status: "pass", message: `Boot command logged to ${logPath}` }
}

// ── Task context re-injection ───────────────────────────────────────────────

const MAX_TASK_CONTEXT_CHARS = 2000

interface TaskEntry {
  id: string
  title: string
  status: string
  priority: string
  assignee?: string
  workspace?: string
  blockedReason?: string
  description?: string
}

function priorityWeight(p: string): number {
  switch (p) {
    case "urgent": return 0
    case "high": return 1
    case "normal": return 2
    case "low": return 3
    default: return 4
  }
}

function injectTaskContext(
  agentName: string,
  agentRole: string,
  stateDir: string,
  fleetName: string,
  log: (...args: unknown[]) => void,
): BootCheckResult {
  const tasksPath = join(homedir(), ".fleet", "tasks", `${fleetName}.json`)

  if (!existsSync(tasksPath)) {
    return { step: "tasks", status: "pass", message: "No task store found — skipping" }
  }

  let store: { tasks: TaskEntry[] }
  try {
    store = JSON.parse(readFileSync(tasksPath, "utf8"))
  } catch (e) {
    return {
      step: "tasks",
      status: "warn",
      message: `Task store corrupt — skipping (${e instanceof Error ? e.message : e})`,
    }
  }

  if (!store.tasks || store.tasks.length === 0) {
    return { step: "tasks", status: "pass", message: "Task store empty — skipping" }
  }

  const isLead = agentRole === "lead"
  const activeTasks = store.tasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  )

  let relevantTasks: TaskEntry[]
  let header: string

  if (isLead) {
    // Lead gets the full board
    relevantTasks = activeTasks.sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority))
    header = "## Fleet Task Board"
  } else {
    // Worker gets only their assigned tasks
    relevantTasks = activeTasks
      .filter((t) => t.assignee === agentName)
      .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority))
    header = "## Your Current Tasks"
  }

  if (relevantTasks.length === 0) {
    const contextPath = join(stateDir, "tasks-context.md")
    try { writeFileSync(contextPath, "", "utf8") } catch (err) {
      process.stderr.write(`[boot-check] failed to write empty tasks-context.md: ${err instanceof Error ? err.message : err}\n`)
    }
    return { step: "tasks", status: "pass", message: "No active tasks for this agent" }
  }

  // Build context content with size cap
  const lines: string[] = [header, ""]
  let charCount = header.length + 1

  if (isLead) {
    // Group by status for lead board view
    const groups: Record<string, TaskEntry[]> = {}
    for (const t of relevantTasks) {
      const key = t.status
      if (!groups[key]) groups[key] = []
      groups[key].push(t)
    }

    const statusOrder = ["in_progress", "blocked", "open"]
    for (const status of statusOrder) {
      const tasks = groups[status]
      if (!tasks || tasks.length === 0) continue

      const label = status === "in_progress" ? "In Progress" : status === "blocked" ? "Blocked" : "Open"
      const groupHeader = `**${label} (${tasks.length}):**`
      if (charCount + groupHeader.length + 1 > MAX_TASK_CONTEXT_CHARS) {
        const remaining = relevantTasks.length - lines.filter((l) => l.startsWith("- [")).length
        lines.push(`*[+${remaining} more — run \`fleet task board\`]*`)
        break
      }
      lines.push(groupHeader)
      charCount += groupHeader.length + 1

      for (const t of tasks) {
        const assigneeStr = t.assignee ? ` — ${t.assignee}` : " — unassigned"
        const blockedStr = t.status === "blocked" && t.blockedReason ? ` — BLOCKED: ${t.blockedReason}` : ""
        const line = `- [${t.id}] ${t.title}${assigneeStr} (${t.priority.toUpperCase()})${blockedStr}`
        if (charCount + line.length + 1 > MAX_TASK_CONTEXT_CHARS) {
          const remaining = relevantTasks.length - lines.filter((l) => l.startsWith("- [")).length
          lines.push(`*[+${remaining} more — run \`fleet task board\`]*`)
          break
        }
        lines.push(line)
        charCount += line.length + 1
      }
      lines.push("")
      charCount += 1
    }

    lines.push("Run `fleet task board` for live state. `fleet task create/assign/update` to manage.")
  } else {
    // Worker view: their tasks with details
    for (const t of relevantTasks) {
      const workspaceStr = t.workspace ? ` | Workspace: ${t.workspace}` : ""
      const blockedStr = t.status === "blocked" && t.blockedReason ? `\n  Blocked: ${t.blockedReason}` : ""
      const descStr = t.description ? `\n  ${t.description.slice(0, 100)}${t.description.length > 100 ? "..." : ""}` : ""
      const line = `- **[${t.id}]** ${t.priority.toUpperCase()} — ${t.title}\n  Status: ${t.status}${workspaceStr}${blockedStr}${descStr}`
      if (charCount + line.length + 1 > MAX_TASK_CONTEXT_CHARS) {
        const remaining = relevantTasks.length - lines.filter((l) => l.startsWith("- **[")).length
        lines.push(`*[+${remaining} more — run \`fleet task list --assignee ${agentName}\`]*`)
        break
      }
      lines.push(line)
      charCount += line.length + 1
    }

    lines.push("")
    lines.push("Run `fleet task show <id>` for details. `fleet task update <id> --status done --note \"...\"` when complete.")
  }

  const content = lines.join("\n")
  const contextPath = join(stateDir, "tasks-context.md")
  try {
    writeFileSync(contextPath, content + "\n", "utf8")
  } catch (e) {
    return {
      step: "tasks",
      status: "warn",
      message: `Failed to write tasks-context.md — ${e instanceof Error ? e.message : e}`,
    }
  }

  return {
    step: "tasks",
    status: "pass",
    message: `Injected ${relevantTasks.length} task(s) into tasks-context.md (${content.length} chars, ${isLead ? "full board" : "personal"})`,
  }
}

// ── Project wiki injection ─────────────────────────────────────────────────

function injectProjectWiki(
  agentName: string,
  agentRole: string,
  workspace: string | undefined,
  stateDir: string,
  configDir: string,
  log: (...args: unknown[]) => void,
): BootCheckResult {
  const sections = loadWikiSections(configDir, agentRole, workspace)

  if (sections.length === 0) {
    const wikiPath = join(stateDir, "project-wiki.md")
    try { writeFileSync(wikiPath, "", "utf8") } catch (err) {
      process.stderr.write(`[boot-check] failed to write empty project-wiki.md: ${err instanceof Error ? err.message : err}\n`)
    }
    return { step: "wiki", status: "pass", message: "No wiki entries found — skipping" }
  }

  const content = buildProjectWiki(sections)
  const wikiPath = join(stateDir, "project-wiki.md")

  try {
    writeFileSync(wikiPath, content + "\n", "utf8")
  } catch (e) {
    return {
      step: "wiki",
      status: "warn",
      message: `Failed to write project-wiki.md — ${e instanceof Error ? e.message : e}`,
    }
  }

  const sources = sections.map(s => s.source).join(", ")
  return {
    step: "wiki",
    status: "pass",
    message: `Injected wiki context (${content.length} chars, sources: ${sources})`,
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function bootCheck(
  agentName: string,
  opts?: { json?: boolean },
): Promise<BootCheckResult[]> {
  const log = opts?.json ? () => {} : console.log.bind(console)
  const results: BootCheckResult[] = []

  // Load config
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agentDef = config.agents[agentName]
  if (!agentDef) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  const stateDir = resolveStateDir(agentName, config)

  // Validate bot tokens — use cache for fast restarts, only validate uncached
  const discord = new DiscordApi()
  const botIds: Record<string, string> = {}
  const botDisplayNames: Record<string, string> = {}

  const botIdsCachePath = join(configDir, "bot-ids-cache.json")
  let cachedBotIds: Record<string, { id: string; displayName: string }> = {}
  try {
    if (existsSync(botIdsCachePath)) {
      cachedBotIds = JSON.parse(readFileSync(botIdsCachePath, "utf8"))
    }
  } catch {}

  const entries = Object.entries(config.agents)

  // Use cached IDs where available
  for (const [name, cached] of Object.entries(cachedBotIds)) {
    if (config.agents[name]) {
      botIds[name] = cached.id
      botDisplayNames[name] = cached.displayName
    }
  }

  // Only validate uncached agents — zero network calls when cache is warm
  const needsValidation = entries.filter(([name]) => !cachedBotIds[name])

  if (needsValidation.length > 0) {
    const tokenResults = await Promise.allSettled(
      needsValidation.map(async ([name]) => {
        const agentToken = getToken(name, config, configDir)
        const info = await discord.validateToken(agentToken)
        return { name, id: info.id, displayName: info.name }
      })
    )

    for (let i = 0; i < needsValidation.length; i++) {
      const [name] = needsValidation[i]
      const result = tokenResults[i]
      if (result.status === "fulfilled") {
        botIds[name] = result.value.id
        botDisplayNames[name] = result.value.displayName
        cachedBotIds[name] = { id: result.value.id, displayName: result.value.displayName }
      } else {
        botIds[name] = "UNKNOWN"
        botDisplayNames[name] = name
        if (name === agentName) {
          throw new Error(`Boot-check failed: own token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`)
        }
      }
    }

    // Update cache
    try { writeFileSync(botIdsCachePath, JSON.stringify(cachedBotIds, null, 2)) } catch {}
  }

  // Step 1: Regenerate access.json from fleet.yaml
  log("  [1/6] Regenerating access.json...")
  const accessResult = await checkAndRegenerateAccess(agentName, config, stateDir, botIds, log)
  results.push(accessResult)
  log(`        ${accessResult.status}: ${accessResult.message}`)

  // Step 2: Verify plugin integrity
  log("  [2/6] Checking plugin integrity...")
  const pluginResult = checkPluginIntegrity(log)
  results.push(pluginResult)
  log(`        ${pluginResult.status}: ${pluginResult.message}`)

  // Step 3: Verify identity.md
  log("  [3/6] Checking identity...")
  // Regenerate identity + roster to ensure they're current
  writeBootIdentity(agentName, config, botIds, stateDir, botDisplayNames)
  writeRoster(agentName, config, botIds, stateDir, botDisplayNames)
  const identityResult = checkIdentity(stateDir)
  results.push(identityResult)
  log(`        ${identityResult.status}: ${identityResult.message}`)

  // Step 4: Inject task context (failure-tolerant — never blocks boot)
  log("  [4/6] Injecting task context...")
  const taskResult = injectTaskContext(agentName, agentDef.role, stateDir, config.fleet.name, log)
  results.push(taskResult)
  log(`        ${taskResult.status}: ${taskResult.message}`)

  // Step 5: Inject project wiki context (failure-tolerant)
  log("  [5/6] Injecting project wiki...")
  const workspace = agentDef.workspace ?? config.defaults.workspace
  const wikiResult = injectProjectWiki(agentName, agentDef.role, workspace, stateDir, configDir, log)
  results.push(wikiResult)
  log(`        ${wikiResult.status}: ${wikiResult.message}`)

  // Step 6: Log boot command + env snapshot
  log("  [6/6] Logging boot command...")
  const token = getToken(agentName, config, configDir)
  const bootLogResult = logBootCommand(agentName, stateDir, {
    DISCORD_BOT_TOKEN: token,
    DISCORD_STATE_DIR: stateDir,
    DISCORD_ACCESS_MODE: "static",
    FLEET_SELF: agentName,
  })
  results.push(bootLogResult)
  log(`        ${bootLogResult.status}: ${bootLogResult.message}`)

  // Summary
  const failures = results.filter((r) => r.status === "fail")
  if (failures.length > 0) {
    log(`\n  Boot-check FAILED (${failures.length} issue(s)):`)
    for (const f of failures) {
      log(`    - ${f.step}: ${f.message}`)
    }
  } else {
    log(`\n  Boot-check passed — ${agentName} ready to launch.`)
  }

  if (opts?.json) {
    console.log(JSON.stringify(results, null, 2))
  }

  return results
}
