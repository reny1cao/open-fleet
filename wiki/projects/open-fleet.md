# Open Fleet Project

## Overview
Agent fleet orchestration system — manages multi-agent teams via Discord.

## Architecture
- CLI: Bun + TypeScript, entry at src/index.ts
- API server: HTTP on port 4680, Bearer token auth
- Task store: JSON file at ~/.fleet/tasks/<fleet>.json
- Agents: Claude Code processes managed via tmux sessions
- Dashboard: Self-contained HTML served at /dashboard

## Key Directories
- src/commands/ — CLI command handlers
- src/tasks/ — Task store, types, HTTP client, notifications
- src/server/ — API server + dashboard
- src/agents/ — Agent adapters (claude, codex)
- src/core/ — Config, identity, heartbeat, wiki
- wiki/ — Project wiki content (this system)
