# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
bun run src/index.ts          # Run CLI in development (e.g., bun run src/index.ts status)
bun test                      # Run all tests
bun test test/config.test.ts  # Run a single test file
bun build --target bun --outfile fleet-remote.mjs src/index.ts  # Build remote binary
```

Runtime is **Bun** (not Node). Tests use Bun's built-in test runner (`bun:test`). There is no separate lint or format step.

## Architecture

Open Fleet is a CLI (`fleet`) that orchestrates AI agents across machines via **Discord + tmux + SSH**. The only runtime dependency is `yaml`. See `docs/ARCHITECTURE.md` for detailed design rationale.

### Core design rules

- **Hub never works** — The hub/lead agent is dispatch-only. Real work runs in background subagents to keep the hub's context window clean.
- **N bots = N sessions** — Each agent requires its own Claude Code process due to MCP plugin constraints (tool name collisions, shared state paths).
- **Star topology** — One hub coordinates N workers. No mesh or hierarchy.
- **fleet.yaml is the single source of truth** — All config reads go through `src/core/config.ts`. No hardcoded agent names, servers, or roles.

### Key flows

**Command routing:** `src/index.ts` → `src/cli.ts` (switch statement) → `src/commands/<name>.ts`. Each command is one file.

**Identity injection:** `src/core/identity.ts` generates an `identity.md` file in the agent's state directory. The Claude Code process loads it via `--append-system-prompt-file ${stateDir}/identity.md`. Role overlays (`identities/roles/*.md`) are injected into running agents via `runtime.sendKeys()` (see `src/commands/inject.ts`).

**Multi-instance isolation:** Multiple bots on one machine are isolated via `DISCORD_STATE_DIR` env var, which overrides the default `~/.claude/channels/discord/` state path.

**Adding a new CLI command:**
1. Create handler in `src/commands/<name>.ts`
2. Add the case to the switch in `src/cli.ts`
3. Update the `usage()` help text in `src/cli.ts`
4. Add shell completions in `completions/`
