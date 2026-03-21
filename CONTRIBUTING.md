# Contributing to Fleet

Thanks for your interest in contributing! Fleet is a shell-native tool for orchestrating AI agents across multiple servers.

## Getting Started

1. Fork and clone the repo
2. Run `./setup.sh` to set up dependencies
3. Create a `fleet.yaml` (see `fleet.yaml.example`)
4. Test with `fleet doctor`

## Code Structure

```
fleet                    # CLI entry point (sub-command router)
lib/
├── config.sh            # fleet.yaml parsing (Python3 + PyYAML)
├── remote.sh            # SSH + tmux session management
├── identity.sh          # Identity injection + hot role injection
├── init.sh              # Interactive setup flow
├── doctor.sh            # Health diagnostics
└── ui.sh                # Colors and output helpers
```

## Design Principles

- **Shell native** — No Node.js/Python runtime dependencies beyond PyYAML for YAML parsing
- **fleet.yaml is the single source of truth** — All config reads go through `lib/config.sh`
- **No hardcoded values** — Server names, SSH hosts, users, tmux prefixes all come from config
- **Agents are generic** — The CLI doesn't assume specific agent names or roles

## Making Changes

1. Create a feature branch: `git checkout -b feature/my-change`
2. Make your changes
3. Test locally: `fleet doctor` should pass, `fleet start/stop` should work
4. Submit a PR with a clear description

## Adding a New Command

1. Add the handler function `do_mycommand()` in `fleet` or a new `lib/mycommand.sh`
2. Add the case to the route switch in `fleet`
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
