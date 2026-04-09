/**
 * Structured API error classification for fleet agent resilience.
 *
 * Provides a 3-stage classification pipeline that determines the correct
 * recovery action (retry, compact, rotate credential, alert, or abort)
 * from terminal output or error strings.
 *
 * Reference: Hermes Agent `agent/error_classifier.py`
 */

// ── Error taxonomy ──────────────────────────────────────────────────────

export type ErrorCategory =
  | "auth"              // 401/403 — token expired or invalid
  | "billing"           // 402 or credit exhaustion — rotate key or alert
  | "rate_limit"        // 429 — backoff, then rotate if available
  | "context_overflow"  // Context too large — compact, not restart
  | "server_error"      // 500/502/503 — transient, retry with backoff
  | "timeout"           // Connection/read timeout — retry
  | "format_error"      // 400 bad request — don't retry
  | "unknown"           // Unclassifiable — retry with backoff

export interface ClassifiedError {
  category: ErrorCategory
  retryable: boolean
  shouldCompact: boolean
  shouldRotateKey: boolean
  shouldAlert: boolean
  message: string
  statusCode?: number
  rawError: string
}

// ── Pattern lists ───────────────────────────────────────────────────────

const BILLING_PATTERNS = [
  "insufficient credits",
  "credit balance",
  "credits have been exhausted",
  "payment required",
  "billing hard limit",
  "exceeded your current quota",
  "account is deactivated",
]

const RATE_LIMIT_PATTERNS = [
  "rate limit",
  "rate_limit",
  "too many requests",
  "throttled",
  "tokens per minute",
  "requests per minute",
  "try again in",
  "please retry after",
]

// Signals that a usage-limit error is transient (not billing)
const TRANSIENT_SIGNALS = [
  "try again",
  "retry",
  "resets at",
  "reset in",
  "wait",
  "window",
]

const CONTEXT_OVERFLOW_PATTERNS = [
  "context length",
  "context size",
  "maximum context",
  "token limit",
  "too many tokens",
  "reduce the length",
  "context window",
  "prompt is too long",
  "max_tokens",
  "maximum number of tokens",
]

const AUTH_PATTERNS = [
  "invalid api key",
  "invalid_api_key",
  "authentication_error",
  "unauthorized",
  "forbidden",
  "invalid token",
  "token expired",
  "access denied",
  "please run /login",
]

const TRANSPORT_PATTERNS = [
  "econnrefused",
  "etimedout",
  "econnreset",
  "epipe",
  "ehostunreach",
  "socket hang up",
  "network timeout",
  "fetch failed",
  "dns resolution failed",
]

const SERVER_DISCONNECT_PATTERNS = [
  "server disconnected",
  "connection reset by peer",
  "connection was closed",
  "unexpected eof",
  "incomplete chunked read",
]

// ── Classification pipeline ─────────────────────────────────────────────

/**
 * Classify an error string into a structured recovery recommendation.
 *
 * 3-stage pipeline:
 *   1. HTTP status code + message refinement
 *   2. Message pattern matching (no status code)
 *   3. Transport/heuristic fallback
 */
export function classifyError(
  errorText: string,
  options: { sessionLong?: boolean } = {},
): ClassifiedError {
  const msg = errorText.toLowerCase()
  const statusCode = extractStatusCode(msg)

  const result = (
    category: ErrorCategory,
    overrides: Partial<ClassifiedError> = {},
  ): ClassifiedError => ({
    category,
    retryable: true,
    shouldCompact: false,
    shouldRotateKey: false,
    shouldAlert: false,
    message: summarize(category, errorText),
    statusCode: statusCode ?? undefined,
    rawError: errorText,
    ...overrides,
  })

  // ── Stage 1: Status code classification ──────────────────────────

  if (statusCode !== null) {
    const classified = classifyByStatus(statusCode, msg, result)
    if (classified) return classified
  }

  // ── Stage 2: Message pattern matching ────────────────────────────

  const classified = classifyByPattern(msg, result)
  if (classified) return classified

  // ── Stage 3: Heuristic fallback ──────────────────────────────────

  // Server disconnect on a long session → likely context overflow
  const isDisconnect = SERVER_DISCONNECT_PATTERNS.some(p => msg.includes(p))
  if (isDisconnect && options.sessionLong) {
    return result("context_overflow", {
      shouldCompact: true,
      message: "Server disconnected during long session — likely context overflow",
    })
  }

  // Transport errors
  if (TRANSPORT_PATTERNS.some(p => msg.includes(p))) {
    return result("timeout", { message: "Transport error — will retry" })
  }

  // Disconnect without long session context → timeout
  if (isDisconnect) {
    return result("timeout", { message: "Server disconnected — will retry" })
  }

  // ── Fallback: unknown ────────────────────────────────────────────

  return result("unknown")
}

// ── Stage 1: Status code ────────────────────────────────────────────────

function classifyByStatus(
  statusCode: number,
  msg: string,
  result: ResultFn,
): ClassifiedError | null {
  if (statusCode === 401) {
    return result("auth", {
      retryable: false,
      shouldRotateKey: true,
      shouldAlert: true,
      message: "Authentication failed (401) — token may be expired",
    })
  }

  if (statusCode === 403) {
    // OpenRouter-style "key limit exceeded" is billing, not auth
    if (msg.includes("key limit exceeded") || msg.includes("spending limit")) {
      return result("billing", {
        retryable: false,
        shouldRotateKey: true,
        shouldAlert: true,
        message: "Spending limit reached (403)",
      })
    }
    return result("auth", {
      retryable: false,
      shouldAlert: true,
      message: "Access forbidden (403)",
    })
  }

  if (statusCode === 402) {
    return classify402(msg, result)
  }

  if (statusCode === 429) {
    return result("rate_limit", {
      shouldRotateKey: true,
      message: "Rate limited (429) — backing off",
    })
  }

  if (statusCode === 400) {
    // Context overflow hidden in 400
    if (CONTEXT_OVERFLOW_PATTERNS.some(p => msg.includes(p))) {
      return result("context_overflow", {
        shouldCompact: true,
        message: "Context too large (400) — needs compaction",
      })
    }
    // Rate limit misreported as 400
    if (RATE_LIMIT_PATTERNS.some(p => msg.includes(p))) {
      return result("rate_limit", { shouldRotateKey: true })
    }
    return result("format_error", {
      retryable: false,
      shouldAlert: true,
      message: "Bad request (400) — possible format error",
    })
  }

  if (statusCode === 413) {
    return result("context_overflow", {
      shouldCompact: true,
      message: "Payload too large (413) — needs compaction",
    })
  }

  if (statusCode >= 500 && statusCode < 600) {
    return result("server_error", {
      message: `Server error (${statusCode}) — will retry`,
    })
  }

  // Other 4xx — non-retryable
  if (statusCode >= 400 && statusCode < 500) {
    return result("format_error", {
      retryable: false,
      shouldAlert: true,
      message: `Client error (${statusCode})`,
    })
  }

  return null
}

/**
 * Disambiguate 402: billing exhaustion vs transient usage limit.
 *
 * Key insight from Hermes: some 402s are transient rate limits disguised as
 * billing errors. "Usage limit, try again in 5 minutes" is NOT a billing
 * problem — it's a periodic quota that resets.
 */
function classify402(msg: string, result: ResultFn): ClassifiedError {
  const hasTransientSignal = TRANSIENT_SIGNALS.some(p => msg.includes(p))

  if (hasTransientSignal) {
    return result("rate_limit", {
      shouldRotateKey: true,
      message: "Transient usage limit (402 with retry signal) — treating as rate limit",
    })
  }

  return result("billing", {
    retryable: false,
    shouldRotateKey: true,
    shouldAlert: true,
    message: "Billing/credit exhaustion (402) — needs attention",
  })
}

// ── Stage 2: Pattern matching ───────────────────────────────────────────

function classifyByPattern(
  msg: string,
  result: ResultFn,
): ClassifiedError | null {
  // Billing (check before rate_limit — billing is more severe)
  if (BILLING_PATTERNS.some(p => msg.includes(p))) {
    return result("billing", {
      retryable: false,
      shouldRotateKey: true,
      shouldAlert: true,
      message: "Billing/credit exhaustion detected",
    })
  }

  // Rate limit
  if (RATE_LIMIT_PATTERNS.some(p => msg.includes(p))) {
    return result("rate_limit", {
      shouldRotateKey: true,
      message: "Rate limit detected — backing off",
    })
  }

  // Context overflow
  if (CONTEXT_OVERFLOW_PATTERNS.some(p => msg.includes(p))) {
    return result("context_overflow", {
      shouldCompact: true,
      message: "Context overflow detected — needs compaction",
    })
  }

  // Auth
  if (AUTH_PATTERNS.some(p => msg.includes(p))) {
    return result("auth", {
      retryable: false,
      shouldRotateKey: true,
      shouldAlert: true,
      message: "Authentication error detected",
    })
  }

  return null
}

// ── Helpers ─────────────────────────────────────────────────────────────

type ResultFn = (
  category: ErrorCategory,
  overrides?: Partial<ClassifiedError>,
) => ClassifiedError

/** Extract an HTTP status code from error text (e.g., "401 Unauthorized", "status: 429"). */
function extractStatusCode(msg: string): number | null {
  // Match "HTTP 429", "status 429", "status: 429", "error 429", or bare "429 Too Many"
  const match = msg.match(/(?:http|status|error)[:\s]+(\d{3})\b/i)
    ?? msg.match(/\b(\d{3})\s+(?:unauthorized|forbidden|not found|bad request|too many|internal server|service unavailable|payment required)/i)
  if (match) {
    const code = parseInt(match[1], 10)
    if (code >= 400 && code < 600) return code
  }
  return null
}

function summarize(category: ErrorCategory, raw: string): string {
  const truncated = raw.length > 120 ? raw.slice(0, 120) + "..." : raw
  const labels: Record<ErrorCategory, string> = {
    auth: "Authentication error",
    billing: "Billing/quota error",
    rate_limit: "Rate limited",
    context_overflow: "Context too large",
    server_error: "Server error",
    timeout: "Connection timeout",
    format_error: "Request format error",
    unknown: "Unclassified error",
  }
  return `${labels[category]}: ${truncated}`
}

// ── Convenience: classify terminal output lines ─────────────────────────

/**
 * Scan multi-line terminal output for error patterns.
 * Returns the most severe classification found, or null if no errors detected.
 *
 * Severity order: auth > billing > context_overflow > rate_limit > server_error > timeout > format_error > unknown
 */
const SEVERITY_ORDER: ErrorCategory[] = [
  "auth",
  "billing",
  "context_overflow",
  "rate_limit",
  "server_error",
  "timeout",
  "format_error",
  "unknown",
]

export function classifyTerminalOutput(
  output: string,
  options: { sessionLong?: boolean } = {},
): ClassifiedError | null {
  // Look for lines that contain error indicators
  const errorLines = output.split("\n").filter(line => {
    const l = line.toLowerCase()
    return (
      l.includes("error") ||
      l.includes("401") ||
      l.includes("402") ||
      l.includes("403") ||
      l.includes("429") ||
      l.includes("500") ||
      l.includes("503") ||
      l.includes("timeout") ||
      l.includes("econnrefused") ||
      l.includes("rate limit") ||
      l.includes("context length") ||
      l.includes("unauthorized") ||
      l.includes("authentication") ||
      l.includes("disconnected")
    )
  })

  if (errorLines.length === 0) return null

  let worst: ClassifiedError | null = null
  let worstIdx = SEVERITY_ORDER.length

  for (const line of errorLines) {
    const classified = classifyError(line, options)
    const idx = SEVERITY_ORDER.indexOf(classified.category)
    if (idx < worstIdx) {
      worst = classified
      worstIdx = idx
    }
  }

  return worst
}
