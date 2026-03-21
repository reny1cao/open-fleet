---
name: hq
description: Manage the Discord HQ bot fleet — start, stop, inject roles, relocate bots, and check status across local, Singapore, and Germany
user_invocable: true
---

# HQ Bot Fleet Manager

You manage a fleet of 5 Discord bots across 3 locations. Each bot is a Claude Code session with `--channels`. Any bot can run at any location.

## Bot Registry

| Bot | Default Location | Role | Default Dir |
|-----|-----------------|------|-------------|
| sentinel | local | Hub — 总调度，不干活 | ~/workspace/automation |
| pilot | local | 指导远程开发 | ~/workspace/automation |
| archon | singapore | Field Agent | ~/workspace |
| forge | singapore | 开发执行 | ~/workspace |
| citadel | germany | 基础设施执行 | ~/workspace |

## Locations

| Location | SSH Host | Server |
|----------|----------|--------|
| local | — | 本地 Mac |
| singapore | hetzner | 新加坡 Hetzner VPS |
| germany | nuremberg | 德国 Nuremberg VPS |

## Script

All operations go through: `./spawn.sh`

## Commands

### "启动/start/拉起 <bot>"
```bash
./spawn.sh start <bot>
```

### "启动 <bot> 在 <path>"
```bash
./spawn.sh start <bot> <path>
```

### "启动 <bot> 角色 <role>" / "start <bot> as <role>"
```bash
./spawn.sh start <bot> --role <role>
```

### "把 <bot> 放到 <location>" / "<bot> 跑到新加坡/德国/本地"
```bash
./spawn.sh start <bot> --at <location>
```
Override the bot's default location. `<location>` = `local` / `singapore` / `germany`.

### 组合使用
```bash
# Pilot 跑到新加坡，指定目录，当写作专家
./spawn.sh start pilot --at singapore ~/workspace/project --role writer
```
`--at`、`--role`、work-dir 可以任意组合。

### "注入/inject <bot> <role>" / "让 <bot> 当 <role>"
```bash
./spawn.sh inject <bot> <role>
```
Hot-inject a role into a running bot without restart.

### "停止/stop/关掉 <bot>"
```bash
./spawn.sh stop <bot>
```
If the bot was started with `--at`, also pass `--at`:
```bash
./spawn.sh stop <bot> --at <location>
```

### "状态/status/谁在线"
```bash
./spawn.sh status
```

### "全部启动"
Run `start` for each bot sequentially. Skip bots that are already running.

### "全部停止"
Run `stop` for each bot sequentially.

## Roles

Available roles in `scripts/hq/identities/roles/`:

| Role | File | Use When |
|------|------|----------|
| writer | writer.md | 写作任务（公众号/X/小红书） |
| reviewer | reviewer.md | Code review |
| ops | ops.md | 服务器运维 |

Add new roles by creating `scripts/hq/identities/roles/<name>.md`.

## Rules

1. **不要自己起停自己** — 如果你是 Sentinel，不要 `stop sentinel`
2. **远程 bot 通过 SSH** — spawn.sh 自动处理，`--at` 覆盖默认位置
3. **起停后汇报** — 简洁告知哪些 bot 起了/停了/在哪
4. **status 输出直接转发** — 不要重新格式化，脚本输出已经够清晰
5. **停非默认位置的 bot 要带 --at** — 否则会去默认位置找，找不到
