export interface ChannelEventAuthor {
  id: string
  name?: string
  isBot: boolean
}

export interface ChannelEvent {
  source: "discord"
  channelId: string
  messageId: string
  scopeKey: string
  workspace: string
  author: ChannelEventAuthor
  content: string
}

export interface ChannelReplyAction {
  type: "reply"
  text: string
  replyToMessageId?: string
}

export type ChannelAction = ChannelReplyAction

export interface ChannelActionEnvelope {
  actions: ChannelAction[]
}
