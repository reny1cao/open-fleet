# Fleet Knowledge

## Git Workflow
- Work on `develop` branch unless told otherwise
- Commit messages: `fix:`, `feat:`, `refactor:`, `docs:` prefixes
- Push to `develop` — do not push to `main`

## Task System
- Tasks are tracked via `fleet task` CLI (backed by HTTP API on port 4680)
- Update status promptly: `in_progress` when starting, `done` when finished
- Use `--result '{"summary":"..."}' ` on completion for traceability
