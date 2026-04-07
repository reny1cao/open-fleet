import { findConfigDir, loadConfig, getToken, loadEnv } from "../core/config"
import { DiscordApi } from "../channel/discord/api"
import { homedir } from "os"
import type { FleetConfig } from "../core/types"
import type { Task } from "./types"

interface NotifyContext {
  configDir: string
  config: FleetConfig
  token: string
  channelId: string
  discord: DiscordApi
  botIds: Record<string, string>
}

/**
 * Resolve the Discord channel for a task notification.
 * Priority: project match → workspace match → assignee's primary work channel → fleet default workspace channel.
 * #command is NEVER used for task notifications.
 */
function resolveChannelId(config: FleetConfig, taskWorkspace?: string, assignee?: string, project?: string): string | null {
  const channels = config.discord.channels
  const home = homedir()
  const normalize = (p: string) => {
    let resolved = p
    if (resolved.startsWith("~/")) resolved = home + resolved.slice(1)
    else if (resolved === "~") resolved = home
    return resolved.replace(/\/+$/, "")
  }

  // 0. Match task project to a channel label (e.g., project "fleet-dev" → channel "fleet-dev")
  if (project) {
    const ch = channels[project]
    if (ch) return ch.id
  }

  // 1. Match task workspace to a channel's workspace
  if (taskWorkspace) {
    const taskWs = normalize(taskWorkspace)
    let bestMatch: { label: string; id: string; wsLen: number } | null = null
    for (const [label, ch] of Object.entries(channels)) {
      if (!ch.workspace) continue
      const chWs = normalize(ch.workspace)
      if (taskWs === chWs || taskWs.startsWith(chWs + "/")) {
        if (!bestMatch || chWs.length > bestMatch.wsLen) {
          bestMatch = { label, id: ch.id, wsLen: chWs.length }
        }
      }
    }
    if (bestMatch) return bestMatch.id
  }

  // 2. Assignee's primary work channel (first non-command channel in their scope)
  if (assignee) {
    const agentDef = config.agents[assignee]
    if (agentDef?.channels) {
      for (const chLabel of agentDef.channels) {
        if (chLabel === "command") continue
        const ch = channels[chLabel]
        if (ch) return ch.id
      }
    }
  }

  // 3. Fleet default workspace → channel match
  const defaultWs = config.defaults.workspace
  if (defaultWs) {
    const defWs = normalize(defaultWs)
    for (const [label, ch] of Object.entries(channels)) {
      if (label === "command") continue
      if (!ch.workspace) continue
      if (normalize(ch.workspace) === defWs) return ch.id
    }
  }

  // 4. First non-command channel (last resort)
  for (const [label, ch] of Object.entries(channels)) {
    if (label === "command") continue
    return ch.id
  }

  return null
}

async function resolveContext(task: Task, opts?: { assigneeOverride?: string; sender?: string }): Promise<NotifyContext | null> {
  try {
    const configDir = findConfigDir()
    const config = loadConfig(configDir)

    const channelId = resolveChannelId(config, task.workspace, opts?.assigneeOverride ?? task.assignee, task.project)
    if (!channelId) return null

    // Resolve sender's bot token (notification appears as their message):
    // 1. Sender agent's own token (if sender is a known agent)
    // 2. Dedicated Fleet Bot token (config.discord.notificationBotToken env var)
    // 3. Fallback: lead agent's token
    let token: string | undefined

    // Try sender's own token first
    if (opts?.sender && config.agents[opts.sender]) {
      try {
        token = getToken(opts.sender, config, configDir)
      } catch {}
    }

    // Try dedicated notification bot token
    if (!token) {
      const notifTokenEnv = config.discord.notificationBotToken
      if (notifTokenEnv) {
        token = process.env[notifTokenEnv] ?? loadEnv(configDir)[notifTokenEnv]
      }
    }

    // Fall back to lead's token
    if (!token) {
      const leadName = config.structure?.lead
        ?? Object.entries(config.agents).find(([, def]) => def.role === "lead")?.[0]
      if (!leadName) return null
      token = getToken(leadName, config, configDir)
    }

    // Resolve bot IDs for @mentions
    const discord = new DiscordApi()
    const botIds: Record<string, string> = {}
    const entries = Object.entries(config.agents)
    const results = await Promise.allSettled(
      entries.map(async ([name]) => {
        const agentToken = getToken(name, config, configDir)
        const info = await discord.validateToken(agentToken)
        return { name, id: info.id }
      })
    )
    for (let i = 0; i < entries.length; i++) {
      const [name] = entries[i]
      const result = results[i]
      if (result.status === "fulfilled") {
        botIds[name] = result.value.id
      }
    }

    return { configDir, config, token, channelId, discord, botIds }
  } catch {
    return null
  }
}

function mention(ctx: NotifyContext, agentName: string): string {
  const id = ctx.botIds[agentName]
  return id ? `<@${id}>` : `**${agentName}**`
}

function formatPriority(p: string): string {
  switch (p) {
    case "urgent": return "URGENT"
    case "high": return "HIGH"
    default: return p.toUpperCase()
  }
}

export async function notifyTaskAssigned(task: Task, sender?: string): Promise<void> {
  if (!task.assignee) return
  const ctx = await resolveContext(task, { sender: sender ?? task.createdBy })
  if (!ctx) return

  const msg = `${mention(ctx, task.assignee)} ← **${task.title}** [${formatPriority(task.priority)}] (\`${task.id}\`)`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskDone(task: Task, sender?: string): Promise<void> {
  const ctx = await resolveContext(task, { sender: sender ?? task.assignee })
  if (!ctx) return

  const creator = task.createdBy
  const summary = task.result?.summary ?? task.notes.filter(n => n.type === "comment").pop()?.text ?? ""
  const summaryLine = summary ? ` — ${summary}` : ""
  const msg = `${mention(ctx, creator)} ✅ **${task.title}**${summaryLine} (\`${task.id}\`)`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskBlocked(task: Task, sender?: string): Promise<void> {
  const ctx = await resolveContext(task, { sender: sender ?? task.assignee })
  if (!ctx) return

  const leadName = ctx.config.structure?.lead
    ?? Object.entries(ctx.config.agents).find(([, def]) => def.role === "lead")?.[0]
  if (!leadName) return

  const reason = task.blockedReason ?? "no reason given"
  const msg = `${mention(ctx, leadName)} 🚫 **${task.title}** blocked: ${reason} (\`${task.id}\` → ${task.assignee ?? "unassigned"})`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskReview(task: Task, sender?: string): Promise<void> {
  const ctx = await resolveContext(task, { sender: sender ?? task.assignee })
  if (!ctx) return

  // Find reviewer: agent with role "reviewer"
  const reviewerEntry = Object.entries(ctx.config.agents).find(([, def]) => def.role === "reviewer")
  if (!reviewerEntry) {
    // No reviewer configured — notify lead instead
    const leadName = ctx.config.structure?.lead
      ?? Object.entries(ctx.config.agents).find(([, def]) => def.role === "lead")?.[0]
    if (!leadName) return
    const msg = `${mention(ctx, leadName)} 📝 **${task.title}** ready for review (\`${task.id}\` → ${task.assignee ?? "unassigned"})`
    try { await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg) } catch (err) { process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`) }
    return
  }

  const [reviewerName] = reviewerEntry
  const assigneeMention = task.assignee ? ` by ${mention(ctx, task.assignee)}` : ""
  const msg = `${mention(ctx, reviewerName)} 📝 **${task.title}**${assigneeMention} [${formatPriority(task.priority)}] (\`${task.id}\`)`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskVerify(task: Task, sender?: string): Promise<void> {
  const ctx = await resolveContext(task, { sender })
  if (!ctx) return

  // Notify lead/user for final verification
  const leadName = ctx.config.structure?.lead
    ?? Object.entries(ctx.config.agents).find(([, def]) => def.role === "lead")?.[0]
  if (!leadName) return

  const msg = `${mention(ctx, leadName)} 🔍 **${task.title}** ready to verify [${formatPriority(task.priority)}] (\`${task.id}\`)`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskReassigned(task: Task, oldAssignee: string | undefined, newAssignee: string | undefined, sender?: string): Promise<void> {
  if (!oldAssignee && !newAssignee) return
  const ctx = await resolveContext(task, { sender })
  if (!ctx) return

  const target = newAssignee ? mention(ctx, newAssignee) : "unassigned"
  const from = oldAssignee ? ` (was ${mention(ctx, oldAssignee)})` : ""
  const msg = `${target} ← **${task.title}** [${formatPriority(task.priority)}]${from} (\`${task.id}\`)`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}
