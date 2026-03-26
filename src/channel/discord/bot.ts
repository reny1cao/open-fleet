import type { ChannelDef } from "../../core/types"
import type { ChannelAction, ChannelEvent } from "../protocol"
import { DiscordApi } from "./api"
import { executeDiscordActions } from "./executor"
import { evaluateDiscordMessageDelivery, resolveScopeKey, stripBotMention } from "./events"

const DISCORD_GATEWAY_HELLO = 10
const DISCORD_GATEWAY_HEARTBEAT_ACK = 11
const DISCORD_GATEWAY_DISPATCH = 0
const DISCORD_GATEWAY_IDENTIFY = 2
const DISCORD_GATEWAY_HEARTBEAT = 1
const DISCORD_GATEWAY_INTENTS = 1 | 512 | 32768
interface DiscordGatewayEnvelope {
  op: number
  d?: Record<string, unknown>
  s?: number | null
  t?: string | null
}

interface DiscordAuthor {
  id: string
  username?: string
  bot?: boolean
}

interface DiscordMessagePayload {
  id: string
  channel_id: string
  content: string
  author: DiscordAuthor
  mentions?: Array<{ id: string }>
  message_reference?: { message_id?: string }
}

interface DiscordBotOptions {
  agentName: string
  token: string
  botUserId: string
  channels: Record<string, ChannelDef>
  defaultWorkspace: string
  api?: DiscordApi
  onEvent(event: ChannelEvent): Promise<ChannelAction[]>
}

export class DiscordBot {
  private readonly api: DiscordApi
  private readonly managedChannels = new Map<string, ChannelDef>()
  private readonly channelCache = new Map<string, { id: string; type: number; parentId?: string }>()
  private readonly recentSentMessageIds = new Set<string>()
  private readonly recentSeenMessageIds = new Set<string>()
  private socket: WebSocket | null = null
  private sequence: number | null = null
  private heartbeatTimer: Timer | null = null
  private queue = Promise.resolve()
  private readyResolve: (() => void) | null = null
  private readyReject: ((reason?: unknown) => void) | null = null
  private closeResolve: (() => void) | null = null
  private readonly readyPromise: Promise<void>
  private readonly closedPromise: Promise<void>

  constructor(private readonly opts: DiscordBotOptions) {
    this.api = opts.api ?? new DiscordApi()
    for (const channel of Object.values(opts.channels)) {
      this.managedChannels.set(channel.id, channel)
    }
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.closedPromise = new Promise<void>((resolve) => {
      this.closeResolve = resolve
    })
  }

  private noteRecentMessageId(target: Set<string>, messageId: string, cap: number): void {
    target.add(messageId)
    if (target.size > cap) {
      const first = target.values().next().value
      if (typeof first === "string") {
        target.delete(first)
      }
    }
  }

  private previewContent(content: string): string {
    const singleLine = content.replace(/\s+/g, " ").trim()
    if (singleLine.length <= 80) {
      return singleLine
    }
    return `${singleLine.slice(0, 77)}...`
  }

  private logMessageDecision(
    message: DiscordMessagePayload,
    deliver: boolean,
    reason: string,
    extra?: { scopeKey?: string; workspace?: string; actions?: number; sent?: number; error?: string },
  ): void {
    const parts = [
      `[fleet][discord][${this.opts.agentName}]`,
      `deliver=${deliver ? "yes" : "no"}`,
      `reason=${reason}`,
      `message=${message.id}`,
      `channel=${message.channel_id}`,
      `author_id=${message.author?.id ?? "unknown"}`,
      `author_type=${message.author?.bot ? "bot" : "human"}`,
      `preview=${JSON.stringify(this.previewContent(message.content))}`,
    ]

    if (extra?.scopeKey) {
      parts.push(`scope=${extra.scopeKey}`)
    }
    if (extra?.workspace) {
      parts.push(`workspace=${JSON.stringify(extra.workspace)}`)
    }
    if (typeof extra?.actions === "number") {
      parts.push(`actions=${extra.actions}`)
    }
    if (typeof extra?.sent === "number") {
      parts.push(`sent=${extra.sent}`)
    }
    if (extra?.error) {
      parts.push(`error=${JSON.stringify(extra.error)}`)
    }

    console.log(parts.join(" "))
  }

  async start(): Promise<void> {
    const gatewayUrl = await this.api.getGatewayUrl(this.opts.token)
    this.socket = new WebSocket(gatewayUrl)
    this.socket.onmessage = (event) => this.handleSocketMessage(String(event.data))
    this.socket.onerror = () => {
      if (this.readyReject) {
        this.readyReject(new Error("Discord gateway connection failed"))
        this.readyReject = null
      }
    }
    this.socket.onclose = () => {
      this.clearHeartbeat()
      this.closeResolve?.()
    }

    await this.readyPromise
  }

  async waitForClose(): Promise<void> {
    await this.closedPromise
  }

  async close(): Promise<void> {
    this.clearHeartbeat()
    this.socket?.close()
    await this.closedPromise
  }

  private handleSocketMessage(raw: string): void {
    const payload = JSON.parse(raw) as DiscordGatewayEnvelope
    if (typeof payload.s === "number") {
      this.sequence = payload.s
    }

    if (payload.op === DISCORD_GATEWAY_HELLO) {
      const intervalMs = Number(payload.d?.heartbeat_interval ?? 0)
      if (!intervalMs) {
        throw new Error("Discord gateway HELLO payload is missing heartbeat_interval")
      }
      this.startHeartbeat(intervalMs)
      this.identify()
      return
    }

    if (payload.op === DISCORD_GATEWAY_HEARTBEAT_ACK) {
      return
    }

    if (payload.op !== DISCORD_GATEWAY_DISPATCH || !payload.t) {
      return
    }

    if (payload.t === "READY") {
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
      return
    }

    if (payload.t === "MESSAGE_CREATE" && payload.d) {
      const message = payload.d as unknown as DiscordMessagePayload
      if (this.recentSeenMessageIds.has(message.id)) {
        this.logMessageDecision(message, false, "duplicate")
        return
      }
      this.noteRecentMessageId(this.recentSeenMessageIds, message.id, 500)
      this.queue = this.queue
        .then(() => this.handleMessage(message))
        .catch((error) => console.error(`[fleet] Discord bot handler error: ${error instanceof Error ? error.message : error}`))
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.sendGateway({
      op: DISCORD_GATEWAY_HEARTBEAT,
      d: this.sequence,
    })
    this.heartbeatTimer = setInterval(() => {
      this.sendGateway({
        op: DISCORD_GATEWAY_HEARTBEAT,
        d: this.sequence,
      })
    }, intervalMs)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private identify(): void {
    this.sendGateway({
      op: DISCORD_GATEWAY_IDENTIFY,
      d: {
        token: this.opts.token,
        intents: DISCORD_GATEWAY_INTENTS,
        properties: {
          os: process.platform,
          browser: "open-fleet",
          device: "open-fleet",
        },
      },
    })
  }

  private sendGateway(payload: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(payload))
  }

  private async handleMessage(message: DiscordMessagePayload): Promise<void> {
    if (!message.author || message.author.id === this.opts.botUserId) {
      this.logMessageDecision(message, false, "self_message")
      return
    }

    const delivery = evaluateDiscordMessageDelivery(message, this.opts.botUserId, this.recentSentMessageIds)
    if (!delivery.deliver) {
      this.logMessageDecision(message, false, delivery.reason)
      return
    }

    const channel = await this.getChannelContext(message.channel_id)
    const scopeKey = resolveScopeKey(
      message,
      channel ? { id: channel.id, type: channel.type, parent_id: channel.parentId } : null,
      this.managedChannels.keys(),
    )
    if (!scopeKey) {
      this.logMessageDecision(message, false, "unmanaged_scope")
      return
    }

    const workspace = this.resolveWorkspace(message.channel_id, channel)
    this.logMessageDecision(message, true, delivery.reason, { scopeKey, workspace })

    const stripped = stripBotMention(message.content, this.opts.botUserId)
    const event: ChannelEvent = {
      source: "discord",
      channelId: message.channel_id,
      messageId: message.id,
      scopeKey,
      workspace,
      author: {
        id: message.author.id,
        name: message.author.username,
        isBot: Boolean(message.author.bot),
      },
      content: stripped,
    }

    try {
      await this.api.triggerTyping(this.opts.token, message.channel_id)
    } catch {}

    try {
      const actions = await this.opts.onEvent(event)
      const sent = await this.executeActions(message.channel_id, actions)
      this.logMessageDecision(message, true, "actions_executed", {
        scopeKey,
        workspace,
        actions: actions.length,
        sent,
      })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      this.logMessageDecision(message, true, "handler_error", {
        scopeKey,
        workspace,
        error: messageText,
      })
      await this.executeActions(message.channel_id, [{
        type: "reply",
        text: `I hit an internal error while handling this request:\n\n\`${messageText}\``,
        replyToMessageId: message.id,
      }])
    }
  }

  private async getChannelContext(channelId: string): Promise<{ id: string; type: number; parentId?: string } | null> {
    if (this.managedChannels.has(channelId)) {
      return {
        id: channelId,
        type: 0,
      }
    }

    if (this.channelCache.has(channelId)) {
      return this.channelCache.get(channelId) ?? null
    }

    const channel = await this.api.getChannel(this.opts.token, channelId)
    const record = {
      id: channel.id,
      type: channel.type,
      parentId: channel.parentId,
    }
    this.channelCache.set(channelId, record)
    return record
  }

  private resolveWorkspace(
    channelId: string,
    channel: { id: string; type: number; parentId?: string } | null,
  ): string {
    const direct = this.managedChannels.get(channelId)
    if (direct?.workspace) {
      return direct.workspace
    }

    if (channel?.parentId) {
      const parent = this.managedChannels.get(channel.parentId)
      if (parent?.workspace) {
        return parent.workspace
      }
    }

    return this.opts.defaultWorkspace
  }

  private async executeActions(channelId: string, actions: ChannelAction[]): Promise<number> {
    const sentIds = await executeDiscordActions(this.api, this.opts.token, channelId, actions)
    for (const sentId of sentIds) {
      this.noteRecentMessageId(this.recentSentMessageIds, sentId, 200)
    }
    return sentIds.length
  }
}
