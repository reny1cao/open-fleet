import { describe, expect, it } from "bun:test"
import { isBotMentioned, resolveScopeKey, stripBotMention } from "../src/channel/discord/events"

describe("isBotMentioned", () => {
  it("returns true when the bot is explicitly mentioned", () => {
    expect(isBotMentioned({ mentions: [{ id: "bot-1" }, { id: "bot-2" }] }, "bot-2")).toBe(true)
  })

  it("returns false when the bot is not mentioned", () => {
    expect(isBotMentioned({ mentions: [{ id: "bot-1" }] }, "bot-2")).toBe(false)
  })
})

describe("resolveScopeKey", () => {
  it("uses the channel scope for top-level messages in managed channels", () => {
    const scopeKey = resolveScopeKey(
      { channel_id: "chan-1" },
      { id: "chan-1", type: 0 },
      ["chan-1"],
    )

    expect(scopeKey).toBe("channel:chan-1")
  })

  it("uses the thread scope for messages inside a thread under a managed channel", () => {
    const scopeKey = resolveScopeKey(
      { channel_id: "thread-1" },
      { id: "thread-1", type: 11, parent_id: "chan-1" },
      ["chan-1"],
    )

    expect(scopeKey).toBe("thread:thread-1")
  })

  it("returns null for messages outside managed channels", () => {
    const scopeKey = resolveScopeKey(
      { channel_id: "chan-2" },
      { id: "chan-2", type: 0 },
      ["chan-1"],
    )

    expect(scopeKey).toBeNull()
  })
})

describe("stripBotMention", () => {
  it("removes both standard mention syntaxes", () => {
    expect(stripBotMention("hello <@123> and <@!123>", "123")).toBe("hello  and")
  })
})
