import type { ChannelAction, ChannelActionEnvelope, ChannelEvent } from "../../channel/protocol"

function extractJsonCandidates(raw: string): string[] {
  const candidates = new Set<string>()
  const trimmed = raw.trim()

  if (trimmed.length > 0) {
    candidates.add(trimmed)
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    candidates.add(fenced[1].trim())
  }

  const objectStart = trimmed.indexOf("{")
  const objectEnd = trimmed.lastIndexOf("}")
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.add(trimmed.slice(objectStart, objectEnd + 1))
  }

  return [...candidates]
}

function normalizeReplyAction(value: unknown): ChannelAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>
  if (candidate.type !== "reply") {
    return null
  }

  const text = typeof candidate.text === "string" ? candidate.text.trim() : ""
  if (text.length === 0) {
    return null
  }

  const replyToMessageId = typeof candidate.replyToMessageId === "string"
    ? candidate.replyToMessageId
    : undefined

  return {
    type: "reply",
    text,
    replyToMessageId,
  }
}

function parseActionEnvelope(raw: string): ChannelAction[] | null {
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate) as unknown

      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizeReplyAction)
          .filter((action): action is ChannelAction => action !== null)
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue
      }

      const envelope = parsed as Partial<ChannelActionEnvelope> & { actions?: unknown }
      if (!Array.isArray(envelope.actions)) {
        continue
      }

      return envelope.actions
        .map(normalizeReplyAction)
        .filter((action): action is ChannelAction => action !== null)
    } catch {}
  }

  return null
}

export function buildCodexChannelPrompt(event: ChannelEvent): string {
  const meta = [
    `source="${event.source}"`,
    `channel_id="${event.channelId}"`,
    `message_id="${event.messageId}"`,
    `scope="${event.scopeKey}"`,
    `user="${event.author.name ?? event.author.id}"`,
    `user_id="${event.author.id}"`,
    `user_type="${event.author.isBot ? "bot" : "human"}"`,
    `workspace="${event.workspace}"`,
  ].join(" ")

  const message = event.content.trim().length > 0
    ? event.content
    : "You were addressed without additional text. Ask the user what they need."

  return [
    "A new Open Fleet channel event arrived.",
    "",
    "Return only valid JSON. Do not use markdown fences. Do not add commentary before or after the JSON.",
    "",
    "Schema:",
    "{",
    '  "actions": [',
    '    { "type": "reply", "text": "message text", "replyToMessageId": "optional Discord message id" }',
    "  ]",
    "}",
    "",
    "Rules:",
    "- Use an empty actions array when no Discord response is needed.",
    `- Set replyToMessageId to "${event.messageId}" only if you intentionally want a native Discord reply to this inbound message.`,
    "- Omit replyToMessageId for a normal standalone channel message.",
    "- Never claim you posted to Discord yourself; Open Fleet executes the actions.",
    "",
    `<channel ${meta}>`,
    message,
    "</channel>",
  ].join("\n")
}

export function parseCodexChannelActions(raw: string, event: ChannelEvent): ChannelAction[] {
  const parsed = parseActionEnvelope(raw)
  if (parsed !== null) {
    return parsed
  }

  const fallback = raw.trim()
  if (fallback.length === 0) {
    return []
  }

  return [{
    type: "reply",
    text: fallback,
    replyToMessageId: event.messageId,
  }]
}
