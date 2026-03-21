---
name: hq
description: Manage the Discord HQ bot fleet — start, stop, inject roles, relocate bots, and check status across multiple locations
user_invocable: true
---

# HQ Bot Fleet Manager

You manage a fleet of Discord bots across multiple locations. Each bot is a Claude Code session with `--channels`. Any bot can run at any location.

## Bot Registry

Read `bot-pool.json` for the current fleet configuration. Each entry has:
- **name**: Bot identifier (used for tmux session `hq-<name>` and identity file lookup)
- **location**: Default location (`local` / `singapore` / `germany`)
- **role**: Fleet role (hub, guide, field-agent, dev-worker, infra-worker)
- **default_dir**: Working directory when none specified

## Script

All operations go through: `fleet`

## Commands

### "start <bot>"
```bash
fleet start <bot>
```

### "start <bot> at <path>"
```bash
fleet start <bot> <path>
```

### "start <bot> as <role>"
```bash
fleet start <bot> --role <role>
```

### "relocate <bot> to <location>"
```bash
fleet start <bot> --at <location>
```
Override the bot's default location. `<location>` = `local` / `singapore` / `germany`.

### Combine flags
```bash
fleet start pilot --at singapore ~/workspace/project --role writer
```
`--at`, `--role`, and work-dir can be combined freely.

### "inject <bot> <role>"
```bash
fleet inject <bot> <role>
```
Hot-inject a role into a running bot without restart.

### "stop <bot>"
```bash
fleet stop <bot>
```
If the bot was started with `--at`, also pass `--at`:
```bash
fleet stop <bot> --at <location>
```

### "status"
```bash
fleet status
```

### "start all"
Run `start` for each bot sequentially. Skip bots already running.

### "stop all"
Run `stop` for each bot sequentially.

## Roles

Available roles in `identities/roles/`:
- **writer** — Content creation
- **reviewer** — Code review
- **ops** — Server operations

Add new roles by creating `identities/roles/<name>.md`.

## Rules

1. **Don't start/stop yourself** — If you are Sentinel, don't `stop sentinel`
2. **Remote bots use SSH** — spawn.sh handles this automatically; `--at` overrides default location
3. **Report after start/stop** — Concisely state which bots started/stopped and where
4. **Pass status output directly** — Don't reformat it, the script output is clear enough
5. **Use --at for non-default locations** — Stopping without it will look at the default location
