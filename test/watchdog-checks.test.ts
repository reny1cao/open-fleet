import { describe, it, expect } from "bun:test"
import { hashOutput } from "../src/watchdog/checks"

// ── hashOutput ──────────────────────────────────────────────────────────────

describe("hashOutput", () => {
  it("is deterministic — same input produces same output", () => {
    const a = hashOutput("hello world")
    const b = hashOutput("hello world")
    expect(a).toBe(b)
  })

  it("different inputs produce different outputs", () => {
    const a = hashOutput("hello")
    const b = hashOutput("goodbye")
    expect(a).not.toBe(b)
  })

  it("trims whitespace before hashing", () => {
    const a = hashOutput("  hello  \n")
    const b = hashOutput("hello")
    expect(a).toBe(b)
  })

  it("returns a 12-character hex string", () => {
    const result = hashOutput("test input")
    expect(result).toMatch(/^[0-9a-f]{12}$/)
  })

  it("handles empty string", () => {
    const result = hashOutput("")
    expect(result).toMatch(/^[0-9a-f]{12}$/)
  })
})

// ── Plugin error regex patterns (from checkPlugin) ─────────────────────────

describe("plugin error regex patterns", () => {
  const errorPattern = /ECONNREFUSED|plugin.*disconnected|401.*Unauthorized|authentication_error/i
  const authPattern = /401|authentication_error|Please run \/login/i

  it("matches ECONNREFUSED", () => {
    expect(errorPattern.test("Error: connect ECONNREFUSED 127.0.0.1:3000")).toBe(true)
  })

  it("matches plugin disconnected", () => {
    expect(errorPattern.test("plugin has disconnected unexpectedly")).toBe(true)
  })

  it("matches 401 Unauthorized", () => {
    expect(errorPattern.test("HTTP 401 Unauthorized")).toBe(true)
  })

  it("matches authentication_error", () => {
    expect(errorPattern.test("Error: authentication_error")).toBe(true)
    expect(authPattern.test("Error: authentication_error")).toBe(true)
  })

  it("matches 'Please run /login'", () => {
    expect(authPattern.test("Session expired. Please run /login to re-authenticate")).toBe(true)
  })

  it("does not match normal output", () => {
    expect(errorPattern.test("Agent is running normally, no errors")).toBe(false)
    expect(authPattern.test("Agent is running normally, no errors")).toBe(false)
  })
})

// ── Thinking/ideating regex pattern (from checkOutputStuck) ────────────────

describe("thinking regex pattern", () => {
  const thinkingPattern = /(?:Ideating|Thinking|Osmosing|Brewed|Baked|Crunched|Fluttering|Dilly|Perambulat|Sautéed|Shimmying|Churned|Cogitat).*\d+[ms]/i

  it("matches 'Thinking 5s'", () => {
    expect(thinkingPattern.test("Thinking 5s")).toBe(true)
  })

  it("matches 'Ideating 120s'", () => {
    expect(thinkingPattern.test("Ideating 120s")).toBe(true)
  })

  it("matches 'Cogitating 3m'", () => {
    expect(thinkingPattern.test("Cogitating 3m")).toBe(true)
  })

  it("does not match unrelated output", () => {
    expect(thinkingPattern.test("Wrote file src/main.ts")).toBe(false)
  })
})
