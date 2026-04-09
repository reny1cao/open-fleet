# Design: Error Classifier for Fleet Agent Resilience

**Author:** Ken Thompson
**Task:** task-175
**Status:** Draft
**Reference:** Hermes Agent `agent/error_classifier.py`

---

## Problem

Fleet's error handling is scattered and string-based. The watchdog uses inline regex
(`/ECONNREFUSED|plugin.*disconnected|401.*Unauthorized/`) to detect problems, and the
agent wrapper retries blindly (5 attempts, 3s delay, no backoff). There is no structured
classification — a billing error gets the same "restart" response as a transient timeout.

This leads to:
- **Wasted restarts** — restarting on billing exhaustion won't help
- **Missed compression** — context overflow looks like a generic 400, triggers restart instead of `/compact`
- **No credential rotation** — rate-limited keys aren't rotated, the agent just retries the same key
- **Alert noise** — everything is "critical" because there's no severity taxonomy

## Goals

1. Centralized error classification — one module that the watchdog, agent adapter, and future retry middleware all consult
2. Structured recovery hints — each classified error says what to do (retry, rotate, compact, fallback, abort)
3. Simplified 3-stage pipeline (Steve asked for 3 stages, not Hermes's 7)
4. TypeScript-native, zero dependencies, fits existing watchdog types

## Non-Goals

- Full provider-specific pattern matching (Hermes has ~100 patterns across 15 providers — we only talk to Anthropic/OpenAI via Claude Code and Codex)
- Credential pool rotation (we don't have a credential pool yet)
- Automatic model fallback (fleet agents are pinned to specific models)

---

## Design

### 3-Stage Classification Pipeline

Hermes uses a 7-stage pipeline because it supports 200+ models across many providers.
Fleet only proxies through Claude Code and Codex, so we can simplify to 3 stages:

```
Stage 1: Status Code    → HTTP status + message refinement
Stage 2: Pattern Match  → Error message patterns (no status code available)
Stage 3: Heuristic      → Transport errors, large-session inference
```

Each stage returns early on match. If no stage matches, fall through to `unknown` (retryable).

### Error Taxonomy

```typescript
type ErrorCategory =
  | "auth"               // 401/403 — token expired or invalid
  | "billing"            // 402 or credit exhaustion — rotate key or alert
  | "rate_limit"         // 429 — backoff, then rotate if available
  | "context_overflow"   // Context too large — compact, not restart
  | "server_error"       // 500/502/503 — transient, retry with backoff
  | "timeout"            // Connection/read timeout — retry
  | "format_error"       // 400 bad request — abort, don't retry
  | "unknown"            // Unclassifiable — retry with backoff
```

8 categories (vs Hermes's 13). Dropped: `model_not_found` (fleet agents don't switch
models), `payload_too_large` (Claude Code handles this), `thinking_signature` and
`long_context_tier` (Anthropic-specific, Claude Code handles internally).

### Recovery Hints

```typescript
interface ClassifiedError {
  category: ErrorCategory
  retryable: boolean
  shouldCompact: boolean       // Send /compact to the agent
  shouldRotateKey: boolean     // Try a different API key (future)
  shouldAlert: boolean         // Notify via Discord
  message: string              // Human-readable error summary
  statusCode?: number
  rawError: string             // Original error text for logging
}
```

### Decision Matrix

| Category | Retryable | Compact | Rotate Key | Alert | Watchdog Action |
|----------|-----------|---------|------------|-------|-----------------|
| auth | No | No | Yes | Yes (critical) | Alert, don't restart |
| billing | No | No | Yes | Yes (critical) | Alert, don't restart |
| rate_limit | Yes | No | Yes | No | Backoff, wait |
| context_overflow | Yes | Yes | No | No | Send /compact |
| server_error | Yes | No | No | After 3 consecutive | Retry with backoff |
| timeout | Yes | No | No | After 3 consecutive | Retry, check network |
| format_error | No | No | No | Yes (warn) | Log, don't restart |
| unknown | Yes | No | No | After 5 consecutive | Retry with backoff |

### Pattern Lists

Adapted from Hermes, trimmed to what fleet agents actually encounter:

**Billing patterns:** `insufficient credits`, `credit balance`, `payment required`,
`billing hard limit`, `exceeded your current quota`

**Rate limit patterns:** `rate limit`, `too many requests`, `throttled`,
`tokens per minute`, `try again in`

**Context overflow patterns:** `context length`, `maximum context`, `token limit`,
`too many tokens`, `reduce the length`, `prompt is too long`

**Auth patterns:** `invalid api key`, `authentication`, `unauthorized`,
`access denied`, `token expired`

**Transport error types:** `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`,
`EPIPE`, `EHOSTUNREACH`, `socket hang up`, `network timeout`

### Integration Points

1. **Watchdog `checkPlugin()`** — replace inline regex with `classifyError(output)`.
   The watchdog already captures terminal output; the classifier parses it.

2. **Watchdog daemon remediation** — use `ClassifiedError` hints to pick the right
   action (compact vs restart vs alert vs wait).

3. **Future: agent adapter retry loop** — the wrapper script's blind 5-retry loop
   could consult the classifier to decide whether restarting makes sense.

### 402 Disambiguation (from Hermes)

Hermes discovered that some 402s are transient rate limits disguised as billing errors
(e.g., "usage limit, try again in 5 minutes"). The classifier checks for transient
signals (`try again`, `retry`, `resets at`, `wait`) in 402 responses before classifying
as billing. This prevents unnecessary alerts on temporary quota limits.

### Large Session Heuristic (from Hermes)

When a server disconnect occurs with no status code and the agent has been running a
long session (detected via output patterns like high token counts or "context" mentions),
classify as `context_overflow` instead of `timeout`. This triggers `/compact` instead
of a restart that would just hit the same limit.

---

## File Structure

```
src/watchdog/
  error-classifier.ts    # ClassifiedError, classifyError(), pattern lists
  checks.ts              # Updated to use classifyError()
  daemon.ts              # Updated remediation logic
  types.ts               # Add ErrorCategory, ClassifiedError types
```

Single new file (`error-classifier.ts`), plus minor updates to existing watchdog files.

---

## What We're Taking from Hermes

| Hermes Pattern | Fleet Adaptation |
|---------------|------------------|
| 7-stage priority pipeline | 3-stage (status → pattern → heuristic) |
| 13 FailoverReason enum values | 8 ErrorCategory values |
| 402 billing vs rate-limit disambiguation | Same logic, simplified |
| Server disconnect + large session = context overflow | Same heuristic |
| `ClassifiedError` dataclass with recovery hints | Same pattern, TypeScript interface |
| Provider-specific pattern lists (~100 patterns) | ~30 patterns relevant to fleet |
| Credential pool rotation | Deferred (flag exists, not implemented) |

## What We're NOT Taking

- Anthropic thinking block signature handling (Claude Code handles internally)
- OpenRouter metadata.raw unwrapping (we don't use OpenRouter)
- Model fallback logic (fleet agents are pinned)
- Error code classification stage (our errors come from terminal output, not API bodies)
