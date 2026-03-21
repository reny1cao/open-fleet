# Fleet CLI — Agent Quick Reference

Fleet manages AI agent fleets across servers via Discord + tmux + SSH.

## Commands (use --json for machine output)

```
fleet status --json          # [{"name","server","state","role"}]
fleet start <agent> --wait   # Start + wait for ready. --json for result
fleet stop <agent>           # Stop. FLEET_SELF blocks self-stop
fleet inject <agent> <role>  # Hot-inject role (writer/reviewer/ops)
fleet apply --json           # Start all agents from fleet.yaml
fleet doctor --json          # Health check with pass/fail/checks
fleet init --token T --channel C --name N  # Non-interactive setup
```

## Exit codes
0=success, 1=usage error, 2=config error, 3=runtime error, 5=conflict

## Config
`fleet.yaml` — agents, servers, Discord channel. `.env` — tokens.
