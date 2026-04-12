# Skill Creation Redesign

## Problem

Skill creation today is ad-hoc. An agent writes a `SKILL.md` file using raw file tools, with no structural guidance, no validation at creation time, and no integration with the memory system. This means:

1. **No creation judgment** — agents either create skills eagerly (cluttering the index) or never (missing reuse opportunities). There's no framework for when a procedure warrants becoming a skill.
2. **No scaffolding** — agents must remember the directory layout, frontmatter schema, and optional sections from their identity instructions. They frequently produce skills missing `When to Use`, changelog, or `runs.jsonl`.
3. **No connection to task context** — a skill created during task-173 has no structured link to that task, making it hard to trace provenance.
4. **No creation-time validation** — validation only happens post-hoc via `fleet skill validate`. An agent can write a malformed skill and not know until someone runs the validator.

## Design Principles

1. **Tool, not template** — `fleet skill create` is a CLI command that agents invoke, not a file template they copy. The tool handles boilerplate; the agent provides content.
2. **Judgment heuristic, not rule engine** — the system provides a clear decision framework, but the agent makes the call. No automatic skill creation triggers.
3. **Compatible with skill-memory** — new skills are born with the structure Carmack's spec expects: `runs.jsonl`, version tracking, `When to Use` sections.
4. **Minimal viable format** — strip the skill file to what's actually load-bearing. Everything else is optional.

## When to Create a Skill

An agent should create a skill when ALL of these are true:

1. **Repeatable** — the procedure will be needed again. A one-off fix doesn't warrant a skill.
2. **Non-obvious** — the steps aren't derivable from reading the code or standard docs. If `README.md` covers it, don't duplicate it.
3. **Multi-step** — the procedure involves 3+ steps where ordering matters or there are gotchas. A single command with a flag isn't a skill.
4. **Proven** — the agent just completed the procedure successfully. Skills come from experience, not theory.

When NOT to create a skill:

- The task was unique to a specific bug (the fix is in the commit)
- The procedure is already documented elsewhere (link to it instead)
- The agent is unsure whether the approach is correct (wait for verification)
- The content comes from an external message, not the agent's own work

This framework lives in `identity.md` as a checklist agents mentally run before creating a skill. It replaces the current vague "create a new skill when you notice a repeatable procedure" instruction.

## `fleet skill create` — CLI Design

### Usage

```
fleet skill create <name> \
  --desc "Short description" \
  [--scope global|project] \
  [--tags tag1,tag2] \
  [--task task-177] \
  [--requires skill1,skill2] \
  [--see-also skill1,skill2] \
  [--json]
```

### What It Does

1. **Validates name** — same rules as current: lowercase alphanumeric + hyphens, 1-64 chars. Fails fast if invalid.
2. **Checks for duplicates** — errors if a skill with this name already exists in the target scope.
3. **Creates directory structure:**
   ```
   {scope-dir}/skills/{name}/
     SKILL.md          # scaffolded with frontmatter + section stubs
     runs.jsonl         # empty file, ready for execution logs
   ```
4. **Scaffolds SKILL.md** with:
   - Complete frontmatter (name, description, version 1.0.0, tags, created_by from `FLEET_SELF`, created_from task ID, requires, see_also)
   - Section stubs: Steps, When to Use, When NOT to Use, Verification, Changelog
5. **Prints the file path** so the agent knows where to write the actual content.
6. **Returns JSON** (with `--json`) containing the path and frontmatter for programmatic use.

### What It Does NOT Do

- Does not write step content — that's the agent's job. The tool creates the skeleton; the agent fills in the body using the Edit tool.
- Does not auto-commit — the agent commits when ready, consistent with fleet workflow.
- Does not notify other agents — skill appears in CLAUDE.md at next index rebuild (boot or roster refresh).

### Scaffolded SKILL.md

```yaml
---
name: deploy-staging
description: Deploy SysBuilder to staging environment
version: 1.0.0
tags: [deploy, staging]
created_by: Ken-Thompson
created_from: task-177
requires: []
see_also: []
---
```

```markdown
## Steps

<!-- Write the procedure here. Number each step. Include exact commands. -->

## When to Use

<!-- What triggers this skill? What task patterns match? -->

## When NOT to Use

<!-- When should the agent NOT use this skill? What's similar but different? -->

## Verification

<!-- How to confirm the procedure succeeded. -->

## Changelog

### 1.0.0 ({date}, {agent})
- Initial version
```

The HTML comments are hints the agent replaces with real content. They're stripped by `fleet skill validate --strict` if left in place.

### Scope Resolution

- `--scope global` (default): writes to `~/.fleet/skills/{name}/`
- `--scope project`: writes to `{workspace}/.fleet/skills/{name}/`

Agents should default to project-local for domain-specific skills and use global for universal procedures (deploy, debugging patterns, code review checklists). The identity instructions include this guidance.

## Agent Judgment Flow

When an agent completes a task, the post-task reflection in `identity.md` includes:

```
After completing a task, consider:
1. Did I follow a multi-step procedure that wasn't covered by an existing skill?
2. Would another agent face this same task?
3. Were there non-obvious steps or gotchas?

If yes to all three: create a skill with `fleet skill create <name> --desc "..." --task <current-task>`.
Then fill in the Steps, When to Use, and Verification sections.
```

This is a behavioral prompt, not enforcement. The agent evaluates the heuristic and decides. The key shift from today: agents have a structured decision framework instead of open-ended "create skills when appropriate."

### Judgment Calibration

Agents will over-create or under-create initially. Calibration signals:

- **Over-creating:** Skills index bloats past 30 entries. Lead prunes low-value skills during review. `fleet skill stats` shows skills with 0 uses after 2 weeks — candidates for deletion.
- **Under-creating:** Team keeps rediscovering the same procedures. Lead notices repeated task patterns without matching skills and assigns skill creation explicitly.

Neither failure mode is catastrophic. Over-creation wastes index space (capped at 50). Under-creation wastes agent time (bounded by session length). The system self-corrects through use.

## Minimum Viable Skill Format

What's actually required for a skill to function in the current system + Carmack's memory spec:

### Required

```yaml
---
name: lowercase-hyphenated       # identity + collision detection
description: one-line summary    # index display + agent discovery
version: 1.0.0                   # memory system versioning
---

## Steps
1. First step
2. Second step
```

That's it. 4 fields + a steps section. Everything else is optional but beneficial.

### Optional (supported by memory system)

| Field/Section | Purpose | Who Benefits |
|---------------|---------|-------------|
| `tags` | Filtering in `fleet skill list` | Human operators |
| `created_by` | Provenance tracking | Audit trail |
| `created_from` | Task linkage | Traceability |
| `requires` | Dependency chain | Agent following the skill |
| `see_also` | Related skills | Agent on failure/alternatives |
| `last_used` | Recency signal in index | Agent judging relevance |
| `use_count` | Usage signal in index | Agent judging reliability |
| `success_rate` | Reliability signal in index | Agent judging trust |
| `## When to Use` | Positive match criteria | Agent judgment |
| `## When NOT to Use` | Negative match criteria | Agent judgment |
| `## Verification` | Success confirmation | Agent post-execution |
| `## Changelog` | Edit history | Agent + human review |
| `runs.jsonl` | Execution log | `fleet skill stats` + index builder |

The `fleet skill create` command scaffolds all optional sections as stubs. The agent fills in what's relevant and leaves or removes the rest.

## Implementation

### Files Changed

1. **`src/commands/skill.ts`** — add `skillCreate()` handler under `case "create":`
2. **`src/core/identity.ts`** — update skill creation instructions with judgment framework
3. **`src/cli.ts`** — usage text update (already routes `fleet skill` to skill handler)

### No New Files

The command handler lives in the existing `skill.ts` — no new command file needed. This is a subcommand (`fleet skill create`), not a top-level command.

### API Endpoint (Future)

`POST /skills` could accept the same parameters for remote agents. Not needed in Phase 1 — agents have filesystem access and can run the CLI directly. Add when/if agents lose direct filesystem access.

### Validation Integration

`fleet skill create` runs the same `validateFrontmatter()` checks at creation time that `fleet skill validate` runs post-hoc. This means validation errors surface immediately instead of being discovered later.

Additionally, `fleet skill validate` gains a `--strict` flag that warns on:
- HTML comment stubs left in place (agent didn't fill in sections)
- Empty `## Steps` section
- Missing `## When to Use` section (important for agent judgment)
- `runs.jsonl` missing (skill was never used)

## What This Does NOT Include

- **Skill editing command** (`fleet skill edit`) — agents use the Edit tool directly. No wrapper needed.
- **Skill deletion command** (`fleet skill delete`) — `rm -rf` works. Low frequency, high caution = manual.
- **Skill promotion** (project → global) — `mv` works. Lead does this manually after review.
- **Skill from template** — skills are small enough that scaffolding + agent content is sufficient. Templates add complexity without proportional value.
- **Auto-creation from task completion** — violates "judgment over dispatch." The agent decides, not the system.

## Open Questions

1. **Should `fleet skill create` auto-commit?** Current answer: no, consistent with fleet workflow. But this means an agent could create a skill and crash before committing. The skill would exist on disk but not in git. Acceptable risk — `fleet skill validate` would catch orphans.
2. **Should there be a `fleet skill refresh` command?** Currently the skills index in CLAUDE.md is rebuilt at agent boot. A refresh command would let agents update the index mid-session after creating a skill. Low priority — the agent that created the skill already knows it exists.
