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

## Exit codes
0=success, 1=usage error, 2=config error, 3=runtime error, 5=conflict

## Config
`fleet.yaml` — agents, servers, Discord channel. `.env` — tokens.
