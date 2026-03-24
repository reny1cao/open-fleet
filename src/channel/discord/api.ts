import type {
  ChannelAdapter,
  BotInfo,
  ServerInfo,
  ChannelInfo,
  AccessConfig,
  AccessConfigOpts,
} from "../types"

const BASE_URL = "https://discord.com/api/v10"
const BOT_PERMISSIONS = "117840"
const TIMEOUT_MS = 5000

// Discord channel type constants
const DISCORD_TYPE_TEXT = 0
const DISCORD_TYPE_VOICE = 2
const DISCORD_TYPE_CATEGORY = 4

function channelType(t: number): ChannelInfo["type"] | null {
  if (t === DISCORD_TYPE_TEXT) return "text"
  if (t === DISCORD_TYPE_VOICE) return "voice"
  if (t === DISCORD_TYPE_CATEGORY) return "category"
  return null
}

/**
 * Resolve proxy URL:
 *   1. Env var (HTTPS_PROXY / HTTP_PROXY)
 *   2. ~/.fleet/config.json → proxy field
 */
function resolveProxy(): string | undefined {
  // 1. Explicit env var (highest priority)
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
  if (envProxy) return envProxy

  // 2. Global fleet config
  try {
    const { readFileSync, existsSync } = require("fs") as typeof import("fs")
    const { join } = require("path") as typeof import("path")
    const { homedir } = require("os") as typeof import("os")
    const configPath = join(homedir(), ".fleet", "config.json")
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"))
      if (config.proxy) return config.proxy
    }
  } catch {}

  return undefined
}

async function discordFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const proxy = resolveProxy()

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", ...options.headers },
      signal: controller.signal,
      ...(proxy ? { proxy } : {}),
    } as RequestInit)
    return res
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Discord API timed out after ${TIMEOUT_MS / 1000}s (${path})`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export class DiscordApi implements ChannelAdapter {
  async validateToken(token: string): Promise<BotInfo> {
    const meRes = await discordFetch("/users/@me", token)
    if (!meRes.ok) {
      throw new Error(`Discord token validation failed: ${meRes.status} ${meRes.statusText}`)
    }
    const me = (await meRes.json()) as { id: string; username: string }

    // Try to get app info for appId; tolerate failure (bot may not have app access)
    let appId = me.id
    try {
      const appRes = await discordFetch("/oauth2/applications/@me", token)
      if (appRes.ok) {
        const app = (await appRes.json()) as { id: string }
        appId = app.id
      }
    } catch {
      // non-fatal — fall back to user id
    }

    return { id: me.id, name: me.username, appId }
  }

  async listServers(token: string): Promise<ServerInfo[]> {
    const res = await discordFetch("/users/@me/guilds", token)
    if (!res.ok) {
      throw new Error(`Failed to list servers: ${res.status} ${res.statusText}`)
    }
    const guilds = (await res.json()) as Array<{ id: string; name: string; owner_id?: string }>
    return guilds.map((g) => ({ id: g.id, name: g.name, ownerId: g.owner_id }))
  }

  async listChannels(token: string, serverId: string): Promise<ChannelInfo[]> {
    const res = await discordFetch(`/guilds/${serverId}/channels`, token)
    if (!res.ok) {
      throw new Error(`Failed to list channels: ${res.status} ${res.statusText}`)
    }
    const channels = (await res.json()) as Array<{ id: string; name: string; type: number }>
    const result: ChannelInfo[] = []
    for (const ch of channels) {
      const type = channelType(ch.type)
      if (type !== null) {
        result.push({ id: ch.id, name: ch.name, type })
      }
    }
    return result
  }

  async createChannel(
    token: string,
    serverId: string,
    name: string,
    categoryId?: string
  ): Promise<ChannelInfo> {
    const body: Record<string, unknown> = { name, type: DISCORD_TYPE_TEXT }
    if (categoryId !== undefined) body.parent_id = categoryId

    const res = await discordFetch(`/guilds/${serverId}/channels`, token, {
      method: "POST",
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Failed to create channel: ${res.status} ${res.statusText}`)
    }
    const ch = (await res.json()) as { id: string; name: string; type: number }
    return { id: ch.id, name: ch.name, type: "text" }
  }

  async getGatewayUrl(token: string): Promise<string> {
    const res = await discordFetch("/gateway/bot", token)
    if (!res.ok) {
      throw new Error(`Failed to fetch Discord gateway URL: ${res.status} ${res.statusText}`)
    }
    const body = (await res.json()) as { url: string }
    return `${body.url}?v=10&encoding=json`
  }

  async getChannel(
    token: string,
    channelId: string,
  ): Promise<{ id: string; name?: string; type: number; parentId?: string }> {
    const res = await discordFetch(`/channels/${channelId}`, token)
    if (!res.ok) {
      throw new Error(`Failed to fetch channel ${channelId}: ${res.status} ${res.statusText}`)
    }
    const body = (await res.json()) as { id: string; name?: string; type: number; parent_id?: string }
    return {
      id: body.id,
      name: body.name,
      type: body.type,
      parentId: body.parent_id,
    }
  }

  async getChannelByName(
    token: string,
    serverId: string,
    name: string
  ): Promise<ChannelInfo | null> {
    const channels = await this.listChannels(token, serverId)
    return channels.find((ch) => ch.name === name && ch.type === "text") ?? null
  }

  async triggerTyping(token: string, channelId: string): Promise<void> {
    const res = await discordFetch(`/channels/${channelId}/typing`, token, {
      method: "POST",
    })
    if (!res.ok) {
      throw new Error(`Failed to send typing indicator: ${res.status} ${res.statusText}`)
    }
  }

  async sendMessage(
    token: string,
    channelId: string,
    content: string,
    replyToMessageId?: string,
  ): Promise<void> {
    const body: Record<string, unknown> = { content }
    if (replyToMessageId) {
      body.message_reference = {
        message_id: replyToMessageId,
        fail_if_not_exists: false,
      }
      body.allowed_mentions = {
        parse: ["users", "roles", "everyone"],
        replied_user: false,
      }
    }

    const res = await discordFetch(`/channels/${channelId}/messages`, token, {
      method: "POST",
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Failed to send Discord message: ${res.status} ${res.statusText}`)
    }
  }

  generateAccessConfig(opts: AccessConfigOpts): AccessConfig {
    const { channels, userId, partnerBotIds, requireMention } = opts

    const groups: Record<string, { requireMention: boolean; allowFrom: string[] }> = {}
    for (const ch of Object.values(channels)) {
      groups[ch.id] = {
        requireMention,
        allowFrom: [],
      }
    }

    return {
      dmPolicy: "allowlist",
      allowFrom: [...partnerBotIds, ...(userId ? [userId] : [])],
      groups,
      pending: {},
    }
  }

  inviteUrl(appId: string): string {
    return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${BOT_PERMISSIONS}`
  }

  pluginId(): string {
    return "plugin:discord@claude-plugins-official"
  }
}
