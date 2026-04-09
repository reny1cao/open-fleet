# Open Fleet — Current Status

Last updated: 2026-04-08

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

## What Shipped This Session (2026-04-07/08)

**193 tests passing across 14 test files. 6 sprints, 26+ tasks shipped.**

### Fleet Task System — Fully Operational
- `fleet task` CLI wired into binary — 7 subcommands (create, update, comment, list, board, show, recap)
- Agent self-serve: agents can update their own task status via CLI
- Token synced across server + all agents via shared `.env`
- Task lifecycle enforcement with path hints on invalid transitions
- Concise single-line notifications + error logging (no more silent `.catch`)
- Notification sender attribution — comes from the agent's bot, not lead's

### Project Wiki System
- `wiki/` scoped by workspace + role (shared → role → project)
- `fleet wiki list|show|set` CLI commands
- Injected on boot via `--append-system-prompt-file project-wiki.md`
- 4KB cap, path traversal protection
- `wiki/projects/open-fleet.md` populated with architecture + commands + conventions

### Dashboard v2 — World-Class Fleet Management UI
- **3 views:** Mission Control (agent cards + activity feed), Board (4-lane Kanban), Timeline (Gantt-lite)
- **Mission Control:** Agent grid with status dots, current task, heartbeat sparkline, daily stats. Idle cards show last completed task. Lead shows "lead" badge + assigned count.
- **Board:** 4 lanes (Backlog/Active/Review/Done). Active/Review 50% wider. Flow timing on cards. Stale indicators (yellow border). Sprint progress bar. Blocked-first sort.
- **Timeline:** Horizontal Gantt with color legend, collapsible idle rows, configurable range (4h/8h/12h/24h), restart button per agent, boot-check badges.
- **Agent modal:** Restart button + live log viewer (30 lines from tmux)
- **Task modal:** Flow timeline bar, dependency chain (recursive + reverse), notes history
- **Docs drawer:** Slide-out panel showing project docs (STATUS.md, wiki, ARCHITECTURE.md). Per-project via filesystem resolver. Lightweight inline markdown renderer.
- **Status bar:** Named agent pips, sprint momentum (done/total)
- **Activity feed:** Chronological events with date-aware timestamps
- **Security:** Token stripped from URL, XSS-safe (escapeHtml + escapeJs), auth on destructive ops only
- **Accessibility:** 11 ARIA attributes, focus management, loading states
- **UX:** Keyboard shortcuts (1/2/3 views, d docs, / search, Esc close), theme toggle, adaptive polling with backoff, graceful degradation on endpoint failures
- **Single self-contained HTML file** — zero dependencies, zero build step

### API Endpoints (server on port 4680)
- `GET /tasks`, `GET /tasks/board`, `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id`
- `GET /agents` (extended: recentActivity, dailyStats, activeTasks)
- `GET /activity?since=2h&limit=50`
- `GET /agents/:name/logs?lines=30`
- `POST /agents/:name/restart` (auth required)
- `GET /docs/:project`, `GET /docs/:project/*path`
- `GET /dashboard` (no auth)

### Infrastructure Fixes
- CLI binary symlink fixed
- Agent env: FLEET_API_URL, FLEET_API_TOKEN, FLEET_SELF, FLEET_DIR all injected
- `~/.fleet/config.json` global fallback created
- Heartbeat daemon for real alive/stale/dead status
- State dir mappings fixed in fleet.yaml
- Boot-check: tasks-context.md + project-wiki.md populated for all agents
- SG-Lab agents know their local server environment (CLAUDE.md updated)

### Codebase Polish
- 4 `any` types narrowed to proper types
- 5 unused imports removed
- 13 silent `.catch(() => {})` → error logging
- Dashboard: fake sparklines → deterministic hash, XSS onclick fix, layout flexbox, flow timing leak fix, dead CSS cleanup, badge backgrounds, mobile board fix

## Known Gaps

- **Heartbeat is Claude-only** — Codex adapter doesn't inject heartbeat
- **CLI stdout buffering** — `bun run src/cli.ts task` produces no output (Bun issue); API works fine
- **Wiki is boot-time only** — edits don't take effect until agent restart
- **No auto-zoom on timeline** — activity cluster detection computed but not applied to default range
- **Badge theming** — `color-mix()` not supported in Safari <16.2
- **No drag-and-drop on board** — read-only (signaled with cursor:default)
- **No server endpoint test coverage** — 193 unit tests, zero HTTP API tests

## Architecture Decisions

- **TypeScript + Bun** — fast startup, built-in test runner
- **tmux for process management** — universal, works over SSH
- **Single-file dashboard** — zero deps, curl-deployable, View Source debuggable
- **CLAUDE.md for dynamic context** — re-read every turn by Claude Code
- **SSH for remote agents** — reuses existing infra
- **Central task server on SG-Lab** — agents use localhost:4680, lead uses Tailscale
- **Filesystem-backed docs** — no database, resolver maps project → workspace via fleet.yaml

## Next Priorities

1. **Battle test with SysBuilder** — use the fleet task system for real project management
2. **CLI stdout fix** — investigate Bun buffering issue so `fleet task` works from local Mac
3. **Auto-zoom timeline** — detect activity cluster and set tight default range
4. **HTTP API tests** — cover the 11 endpoints
5. **Drag-and-drop on board** — visual affordance triggering `fleet task update`
6. **Wiki live reload** — mid-session wiki edits take effect without restart
