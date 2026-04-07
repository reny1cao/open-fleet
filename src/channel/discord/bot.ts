import type { ChannelDef } from "../../core/types"
import { DiscordApi } from "./api"
import { isBotMentioned, resolveScopeKey, stripBotMention } from "./events"

const DISCORD_GATEWAY_HELLO = 10
const DISCORD_GATEWAY_HEARTBEAT_ACK = 11
const DISCORD_GATEWAY_DISPATCH = 0
const DISCORD_GATEWAY_IDENTIFY = 2
const DISCORD_GATEWAY_HEARTBEAT = 1
const DISCORD_GATEWAY_INTENTS = 1 | 512 | 32768
const MAX_DISCORD_MESSAGE_LENGTH = 2000

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
}

export interface DiscordMentionContext {
  channelId: string
  scopeKey: string
  workspace: string
  prompt: string
  replyToMessageId: string
}

interface DiscordBotOptions {
  token: string
  botUserId: string
  channels: Record<string, ChannelDef>
  defaultWorkspace: string
  api?: DiscordApi
  onMention(context: DiscordMentionContext): Promise<string>
}

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

export class DiscordBot {
  private readonly api: DiscordApi
  private readonly managedChannels = new Map<string, ChannelDef>()
  private readonly channelCache = new Map<string, { id: string; type: number; parentId?: string }>()
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
      return
    }

    if (!isBotMentioned(message, this.opts.botUserId)) {
      return
    }

    const channel = await this.getChannelContext(message.channel_id)
    const scopeKey = resolveScopeKey(
      message,
      channel ? { id: channel.id, type: channel.type, parent_id: channel.parentId } : null,
      this.managedChannels.keys(),
    )
    if (!scopeKey) {
      return
    }

    const workspace = this.resolveWorkspace(message.channel_id, channel)
    const stripped = stripBotMention(message.content, this.opts.botUserId)
    const prompt = [
      `Discord mention from ${message.author.username ?? message.author.id}.`,
      `Scope: ${scopeKey}`,
      `Workspace: ${workspace}`,
      "",
      "Message:",
      stripped.length > 0
        ? stripped
        : "You were explicitly mentioned in Discord without any additional text. Ask the user what they need.",
    ].join("\n")

    try {
      await this.api.triggerTyping(this.opts.token, message.channel_id)
    } catch (err) {
      process.stderr.write(`[discord] triggerTyping failed: ${err instanceof Error ? err.message : err}\n`)
    }

    try {
      const reply = await this.opts.onMention({
        channelId: message.channel_id,
        scopeKey,
        workspace,
        prompt,
        replyToMessageId: message.id,
      })
      await this.reply(message.channel_id, reply, message.id)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      await this.reply(
        message.channel_id,
        `I hit an internal error while handling this request:\n\n\`${messageText}\``,
        message.id,
      )
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

  private async reply(channelId: string, content: string, replyToMessageId: string): Promise<void> {
    const chunks = splitDiscordMessage(content)
    for (const [index, chunk] of chunks.entries()) {
      await this.api.sendMessage(
        this.opts.token,
        channelId,
        chunk,
        index === 0 ? replyToMessageId : undefined,
      )
    }
  }
}
