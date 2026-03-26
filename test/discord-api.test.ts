import { describe, it, expect } from "bun:test"
import { DiscordApi } from "../src/channel/discord/api"

const api = new DiscordApi()

// ── inviteUrl ─────────────────────────────────────────────────────────────────

describe("inviteUrl", () => {
  it("contains the correct client_id", () => {
    const url = api.inviteUrl("123456789")
    expect(url).toContain("client_id=123456789")
  })

  it("contains the correct permissions", () => {
    const url = api.inviteUrl("123456789")
    expect(url).toContain("permissions=117840")
  })

  it("contains the bot scope", () => {
    const url = api.inviteUrl("123456789")
    expect(url).toContain("scope=bot")
  })

  it("is a discord oauth2 authorize URL", () => {
    const url = api.inviteUrl("abc")
    expect(url).toStartWith("https://discord.com/oauth2/authorize")
  })
})

// ── pluginId ──────────────────────────────────────────────────────────────────

describe("pluginId", () => {
  it("returns the correct plugin identifier string", () => {
    expect(api.pluginId()).toBe("plugin:discord@claude-plugins-official")
  })
})

// ── generateAccessConfig ──────────────────────────────────────────────────────

describe("generateAccessConfig", () => {
  it("sets dmPolicy to allowlist", () => {
    const cfg = api.generateAccessConfig({
      channels: { default: { id: "chan-001" } },
      partnerBotIds: [],
      requireMention: false,
    })
    expect(cfg.dmPolicy).toBe("allowlist")
  })

  it("allowFrom is empty array when no userId", () => {
    const cfg = api.generateAccessConfig({
      channels: { default: { id: "chan-001" } },
      partnerBotIds: [],
      requireMention: false,
    })
    expect(cfg.allowFrom).toEqual([])
  })

  it("allowFrom contains userId when provided", () => {
    const cfg = api.generateAccessConfig({
      channels: { default: { id: "chan-001" } },
      userId: "user-999",
      partnerBotIds: [],
      requireMention: false,
    })
    expect(cfg.allowFrom).toContain("user-999")
  })

  it("groups contains an entry keyed by channelId", () => {
    const cfg = api.generateAccessConfig({
      channels: { default: { id: "chan-001" } },
      partnerBotIds: [],
      requireMention: true,
    })
    expect(cfg.groups["chan-001"]).toBeDefined()
  })

  it("group entry has requireMention set correctly", () => {
    const cfg = api.generateAccessConfig({
      channels: { default: { id: "chan-001" } },
      partnerBotIds: [],
      requireMention: true,
    })
    expect(cfg.groups["chan-001"].requireMention).toBe(true)
  })

  it("group entry allowFrom includes partnerBotIds", () => {
    const cfg = api.generateAccessConfig({
      channels: { default: { id: "chan-001" } },
      partnerBotIds: ["bot-a", "bot-b"],
      requireMention: false,
    })
    expect(cfg.allowFrom).toContain("bot-a")
    expect(cfg.allowFrom).toContain("bot-b")
  })

  it("group entry allowFrom includes userId when provided", () => {
    const cfg = api.generateAccessConfig({
      channels: { default: { id: "chan-001" } },
      userId: "user-999",
      partnerBotIds: ["bot-a"],
      requireMention: false,
    })
    expect(cfg.allowFrom).toContain("user-999")
    expect(cfg.allowFrom).toContain("bot-a")
  })

  it("pending is an empty object", () => {
    const cfg = api.generateAccessConfig({
      channels: { default: { id: "chan-001" } },
      partnerBotIds: [],
      requireMention: false,
    })
    expect(cfg.pending).toEqual({})
  })
})

// ── validateToken ─────────────────────────────────────────────────────────────

describe("validateToken", () => {
  it("rejects an invalid token (network call throws or returns error)", async () => {
    await expect(api.validateToken("invalid-token")).rejects.toThrow()
  })
})

// ── sendMessage ───────────────────────────────────────────────────────────────

describe("sendMessage", () => {
  it("disables reply mentions when posting a Discord reply", async () => {
    const originalFetch = globalThis.fetch
    const calls: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response('{"id":"sent-123"}', { status: 200 })
    }) as typeof fetch

    try {
      const sentId = await api.sendMessage("token-123", "chan-001", "hello", "msg-999")

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain("/channels/chan-001/messages")
      expect(sentId).toBe("sent-123")

      const body = JSON.parse(String(calls[0].init?.body))
      expect(body).toEqual({
        content: "hello",
        message_reference: {
          message_id: "msg-999",
          fail_if_not_exists: false,
        },
        allowed_mentions: {
          parse: ["users", "roles", "everyone"],
          replied_user: false,
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
