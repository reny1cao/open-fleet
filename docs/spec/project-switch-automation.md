# Project Switch Automation (task-172)

## Problem

Switching projects is a manual 4-step checklist (push, test, STATUS.md, confirm). Every step is error-prone:
- Agents forget to push and leave uncommitted work
- Tests aren't run, so the next team inherits a broken workspace
- STATUS.md goes stale because writing it is tedious
- No confirmation that the switch-out was clean before the switch-in begins

The switch-in side is equally manual: pull, read STATUS.md, run tests, post readiness. This burns 10-15 minutes per agent per switch and still misses things.

## Current State

**Manual SOP** (from docs/STATUS.md):

Switch out:
1. Push all work — nothing uncommitted, all branches merged
2. Tests green — confirm full suite passes
3. Write/update STATUS.md
4. Confirm in channel — post "clean"

Switch in:
1. Pull latest
2. Read STATUS.md
3. Run tests
4. Post readiness in channel

**No automation exists.** The fleet CLI has `fleet use` (switches active fleet, not project) and `fleet boot-check` (regenerates agent context at startup). Neither handles project transitions.

## Proposed Command

```
fleet project switch <to-project> [--from <project>] [--agent <name>] [--skip-tests] [--dry-run]
```

Orchestrates a validated project transition for one agent. Runs pre-switch checks on the current project, then sets up context for the target project.

### Phase 1: Switch-Out Validation

Enforced checks before leaving the current project:

```
fleet project switch open-fleet --from sysbuilder

[switch-out] sysbuilder
  ✓ Working tree clean (no uncommitted changes)
  ✓ On expected branch (develop)
  ✓ Branch pushed to remote (0 commits ahead)
  ✓ Tests pass (41/41)
  ✓ STATUS.md up to date (generated via fleet task status-gen)
  
[switch-out] sysbuilder — CLEAN
```

**Check 1 — Clean working tree**
- `git status --porcelain` in the workspace directory
- FAIL if uncommitted changes exist
- Agent must commit or stash before switching

**Check 2 — Expected branch**
- Verify HEAD is on `develop` (or the project's configured default branch)
- WARN if on a feature branch — agent may have unmerged work

**Check 3 — Pushed to remote**
- `git rev-list @{u}..HEAD` — count commits ahead of upstream
- FAIL if unpushed commits exist

**Check 4 — Tests pass**
- Run the project's test command (configured per-project, see Config section)
- FAIL if exit code != 0
- `--skip-tests` bypasses this (for speed, not recommended)

**Check 5 — STATUS.md current**
- Run `fleet task status-gen --project <from> --output <workspace>/docs/STATUS.md`
- Auto-generates the quantitative sections, preserves hand-written Decisions/Open Questions
- Git-add and commit the updated STATUS.md

### Phase 2: Context Switch

Update the agent's runtime context for the new project:

```
[switch-in] open-fleet
  ✓ Workspace exists: ~/workspace/open-fleet
  ✓ Git pull (3 new commits)
  ✓ Tests pass (41/41)
  ✓ Task context regenerated (12 active tasks)
  ✓ Project wiki injected
  ✓ STATUS.md read (last updated: 2026-04-12)

[switch-in] open-fleet — READY
```

**Step 1 — Validate workspace**
- Confirm the target workspace directory exists
- FAIL if missing (project not cloned)

**Step 2 — Git pull**
- `git pull --ff-only` in the target workspace
- FAIL on merge conflicts (agent must resolve manually)

**Step 3 — Run tests**
- Same as switch-out check 4, but against the target project
- Catches cases where someone else broke the project while you were away

**Step 4 — Regenerate task context**
- Equivalent to boot-check Step 4: filter tasks by target project, write to `tasks-context.md`
- Reuses `injectTaskContext()` from `src/commands/boot-check.ts`

**Step 5 — Inject project wiki**
- Equivalent to boot-check Step 5: load `wiki/projects/<project>.md`, write to `project-wiki.md`
- Reuses `injectProjectWiki()` from `src/commands/boot-check.ts`

**Step 6 — Surface STATUS.md**
- Print a summary of the target project's STATUS.md (or warn if missing/stale)
- Agent reads this to get up to speed

### Phase 3: Confirmation

Post results to the project's Discord channel:

```
[#fleet-dev] Donald-Knuth switched from sysbuilder → open-fleet
  Switch-out: clean (tests green, STATUS.md updated, all pushed)
  Switch-in: ready (pulled 3 commits, tests green, 12 active tasks)
```

This replaces the manual "post clean" / "post readiness" steps.

## Configuration

### Per-Project Config in fleet.yaml

```yaml
projects:
  sysbuilder:
    workspace: ~/workspace/sysbuilder
    branch: develop
    test_command: "mvn clean compile test"
    channel: dev
  open-fleet:
    workspace: ~/workspace/open-fleet
    branch: develop
    test_command: "bun test"
    channel: fleet-dev
```

**New fields:**
- `branch` — expected default branch (default: `develop`)
- `test_command` — shell command to run tests (required for automated checks)
- `channel` — Discord channel for switch notifications

If `projects` section is absent, fall back to inferring workspace from `discord.channels[].workspace` mappings (existing behavior).

## Dry Run Mode

```
fleet project switch open-fleet --from sysbuilder --dry-run
```

Runs all checks but makes no changes. Reports what would happen:
- Would commit STATUS.md (modified)
- Would pull 3 commits from origin/develop
- Would regenerate task context (12 tasks)

Useful for checking readiness before actually switching.

## Edge Cases

**Agent has no current project (first switch of session)**
- Skip switch-out phase entirely
- `--from` is optional — if omitted and no current project is tracked, switch-in only

**Workspace has merge conflicts after pull**
- FAIL with clear message: "merge conflict in <files> — resolve manually, then re-run"
- Do not auto-resolve

**Tests fail on switch-in**
- WARN but don't block — the agent is switching TO this project, possibly to fix the broken tests
- Print which tests failed so the agent has context

**STATUS.md doesn't exist in target project**
- WARN: "No STATUS.md found — consider running fleet task status-gen"
- Don't block the switch

**Multiple agents switching simultaneously**
- No locking needed — each agent's context files are in their own state directory
- Git operations use per-workspace locks (git's own mechanism)

## What This Does NOT Include

- **Automatic workspace creation** — if the project isn't cloned, the agent must clone it manually
- **Branch switching** — the command validates you're on the expected branch but doesn't checkout for you
- **Agent restart** — context files are regenerated in-place; Claude Code picks up CLAUDE.md changes on next turn, but `tasks-context.md` and `project-wiki.md` require a restart to reload (they're loaded via `--append-system-prompt-file` at boot)
- **Multi-agent orchestration** — this switches one agent at a time; a "fleet-wide project switch" is a lead coordination task, not a CLI command

## Implementation Plan

### Phase 1 — Core Command

1. Add `projects` section support to fleet.yaml parser
2. Implement `fleet project switch` in `src/commands/project.ts`
3. Switch-out: git checks + test runner + auto STATUS.md gen
4. Switch-in: git pull + context regeneration (reuse boot-check functions)
5. Discord notification on completion

**Effort:** One sprint. Most logic is orchestration of existing primitives (git commands, `status-gen`, `boot-check` steps).

### Phase 2 — Context Reload Without Restart

The main limitation: `tasks-context.md` and `project-wiki.md` are loaded once at boot via `--append-system-prompt-file`. After a switch, the agent would need a restart to pick up the new project context.

Options:
- **Option A:** Accept the restart — `fleet project switch` ends with `fleet restart <agent>`
- **Option B:** Move task context and wiki into CLAUDE.md (re-read every turn) instead of system prompt files
- **Option C:** Add a `fleet reload-context <agent>` command that patches the running session

Recommend Option A for now — a restart is clean and takes seconds. Option B can be explored if restart latency becomes a problem.

### Phase 3 — Pre-Switch Hook

For teams that want custom validation:

```yaml
projects:
  sysbuilder:
    pre_switch_out: "scripts/pre-switch.sh"
    post_switch_in: "scripts/post-switch.sh"
```

Custom scripts run during the switch, can add project-specific checks (e.g., "ensure no pending migrations", "verify API keys are set").

## Open Questions

1. **Should switch state be persisted?** If we track "agent X is currently on project Y" in the task store or agent state, we can auto-detect `--from` and warn if an agent tries to work on the wrong project.
2. **Should `fleet task status-gen` be mandatory on switch-out?** Currently proposed as auto-run. Could be optional if the agent recently ran it manually.
3. **Restart vs. hot-reload trade-off** — how much latency does a restart add in practice? If it's under 10 seconds, Option A is fine indefinitely.
