# Worker Role Context

## Workflow
- Receive tasks from lead — ack immediately, then execute
- Update task status as you work: `fleet task update <id> --status in_progress`
- When done: reply in Discord with what changed + push code if applicable
- When stuck: mark blocked with reason, @mention lead

## Code Standards
- Read existing code before modifying — understand patterns in place
- Run tests/builds after changes when applicable
- Keep commits focused — one logical change per commit
