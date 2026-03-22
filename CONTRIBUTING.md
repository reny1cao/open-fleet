# Contributing to Fleet

Thanks for your interest in contributing! Fleet is a TypeScript CLI for orchestrating AI agents across multiple machines.

## Getting Started

1. Fork and clone the repo
2. Run `./install.sh` to set up dependencies
3. Create a `fleet.yaml` (see `fleet.yaml.example`)
4. Test with `fleet doctor`

## Code Structure

```
fleet                    # CLI entry point (sub-command router)
src/
├── config.ts            # fleet.yaml parsing
├── identity.ts          # Identity injection + hot role injection
├── init.ts              # Interactive setup flow
├── doctor.ts            # Health diagnostics
└── ui.ts                # Colors and output helpers
```

## Design Principles

- **TypeScript CLI** — The CLI is implemented in TypeScript under `src/`
- **fleet.yaml is the single source of truth** — All config reads go through `src/config.ts`
- **No hardcoded values** — Server names, users, and prefixes all come from config
- **Agents are generic** — The CLI doesn't assume specific agent names or roles

## Making Changes

1. Create a feature branch: `git checkout -b feature/my-change`
2. Make your changes
3. Test locally: `fleet doctor` should pass, `fleet start/stop` should work
4. Submit a PR with a clear description

## Adding a New Command

1. Add the handler function in `src/` (new file or extend an existing one)
2. Add the case to the route switch in the CLI entry point
3. Update `fleet help` text
4. Add shell completions in `completions/`

## Adding a New Role

Create `identities/roles/<name>.md`. The file is injected as a prompt overlay. Keep it focused on domain expertise and behavioral rules.

## Reporting Issues

When filing an issue, include:
- `fleet doctor` output
- OS and shell version
- Steps to reproduce

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
