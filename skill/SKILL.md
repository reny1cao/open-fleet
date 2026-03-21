---
name: fleet
description: Manage an AI coding agent fleet — start, stop, inject roles, check status, and diagnose issues across local and remote servers
user_invocable: true
---

# Fleet — Agent Fleet Manager

You manage a fleet of AI coding agents across multiple servers. Each agent is a Claude Code session with a Discord channel plugin. All operations go through the `fleet` CLI.

## Discovery

```bash
fleet status          # Who's online, who's offline
fleet help            # Available commands
fleet doctor          # Full health check
```

## Commands

### "start <agent>"
```bash
fleet start <agent>
```

### "start <agent> at <path>"
```bash
fleet start <agent> <path>
```

### "start <agent> as <role>"
```bash
fleet start <agent> --role <role>
```

### "relocate <agent> to <server>"
```bash
fleet start <agent> --at <server>
```
Override the agent's default server location.

### Combine flags
```bash
fleet start worker --at staging ~/workspace/project --role writer
```
`--at`, `--role`, and workspace can be combined freely.

### "inject <agent> <role>"
```bash
fleet inject <agent> <role>
```
Hot-inject a role into a running agent without restart.

### "stop <agent>"
```bash
fleet stop <agent>
```
If the agent was started with `--at`, also pass `--at`:
```bash
fleet stop <agent> --at <server>
```

### "status"
```bash
fleet status
```

### "start all"
Run `start` for each agent sequentially. Skip agents already running.

### "stop all"
Run `stop` for each agent sequentially.

### "diagnose"
```bash
fleet doctor
```
Full health check: prerequisites, config, tokens, patches, SSH, remote nodes, identities.

### "initialize"
```bash
fleet init
```
Interactive setup: creates fleet.yaml + .env + identity files.

## Roles

Available roles in `identities/roles/`:
- **writer** — Content creation
- **reviewer** — Code review
- **ops** — Server operations

Add new roles by creating `identities/roles/<name>.md`.

## Rules

1. **Don't operate on $FLEET_SELF** — Never start, stop, or inject yourself
2. **Report after start/stop** — Concisely state which agents started/stopped and where
3. **Pass status output directly** — Don't reformat it, the script output is clear enough
4. **Use --at for non-default servers** — Stopping without it looks at the default server
5. **Run doctor for issues** — If something seems wrong, `fleet doctor` before manual debugging
