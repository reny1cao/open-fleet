const DISCORD_TYPE_PUBLIC_THREAD = 11
const DISCORD_TYPE_PRIVATE_THREAD = 12
const DISCORD_TYPE_ANNOUNCEMENT_THREAD = 10

export interface DiscordMention {
  id: string
}

export interface DiscordMessageEvent {
  id: string
  channel_id: string
  content: string
  mentions?: DiscordMention[]
}

export interface DiscordChannelRecord {
  id: string
  type: number
  parent_id?: string
}

export function isBotMentioned(
  message: Pick<DiscordMessageEvent, "content" | "mentions">,
  botId: string,
): boolean {
  const explicitMentionPatterns = [`<@${botId}>`, `<@!${botId}>`]
  if (explicitMentionPatterns.some((pattern) => message.content.includes(pattern))) {
    return true
  }

  return false
}

export function stripBotMention(content: string, botId: string): string {
  return content
    .replaceAll(`<@${botId}>`, "")
    .replaceAll(`<@!${botId}>`, "")
    .trim()
}

export function isThreadChannel(channel: Pick<DiscordChannelRecord, "type">): boolean {
  return channel.type === DISCORD_TYPE_ANNOUNCEMENT_THREAD
    || channel.type === DISCORD_TYPE_PUBLIC_THREAD
    || channel.type === DISCORD_TYPE_PRIVATE_THREAD
}

export function resolveScopeKey(
  message: Pick<DiscordMessageEvent, "channel_id">,
  channel: Pick<DiscordChannelRecord, "id" | "type" | "parent_id"> | null,
  managedChannelIds: Iterable<string>,
): string | null {
  const managed = new Set(managedChannelIds)

  if (managed.has(message.channel_id)) {
    return `channel:${message.channel_id}`
  }

  if (channel && isThreadChannel(channel) && channel.parent_id && managed.has(channel.parent_id)) {
    return `thread:${channel.id}`
  }

  return null
}
