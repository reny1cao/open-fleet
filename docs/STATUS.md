# Open Fleet — Current Status

Last updated: 2026-03-29

## Project Switch SOP

**Before switching out:**
1. Push all work — nothing uncommitted, all branches merged
2. Tests green — confirm full suite passes, post the count
3. Write/update STATUS.md — what's built, gaps, decisions, next priorities
4. Confirm in channel — each person posts "clean" once done

**When switching back in:**
1. Pull latest — `git pull`, check for changes since we left
2. Read STATUS.md — get up to speed
3. Run tests — `bun test`, confirm everything passes
4. Post in channel — "back online, STATUS.md read, tests green, ready"
5. Lead assigns first tasks

## What Shipped This Session

**152 tests passing across 13 test files.**

### Fleet Logs (`fleet logs`)
- `fleet logs <agent>` — tail agent's tmux pane output
- `fleet logs --all` — interleave all agents' output with agent name prefix
- `fleet logs <agent> --lines N` — last N lines (default 50)
- `--json` support for machine-readable output
- Works for local and remote agents (SSH + tmux capture)
- Handles empty tmux output gracefully

### Agent Heartbeat System
- Background process in agent wrapper writes `heartbeat.json` every 30s
- `readHeartbeat(stateDir)` — returns state: alive (< 60s), stale (< 5min), dead (>= 5min), unknown
- `readRemoteHeartbeat()` — SSH-reads heartbeat from remote agents
- Atomic writes (temp + rename) to prevent partial reads
- Injected into Claude adapter's wrapper script via `heartbeatShellSnippet()`

### Fleet Status Upgrade
- Shows heartbeat-aware state: `[alive]`, `[stale]`, `[hung?]`, `[on]`, `[off]`
- "Last seen" age in human-readable format (5s ago, 2m ago, 1h ago)
- JSON output includes `heartbeat`, `lastSeen`, `ageSec` fields
- Remote agents: reads heartbeat via SSH with correct `~` path expansion

### Fleet Watch (`fleet watch`)
- Phase 1: clear + print loop every 5s with agent status table
- Phase 2: parsed activity feed with event classification
  - Detects: git commits, test runs, file edits, Discord messages, thinking states
  - Strips ANSI codes and noise
  - Chronologically interleaved across all agents
  - Agent name prefix on each line

### Knowledge Docs (reverted)
- Built `loadKnowledgeDocs()` to auto-inject `~/.fleet/docs/knowledge/` into agent context
- Reverted per user feedback — injecting every learning into every session is not the right design
- Knowledge files remain in `~/.fleet/docs/knowledge/` for reference
- Better design needed (selective injection, per-project, or agent-requested)

## Known Gaps

- **Heartbeat is Claude-only** — Codex adapter doesn't use a wrapper script, so no heartbeat injection
- **SSH user mismatch** — `fleet logs`/`fleet status` may fail if SSH alias resolves to wrong user (config issue, not code bug)
- **Fleet watch activity feed** — output quality depends on what's in the tmux pane; agents in long-running operations show less meaningful activity
- **Knowledge docs design TBD** — auto-injection was too aggressive; need a better pattern (on-demand, per-project, or agent-requested)
- **No shared fleet memory** — agents don't share learnings across sessions (brainstorm item)
- **No task routing** — no shared work queue between agents (brainstorm item)

## Architecture Decisions

- **TypeScript + Bun** — fast startup, built-in test runner, single binary potential
- **tmux for process management** — universal, works over SSH, supports capture/send-keys
- **Heartbeat via background bash loop** — no daemon, cleaned up via trap, minimal footprint
- **CLAUDE.md for dynamic context** — re-read every turn by Claude Code, enables live roster updates
- **SSH for remote agents** — reuses existing infra, no new ports or services

## Next Priorities

1. **Shared fleet memory** — design a better pattern than auto-injecting all knowledge. Options: agent-requested retrieval, per-project knowledge, tagged/scoped docs
2. **Agent-to-agent task routing** — shared task queue (lead creates, workers claim, status flows automatically)
3. **Observability dashboard** — `fleet watch` Phase 3: TUI with panels, scrollable activity, alert on errors
4. **Codex heartbeat** — extend heartbeat to Codex adapter (different injection mechanism needed)
5. **Adoption improvements** — `fleet init` wizard, better error messages, guided setup for first-time users
