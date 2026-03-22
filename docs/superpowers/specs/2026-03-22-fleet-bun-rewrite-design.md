# Fleet CLI — Bun/TypeScript Rewrite

> Full rewrite of the fleet CLI from bash to Bun/TypeScript. Foundation layer covering design + instantiate, with govern + adapt kept in mind architecturally.

## Why Rewrite

The bash CLI (~3.6K lines) works but fights its own language:
- JSON built via string concatenation → wrong schemas shipped
- Python3 spawned for every YAML query and JSON manipulation
- sed-patching TypeScript source code for bot-to-bot config
- No types, no tests, quoting bugs in production

Bun is already a required dependency. The Discord plugin is TypeScript. The rewrite unifies the stack.

## Design Principles

1. **Org-first, not bot-first** — Fleet models an organization (mission, structure, roles, decision rights, comms topology), not just a bag of processes
2. **Channel adapter interface** — Discord is the first adapter; Slack, Telegram, Matrix can follow without rewriting core
3. **No source patching** — Bot-to-bot config, partner IDs, and access control live in config files, not sed-injected into plugin source
4. **Identity at boot, not after** — Agents load their identity before the channel connects, eliminating the race condition
5. **Single binary** — `bun build --compile` produces one `fleet` executable. No Python3, no PyYAML

## Architecture

```
fleet (CLI entry point)
├── core/
│   ├── org.ts              # Organization model (mission, structure, topology)
│   ├── agent.ts            # Agent definition (name, role, identity, server)
│   ├── config.ts           # fleet.yaml read/write/validate
│   └── identity.ts         # Identity generation + boot file writing
├── channel/
│   ├── types.ts            # Channel adapter interface
│   ├── discord/
│   │   ├── adapter.ts      # Discord implementation
│   │   ├── api.ts          # Discord REST API client
│   │   └── access.ts       # access.json schema + generation
│   └── (future: slack/, telegram/)
├── runtime/
│   ├── types.ts            # Runtime adapter interface (tmux, future: docker, ssh)
│   ├── tmux.ts             # tmux session management (local)
│   └── remote.ts           # SSH + tmux (remote servers)
├── commands/
│   ├── init.ts             # fleet init (interactive + non-interactive)
│   ├── start.ts            # fleet start <agent>
│   ├── stop.ts             # fleet stop <agent>
│   ├── status.ts           # fleet status
│   ├── inject.ts           # fleet inject <agent> <role>
│   ├── add-agent.ts        # fleet add-agent
│   ├── apply.ts            # fleet apply (start all)
│   ├── doctor.ts           # fleet doctor
│   └── patch.ts            # fleet patch (legacy, thin — migrate to config-based)
├── cli.ts                  # Argument parsing + command dispatch
└── index.ts                # Entry point
```

## Organization Model

The core abstraction shift: fleet manages an **organization**, not just processes.

```typescript
// core/org.ts

interface Organization {
  name: string
  mission?: string                    // What this org exists to do
  structure: OrgStructure             // Topology + decision rights
  agents: Record<string, AgentDef>    // Named agents
  channel: ChannelConfig              // Communication layer
}

interface OrgStructure {
  topology: 'star' | 'hierarchy' | 'mesh' | 'squad'
  lead?: string                       // Agent name of the lead (star/hierarchy)
  decisionRights?: Record<string, string[]>  // future: who can approve what
}

interface AgentDef {
  role: string
  tokenEnv: string                     // Env var name, e.g. DISCORD_BOT_TOKEN_PM
  server: 'local' | string            // 'local' or server name from servers config
  identity: string                     // Path to identity file
  workspace?: string                   // Override default workspace
  stateDir?: string                    // Override for multi-instance isolation
}

// tokenEnv convention: DISCORD_BOT_TOKEN_<UPPER_AGENT_NAME>
// Tokens live in .env, never in fleet.yaml

interface ChannelConfig {
  type: 'discord'                      // Extensible to 'slack', 'telegram'
  channelId: string
  serverId?: string
  userId?: string                      // Owner's user ID
}
```

This maps to `fleet.yaml`:

```yaml
fleet:
  name: crew
  mission: "Development team for the qa project"

structure:
  topology: star
  lead: pm

discord:
  channel_id: "1234567890"
  server_id: "9876543210"
  user_id: "5555555555"

servers:
  staging:
    ssh_host: my-server
    user: dev

defaults:
  workspace: ~/workspace
  runtime: claude

agents:
  pm:
    role: lead
    server: local
  worker:
    role: worker
    server: local
  reviewer:
    role: reviewer
    server: local
```

Tokens stay in `.env` (not in YAML — secrets separate from config).

## Channel Adapter Interface

```typescript
// channel/types.ts

interface ChannelAdapter {
  /** Validate credentials (e.g., bot token) */
  validateToken(token: string): Promise<BotInfo>

  /** List servers/workspaces the bot is in */
  listServers(token: string): Promise<ServerInfo[]>

  /** List channels in a server */
  listChannels(token: string, serverId: string): Promise<ChannelInfo[]>

  /** Create a channel */
  createChannel(token: string, serverId: string, name: string, categoryId?: string): Promise<ChannelInfo>

  /** Look up a channel by name */
  getChannelByName(token: string, serverId: string, name: string): Promise<ChannelInfo | null>

  /** Generate access config for an agent */
  generateAccessConfig(opts: AccessConfigOpts): AccessConfig
}

interface AccessConfigOpts {
  channelId: string
  userId?: string                     // Owner's Discord user ID
  partnerBotIds: string[]             // Other bots in the fleet
  requireMention: boolean
  accessMode?: 'static' | 'dynamic'  // static = snapshot at boot, no mutations
}

  /** Generate invite URL */
  inviteUrl(appId: string): string

  /** Get the plugin identifier for --channels flag */
  pluginId(): string
}

interface BotInfo {
  id: string
  name: string
  appId: string
}

interface ServerInfo {
  id: string
  name: string
  ownerId?: string
}

interface ChannelInfo {
  id: string
  name: string
  type: 'text' | 'voice' | 'category'
}
```

Discord implements this interface. Future adapters (Slack, Telegram) implement the same interface with platform-specific details hidden.

## Identity at Boot

**Problem:** Currently, identity is injected via tmux send-keys after the session starts. Discord gateway connects first, messages arrive, agent responds without identity.

**Solution:** Write a per-agent CLAUDE.md to the agent's state directory, then start Claude Code with that directory as the project root (or use `--project-dir`).

```typescript
// core/identity.ts

function writeBootIdentity(agent: AgentDef, org: Organization, stateDir: string): void {
  const claudeMd = buildIdentityPrompt(agent, org)
  const claudeDir = join(stateDir, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(join(claudeDir, 'CLAUDE.md'), claudeMd)
}

function buildIdentityPrompt(agent: AgentDef, org: Organization): string {
  // Reads identities/<agent>.md + role overlay
  // Includes: team roster, channel, formatting rules
  // Returns full CLAUDE.md content
}
```

The `fleet start` command:
1. Write identity to `stateDir/.claude/CLAUDE.md`
2. Start Claude Code with `--project-dir stateDir` and `--channels`
3. Agent boots with identity already in context — no race

Each agent has its own `stateDir` (e.g., `~/.fleet/state/pm/`), so no CLAUDE.md conflicts.

**Workspace access:** The agent's actual workspace is set via a symlink or the identity prompt instructs the agent where to work. Alternatively, Claude Code's `--project-dir` can be the workspace, and we write the CLAUDE.md there in a fleet-specific subdirectory. We'll prototype both approaches and pick what works with Claude Code's actual behavior.

## Partner Bot Config (No Source Patching)

**Problem:** Currently, `PARTNER_BOT_IDS` is sed-patched into `server.ts`. Fragile, breaks on format changes.

**Solution:** The Discord plugin already reads `DISCORD_STATE_DIR` from env. We extend this pattern — write a `partners.json` to the state dir, and the plugin reads it at boot.

However, since we don't control the upstream Discord plugin source, we need a pragmatic approach:

**Option A (short-term):** Keep patching server.ts but do it properly from TypeScript with AST awareness (ts-morph or simple regex with validation).

**Option B (medium-term):** Fork the Discord plugin into the fleet repo. This gives us full control over partner IDs, access config, and any fleet-specific behavior.

**Recommendation:** Start with Option A (proper TS-aware patching), move to Option B when fleet needs plugin features upstream doesn't provide. The patch logic in TypeScript will be far more reliable than the current bash+sed+python approach.

## Runtime Adapter

```typescript
// runtime/types.ts

interface RuntimeAdapter {
  /** Start an agent session */
  start(opts: StartOpts): Promise<SessionInfo>

  /** Stop an agent session */
  stop(session: string): Promise<void>

  /** Check if session is running */
  isRunning(session: string): Promise<boolean>

  /** Send text to a running session */
  sendKeys(session: string, text: string): Promise<void>

  /** Capture session output */
  captureOutput(session: string, lines?: number): Promise<string>

  /** Wait for a pattern in session output */
  waitFor(session: string, pattern: RegExp, timeoutMs?: number): Promise<boolean>
}
```

Two implementations:
- **TmuxLocal** — local tmux sessions (current behavior)
- **TmuxRemote** — SSH + tmux (current behavior, but with proper timeouts and no `su -`)

## Config Module

```typescript
// core/config.ts

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

interface FleetConfig {
  fleet: { name: string; mission?: string }
  structure: OrgStructure
  discord: ChannelConfig
  servers?: Record<string, ServerConfig>
  defaults: DefaultsConfig
  agents: Record<string, AgentYamlDef>
}

function loadConfig(dir?: string): FleetConfig {
  // Find fleet.yaml, parse, validate schema
  // Throw typed errors for missing fields
}

function saveConfig(config: FleetConfig, dir: string): void {
  // Write fleet.yaml with comments preserved where possible
}

function loadEnv(dir: string): Record<string, string> {
  // Parse .env file, return token map
}
```

No Python3. No PyYAML. Bun's ecosystem handles YAML natively.

**Config search precedence** (matches bash behavior for coexistence):
1. `$FLEET_CONFIG` env var (explicit path)
2. `./fleet.yaml` (current directory)
3. `$FLEET_DIR/fleet.yaml` (fleet directory)

## Command: `fleet init`

The most complex command. Two modes:

**Interactive (human):**
```
fleet init
```
Walks through: prerequisites → tokens → server/channel discovery → team design → generate config.

**Non-interactive (agent):**
```
fleet init --token T1 --token T2 --name crew --agent pm:local:lead --agent worker:local:worker
```
Auto-detects server + channel. Fails loud if detection fails.

Both modes:
1. Validate tokens via Discord API (with 5s timeout)
2. Detect guild, auto-detect or create channel
3. Generate `fleet.yaml`, `.env`, identity files, access.json
4. Sync partner bot IDs (write config, patch if needed)
5. Print invite URLs + next steps

## Command: `fleet start`

```typescript
async function start(agent: string, opts: StartOpts) {
  const config = loadConfig()
  const agentDef = config.agents[agent]
  const token = getToken(agent, config)
  const stateDir = resolveStateDir(agent, config)

  // 1. Write identity to stateDir/identity.md
  writeBootIdentity(agentDef, config, stateDir)

  // 2. Write access.json to stateDir
  writeAccessConfig(agentDef, config, stateDir)

  // Identity loaded via --append-system-prompt-file (before channel connects)

  // 3. Start Claude Code via runtime adapter
  const runtime = agentDef.server === 'local'
    ? new TmuxLocal()
    : new TmuxRemote(config.servers[agentDef.server])

  const session = sessionName(config.fleet.name, agent)
  await runtime.start({
    session,
    env: {
      DISCORD_BOT_TOKEN: token,
      DISCORD_STATE_DIR: stateDir,
      FLEET_SELF: agent,
    },
    workDir: resolveWorkspace(agentDef, config),
    command: `claude --dangerously-skip-permissions --append-system-prompt-file ${stateDir}/identity.md --channels ${adapter.pluginId()}`,
  })

  // 4. Handle --dangerously-skip-permissions first-run confirmation
  //    Claude Code prompts for confirmation on first use. Auto-accept it.
  const accepted = await runtime.waitFor(session, /bypass|dangerous|permission|y\/n/i, 10_000)
  if (accepted) {
    await runtime.sendKeys(session, 'y\n')
  }

  // 5. Wait for ready (if --wait)
  if (opts.wait) {
    await runtime.waitFor(session, /Listening for channel messages/, 60_000)
  }
}
```

No identity injection race. No tmux send-keys for identity. No sleep 3.

## Command: `fleet doctor`

Health checks, all with proper timeouts:

1. Prerequisites (bun, claude, tmux, ssh)
2. Claude Code version (>= 2.1.80)
3. Config validation (fleet.yaml schema)
4. Token validation (Discord API, 5s timeout per token)
5. Plugin installed + patches applied
6. Access.json schema validation
7. Partner bot IDs in sync
8. SSH connectivity (remote servers, 5s timeout)
9. Running sessions match config

All checks return structured results. `--json` outputs array of `{check, status, message}`.

## File Layout (in repo)

```
~/.fleet/
├── src/
│   ├── index.ts
│   ├── cli.ts
│   ├── core/
│   │   ├── org.ts
│   │   ├── agent.ts
│   │   ├── config.ts
│   │   └── identity.ts
│   ├── channel/
│   │   ├── types.ts
│   │   └── discord/
│   │       ├── adapter.ts
│   │       ├── api.ts
│   │       └── access.ts
│   ├── runtime/
│   │   ├── types.ts
│   │   ├── tmux.ts
│   │   └── remote.ts
│   └── commands/
│       ├── init.ts
│       ├── start.ts
│       ├── stop.ts
│       ├── status.ts
│       ├── inject.ts
│       ├── add-agent.ts
│       ├── apply.ts
│       ├── doctor.ts
│       └── patch.ts
├── test/
│   ├── config.test.ts
│   ├── discord-api.test.ts
│   ├── access.test.ts
│   ├── identity.test.ts
│   └── commands/
│       ├── init.test.ts
│       └── start.test.ts
├── identities/
│   └── roles/
│       ├── writer.md
│       ├── reviewer.md
│       └── ops.md
├── skill/
│   └── SKILL.md
├── docs/
│   ├── ARCHITECTURE.md
│   └── TROUBLESHOOTING.md
├── package.json
├── tsconfig.json
├── bunfig.toml
├── install.sh              # Updated: builds from source or downloads binary
└── fleet -> built binary or bun runner
```

## Dependencies

```json
{
  "name": "open-fleet",
  "type": "module",
  "dependencies": {
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.5.0"
  }
}
```

Minimal. `yaml` for parsing fleet.yaml. Discord API calls use `fetch` (built into Bun). No discord.js needed in the CLI (that's the plugin's dependency, not ours). No commander/yargs — hand-rolled arg parsing keeps the binary small.

## Migration Path

1. **Phase 1: Core + init + start + stop + status** — Get basic fleet management working in TS. Validate identity-at-boot approach.
2. **Phase 2: doctor + add-agent + inject + apply** — Complete command parity with bash version.
3. **Phase 3: Tests + binary build** — `bun build --compile --outfile fleet`. Update install.sh.
4. **Phase 4: Remove bash** — Delete lib/*.sh. Single language.

Bash version stays functional during migration. Both can coexist (TS binary at `fleet-next`, bash at `fleet`). Swap when ready.

## Command: `fleet deps`

Checks and installs prerequisites. Replaces the bash `do_deps`.

```
fleet deps              # Check prerequisites
fleet deps --install    # Auto-install missing
```

Checks: bun, claude (>= 2.1.80), tmux, ssh, Discord plugin installed, `claude auth status`.
Auto-install: tmux via brew/apt/dnf/pacman, bun via curl, Claude Code via npm.

Note: `jq` and `python3`/`PyYAML` are no longer required in the TS version.

## Identity at Boot — Resolved

Claude Code supports `--append-system-prompt-file <path>`. This is the solution:

```bash
claude --dangerously-skip-permissions \
  --append-system-prompt-file ~/.fleet/state/pm/identity.md \
  --channels plugin:discord@claude-plugins-official
```

Each agent's identity file lives in its own state dir (`~/.fleet/state/<agent>/identity.md`). The flag appends it to the default system prompt before the session starts — before the channel connects, before any Discord messages arrive.

**No CLAUDE.md conflicts.** No project-dir workarounds. No race condition. The open question from the original spec is resolved.

## Note on `fleet inject`

`fleet inject <agent> <role>` for live role changes still uses `RuntimeAdapter.sendKeys`. This is intentional — hot injection into a running session can only work via tmux. The "no send-keys for identity" principle applies to **initial** identity only, not live overlays.

## Note on `DISCORD_ACCESS_MODE`

Fleet-managed agents should default to `DISCORD_ACCESS_MODE=static` in their env. This snapshots access.json at boot and prevents runtime mutations. The generated access.json uses `dmPolicy: "allowlist"` (not "pairing") since fleet agents don't need interactive pairing.

## Open Questions

1. **Plugin fork timing** — When does fleet need enough plugin control to justify forking discord plugin into the repo?
2. **Org structure in practice** — The `structure` field in fleet.yaml is forward-looking. For v1, only `topology: star` with `lead` is implemented. Hierarchy/mesh/squad come with govern + adapt layers.

## Resolved Questions

1. ~~`--project-dir` behavior~~ — **Resolved.** Claude Code has `--append-system-prompt-file <path>` which loads identity before the session starts. No CLAUDE.md conflicts, no race condition.

## Success Criteria

- `fleet init` → `fleet start` → bot responds in Discord (no race condition)
- Zero Python3 dependency
- Zero sed patching for core functionality
- All network calls have timeouts
- `fleet doctor --json` validates the full stack
- `bun test` passes
- Single compiled binary works on macOS and Linux
