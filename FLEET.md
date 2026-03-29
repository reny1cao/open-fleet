# Fleet CLI — Agent Quick Reference

Fleet manages AI agent fleets across servers via Discord + tmux + SSH.

## Commands (use --json for machine output)

```
fleet status --json          # [{"name","server","state","role","heartbeat","lastSeen","ageSec"}]
fleet start <agent> --wait   # Start + wait for ready. --json for result
fleet stop <agent>           # Stop. FLEET_SELF blocks self-stop
fleet logs <agent>           # Last 50 lines from agent's tmux session
fleet logs <agent> --lines N # Last N lines
fleet logs --all             # Unified output from all agents (prefixed by name)
fleet logs <agent> --follow  # Tail live output (Ctrl+C to stop)
fleet watch                  # Live dashboard: agent status + activity feed (refreshes every 5s)
fleet watch --interval 10    # Custom refresh interval in seconds
fleet inject <agent> <role>  # Hot-inject role (writer/reviewer/ops)
fleet apply --json           # Start all agents from fleet.yaml
fleet doctor --json          # Health check with pass/fail/checks
fleet init --token T --channel C --name N  # Non-interactive setup
```

## Status heartbeat

Agents write a heartbeat every 30s to `~/.fleet/state/<agent>/heartbeat.json`. `fleet status` combines tmux session state with heartbeat recency:

```
[alive]  — tmux running + heartbeat < 60s
[stale]  — tmux running + heartbeat 1-5min old
[hung?]  — tmux running + heartbeat > 5min (may be stuck)
[on]     — tmux running, no heartbeat yet
[off]    — tmux session not found
```

## Fleet watch

`fleet watch` shows a live dashboard with agent status and an activity feed. Refreshes every 5 seconds. Ctrl+C to quit.

The activity feed parses tmux output and classifies events: Discord messages, git operations, file edits, test runs, errors. Noise (ANSI codes, progress bars, blank lines) is stripped automatically.

## Team knowledge

Files in `~/.fleet/docs/knowledge/` are automatically loaded into every agent's CLAUDE.md on boot. Add team learnings, server references, or project-specific rules — all agents inherit them without restart.

```
~/.fleet/docs/knowledge/
  neo4j-rules.md      # Database patterns
  docker-rules.md     # Container gotchas
  server-reference.md # IP addresses, credentials
```

To add knowledge: create a file, write the rules. Next agent turn picks it up.

## Exit codes
0=success, 1=usage error, 2=config error, 3=runtime error, 5=conflict

## Config
`fleet.yaml` — agents, servers, Discord channel. `.env` — tokens.
