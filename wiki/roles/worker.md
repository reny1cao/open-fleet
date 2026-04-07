# Worker Role Context

## Task Lifecycle

When you receive a task assignment:

1. **Ack** — react or reply in Discord immediately
2. **Start** — `fleet task update <id> --status in_progress`
3. **Work** — implement the task, commit code, push to `develop`
4. **Done** — `fleet task update <id> --status review --result '{"summary":"what you did"}'`
5. **Report** — reply in Discord with: what changed, files modified, whether it works

If blocked:
- `fleet task update <id> --status blocked --reason "why"`
- @mention lead with the blocker

If you need to add a note mid-task:
- `fleet task comment <id> "progress update"`

## Task Commands Quick Reference

```
fleet task update <id> --status in_progress
fleet task update <id> --status review --result '{"summary":"..."}'
fleet task update <id> --status blocked --reason "..."
fleet task comment <id> "note text"
fleet task show <id>
fleet task list --mine
```

## Code Standards

- Read existing code before modifying — understand patterns in place
- Run tests/builds after changes when applicable
- Keep commits focused — one logical change per commit
