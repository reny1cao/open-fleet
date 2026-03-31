import { findConfigDir, loadConfig, getToken } from "../core/config"
import { DiscordApi } from "../channel/discord/api"
import type { WatchdogState, WatchdogConfig, WatchdogEventType } from "./types"
import { canAlert, markAlerted } from "./state"

export async function alertDiscord(
  level: "warn" | "critical",
  agent: string,
  eventType: WatchdogEventType,
  message: string,
  state: WatchdogState,
  config: WatchdogConfig,
): Promise<void> {
  if (config.noAlert) return
  if (!canAlert(state, agent, eventType, config.thresholds.alertDedup)) return

  const configDir = findConfigDir()
  const fleetConfig = loadConfig(configDir)

  // Find the command channel (or first channel)
  const channelLabel = config.alertChannel ?? "command"
  const channel = fleetConfig.discord.channels[channelLabel]
    ?? Object.values(fleetConfig.discord.channels)[0]
  if (!channel) return

  // Use the first lead's token to send the alert
  const leadName = fleetConfig.structure?.lead
    ?? Object.entries(fleetConfig.agents).find(([, def]) => def.role === "lead")?.[0]
  if (!leadName) return

  let token: string
  try {
    token = getToken(leadName, fleetConfig, configDir)
  } catch {
    return
  }

  const prefix = level === "critical" ? "🚨 CRITICAL" : "⚠️ WARNING"
  const userMention = level === "critical" && fleetConfig.discord.userId
    ? `<@${fleetConfig.discord.userId}> `
    : ""
  const text = `${userMention}**[Fleet Watchdog] ${prefix}: ${agent}**\n${message}`

  try {
    const discord = new DiscordApi()
    await discord.sendMessage(token, channel.id, text)
    markAlerted(state, agent, eventType)
  } catch (err) {
    process.stderr.write(`[watchdog] Discord alert failed: ${err instanceof Error ? err.message : err}\n`)
  }
}
