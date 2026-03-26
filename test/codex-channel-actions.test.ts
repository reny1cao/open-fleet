import { describe, expect, it } from "bun:test"
import type { ChannelEvent } from "../src/channel/protocol"
import { buildCodexChannelPrompt, parseCodexChannelActions } from "../src/agents/codex/channel-actions"

const event: ChannelEvent = {
  source: "discord",
  channelId: "chan-1",
  messageId: "msg-1",
  scopeKey: "channel:chan-1",
  workspace: "/tmp/workspace",
  author: {
    id: "user-1",
    name: "alice",
    isBot: false,
  },
  content: "please help",
}

describe("buildCodexChannelPrompt", () => {
  it("includes the event metadata and JSON schema instructions", () => {
    const prompt = buildCodexChannelPrompt(event)

    expect(prompt).toContain('message_id="msg-1"')
    expect(prompt).toContain('"actions"')
    expect(prompt).toContain("Return only valid JSON")
  })
})

describe("parseCodexChannelActions", () => {
  it("parses a valid JSON envelope", () => {
    const actions = parseCodexChannelActions(
      JSON.stringify({
        actions: [
          { type: "reply", text: "done", replyToMessageId: "msg-1" },
        ],
      }),
      event,
    )

    expect(actions).toEqual([
      { type: "reply", text: "done", replyToMessageId: "msg-1" },
    ])
  })

  it("parses JSON inside a fenced code block", () => {
    const actions = parseCodexChannelActions(
      '```json\n{"actions":[{"type":"reply","text":"done"}]}\n```',
      event,
    )

    expect(actions).toEqual([
      { type: "reply", text: "done", replyToMessageId: undefined },
    ])
  })

  it("falls back to a threaded reply when the model returns plain text", () => {
    const actions = parseCodexChannelActions("plain text reply", event)

    expect(actions).toEqual([
      { type: "reply", text: "plain text reply", replyToMessageId: "msg-1" },
    ])
  })

  it("allows a silent turn with an empty action list", () => {
    const actions = parseCodexChannelActions('{"actions":[]}', event)

    expect(actions).toEqual([])
  })
})
