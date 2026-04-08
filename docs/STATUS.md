# Open Fleet — Current Status

Last updated: 2026-04-08 01:27 UTC

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

---

## Session: 2026-04-07/08 — Dashboard v2, Task System, Wiki

**193 tests passing across 14 test files. 6 sprints, 26+ tasks shipped.**

### Sprint 1-2: Fleet Task System — Fully Operational
- `fleet task` CLI wired into binary — 7 subcommands (create, update, comment, list, board, show, recap)
- Agent self-serve: agents can update their own task status via CLI (fixed symlink, token sync, FLEET_DIR env)
- Task lifecycle enforcement with path hints on invalid transitions
- Concise single-line notifications + error logging (13 silent `.catch` → stderr)
- Notification sender attribution — comes from the agent's bot, not lead's
- SG-Lab agents know their local server environment (CLAUDE.md updated)
- Restart context analysis: 5 items preserved, 6 lost, documented recommendations

### Sprint 3: Project Wiki System
- `wiki/` scoped by workspace + role (shared → role → project)
- `fleet wiki list|show|set` CLI commands
- Injected on boot via `--append-system-prompt-file project-wiki.md`
- 4KB cap, path traversal protection
- Worker + reviewer wikis with full task lifecycle commands
- `wiki/projects/open-fleet.md` populated with architecture + commands + conventions

### Sprint 4: Dashboard v2 — 3-View Fleet Management UI
- **Mission Control:** Agent grid with status dots, current task, heartbeat sparkline, daily stats, live activity feed
- **Board:** 4-lane Kanban (Backlog/Active/Review/Done), flow timing on cards, stale indicators, sprint progress bar
- **Timeline:** Gantt-lite with color legend, collapsible idle rows, configurable range (4h/8h/12h/24h), restart button
- Agent modal: restart button + live log viewer (30 lines from tmux)
- Task modal: flow timeline bar, dependency chain (recursive + reverse), notes history
- Single self-contained HTML file — zero dependencies, zero build step

### Sprint 5: Picky Council QA — 8 fixes
- Sparklines: deterministic hash (not random noise)
- XSS: `escapeJs()` on all onclick handlers
- Layout: flexbox replaces calc(100vh)
- Flow timing: capped at completedAt
- Activity feed: batched into refresh cycle
- Restart button + log viewer in agent modal
- Loading states + 11 ARIA attributes + focus management
- Cleanup: dead CSS, badge backgrounds, mobile board, showTask cache

### Sprint 6: PM Polish
- Idle agent cards show last completed task or last action
- Lead card shows "lead" badge + assigned count (not "unknown")
- Timeline: color legend, collapsed idle rows, single now-line, active agents first
- Board: wider Active/Review lanes, sprint progress bar, read-only cursor
- Activity: date-aware timestamps ("Today"/"Yesterday"), named status pips, sprint momentum

### Docs Drawer
- Slide-out panel showing project docs (STATUS.md, wiki, ARCHITECTURE.md)
- Per-project via filesystem resolver (fleet.yaml channel workspace mappings)
- Lightweight inline markdown renderer (~40 lines)
- API: `GET /docs/:project`, `GET /docs/:project/*path`

### Infrastructure
- CLI binary symlink fixed
- Agent env: FLEET_API_URL, FLEET_API_TOKEN, FLEET_SELF, FLEET_DIR all injected
- `~/.fleet/config.json` global fallback
- Heartbeat daemon for real alive/stale/dead status
- State dir mappings fixed in fleet.yaml
- Boot-check: tasks-context.md + project-wiki.md populated for all agents
- Central task server on SG-Lab (101 tasks, shared store)

### Codebase Polish
- 4 `any` types narrowed, 5 unused imports removed
- 13 silent `.catch(() => {})` → error logging
- Validation: blockedReason + project max length, malformed JSON → 400
- No-op PATCH skip (don't bump updatedAt if nothing changed)

---

## Session: 2026-03-29 — Fleet Logs, Heartbeat, Watch

**152 tests passing across 13 test files.**

### Fleet Logs (`fleet logs`)
- `fleet logs <agent>` — tail agent's tmux pane output
- `fleet logs --all` — interleave all agents' output with agent name prefix
- `fleet logs <agent> --lines N` — last N lines (default 50)
- `--json` support for machine-readable output
- Works for local and remote agents (SSH + tmux capture)

### Agent Heartbeat System
- Background process in agent wrapper writes `heartbeat.json` every 30s
- `readHeartbeat(stateDir)` — returns state: alive (< 60s), stale (< 5min), dead (>= 5min), unknown
- `readRemoteHeartbeat()` — SSH-reads heartbeat from remote agents
- Atomic writes (temp + rename) to prevent partial reads

### Fleet Status Upgrade
- Shows heartbeat-aware state: `[alive]`, `[stale]`, `[hung?]`, `[on]`, `[off]`
- "Last seen" age in human-readable format
- JSON output includes `heartbeat`, `lastSeen`, `ageSec` fields

### Fleet Watch (`fleet watch`)
- Phase 1: clear + print loop every 5s with agent status table
- Phase 2: parsed activity feed with event classification

### Knowledge Docs (reverted)
- Built `loadKnowledgeDocs()` — reverted as too aggressive
- Knowledge files remain in `~/.fleet/docs/knowledge/` for reference

---

## Known Gaps

- **CLI stdout buffering** — `bun run src/cli.ts task` produces no output from local Mac (Bun issue)
- **Heartbeat is Claude-only** — Codex adapter doesn't inject heartbeat
- **Wiki is boot-time only** — edits don't take effect until agent restart
- **No auto-zoom on timeline** — activity cluster detection computed but not applied
- **Badge theming** — `color-mix()` not supported in Safari <16.2
- **No drag-and-drop on board** — read-only
- **No server endpoint test coverage** — 193 unit tests, zero HTTP API tests
- **Master/develop branch divergence** — 4 file conflicts need merge

## Architecture Decisions

- **TypeScript + Bun** — fast startup, built-in test runner
- **tmux for process management** — universal, works over SSH
- **Single-file dashboard** — zero deps, curl-deployable, View Source debuggable
- **CLAUDE.md for dynamic context** — re-read every turn by Claude Code
- **SSH for remote agents** — reuses existing infra
- **Central task server on SG-Lab** — agents use localhost:4680, lead uses Tailscale
- **Filesystem-backed docs** — resolver maps project → workspace via fleet.yaml

## Next Priorities

1. **Battle test with SysBuilder** — use fleet task system for real project management
2. **CLI stdout fix** — investigate Bun buffering issue
3. **Auto-zoom timeline** — detect activity cluster, set tight default range
4. **HTTP API tests** — cover the 11 endpoints
5. **Drag-and-drop on board** — visual affordance triggering `fleet task update`
6. **Wiki live reload** — mid-session wiki edits take effect without restart
7. **Master/develop merge** — resolve the 4-file conflict
