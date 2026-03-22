export interface BotInfo { id: string; name: string; appId: string }
export interface ServerInfo { id: string; name: string; ownerId?: string }
export interface ChannelInfo { id: string; name: string; type: "text" | "voice" | "category" }

export interface AccessConfig {
  dmPolicy: "allowlist" | "pairing" | "disabled"
  allowFrom: string[]
  groups: Record<string, { requireMention: boolean; allowFrom: string[] }>
  pending: Record<string, never>
}

export interface AccessConfigOpts {
  channelId: string
  userId?: string
  partnerBotIds: string[]
  requireMention: boolean
}

export interface ChannelAdapter {
  validateToken(token: string): Promise<BotInfo>
  listServers(token: string): Promise<ServerInfo[]>
  listChannels(token: string, serverId: string): Promise<ChannelInfo[]>
  createChannel(token: string, serverId: string, name: string, categoryId?: string): Promise<ChannelInfo>
  getChannelByName(token: string, serverId: string, name: string): Promise<ChannelInfo | null>
  generateAccessConfig(opts: AccessConfigOpts): AccessConfig
  inviteUrl(appId: string): string
  pluginId(): string
}
