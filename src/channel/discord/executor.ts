import type { ChannelAction } from "../protocol"
import { DiscordApi } from "./api"

const MAX_DISCORD_MESSAGE_LENGTH = 2000

function splitDiscordMessage(content: string): string[] {
  if (content.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    return [content]
  }

  const chunks: string[] = []
  let remaining = content.trim()

  while (remaining.length > MAX_DISCORD_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", MAX_DISCORD_MESSAGE_LENGTH)
    if (splitAt < MAX_DISCORD_MESSAGE_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(" ", MAX_DISCORD_MESSAGE_LENGTH)
    }
    if (splitAt < MAX_DISCORD_MESSAGE_LENGTH / 2) {
      splitAt = MAX_DISCORD_MESSAGE_LENGTH
    }

    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }

  if (remaining.length > 0) {
    chunks.push(remaining)
  }

  return chunks
}

export async function executeDiscordActions(
  api: DiscordApi,
  token: string,
  channelId: string,
  actions: ChannelAction[],
): Promise<string[]> {
  const sentMessageIds: string[] = []

  for (const action of actions) {
    if (action.type !== "reply") {
      continue
    }

    const chunks = splitDiscordMessage(action.text)
    for (const [index, chunk] of chunks.entries()) {
      const sentId = await api.sendMessage(
        token,
        channelId,
        chunk,
        index === 0 ? action.replyToMessageId : undefined,
      )
      sentMessageIds.push(sentId)
    }
  }

  return sentMessageIds
}
