# Open Fleet Project

Agent fleet orchestration — manages multi-agent teams communicating via Discord.

## Architecture

- **CLI**: Bun + TypeScript. Entry: `src/index.ts` → `src/cli.ts`. Binary: `fleet` (bash wrapper running `bun run src/index.ts`)
- **API server**: HTTP on port 4680 (`src/server/index.ts`). Bearer token auth via `FLEET_API_TOKEN`
- **Task store**: JSON at `~/.fleet/tasks/<fleet-name>.json`. Status flow: backlog → open → in_progress → review → verify → done
- **Agents**: Claude Code processes in tmux sessions. Each agent = one Discord bot token
- **Dashboard**: Self-contained HTML at `/dashboard` (no auth, JS handles token)
- **Watchdog**: Health daemon checking session, heartbeat, output staleness, disk

## Key Directories

```
src/commands/     CLI command handlers (23 commands)
src/tasks/        Task store, types, HTTP client, notifications
src/server/       API server + dashboard HTML
src/agents/       Agent adapters: claude/ (plugin-based) and codex/ (native)
src/core/         Config loader, identity builder, heartbeat, wiki sections
src/channel/      Discord bot + API client + access control
src/runtime/      Tmux session management (local + SSH remote)
src/watchdog/     Health checks, remediation, state tracking
wiki/             Project knowledge (this system) — injected at boot
```

## Agent Startup Flow

1. `fleet start <agent>` loads `fleet.yaml`, selects adapter (Claude or Codex)
2. `boot-check` runs: regenerates `access.json`, `identity.md`, `tasks-context.md`, `project-wiki.md`
3. Wrapper script launches in tmux with auto-restart (3 retries max, 30s min uptime)
4. Claude starts with: `--append-system-prompt-file` for identity + tasks + wiki, `--add-dir` for workspace, `--channels` for Discord plugin
5. Heartbeat written every 30s. Watchdog monitors liveness

## API Endpoints (port 4680)

GET `/tasks` (list, ?assignee/?status/?project), GET `/tasks/:id`, POST `/tasks` (create), PATCH `/tasks/:id` (update), GET `/tasks/board` (kanban), GET `/agents` (status+heartbeat), GET `/dashboard` (web UI, no auth).

## Essential CLI Commands

```
fleet task update <id> --status <s> [--note "..."] [--result '{"summary":"..."}']
fleet task list [--mine] [--status <s>]
fleet task board
fleet task show <id>
fleet start/stop/restart <agent>
fleet status [--json]
fleet logs <agent> [--follow]
fleet server start/stop/status
fleet doctor                    # diagnose config/plugin/token issues
fleet patch                     # apply Discord plugin patches
```

## Environment Variables

Agents receive these at boot:
- `FLEET_SELF` — agent name (e.g., "John-Carmack")
- `FLEET_API_URL` — API server URL (http://127.0.0.1:4680)
- `FLEET_API_TOKEN` — bearer token for API auth
- `FLEET_DIR` — path to fleet.yaml directory

## Config: fleet.yaml

Single source of truth. Defines: fleet name, Discord server/channels, agent definitions (role, server, identity, workspace, channels), server configs for remote agents.

State dirs: `~/.fleet/state/<fleetName>-<agentName>/` (identity.md, access.json, CLAUDE.md, tasks-context.md, project-wiki.md).

## Notification System

Task notifications fire on status changes (assigned, done, blocked, review, verify, reassign). Sent as Discord messages with @mentions. All errors logged to stderr with `[notify]` prefix. Notifications are single-line format.

## Working Conventions

- Branch: `develop` (never push to `main`)
- Commit prefixes: `fix:`, `feat:`, `refactor:`, `docs:`
- Update task status promptly: `in_progress` on start, `done` on finish
- Report results via Discord — terminal output is invisible to teammates
- Always @mention teammates so they get notifications
