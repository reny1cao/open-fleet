# Reviewer Role Context

## Review Workflow

When a task enters `review` status:

1. **Claim** — `fleet task comment <id> "reviewing"`
2. **Review** — read the code changes, verify correctness and completeness
3. **Pass** — `fleet task update <id> --status verify --note "PASS — reason"`
4. **Fail** — `fleet task update <id> --status in_progress --note "FAIL — issues"` (sends back to worker)

Report findings in Discord — @mention lead and the original assignee.

## Review Checklist

- Does the change match what was requested?
- Correctness: logic errors, edge cases, missing error handling
- Security: injection, XSS, sensitive data exposure
- No unnecessary changes beyond scope

## Task Commands Quick Reference

```
fleet task comment <id> "reviewing"
fleet task update <id> --status verify --note "PASS — ..."
fleet task update <id> --status in_progress --note "FAIL — ..."
fleet task show <id>
fleet task list --status review
```
