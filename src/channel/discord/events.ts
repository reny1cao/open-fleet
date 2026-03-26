const DISCORD_TYPE_PUBLIC_THREAD = 11
const DISCORD_TYPE_PRIVATE_THREAD = 12
const DISCORD_TYPE_ANNOUNCEMENT_THREAD = 10

export interface DiscordMention {
  id: string
}

export interface DiscordMessageReference {
  message_id?: string
}

export interface DiscordAuthor {
  id: string
  username?: string
  bot?: boolean
}

export interface DiscordMessageEvent {
  id: string
  channel_id: string
  content: string
  author?: DiscordAuthor
  mentions?: DiscordMention[]
  message_reference?: DiscordMessageReference
}

export interface DiscordChannelRecord {
  id: string
  type: number
  parent_id?: string
}

export type DiscordDeliveryReason =
  | "explicit_mention"
  | "human_reply_to_recent_bot"
  | "bot_reply_without_explicit_mention"
  | "no_trigger"

export interface DiscordDeliveryDecision {
  deliver: boolean
  reason: DiscordDeliveryReason
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

export function isReplyToRecentBotMessage(
  message: Pick<DiscordMessageEvent, "message_reference">,
  recentMessageIds: ReadonlySet<string>,
): boolean {
  const refId = message.message_reference?.message_id
  if (!refId) {
    return false
  }
  return recentMessageIds.has(refId)
}

export function evaluateDiscordMessageDelivery(
  message: Pick<DiscordMessageEvent, "content" | "mentions" | "author" | "message_reference">,
  botId: string,
  recentMessageIds: ReadonlySet<string>,
): DiscordDeliveryDecision {
  if (isBotMentioned(message, botId)) {
    return {
      deliver: true,
      reason: "explicit_mention",
    }
  }

  if (message.author?.bot) {
    return {
      deliver: false,
      reason: "bot_reply_without_explicit_mention",
    }
  }

  if (isReplyToRecentBotMessage(message, recentMessageIds)) {
    return {
      deliver: true,
      reason: "human_reply_to_recent_bot",
    }
  }

  return {
    deliver: false,
    reason: "no_trigger",
  }
}

export function shouldDeliverDiscordMessage(
  message: Pick<DiscordMessageEvent, "content" | "mentions" | "author" | "message_reference">,
  botId: string,
  recentMessageIds: ReadonlySet<string>,
): boolean {
  return evaluateDiscordMessageDelivery(message, botId, recentMessageIds).deliver
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
