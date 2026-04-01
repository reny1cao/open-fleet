# open-fleet — Project Overview

> Comprehensive project overview assembled by the fleet team. Last updated: 2026-04-01.

---

## 1. Project Summary

open-fleet is a CLI tool for managing fleets of AI coding agents (Claude, Codex) that collaborate via Discord. It handles agent lifecycle (start, stop, restart), identity/roster generation, Discord channel scoping, remote server deployment, health monitoring, and live observability — all from a single `fleet` command.

**Problem it solves:** Running multiple AI agents as a coordinated team requires managing tokens, Discord permissions, tmux sessions, identity prompts, remote servers, and health checks. open-fleet unifies all of this behind a declarative YAML config (`fleet.yaml`) and a single CLI.

**Tech stack:** TypeScript, Bun runtime, tmux for process management, Discord Bot API, SSH/SCP for remote servers. Single dependency: `yaml` for config parsing.

**Codebase:** 53 TypeScript source files, ~7,600 lines of code. 13 test files with 152 tests.

---

## 2. Architecture

### High-Level Module Map

```
┌──────────────────────────────────────────────────┐
│                   CLI (cli.ts)                   │
│           22 commands, hand-rolled arg parser    │
└──────┬───────┬──────────┬──────────┬─────────────┘
       │       │          │          │
       ▼       ▼          ▼          ▼
   ┌───────┐ ┌────────┐ ┌────────┐ ┌──────────┐
   │ Core  │ │ Agent  │ │Discord │ │ Watchdog │
   │       │ │Adapters│ │Channel │ │          │
   └───┬───┘ └───┬────┘ └───┬────┘ └────┬─────┘
       │         │          │            │
       └─────────┴────┬─────┘            │
                      ▼                  │
               ┌──────────┐             │
               │ Runtime  │◄────────────┘
               │(tmux/SSH)│
               └──────────┘
```

### Entry Point

`src/cli.ts` — no framework, just a switch statement dispatching to 22 command files. All commands support `--json` for scripting. Single external dependency: `yaml`.

### Core (`src/core/` — 5 files)

The foundation layer. No dependencies on other subsystems.

- **config.ts** — Loads `fleet.yaml` (YAML → `FleetConfig`), resolves bot tokens (env var → `.env` file), computes state directory paths (`~/.fleet/state/<fleet>-<agent>`), generates tmux session names (`<fleet>-<agent>`)
- **identity.ts** — Builds the agent system prompt (`identity.md`) with role, mission, and behavioral rules. Builds the dynamic roster (`CLAUDE.md`) with teammate names, roles, mention syntax, and channel assignments. Roster is re-read by Claude every turn, enabling hot updates without restart
- **heartbeat.ts** — Liveness protocol. A shell snippet (injected into each agent's wrapper script) writes a timestamp to `heartbeat.json` every 60 seconds. Readers classify: <60s = alive, <5min = stale, >5min = dead. Supports local and remote reads (via SSH)
- **activity.ts** — Parses raw terminal output into structured `ActivityEvent` objects. Classifies: discord messages, git operations, tool calls, errors, thinking states. Used by `fleet watch` for the live dashboard
- **types.ts** — Central type definitions: `FleetConfig`, `AgentDef`, `ServerConfig`, `ChannelDef`, `BotEntry`, `OrgStructure`

### Agent Adapters (`src/agents/` — 7 files, 2 adapters)

The adapter pattern abstracts how different AI agents are launched and managed. Interface: `AgentAdapter` with a single `start(ctx: StartAgentContext)` method. Factory in `resolve.ts` reads the `agentAdapter` field from config.

**Claude adapter** (`claude/adapter.ts` — 258 lines, largest single file):
1. Validates all bot tokens via Discord API → collects bot IDs and display names
2. Writes `identity.md`, `CLAUDE.md`, `access.json`, `settings.json` to state dir
3. For remote agents: SCPs all config files to the remote server
4. Generates a bash wrapper script with: heartbeat background loop, boot-check, crash-recovery retry loop (max 5 rapid restarts, 3s backoff)
5. Launches via runtime, handles permission prompts, waits for "Listening for channel messages"
6. Runs auto-patch after start to fix Discord plugin partner bot IDs

**Codex adapter** (`codex/` — 5 files):
- `adapter.ts` — Similar launch flow for OpenAI Codex
- `app-server.ts` — JSON-RPC client for Codex's app server protocol
- `bootstrap.ts` — Resolves Codex binary path, builds launch commands
- `state.ts` — Thread ID persistence (scope → thread mapping in `codex-threads.json`)
- `instructions.ts` — Builds Codex-specific developer instructions prompt

### Runtime (`src/runtime/` — 4 files)

Abstracts execution between local and remote machines. Both implement `RuntimeAdapter`: `start()`, `stop()`, `isRunning()`, `sendKeys()`, `captureOutput()`, `waitFor()`.

- **tmux.ts** — `TmuxLocal`: spawns tmux sessions with environment variables, captures output via `tmux capture-pane`, sends keystrokes via `tmux send-keys`, kills entire process tree on stop (not just the tmux session)
- **remote.ts** — `TmuxRemote`: same interface over SSH. Provides `sshRun()` and `scp()` helpers for remote command execution and file transfer
- **resolve.ts** — Factory: `server === "local"` → `TmuxLocal`, otherwise → `TmuxRemote`

### Discord Integration (`src/channel/discord/` — 4 files)

- **api.ts** — `DiscordApi` REST client: token validation (`/users/@me`), server/channel listing, channel creation, message sending. Used during setup, alerts, and bot ID discovery
- **bot.ts** — `DiscordBot` WebSocket gateway client for real-time message events and heartbeat
- **events.ts** — Message processing: mention detection (`isBotMentioned`), mention stripping, scope key resolution (channel/thread routing), thread detection
- **access.ts** — Reads/writes `access.json`: channel whitelist, partner bot IDs (for inter-agent @mentions), `requireMention` flag, owner user ID

### Watchdog (`src/watchdog/` — 7 files)

Autonomous health monitoring daemon, run via `fleet watchdog`.

- **daemon.ts** — Main loop with tiered check intervals: 15s local heartbeat, 30s local output scan, 30-60s remote checks, 5min disk, 10min patch. Detects Mac wake-from-sleep via tick gap analysis. **Note: no top-level try/catch — unhandled exceptions crash the process.**
- **checks.ts** — Five health checks: `checkSession` (tmux alive), `checkHeartbeat` (freshness — defined but never called in the daemon), `checkOutputStuck` (MD5 hash comparison + thinking spinner regex), `checkPlugin` (401/ECONNREFUSED pattern matching), `checkDiskSpace` (remote only via SSH + `df` — local disk is not monitored)
- **remediation.ts** — Three recovery actions: `restartAgent` (full restart, with cooldown), `sendCompact` (send /compact, no cooldown), `sendExitToAgent` (send /exit + let wrapper restart, with cooldown). Both `sendCompact` and `sendExitToAgent` redundantly reload fleet config on every call instead of receiving it as a parameter
- **alert.ts** — Discord notifications via the lead agent's bot token. Dedup by agent+event type (1hr window). @mentions fleet owner on critical alerts
- **state.ts** — Persistent JSON state at `~/.fleet/watchdog/state.json`: per-agent failure counts, cooldown timers, per-server reachability, alert dedup timestamps. Corrupt JSON is silently replaced with fresh state
- **log.ts** — Append-only JSONL event log at `~/.fleet/watchdog/events.jsonl`, 10MB rotation with 1 backup
- **types.ts** — Config defaults: 90%/95% disk thresholds, 5min restart cooldown, 30min compact cooldown, 1hr alert dedup

### Data Flow

**Agent startup:**
`fleet.yaml` → config loader → adapter → write identity files → generate wrapper script → runtime (tmux) → Claude Code starts → Discord plugin connects → listening for @mentions

**Message handling:**
Discord @mention → plugin gate (`access.json`) → agent notification → agent processes request → `reply()` tool → Discord channel

**Health monitoring:**
Watchdog loop → check session/output/plugin/disk → remediation (restart/compact/exit) → Discord alert to lead

### Key Design Decisions

- **1 bot = 1 tmux session** — Discord plugin loads once per process; tool names collide across instances; notifications carry no bot ID to disambiguate
- **File-based state, no database** — State lives in `~/.fleet/state/`, `fleet.yaml`, `access.json`, and `heartbeat.json`. No central coordinator
- **Split identity** — Fixed system prompt (`identity.md` via `--append-system-prompt-file`) + dynamic roster (`CLAUDE.md` re-read every turn). Enables roster updates and role injection without agent restart
- **Wrapper-based resilience** — Bash wrapper handles crash recovery with retry + backoff, not the fleet CLI. Max 5 rapid restarts before giving up

---

## 3. CLI Commands & Features

open-fleet exposes 22 CLI commands via `src/cli.ts`. All commands support `--json` for machine-readable output where applicable.

### Fleet Lifecycle

**`fleet init`** — First-time fleet setup. Creates fleet.yaml, .env, bot-ids.json, and generates identity/access files. Supports interactive mode (no args) or scripted mode (`--token`, `--name`, `--agent`, `--channel` flags). Handles Discord token validation, auto-guild detection, optional plugin patching, and templates. **Status: Complete.**

**`fleet start <agent>`** — Launches an agent in a tmux session (local or remote). Resolves the runtime adapter (Claude or Codex), validates all bot tokens via Discord API, generates identity.md, roster CLAUDE.md, and access.json. For remote agents, SCPs config files to the server. Wraps the agent process in a bash script with auto-restart (max 5 rapid retries, 30s minimum uptime threshold), heartbeat reporting, and boot-check. Supports `--wait` to block until the agent reports ready. **Status: Complete.** Known issues: auto-patch post-start can corrupt `--json` output (two JSON objects concatenated to stdout); patch errors silently swallowed by empty catch block.

**`fleet stop <agent>`** — Gracefully terminates an agent's tmux session via process group kill (full process tree). Prevents self-stop unless `--force` is passed. **Status: Complete.**

**`fleet restart <agent>`** — For Claude agents: sends `/exit` to the session (the wrapper script auto-restarts). For Codex agents: full stop followed by start. **Status: Complete.**

**`fleet apply`** — Starts all configured agents sequentially with `wait=true`. Reports started/already_running/failed for each. **Status: Complete.**

**`fleet clear <agent> | --all`** — Sends `/compact` to a running Claude Code agent to compress context in-place without restarting. The plugin stays alive, patches survive, and the session continues. Skips agents that aren't running. **Status: Complete.** Known issues: `--all` with zero agents gives misleading "Usage" error instead of "No agents configured"; no verification that `/compact` was actually processed by the agent (fire-and-forget).

### Observability & Monitoring

**`fleet status`** — Snapshot of all agents: running state (on/off/error), heartbeat health (alive/stale/dead), role, server, session name, and uptime. Reads heartbeat from local or remote paths. Color-coded terminal output. **Status: Complete.**

**`fleet logs <agent> | --all`** — Captures last N lines from tmux panes (local or remote via SSH). Supports `--follow` with line-diff detection for live tailing. `--all` aggregates logs from every agent. **Status: Complete.**

**`fleet watch`** — Continuous monitoring dashboard. Live-refresh loop (default 5s) showing agent states, heartbeats, and an activity feed extracted from logs (categorized by type: discord, bash, git, file_op, test, thinking, error). Clears screen between updates. **Status: Complete.**

**`fleet watchdog`** — Long-running health daemon. Monitors session liveness, output staleness, plugin crashes (401 auth, process death), auth expiry, and disk space. Triggers auto-remediation: restarts crashed agents, sends `/compact` for context pressure, alerts via Discord. Supports `--dry-run`, `--verbose`, and `--no-alert` flags. **Status: WIP (~60%).** Core monitoring loop works. Alert Discord integration is stubbed but not wired up. Some remediation paths and remote server checks are incomplete. Top-level error handling in the daemon loop is missing (unhandled exception crashes the process).

### Configuration & Identity

**`fleet doctor`** — Comprehensive diagnostic suite. Validates prerequisites (bun, tmux, claude, codex), checks CLI versions and auth status, validates all bot tokens, verifies plugin installation and patches, checks access.json schema, adapter constraints, running session health, and remote server connectivity. **Status: Complete.**

**`fleet validate`** — Schema validation for fleet.yaml. Checks required fields, Discord snowflake ID format, agent definitions (no duplicate token_env), channel references, topology constraints, lead agent presence, server configs, and access.json group keys. **Status: Complete.**

**`fleet patch`** — Collects bot IDs from all configured fleets via bot-ids.json, then patches the local (and remote) Discord plugin server.ts to set PARTNER_BOT_IDS and mention fallback. Handles both cache and marketplace plugin paths. **Status: Complete.**

**`fleet sync [agent]`** — Regenerates access.json, identity.md, and CLAUDE.md roster for one or all agents. SCPs updated files to remote agents. Validates all tokens during sync. Running agents pick up changes via 30s static config reload. **Status: Complete.**

**`fleet boot-check <agent>`** — Pre-launch verification. Regenerates access.json from fleet.yaml, verifies plugin patches are applied, verifies identity.md exists and is current, logs the boot command with a full environment snapshot. Used by the wrapper script before each agent launch. **Status: Complete.**

### Fleet Management

**`fleet add-agent`** — Registers a new agent. Adds entry to fleet.yaml and .env, validates the Discord bot token, regenerates identity/access/roster files for all agents, updates bot-ids.json, triggers a patch run, and prints the bot invite URL. **Status: Complete.**

**`fleet move <agent> <server>`** — Changes an agent's server assignment in fleet.yaml (local to remote or vice versa). Config-only change; requires manual restart to take effect. **Status: Complete.**

**`fleet set-adapter <agent> <claude|codex>`** — Updates an agent's adapter type in fleet.yaml. No runtime validation of compatibility. **Status: Complete.**

**`fleet use <fleet-name|path>`** — Switches the active fleet context. Accepts a directory path or a registered fleet name from `~/.fleet/config.json`. Updates the defaultFleet pointer. **Status: Complete.**

**`fleet setup-server <ssh-host>`** — Bootstraps a remote server for fleet use. SSHs to the host and installs/verifies tmux, bun, claude CLI, npm, and codex. Optionally syncs local Codex auth credentials. Reports installed versions on completion. **Status: Complete.**

**`fleet inject <agent> <role>`** — Runtime role injection. Reads role markdown from `identities/roles/` directory and sends it to a running agent via tmux sendKeys. No receipt confirmation. **Status: Complete.**

### Codex-Specific

**`fleet run-agent <agent>`** — Runs a Codex agent directly (outside tmux). Opens the Discord gateway, handles mentions via the Codex app-server, and manages thread IDs per scope. Codex-only — Claude agents throw an error. **Status: Complete.**

### Summary

- **Complete & stable:** 21 commands
- **WIP:** 1 command (watchdog — core loop works, alerts/remediation incomplete)
- **High-priority fixes:** `start --json` output corruption, silent patch error swallowing
- **Medium-priority:** `clear --all` error message, watchdog hardening
- **Low-priority:** `clear` `/compact` delivery verification, `inject` receipt confirmation

---

## 4. Code Quality & Tests

### Test Suite

- **Framework:** Bun test runner (`bun test`)
- **Results:** 152 tests, 0 failures, 266 assertions across 13 test files
- **Runtime:** ~500ms

### Coverage Map

**Well-tested (13 modules):**

| Test File | Covers |
|-----------|--------|
| config.test.ts | core/config — loadConfig, saveConfig, getToken, sessionName, findConfigDir |
| identity.test.ts | core/identity — buildIdentityPrompt, buildRosterClaudeMd, writeRoster |
| heartbeat.test.ts | core/heartbeat — readHeartbeat, writeHeartbeat, heartbeatShellSnippet |
| activity.test.ts | core/activity — parseActivity, extractRecentActivity |
| access.test.ts | channel/discord/access — writeAccessConfig, readAccessConfig |
| discord-api.test.ts | channel/discord/api — inviteUrl, pluginId, validateToken, sendMessage |
| discord-events.test.ts | channel/discord/events — isBotMentioned, resolveScopeKey, stripBotMention |
| agent-resolve.test.ts | agents/resolve — getAgentAdapterKind |
| codex-bootstrap.test.ts | agents/codex/bootstrap — expandHomePath, resolveCodexStateDir |
| codex-state.test.ts | agents/codex/state — getCodexThreadId, loadCodexThreadMap |
| logs.test.ts | commands/logs — diffLines |
| set-adapter.test.ts | commands/set-adapter — setAdapter |
| watch.test.ts | commands/watch — formatState, buildSnapshot |

**No test coverage (35 files / 64% of codebase):**

- **Commands (17 files):** add-agent, apply, boot-check, clear, doctor, init, inject, move, patch, restart, run-agent, setup-server, start, status, stop, sync, use, validate, watchdog
- **Watchdog (all 7 files):** alert, checks, daemon, log, remediation, state, types
- **Agent adapters (5 files):** claude/adapter, codex/adapter, codex/app-server, codex/instructions, agents/types
- **Runtime (4 files):** remote, tmux, resolve, types
- **Other:** cli.ts, index.ts, channel/discord/bot, channel/types

### Code Quality Findings

**Silent error swallowing — 23 empty `catch {}` blocks:**
Most are cleanup/fallback (temp file deletion, optional config reads), but some mask real errors:
- `core/config.ts` — JSON parse failures silently fall through to defaults
- `agents/claude/adapter.ts:250` — auto-patch failure after start is invisible
- `channel/discord/bot.ts:247` — JSON parse failure in message handling silently dropped

**Code duplication — 5 major patterns (~150-200 duplicated LOC):**
- `expandHome()` — defined independently in 5 files (config.ts, doctor.ts, validate.ts, claude/adapter.ts, codex/bootstrap.ts)
- `compareVersionSegments()` — copied in 3 files (doctor.ts, boot-check.ts, patch.ts)
- Plugin cache path resolution — duplicated in doctor.ts, boot-check.ts, patch.ts
- Token validation via `Promise.allSettled` — repeated in 4 files
- Access config regeneration — repeated in 3-4 files

**Type safety gaps:**
- `config: any` parameter in logs.ts
- `(def as any).stateDir` / `(agent.def as any).role` casts in watch.ts
- Double casts (`as unknown as T`) in codex/app-server.ts and discord/bot.ts

**Dead code:**
- `resetSequence()` exported from core/activity.ts but never imported anywhere

**Error handling inconsistency:**
- Some commands throw on error (start, stop, clear)
- Some use `Promise.allSettled` and continue (sync, adapters)
- Some `console.error` and continue (discord/bot)
- No uniform pattern across the codebase

### Hardcoded Values

These paths/values are repeated across 5+ files without a shared constant:
- `~/.fleet/state/...` — default state directory template
- `~/.claude/plugins/cache/claude-plugins-official/discord` — plugin cache path
- `/tmp/fleet-*` — temp file paths
- `5000` — timeout for CLI version/auth checks in doctor.ts

---

## 5. Infrastructure & Deployment

### Installation

Fleet installs via a one-liner that clones the repo to `~/.fleet`:

```
git clone https://github.com/reny1cao/open-fleet.git ~/.fleet
```

The `install.sh` script handles everything:
- Detects package manager (brew, apt, dnf, pacman)
- Auto-installs system deps: **bun**, **tmux**, **npm**
- Installs AI runtimes: **Claude Code** CLI, **Codex** CLI (via npm global)
- Patches the Discord plugin in `~/.claude/plugins/`
- Symlinks `~/.local/bin/fleet` -> `~/.fleet/fleet` to put the CLI on PATH

No npm package is published — distribution is source-based via git clone.

### Build System

**Runtime:** Bun (TypeScript runtime + bundler)

The `fleet` CLI is a bash wrapper that runs TypeScript directly:

```bash
exec bun run "${FLEET_ROOT}/src/index.ts" "$@"
```

No compilation step required. A legacy compiled binary (`fleet-next`, ~61MB Mach-O) exists but the source runner is now preferred for better debugging and unbuffered output.

**Dependencies are minimal:**
- **Runtime:** `yaml` (YAML parsing) — the only npm dependency
- **Dev:** `@types/bun`
- **System:** bun, tmux, ssh, scp, git, claude CLI, codex CLI

For remote Codex agents, fleet bundles itself into `fleet-remote.mjs` via `bun build`.

### Agent Launch Flow (`fleet start <agent>`)

1. Load `fleet.yaml` -> resolve agent config + Discord bot token from `.env`
2. Validate all bot tokens via Discord API -> collect bot IDs and display names
3. Generate runtime files in `~/.fleet/state/<agent>/`:
   - `identity.md` — fixed system prompt (role, channels, collaboration rules)
   - `.claude/CLAUDE.md` — dynamic teammate roster (re-read every turn)
   - `access.json` — Discord plugin channel/bot configuration
   - `wrapper.sh` — launch script with retry loop
4. Launch in tmux: `tmux new-session -d -s <session> bash wrapper.sh`

The wrapper script runs a crash-recovery loop:
- Background heartbeat (writes `heartbeat.json` every 30s)
- Runs `fleet boot-check` before each launch
- Launches Claude Code with `--dangerously-skip-permissions` + Discord plugin
- Auto-restarts on crash (max 5 rapid restarts, resets after 30s uptime)

### Remote Server Setup (`fleet setup-server <ssh-host>`)

Automates provisioning of remote servers:
1. SSH connectivity test (whoami + uname)
2. Install missing tools: tmux, bun, Claude Code, npm, Codex
3. Optionally copy Codex auth (`--reuse-codex-auth`)

For remote agents at runtime:
- Identity files are SCP'd to `~/.fleet/state/<agent>/` on the remote
- Claude agents launch via SSH + tmux (same wrapper pattern)
- Codex agents get the bundled `fleet-remote.mjs` SCP'd and run via bun

### Configuration Files

| File | Purpose |
|------|---------|
| `fleet.yaml` | Main config: agents, servers, channels, topology |
| `.env` | Bot tokens (gitignored) |
| `~/.fleet/config.json` | Global: fleet paths, proxy settings |
| `~/.fleet/state/<agent>/` | Runtime: identity, access, wrapper, heartbeat |

Config discovery order: `$FLEET_CONFIG` env -> CWD -> `$FLEET_DIR` -> `config.json` defaultFleet.

### Known Infra Issues

- **No versioning/release process** — no tags, changelog, or semver beyond 0.1.0
- **No lockfile committed** — low risk (1 dep) but not best practice
- **`install.sh` assumes Linux for remote** — no macOS brew path for remote tmux install
- **`--dangerously-skip-permissions` on all agents** — no granular permission model
- **Security model is tmux + SSH only** — no TLS or auth on the fleet control plane
- **`docs/knowledge/servers` committed with plaintext credentials** — SG-Dev root password and Neo4j password are in git history

---

## 6. Known Issues & TODOs

### From Today's Code Review (2026-04-01)

**High Priority:**
1. **`fleet start --json` output corruption** — auto-patch writes a second JSON object to stdout, corrupting machine-readable output
2. **Silent patch error swallowing** — `adapter.ts:247-250` has empty catch; should at least `console.warn`
3. **Plaintext credentials in git** — `docs/knowledge/servers` contains server passwords in repo history
4. **Watchdog `checkHeartbeat` defined but never called** — dead code in checks.ts; the heartbeat check is never invoked from the daemon loop

**Medium Priority:**
5. **`fleet clear` naming mismatch** — command is called "clear" but sends `/compact`. Consider renaming to `fleet compact`
6. **`--interval` flag only overrides localHeartbeat** — other watchdog intervals stay at defaults. Misleading UX
7. **`fleet clear --all` with zero agents** — gives misleading "Usage" error instead of "No agents configured"
8. **Watchdog daemon has no top-level error handling** — unhandled exception crashes the process
9. **`sendCompact` remediation has no cooldown** — unlike restart/exit which have cooldown timers

**Low Priority:**
10. **23 silent catch blocks** — need audit to distinguish intentional fallbacks from masked errors
11. **~150-200 lines of duplicated utility code** — expandHome, compareVersionSegments, plugin path resolution should be extracted to shared helpers
12. **64% of source files have zero test coverage** — entire watchdog, most commands, both adapters, all runtime code untested
13. **Type safety gaps** — several `any` casts and double-casts that bypass type checking
14. **No verification that `/compact` was processed** — fire-and-forget via sendKeys
15. **No receipt confirmation for `fleet inject`** — role injection is fire-and-forget
16. **Dead export:** `resetSequence()` in core/activity.ts never imported

### Backlog

- Watchdog alert Discord integration stubbed but not wired up
- Watchdog alerting channel not yet configurable via fleet.yaml
- No integration tests for the full start/stop lifecycle
- Remote agent boot-check is skipped (adapter.ts:134) — remote agents don't get pre-flight validation
- No versioning/release process — no tags, changelog, or semver beyond 0.1.0
- No lockfile committed
- `--dangerously-skip-permissions` on all agents — no granular permission model

---

## 7. Roadmap

*Suggested priorities based on today's review:*

1. **Harden watchdog** — wire up Discord alerts, add top-level error handling, call checkHeartbeat, add compact cooldown
2. **Fix start --json corruption** — separate patch stdout from command output
3. **Rotate credentials** — remove plaintext passwords from git history, use env vars
4. **Extract shared utilities** — expandHome, compareVersionSegments, plugin path resolution into `src/utils/`
5. **Expand test coverage** — prioritize watchdog, commands, and adapters
6. **Add release process** — semver tags, changelog, lockfile

---

*Document assembled by Ken Thompson. Architecture by Donald Knuth. CLI Commands by John Carmack. Infrastructure by Linus Torvalds. Code Quality by Ken Thompson.*
