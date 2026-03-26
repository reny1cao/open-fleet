import { describe, expect, it } from "bun:test"
import {
  evaluateDiscordMessageDelivery,
  isBotMentioned,
  isReplyToRecentBotMessage,
  resolveScopeKey,
  shouldDeliverDiscordMessage,
  stripBotMention,
} from "../src/channel/discord/events"

describe("isBotMentioned", () => {
  it("returns true when the bot is explicitly mentioned", () => {
    expect(isBotMentioned({ content: "hi <@bot-2>", mentions: [{ id: "bot-1" }, { id: "bot-2" }] }, "bot-2")).toBe(true)
  })

  it("returns true for the nickname mention syntax", () => {
    expect(isBotMentioned({ content: "hi <@!bot-2>", mentions: [{ id: "bot-2" }] }, "bot-2")).toBe(true)
  })

  it("returns false when the mention is only implicit in metadata", () => {
    expect(isBotMentioned({ content: "reply without visible mention", mentions: [{ id: "bot-2" }] }, "bot-2")).toBe(false)
  })

  it("returns false when the bot is not mentioned", () => {
    expect(isBotMentioned({ content: "hello", mentions: [{ id: "bot-1" }] }, "bot-2")).toBe(false)
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

describe("isReplyToRecentBotMessage", () => {
  it("returns true when the message replies to a tracked bot message", () => {
    expect(
      isReplyToRecentBotMessage(
        { message_reference: { message_id: "msg-1" } },
        new Set(["msg-1"]),
      ),
    ).toBe(true)
  })

  it("returns false when the reply target is not tracked", () => {
    expect(
      isReplyToRecentBotMessage(
        { message_reference: { message_id: "msg-2" } },
        new Set(["msg-1"]),
      ),
    ).toBe(false)
  })
})

describe("shouldDeliverDiscordMessage", () => {
  it("allows a human reply to one of the bot's recent messages", () => {
    expect(
      shouldDeliverDiscordMessage(
        {
          content: "follow-up",
          author: { id: "user-1", bot: false },
          message_reference: { message_id: "msg-1" },
        },
        "bot-2",
        new Set(["msg-1"]),
      ),
    ).toBe(true)
  })

  it("requires an explicit mention for bot-authored replies", () => {
    expect(
      shouldDeliverDiscordMessage(
        {
          content: "follow-up",
          author: { id: "bot-1", bot: true },
          message_reference: { message_id: "msg-1" },
          mentions: [{ id: "bot-2" }],
        },
        "bot-2",
        new Set(["msg-1"]),
      ),
    ).toBe(false)
  })

  it("still allows explicit bot-to-bot handoffs", () => {
    expect(
      shouldDeliverDiscordMessage(
        {
          content: "<@bot-2> take this",
          author: { id: "bot-1", bot: true },
          mentions: [{ id: "bot-2" }],
        },
        "bot-2",
        new Set(["msg-1"]),
      ),
    ).toBe(true)
  })
})

describe("evaluateDiscordMessageDelivery", () => {
  it("returns explicit_mention when a visible mention is present", () => {
    expect(
      evaluateDiscordMessageDelivery(
        {
          content: "<@bot-2> take this",
          author: { id: "bot-1", bot: true },
          mentions: [{ id: "bot-2" }],
        },
        "bot-2",
        new Set(["msg-1"]),
      ),
    ).toEqual({
      deliver: true,
      reason: "explicit_mention",
    })
  })

  it("returns human_reply_to_recent_bot for human reply continuation", () => {
    expect(
      evaluateDiscordMessageDelivery(
        {
          content: "follow-up",
          author: { id: "user-1", bot: false },
          message_reference: { message_id: "msg-1" },
        },
        "bot-2",
        new Set(["msg-1"]),
      ),
    ).toEqual({
      deliver: true,
      reason: "human_reply_to_recent_bot",
    })
  })

  it("returns bot_reply_without_explicit_mention for bot replies without a visible mention", () => {
    expect(
      evaluateDiscordMessageDelivery(
        {
          content: "follow-up",
          author: { id: "bot-1", bot: true },
          message_reference: { message_id: "msg-1" },
        },
        "bot-2",
        new Set(["msg-1"]),
      ),
    ).toEqual({
      deliver: false,
      reason: "bot_reply_without_explicit_mention",
    })
  })

  it("returns no_trigger for unrelated human messages", () => {
    expect(
      evaluateDiscordMessageDelivery(
        {
          content: "hello there",
          author: { id: "user-1", bot: false },
        },
        "bot-2",
        new Set(["msg-1"]),
      ),
    ).toEqual({
      deliver: false,
      reason: "no_trigger",
    })
  })
})

describe("stripBotMention", () => {
  it("removes both standard mention syntaxes", () => {
    expect(stripBotMention("hello <@123> and <@!123>", "123")).toBe("hello  and")
  })
})
