# Fleet Skill-Based Procedural Memory System

## Problem

Skills today are static prompt files. An agent reads `SKILL.md`, follows the steps, and the system learns nothing. If the skill has a wrong step, a missing prerequisite, or a better approach discovered during execution, that knowledge dies with the session. The next agent (or the same agent after restart) hits the same wall.

The gap isn't "skills don't work" — it's that skills can't improve through use.

## Design Principles

1. **Filesystem-native** — no database, no daemon. Everything is diffable markdown + JSON, consistent with fleet's architecture.
2. **Agent-driven evolution** — agents improve skills as a side effect of using them. No central "skill manager" process.
3. **Judgment over dispatch** — agents decide when to use a skill based on context, not keyword matching. The system provides signal; the agent makes the call.
4. **Composable, not monolithic** — skills can reference other skills. Complex procedures are chains of simple skills, not giant documents.

## Current State

```
~/.fleet/skills/deploy-sg-dev/SKILL.md    # static procedural doc
<workspace>/.fleet/skills/*/SKILL.md      # project-local override

CLAUDE.md:
  ## Available Skills
  | Skill | Description |
  | deploy-sg-dev | Deploy SysBuilder to SG Dev... |
```

Agent sees the index in CLAUDE.md, reads SKILL.md with the Read tool, follows instructions manually. No feedback loop. No usage tracking. No versioning beyond manual edits.

## Proposed Architecture

### 1. Skill Execution Log — `runs.jsonl`

Each skill directory gains a `runs.jsonl` append-only log:

```
~/.fleet/skills/deploy-sg-dev/
  SKILL.md
  runs.jsonl        # new: execution history
```

Each line is one execution record:

```json
{
  "ts": "2026-04-12T11:30:00Z",
  "agent": "John-Carmack",
  "task": "task-173",
  "outcome": "success",
  "duration_s": 45,
  "note": "Step 3 needed sudo, not documented",
  "version": "1.0.0"
}
```

**Fields:**
- `ts` — ISO timestamp
- `agent` — who ran it
- `task` — task context (optional, links to task system)
- `outcome` — `success | partial | failed | skipped`
- `duration_s` — wall-clock seconds (optional)
- `note` — free-text observation (optional, agent-written)
- `version` — SKILL.md version at time of execution

**Why JSONL:** Append-only, no merge conflicts, trivially parseable, greppable. Same pattern as `boot.log`.

**Who writes it:** The agent, after completing or abandoning a skill. This is a behavioral instruction added to the skill workflow section of `identity.md`:

> After using a skill, append a run record to `runs.jsonl` in the skill directory. Include outcome and any observations about steps that were wrong, missing, or could be improved.

### 2. Skill Versioning — Semantic + Changelog

SKILL.md frontmatter already has `version`. Make it meaningful:

```yaml
---
name: deploy-sg-dev
description: Deploy SysBuilder to SG Dev production server
version: 1.1.0
tags: [deploy, sysbuilder, production]
last_used: 2026-04-12
use_count: 7
success_rate: 0.86
---
```

**New frontmatter fields:**
- `last_used` — updated from `runs.jsonl` (derived, can be stale)
- `use_count` — total runs (derived)
- `success_rate` — successes / total (derived)

**Changelog section** in SKILL.md (appended by agents):

```markdown
## Changelog

### 1.1.0 (2026-04-12, John-Carmack)
- Added sudo requirement to step 3 (discovered during task-173)
- Added rollback section based on failed deploy in task-160

### 1.0.0 (2026-04-08, Linus-Torvalds)
- Initial version from manual deploy procedure
```

**Version bump rules:**
- Agent fixes a step → patch bump (1.0.0 → 1.0.1)
- Agent adds a new section (pitfalls, verification) → minor bump (1.0.1 → 1.1.0)
- Skill is restructured or scope changes → major bump (1.1.0 → 2.0.0)

Agents bump versions using judgment. No enforcement — the changelog is the audit trail.

### 3. Skill Relevance Signal — `when` Block

Today, agents see a flat table of skill names + descriptions. They have no signal for *when* a skill applies beyond reading the description. Add a structured `when` section to SKILL.md:

```markdown
## When to Use

- Task mentions "deploy" AND target is "sg-dev" or "singapore"
- After a successful build on the sysbuilder project
- When lead says "ship it" or "push to prod"

## When NOT to Use

- Local development — use `dev-server` skill instead
- Staging deploys — use `deploy-staging` skill
- If last deploy failed — check `runs.jsonl` and fix root cause first
```

This isn't parsed programmatically — it's context for the agent's judgment. The agent reads this alongside the task description and decides. The key insight: **agents are better at fuzzy matching than any keyword dispatch system we'd build.**

### 4. Skill Composition — `requires` and `see_also`

Skills that depend on other skills declare it:

```yaml
---
name: deploy-sg-dev
requires: [build-sysbuilder, check-server-health]
see_also: [rollback-sg-dev, deploy-staging]
---
```

**`requires`** — skills that must succeed before this one starts. Agent reads and executes them in order. Not enforced by tooling — it's a contract the agent honors.

**`see_also`** — related skills for the agent to be aware of. Useful when a skill fails and the agent needs alternatives or followup procedures.

The skills index in CLAUDE.md can surface these relationships:

```markdown
## Available Skills

| Skill | Description | Requires |
|-------|-------------|----------|
| deploy-sg-dev | Deploy to SG Dev production | build-sysbuilder, check-server-health |
| rollback-sg-dev | Rollback SG Dev to previous | check-server-health |
```

### 5. Skill Evolution Loop

The core feedback cycle:

```
Agent receives task
  → Checks CLAUDE.md skills index
  → Reads matching SKILL.md (including When/When NOT sections)
  → Follows steps
  → Records outcome in runs.jsonl
  → If steps were wrong/missing: patches SKILL.md, bumps version, adds changelog entry
  → Next agent benefits from the improved skill
```

**No new tooling required.** Agents already have Read, Write, and file manipulation. The evolution loop is behavioral — taught through identity.md instructions, not enforced by code.

### 6. Derived Metrics — `fleet skill stats`

New CLI command that reads `runs.jsonl` across all skills:

```
$ fleet skill stats

Skill               Uses  Success  Last Used    Last Agent
deploy-sg-dev         7     86%    2026-04-12   John-Carmack
build-sysbuilder     12    100%    2026-04-12   Ken-Thompson
rollback-sg-dev       2     50%    2026-04-10   Linus-Torvalds
debug-fleet-server    3     67%    2026-04-08   Donald-Knuth

$ fleet skill stats deploy-sg-dev --runs
2026-04-12 11:30  John-Carmack  success  45s  "Step 3 needed sudo"
2026-04-11 09:15  Linus-Torvalds  failed  120s  "SSH timeout, server unreachable"
2026-04-10 14:00  Ken-Thompson  success  38s
```

Also: update frontmatter stats (`use_count`, `success_rate`, `last_used`) as a side effect of `fleet skill stats`, so the next CLAUDE.md generation picks them up. However, `buildSkillsIndex()` should **read `runs.jsonl` directly** rather than relying on frontmatter — this ensures stats in CLAUDE.md are always fresh at boot without requiring an intermediate `fleet skill stats` sync step. Frontmatter stats remain useful as a human-readable snapshot but are not the source of truth.

### 7. Skill Discovery Enhancement — Context-Aware Index

Today's skills index is a static table regenerated at boot. Enhance it with usage signal (derived directly from `runs.jsonl` at index build time):

```markdown
## Available Skills

| Skill | Description | Uses | Success |
|-------|-------------|------|---------|
| deploy-sg-dev | Deploy to SG Dev production | 7 | 86% |
| build-sysbuilder | Build SysBuilder project | 12 | 100% |
| debug-fleet-server | Debug Fleet server issues | 3 | 67% |
```

This gives agents a signal about skill reliability. A skill with 50% success rate tells the agent to read it carefully and watch for known issues. A skill with 100% success over 12 runs is battle-tested.

### 8. Skill-to-Skill Delegation

For complex workflows, a skill can reference sub-skills inline:

```markdown
# Deploy to SG Dev

## Prerequisites
Run skill: `build-sysbuilder` (must succeed before proceeding)
Run skill: `check-server-health` (verify target is reachable)

## Steps
1. SSH to sg-dev: `ssh sgdev`
2. Pull latest: `cd /opt/sysbuilder && git pull origin develop`
3. Restart service (requires sudo): `sudo systemctl restart sysbuilder`

## Verification
Run skill: `check-server-health` (confirm deploy succeeded)

## On Failure
Run skill: `rollback-sg-dev` (revert to previous version)
```

Agents follow the delegation chain by reading and executing referenced skills. This is composition through convention — no orchestration engine needed.

## What This Does NOT Include

- **Automatic skill invocation** — agents always decide. No "if task title contains X, run skill Y" dispatch.
- **Skill permissions** — any agent can read/write any skill. Trust the team.
- **Skill marketplace** — skills are local to a fleet. Cross-fleet sharing is file copy.
- **Skill templates** — agents write skills from scratch or copy existing ones. No scaffolding.
- **Runtime execution engine** — skills are documentation, not executable code. The agent is the runtime.

These are deliberate omissions. Each adds complexity that the current fleet size doesn't justify. They can be revisited when the system outgrows agent-driven evolution.

## Implementation Plan

### Phase 1 — Behavioral (no code changes)

1. Add skill execution logging instructions to `identity.md` worker/reviewer sections
2. Add `## When to Use` / `## When NOT to Use` sections to existing skills
3. Add `## Changelog` sections to existing skills
4. Document `requires` and `see_also` in skill frontmatter spec

**Effort:** Update `identity.ts` skill instruction block + update existing SKILL.md files. Half a sprint.

### Phase 2 — CLI support

1. `fleet skill stats [name] [--runs]` — read `runs.jsonl`, display metrics
2. Update `buildSkillsIndex()` to read `runs.jsonl` directly for use_count + success_rate columns (not stale frontmatter)
3. `fleet skill validate` — check for `when` section, `requires` references exist
4. Frontmatter stat derivation from `runs.jsonl` (human-readable snapshot, not source of truth)
5. **Review-gated skills** — `requires_review: true` frontmatter flag for high-stakes skills (e.g. deploy-prod). When a flagged skill's SKILL.md is edited, notify the reviewer agent. Prevents bad edits to critical procedures from propagating silently.

**Effort:** ~5 functions in `src/commands/skill.ts` + update `identity.ts` index builder + notification hook. One sprint.

### Phase 3 — Observation (run, learn, adjust)

1. Monitor whether agents actually log runs (check `runs.jsonl` files)
2. Monitor whether agents improve skills after failures (check changelogs)
3. Adjust identity instructions based on observed behavior
4. Consider: should `fleet task update --status done` auto-prompt "did you use a skill?"

**Effort:** Observation + tuning. Ongoing.

## Open Questions

1. **Should `runs.jsonl` be per-agent or per-skill?** Per-skill (proposed above) is simpler to query. Per-agent would let you see "what skills did Carmack use today?" but that's derivable from task notes.
2. **Token budget for skills in CLAUDE.md** — the current index is capped at 50 entries. As skills grow, should the index be filtered by relevance (workspace, recent usage, task tags)?
