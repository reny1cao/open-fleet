# Fleet Error Classifier with Recovery Flags

## Problem

The existing error classifier (`src/watchdog/error-classifier.ts`) handles LLM/API errors well — auth, billing, rate limits, context overflow, timeouts. But fleet agents fail in many other ways that the classifier doesn't cover: SSH connections drop, tmux sessions crash, disk fills up, config files corrupt, notifications fail silently, processes OOM. These errors are handled inconsistently — some throw, some log to stderr, some are silently swallowed.

The result: when something breaks outside the LLM path, the watchdog either doesn't notice or treats it as a generic restart case. An SSH timeout gets the same response as a corrupt config file. A full disk looks like a process crash.

## Current State

### Existing Classifier (LLM errors only)

```
src/watchdog/error-classifier.ts
  → 8 categories: auth, billing, rate_limit, context_overflow, server_error, timeout, format_error, unknown
  → 3-stage pipeline: status code → pattern match → heuristic
  → Recovery hints: retryable, shouldCompact, shouldRotateKey, shouldAlert
  → Integrated in: watchdog checkPlugin(), daemon remediation
```

This spec extends the system to cover the full error landscape without replacing what exists.

### Error Landscape (from codebase audit)

~120 distinct error handling sites across the codebase. Current handling strategies:

| Strategy | Frequency | Problem |
|----------|-----------|---------|
| Throw and propagate | 45% | No classification — caller gets a raw Error with a message string |
| Catch and log to stderr | 35% | Errors are logged but not categorized or acted on |
| Catch and return safe default | 15% | Graceful, but hides recurring issues |
| Silent ignore | 5% | Appropriate for cleanup, but sometimes hides real failures |

## Design

### Unified Error Taxonomy

Extend `ErrorCategory` to cover three domains:

```typescript
// Domain 1: LLM/API errors (existing, unchanged)
type LlmErrorCategory =
  | "auth"               // 401/403 — token expired or invalid
  | "billing"            // 402 — credit exhaustion
  | "rate_limit"         // 429 — backoff, rotate
  | "context_overflow"   // Context too large — compact
  | "server_error"       // 5xx — transient, retry
  | "timeout"            // Connection/read timeout — retry
  | "format_error"       // 400 — abort
  | "unknown"            // Unclassifiable — retry with backoff

// Domain 2: Infrastructure errors (new)
type InfraErrorCategory =
  | "ssh_connection"     // SSH connect/auth failure, EHOSTUNREACH
  | "ssh_timeout"        // SSH operation timed out (command, SCP)
  | "tmux_session_lost"  // Session crashed, not found, kill failed
  | "tmux_send_failed"   // send-keys or load-buffer failed
  | "process_crash"      // Agent process exited unexpectedly (Codex app-server, Claude Code)
  | "process_oom"        // Out of memory (detected via exit code 137 or OOM pattern)
  | "disk_full"          // Disk usage > threshold or write failure (ENOSPC)
  | "disk_degraded"      // Disk check failed but not critical
  | "network_unreachable"// EHOSTUNREACH, ENETUNREACH on non-SSH paths

// Domain 3: Data/config errors (new)
type DataErrorCategory =
  | "config_missing"     // fleet.yaml not found, required fields absent
  | "config_corrupt"     // YAML/JSON parse failure on config files
  | "store_corrupt"      // Task store or watchdog state unreadable
  | "token_missing"      // Bot token not in env or .env
  | "notification_failed"// Discord message delivery failure

type ErrorCategory = LlmErrorCategory | InfraErrorCategory | DataErrorCategory
```

**25 total categories** (8 existing + 12 infrastructure + 5 data). Each is specific enough to map to a recovery action, general enough to avoid category explosion.

### Recovery Flags

Extend `ClassifiedError` with new recovery hints:

```typescript
interface ClassifiedError {
  // Existing fields (unchanged)
  category: ErrorCategory
  retryable: boolean
  shouldCompact: boolean
  shouldRotateKey: boolean
  shouldAlert: boolean
  message: string
  statusCode?: number
  rawError: string

  // New fields
  severity: "info" | "warning" | "critical" | "fatal"
  recovery: RecoveryAction
  domain: "llm" | "infra" | "data"
  cooldownSec: number          // Minimum wait before retry (0 = immediate)
  maxRetries: number           // Max retry attempts before escalating (0 = don't retry)
  needsHuman: boolean          // Requires human intervention
  affectedAgent?: string       // Which agent is impacted (if known)
}

type RecoveryAction =
  | "retry"                // Retry the same operation after cooldown
  | "retry_backoff"        // Retry with exponential backoff
  | "restart_agent"        // Kill and restart the agent process
  | "compact"              // Send /compact to reduce context
  | "rotate_key"           // Try a different API key
  | "reconnect_ssh"        // Re-establish SSH connection
  | "recreate_session"     // Kill and recreate tmux session
  | "alert_human"          // Notify via Discord, wait for human
  | "abort"                // Stop trying, log and move on
```

### Decision Matrix

#### Infrastructure Errors

| Category | Severity | Recovery | Retryable | Cooldown | Max Retries | Needs Human |
|----------|----------|----------|-----------|----------|-------------|-------------|
| ssh_connection | critical | reconnect_ssh | Yes | 10s | 3 | After 3 failures |
| ssh_timeout | warning | retry_backoff | Yes | 5s | 5 | No |
| tmux_session_lost | critical | recreate_session | Yes | 0s | 1 | After 1 failure |
| tmux_send_failed | warning | retry | Yes | 2s | 3 | No |
| process_crash | critical | restart_agent | Yes | 5s | 3 | After 3 failures |
| process_oom | critical | restart_agent | Yes | 30s | 2 | After 2 failures |
| disk_full | fatal | alert_human | No | 0s | 0 | Yes |
| disk_degraded | info | abort | No | 0s | 0 | No |
| network_unreachable | critical | retry_backoff | Yes | 10s | 5 | After 5 failures |

#### Data/Config Errors

| Category | Severity | Recovery | Retryable | Cooldown | Max Retries | Needs Human |
|----------|----------|----------|-----------|----------|-------------|-------------|
| config_missing | fatal | alert_human | No | 0s | 0 | Yes |
| config_corrupt | fatal | alert_human | No | 0s | 0 | Yes |
| store_corrupt | critical | alert_human | No | 0s | 0 | Yes |
| token_missing | fatal | alert_human | No | 0s | 0 | Yes |
| notification_failed | info | retry | Yes | 5s | 2 | No |

#### LLM Errors (existing, for reference)

| Category | Severity | Recovery | Retryable | Cooldown | Max Retries | Needs Human |
|----------|----------|----------|-----------|----------|-------------|-------------|
| auth | critical | rotate_key | No | 0s | 0 | Yes |
| billing | critical | rotate_key | No | 0s | 0 | Yes |
| rate_limit | warning | retry_backoff | Yes | 30s | 10 | No |
| context_overflow | warning | compact | Yes | 0s | 1 | No |
| server_error | warning | retry_backoff | Yes | 5s | 5 | After 3 consecutive |
| timeout | warning | retry_backoff | Yes | 5s | 5 | After 3 consecutive |
| format_error | warning | abort | No | 0s | 0 | No |
| unknown | warning | retry_backoff | Yes | 10s | 3 | After 5 consecutive |

### Classification Pipeline

Extend the existing 3-stage pipeline to 5 stages:

```
Stage 1: Exit Code        → process_crash (non-zero), process_oom (137/killed)
Stage 2: Status Code      → existing LLM classifier (401, 402, 429, 5xx)
Stage 3: Error Code       → SSH/network (ECONNREFUSED, EHOSTUNREACH, ENOSPC, ENOMEM)
Stage 4: Pattern Match    → error message patterns (see below)
Stage 5: Heuristic        → large session → context_overflow, disk check → disk_*
```

Each stage returns early on match. Stages 1 and 3 are new; stages 2, 4, 5 are extensions of the existing pipeline.

### Pattern Lists (New Categories)

**SSH patterns:**
`Connection refused`, `Connection timed out`, `Connection reset by peer`,
`No route to host`, `Host key verification failed`, `Permission denied (publickey)`,
`ssh: connect to host`, `ssh_exchange_identification`, `SSH command failed`

**tmux patterns:**
`no server running`, `session not found`, `can't find session`,
`server exited unexpectedly`, `lost server`, `send-keys` + `failed`,
`load-buffer` + `failed`

**Process crash patterns:**
`exited unexpectedly`, `killed`, `signal: killed`, `SIGKILL`,
`segmentation fault`, `bus error`, `core dumped`

**OOM patterns:**
`out of memory`, `Cannot allocate memory`, `ENOMEM`, `oom-killer`,
`Killed process`, exit code `137`

**Disk patterns:**
`No space left on device`, `ENOSPC`, `disk quota exceeded`,
`filesystem full`, `cannot write`

**Config patterns:**
`fleet.yaml not found`, `is required`, `not defined in fleet.yaml`,
`Token not found`, `Corrupt task store`

**Notification patterns:**
`Failed to send Discord message`, `Discord API timed out`,
`Notification failed`, `token validation failed`

### How Agents Should Use It

#### 1. Watchdog Integration (automatic)

The watchdog already runs health checks every 30 seconds. Extend the check pipeline:

```
checkHeartbeat()    → stale heartbeat → classify as process_crash or network issue
checkPlugin()       → existing LLM classifier (unchanged)
checkSession()      → tmux session gone → classify as tmux_session_lost
checkDisk()         → disk > 90% → classify as disk_full / disk_degraded
checkConnectivity() → SSH ping fails → classify as ssh_connection / network_unreachable
```

Each check returns a `ClassifiedError` (or null if healthy). The daemon uses the recovery flags to pick the right action — no more if/else chains with string matching.

#### 2. Error-Aware Retry (new)

Replace the blind retry loop in agent wrapper scripts with classifier-informed retry:

```
Agent fails
  → Classify the error
  → If retryable: wait cooldownSec, retry up to maxRetries with backoff
  → If not retryable: check needsHuman
    → If needsHuman: alert via Discord, set task to blocked
    → If not needsHuman: log and abort
```

This eliminates the current pattern of restarting 5 times on a billing error.

#### 3. Task System Integration (new)

When an error affects a task, the classifier can auto-update task status:

```
Agent working on task-042
  → SSH timeout during deploy
  → Classifier: ssh_timeout, retryable, severity=warning
  → If retries exhausted: fleet task update task-042 --status blocked --reason "SSH timeout to sg-dev after 5 retries"
```

This gives the lead visibility into *why* a task is blocked, not just that it is.

#### 4. Discord Alerting (enhanced)

Current alerts are all "critical" severity. With the classifier:

```
info:     No alert. Logged only.
warning:  Alert after N consecutive occurrences (configurable, default 3).
critical: Alert immediately on first occurrence.
fatal:    Alert immediately + set all affected agent tasks to blocked.
```

Alert message includes the classified category and recovery hint:

```
[watchdog] John-Carmack: ssh_connection (critical)
  SSH connection to sg-dev refused — host may be down.
  Recovery: reconnect_ssh (retried 3/3, needs human)
```

### Consecutive Failure Tracking

The watchdog needs to track consecutive failures per agent per category to decide when to escalate:

```typescript
interface FailureTracker {
  agent: string
  category: ErrorCategory
  consecutiveCount: number
  firstSeen: string           // ISO timestamp of first failure in this streak
  lastSeen: string            // ISO timestamp of most recent failure
}
```

Stored in watchdog state (`~/.fleet/watchdog/state.json`). Reset to 0 when the error clears. This replaces the current simple "consecutive failure count" in the daemon with per-category tracking.

### Severity Escalation

Errors escalate severity based on consecutive failures:

```
warning  + 3 consecutive → escalate to critical
critical + 3 consecutive → escalate to fatal (needs human)
```

Example: `ssh_timeout` starts as `warning`. After 3 consecutive SSH timeouts, it escalates to `critical` and triggers an alert. After 3 more, it escalates to `fatal` and blocks affected tasks.

## What This Does NOT Include

- **Automatic remediation for fatal errors** — fatal means the system can't fix it. A human must intervene.
- **Cross-agent error correlation** — if all agents hit SSH errors simultaneously, it's probably a server issue, not 4 independent problems. This is a watchdog-level concern, not a classifier concern.
- **Error history/analytics** — the watchdog log already captures events. A separate `fleet watchdog stats` command could aggregate these, but that's a different task.
- **Custom error categories per fleet** — the taxonomy is fixed. If a fleet needs domain-specific categories, they can extend the type.

## Implementation Plan

### Phase 1 — Extend Taxonomy (small)

1. Add new categories to `ErrorCategory` type in `src/watchdog/error-classifier.ts`
2. Add pattern lists for SSH, tmux, process, disk, config, notification errors
3. Add stages 1 (exit code) and 3 (error code) to the classification pipeline
4. Add new fields to `ClassifiedError`: `severity`, `recovery`, `domain`, `cooldownSec`, `maxRetries`, `needsHuman`
5. Backward-compatible: existing LLM classification unchanged

**Effort:** Extend one file + update types. 2-3 hours.

### Phase 2 — Watchdog Integration

1. Update `checkSession()` to return `ClassifiedError` for tmux failures
2. Update `checkDisk()` to return `ClassifiedError` for disk issues
3. Add `checkConnectivity()` for SSH/network checks
4. Update `daemon.ts` remediation to use recovery flags instead of if/else chains
5. Add per-category consecutive failure tracking to watchdog state

**Effort:** Update 3-4 watchdog files. Half a sprint.

### Phase 3 — Agent Integration

1. Replace blind retry loop with classifier-informed retry in agent wrapper
2. Add task auto-block on exhausted retries (`fleet task update --status blocked --reason`)
3. Enhanced Discord alerts with severity levels and recovery hints

**Effort:** Update adapter files + alert module. Half a sprint.

## Open Questions

1. **Should the classifier be a standalone CLI command?** E.g., `fleet classify "Connection refused"` for debugging. Low effort, useful for testing patterns.
2. **Should `notification_failed` errors be retried silently or surfaced?** Currently they're fire-and-forget with a stderr log. The classifier could queue them for retry, but notification retries risk message duplication.
3. **Should consecutive failure state persist across watchdog restarts?** Currently watchdog state resets on restart. If the watchdog itself crashes and restarts, it loses the failure streak — first occurrence after restart won't trigger escalation.
