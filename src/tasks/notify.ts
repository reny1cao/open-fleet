import { findConfigDir, loadConfig, getToken } from "../core/config"
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
 * Priority: workspace match → "command" channel → first channel.
 */
function resolveChannelId(config: FleetConfig, taskWorkspace?: string): string | null {
  const channels = config.discord.channels

  // 1. Match task workspace to a channel's workspace
  if (taskWorkspace) {
    // Normalize: expand ~ to homedir, strip trailing slashes
    const home = homedir()
    const normalize = (p: string) => {
      let resolved = p
      if (resolved.startsWith("~/")) resolved = home + resolved.slice(1)
      else if (resolved === "~") resolved = home
      return resolved.replace(/\/+$/, "")
    }
    const taskWs = normalize(taskWorkspace)

    // Try exact match first, then prefix match (most specific wins)
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

  // 2. Fallback: command channel, then first channel
  const fallback = channels["command"] ?? Object.values(channels)[0]
  return fallback?.id ?? null
}

async function resolveContext(task: Task): Promise<NotifyContext | null> {
  try {
    const configDir = findConfigDir()
    const config = loadConfig(configDir)

    const channelId = resolveChannelId(config, task.workspace)
    if (!channelId) return null

    // Use lead's token to send notifications
    const leadName = config.structure?.lead
      ?? Object.entries(config.agents).find(([, def]) => def.role === "lead")?.[0]
    if (!leadName) return null

    const token = getToken(leadName, config, configDir)

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

export async function notifyTaskAssigned(task: Task): Promise<void> {
  if (!task.assignee) return
  const ctx = await resolveContext(task)
  if (!ctx) return

  const msg = `${mention(ctx, task.assignee)} You've been assigned: **${task.title}** [${formatPriority(task.priority)}]\nTask ID: \`${task.id}\` — run \`fleet task show ${task.id}\` for details.`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskDone(task: Task): Promise<void> {
  const ctx = await resolveContext(task)
  if (!ctx) return

  const creator = task.createdBy
  const summary = task.result?.summary ?? task.notes.filter(n => n.type === "comment").pop()?.text ?? ""
  const summaryLine = summary ? ` — ${summary}` : ""
  const msg = `${mention(ctx, creator)} Task done: **${task.title}**${summaryLine}\nTask ID: \`${task.id}\``

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskBlocked(task: Task): Promise<void> {
  const ctx = await resolveContext(task)
  if (!ctx) return

  const leadName = ctx.config.structure?.lead
    ?? Object.entries(ctx.config.agents).find(([, def]) => def.role === "lead")?.[0]
  if (!leadName) return

  const reason = task.blockedReason ?? "no reason given"
  const msg = `${mention(ctx, leadName)} Task blocked: **${task.title}** — ${reason}\nTask ID: \`${task.id}\` | Assignee: ${task.assignee ?? "unassigned"}`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskReassigned(task: Task, oldAssignee: string | undefined, newAssignee: string | undefined): Promise<void> {
  if (!oldAssignee && !newAssignee) return
  const ctx = await resolveContext(task)
  if (!ctx) return

  const parts: string[] = []
  if (newAssignee) {
    parts.push(`${mention(ctx, newAssignee)} You've been assigned: **${task.title}** [${formatPriority(task.priority)}]`)
  }
  if (oldAssignee && oldAssignee !== newAssignee) {
    parts.push(`${mention(ctx, oldAssignee)} Task **${task.title}** has been reassigned to ${newAssignee ? mention(ctx, newAssignee) : "unassigned"}.`)
  }
  parts.push(`Task ID: \`${task.id}\``)

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, parts.join("\n"))
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}
