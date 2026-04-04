import { describe, it, expect } from "bun:test"
import { buildReplacement, patchContent, patchMentionFallback } from "../src/commands/patch"

// ── buildReplacement ────────────────────────────────────────────────────────

describe("buildReplacement", () => {
  it("produces valid Set syntax for a single ID", () => {
    const result = buildReplacement(["123"])
    expect(result).toBe("const PARTNER_BOT_IDS = new Set([\n  '123',\n])")
  })

  it("produces valid Set syntax for multiple IDs", () => {
    const result = buildReplacement(["111", "222", "333"])
    expect(result).toContain("'111',")
    expect(result).toContain("'222',")
    expect(result).toContain("'333',")
    expect(result).toMatch(/^const PARTNER_BOT_IDS = new Set\(\[/)
    expect(result).toMatch(/\]\)$/)
  })

  it("handles empty array", () => {
    const result = buildReplacement([])
    expect(result).toBe("const PARTNER_BOT_IDS = new Set([\n\n])")
  })
})

// ── patchContent ────────────────────────────────────────────────────────────

describe("patchContent", () => {
  const replacement = buildReplacement(["999"])

  it("replaces existing PARTNER_BOT_IDS block", () => {
    const content = [
      "const PARTNER_BOT_IDS = new Set([",
      "  '111',",
      "  '222',",
      "])",
      "",
      "console.log('hello')",
    ].join("\n")

    const { updated, changed, patternFound } = patchContent(content, replacement)
    expect(patternFound).toBe(true)
    expect(changed).toBe(true)
    expect(updated).toContain("'999',")
    expect(updated).not.toContain("'111',")
  })

  it("injects fresh block when messageCreate + botDrop present but no PARTNER_BOT_IDS", () => {
    const content = [
      "client.on('messageCreate', msg => {",
      "  if (msg.author.bot) return",
      "  // handle message",
      "})",
    ].join("\n")

    const { updated, changed, patternFound } = patchContent(content, replacement)
    expect(patternFound).toBe(true)
    expect(changed).toBe(true)
    expect(updated).toContain("PARTNER_BOT_IDS")
    expect(updated).toContain("'999',")
    // Should replace "if (msg.author.bot) return" with partner-aware version
    expect(updated).toContain("!PARTNER_BOT_IDS.has(msg.author.id)")
  })

  it("returns unchanged when neither pattern is present", () => {
    const content = "const x = 42\nconsole.log(x)\n"
    const { updated, changed, patternFound } = patchContent(content, replacement)
    expect(patternFound).toBe(false)
    expect(changed).toBe(false)
    expect(updated).toBe(content)
  })

  it("returns changed=false when already up-to-date", () => {
    const content = [
      replacement,
      "",
      "console.log('rest of file')",
    ].join("\n")

    const { updated, changed, patternFound } = patchContent(content, replacement)
    expect(patternFound).toBe(true)
    expect(changed).toBe(false)
    expect(updated).toBe(content)
  })

  it("returns unchanged when only messageCreate present (no botDrop)", () => {
    const content = "client.on('messageCreate', msg => {\n  console.log(msg)\n})"
    const { changed, patternFound } = patchContent(content, replacement)
    expect(patternFound).toBe(false)
    expect(changed).toBe(false)
  })

  it("returns unchanged when only botDrop present (no messageCreate)", () => {
    const content = "if (msg.author.bot) return\nconsole.log('hello')"
    const { changed, patternFound } = patchContent(content, replacement)
    expect(patternFound).toBe(false)
    expect(changed).toBe(false)
  })
})

// ── patchMentionFallback ────────────────────────────────────────────────────

describe("patchMentionFallback", () => {
  const needle = "  if (client.user && msg.mentions.has(client.user)) return true"

  it("inserts fallback when needle is present", () => {
    const content = [
      "function checkMention() {",
      needle,
      "  return false",
      "}",
    ].join("\n")

    const { updated, changed } = patchMentionFallback(content)
    expect(changed).toBe(true)
    expect(updated).toContain("msg.content.includes(`<@${client.user.id}>`)")
  })

  it("returns changed=false when already patched", () => {
    const content = [
      "function checkMention() {",
      needle,
      "  // Fallback: check raw content for <@BOT_ID>",
      "  if (client.user && msg.content.includes(`<@${client.user.id}>`)) return true",
      "  return false",
      "}",
    ].join("\n")

    const { changed } = patchMentionFallback(content)
    expect(changed).toBe(false)
  })

  it("returns changed=false when needle is absent", () => {
    const content = "const x = 42\n"
    const { updated, changed } = patchMentionFallback(content)
    expect(changed).toBe(false)
    expect(updated).toBe(content)
  })
})
