import { describe, it, expect } from "bun:test"
import { classifyError, classifyTerminalOutput } from "../src/watchdog/error-classifier"

describe("classifyError", () => {
  // ── Stage 1: Status code classification ──────────────────────────

  it("classifies 401 Unauthorized as auth", () => {
    const result = classifyError("HTTP 401 Unauthorized")
    expect(result.category).toBe("auth")
    expect(result.retryable).toBe(false)
    expect(result.shouldAlert).toBe(true)
  })

  it("classifies 403 with spending limit as billing", () => {
    const result = classifyError("error 403: key limit exceeded")
    expect(result.category).toBe("billing")
    expect(result.shouldRotateKey).toBe(true)
  })

  it("classifies 403 without spending limit as auth", () => {
    const result = classifyError("error 403: Forbidden")
    expect(result.category).toBe("auth")
  })

  it("classifies 429 as rate limit", () => {
    const result = classifyError("status: 429 Too Many Requests")
    expect(result.category).toBe("rate_limit")
    expect(result.retryable).toBe(true)
    expect(result.shouldRotateKey).toBe(true)
  })

  it("classifies 402 with transient signal as rate limit (not billing)", () => {
    const result = classifyError("error 402: Usage limit exceeded, try again in 5 minutes")
    expect(result.category).toBe("rate_limit")
    expect(result.retryable).toBe(true)
  })

  it("classifies 402 without transient signal as billing", () => {
    const result = classifyError("error 402: Payment Required - credits exhausted")
    expect(result.category).toBe("billing")
    expect(result.retryable).toBe(false)
    expect(result.shouldAlert).toBe(true)
  })

  it("classifies 400 with context length as context overflow", () => {
    const result = classifyError("error 400: context length exceeded")
    expect(result.category).toBe("context_overflow")
    expect(result.shouldCompact).toBe(true)
  })

  it("classifies 400 with rate limit pattern as rate limit", () => {
    const result = classifyError("error 400: too many requests, throttled")
    expect(result.category).toBe("rate_limit")
  })

  it("classifies plain 400 as format error", () => {
    const result = classifyError("error 400: malformed JSON in request body")
    expect(result.category).toBe("format_error")
    expect(result.retryable).toBe(false)
  })

  it("classifies 413 as context overflow", () => {
    const result = classifyError("HTTP 413 Payload Too Large")
    expect(result.category).toBe("context_overflow")
    expect(result.shouldCompact).toBe(true)
  })

  it("classifies 500 as server error", () => {
    const result = classifyError("HTTP 500 Internal Server Error")
    expect(result.category).toBe("server_error")
    expect(result.retryable).toBe(true)
  })

  it("classifies 503 as server error", () => {
    const result = classifyError("HTTP 503 Service Unavailable")
    expect(result.category).toBe("server_error")
    expect(result.retryable).toBe(true)
  })

  // ── Stage 2: Pattern matching ────────────────────────────────────

  it("detects billing from message patterns", () => {
    const result = classifyError("insufficient credits on your account")
    expect(result.category).toBe("billing")
  })

  it("detects rate limit from message patterns", () => {
    const result = classifyError("rate limit exceeded, please slow down")
    expect(result.category).toBe("rate_limit")
  })

  it("detects context overflow from message patterns", () => {
    const result = classifyError("prompt is too long for this model")
    expect(result.category).toBe("context_overflow")
    expect(result.shouldCompact).toBe(true)
  })

  it("detects auth from message patterns", () => {
    const result = classifyError("authentication_error: invalid api key provided")
    expect(result.category).toBe("auth")
  })

  // ── Stage 3: Heuristics ──────────────────────────────────────────

  it("classifies disconnect on long session as context overflow", () => {
    const result = classifyError("connection reset by peer", { sessionLong: true })
    expect(result.category).toBe("context_overflow")
    expect(result.shouldCompact).toBe(true)
  })

  it("classifies disconnect on short session as timeout", () => {
    const result = classifyError("connection reset by peer", { sessionLong: false })
    expect(result.category).toBe("timeout")
    expect(result.retryable).toBe(true)
  })

  it("classifies ECONNREFUSED as timeout", () => {
    const result = classifyError("ECONNREFUSED 127.0.0.1:3000")
    expect(result.category).toBe("timeout")
    expect(result.retryable).toBe(true)
  })

  it("returns unknown for unrecognized errors", () => {
    const result = classifyError("something weird happened in the flux capacitor")
    expect(result.category).toBe("unknown")
    expect(result.retryable).toBe(true)
  })
})

describe("classifyTerminalOutput", () => {
  it("returns null for clean output", () => {
    const result = classifyTerminalOutput("All systems operational\nListening for messages\n")
    expect(result).toBeNull()
  })

  it("picks the most severe error from multi-line output", () => {
    const output = [
      "Connecting to API...",
      "error 429: too many requests",
      "Also got: 401 Unauthorized",
      "Retrying...",
    ].join("\n")
    const result = classifyTerminalOutput(output)
    expect(result).not.toBeNull()
    // auth (401) is more severe than rate_limit (429)
    expect(result!.category).toBe("auth")
  })

  it("detects context overflow in terminal output", () => {
    const output = "Error: maximum context length exceeded for model claude-3"
    const result = classifyTerminalOutput(output)
    expect(result).not.toBeNull()
    expect(result!.category).toBe("context_overflow")
  })
})
