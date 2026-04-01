import { findConfigDir, loadConfig, getToken } from "../core/config"
import { DiscordApi } from "../channel/discord/api"
import type { Task } from "./types"

interface NotifyContext {
  configDir: string
  token: string
  channelId: string
  discord: DiscordApi
  botIds: Record<string, string>
}

async function resolveContext(): Promise<NotifyContext | null> {
  try {
    const configDir = findConfigDir()
    const config = loadConfig(configDir)

    // Find command channel (or first available)
    const channel = config.discord.channels["dev"]
      ?? config.discord.channels["command"]
      ?? Object.values(config.discord.channels)[0]
    if (!channel) return null

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

    return { configDir, token, channelId: channel.id, discord, botIds }
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
    case "urgent": return "🔴 URGENT"
    case "high": return "HIGH"
    default: return p.toUpperCase()
  }
}

export async function notifyTaskAssigned(task: Task): Promise<void> {
  if (!task.assignee) return
  const ctx = await resolveContext()
  if (!ctx) return

  const msg = `${mention(ctx, task.assignee)} You've been assigned: **${task.title}** [${formatPriority(task.priority)}]\nTask ID: \`${task.id}\` — run \`fleet task show ${task.id}\` for details.`

  try {
    await ctx.discord.sendMessage(ctx.token, ctx.channelId, msg)
  } catch (err) {
    process.stderr.write(`[tasks] Notification failed: ${err instanceof Error ? err.message : err}\n`)
  }
}

export async function notifyTaskDone(task: Task): Promise<void> {
  const ctx = await resolveContext()
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
  const ctx = await resolveContext()
  if (!ctx) return

  // Notify the lead
  const configDir = findConfigDir()
  const config = loadConfig(configDir)
  const leadName = config.structure?.lead
    ?? Object.entries(config.agents).find(([, def]) => def.role === "lead")?.[0]
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
  const ctx = await resolveContext()
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
