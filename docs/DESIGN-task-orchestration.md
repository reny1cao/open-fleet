# Task Orchestration — System Design

> Design document for fleet task orchestration. Owner: Ken Thompson. Last updated: 2026-04-01.

---

## Step 1: Functional Requirements

### Actors

- **Human boss** — oversees the fleet, sets high-level goals, monitors progress
- **Lead agent** — decomposes goals into tasks, assigns to workers, tracks progress, unblocks
- **Worker agent** — executes assigned tasks, reports status and results
- **Reviewer agent** — reviews completed work, may request changes
- **Ops agent** — may need to see task state for operational decisions

### Core Use Cases

**UC-1: Lead creates and assigns a task**
Lead defines a task with description, priority, and assignee. Assignee is notified via Discord. Task is immediately visible to all agents.

**UC-2: Worker picks up a task after restart/compaction**
Agent boots, reads its assigned tasks, and resumes work without anyone re-explaining. This is the critical gap today — after compaction, agents have no idea what they were doing.

**UC-3: Worker updates task progress**
Worker marks task as in_progress, adds notes, or marks done with a summary of what was accomplished (files changed, outcome). Lead is notified on completion.

**UC-4: Worker signals a block**
Worker marks task as blocked with a reason. Lead is notified and can reassign, unblock, or adjust scope.

**UC-5: Lead tracks team status**
Lead (or human) views a dashboard of all tasks: who's doing what, what's done, what's stuck. Must work from CLI and Discord.

**UC-6: Lead reprioritizes or reassigns**
Lead changes priority, reassigns a task to a different worker, or cancels a task. Previous assignee is notified.

**UC-7: Task decomposition**
Lead breaks a high-level goal into subtasks, each assignable to different workers. Parent task tracks overall completion.

**UC-8: Task survives fleet-wide disruption**
All agents crash and restart. Task state is fully recoverable from persistent storage. No tasks are lost.

**UC-9: Human reviews progress**
Human boss checks fleet progress via Discord messages, CLI, or by reading the task file directly. No special tooling required.

**UC-10: Human bypasses lead and assigns directly**
Human runs `fleet task create --assign Ken-Thompson "Fix the tests"` from CLI. Task appears in the shared store. Worker is notified via Discord. Lead can see it on next task board read. Important because: the human should never be blocked by a crashed or compacted lead.

**UC-11: Worker reports structured results**
Worker completes a task and attaches concrete artifacts: commit SHAs, changed files, test results, PR URLs. Lead inspects the result to decide if the task is truly done or needs revision. Results persist — the human can audit what each agent actually produced.

**UC-12: Worker discovers sibling tasks**
Worker reads the full task board to see what teammates are working on. Prevents conflicts (two agents editing the same file) and provides context (understanding the bigger picture while working on a piece).

**UC-13: Lead sequences dependent work**
Lead creates task B that depends on task A. Task B is not actionable until A is done. Enables multi-phase workflows: "Carmack implements, then Knuth reviews, then Linus deploys." Simple blocked-by relationship, not a full DAG scheduler.

**UC-14: Lead recovers orchestration context after compaction**
Lead agent compacts or restarts. Boot-check injects the *full board state* — all active tasks across all agents, all blockers, all priorities — not just the lead's personal tasks. The lead is the heaviest user of task state; a confused lead cascades bad assignments to the whole team. This is arguably more critical than UC-2.

**UC-15: Stale task detection and escalation**
An agent dies silently and doesn't restart. Its assigned task sits in_progress with nobody working on it. The watchdog detects that the assignee's heartbeat is dead while the task is active, and escalates to the lead for reassignment. This is a daily reality, not an edge case.

### Source of Truth

**The task store is authoritative from day one.** If a task isn't in the store, it doesn't exist as far as the system is concerned. Discord is the notification layer, not the record system. During the transition from pure-Discord orchestration, the lead must create tasks in the store for any work it assigns. Discord @mentions without a corresponding task are informal requests, not tracked work.

### Extended Use Cases (Full Vision)

**UC-16: Cross-fleet task delegation**
Fleet A (backend team) creates a task that requires work from Fleet B (frontend team). The task is published to a shared task namespace. Fleet B's lead picks it up, decomposes it internally, and reports completion back to Fleet A. Requires: shared task registry across fleets, fleet-level identity, cross-fleet notification channel.

**UC-15: Multiple leads / hierarchical orchestration**
A fleet has a senior lead and sub-leads per domain (e.g., backend lead, frontend lead). Senior lead creates high-level tasks, sub-leads decompose into subtasks for their workers. Task hierarchy: goal → epic → task → subtask. Each level is owned by a lead at that scope.

**UC-16: Peer leads with shared task pool**
Two leads co-own a task pool. Either can create, assign, or reprioritize. Conflict resolution: last-write-wins with audit trail, or lead-level locking per task (one lead claims ownership of a task).

**UC-17: Automated scheduling / queue management**
Tasks are created without an explicit assignee. The scheduler assigns based on: agent availability (not currently working on a task), agent capabilities (role, skills), agent load (number of active tasks), and agent affinity (previous work on related code). Workers pull from the queue rather than waiting for explicit assignment.

**UC-18: Time tracking and estimation**
Each task records: created_at, started_at, completed_at, total_elapsed. Over time, the system accumulates historical data on how long tasks of different types take. The lead can estimate completion time for new tasks based on past performance. Enables: "when will all current tasks be done?" predictions.

**UC-19: Task templates and recurring tasks**
Common workflows are saved as templates (e.g., "code review" = create task → assign reviewer → reviewer posts findings → author fixes → reviewer approves). Recurring tasks execute on a schedule (e.g., "run the test suite every morning and report failures").

**UC-20: Multi-repo / multi-project tasks**
A single task may span multiple repositories or workspaces. The task references which repo(s) it touches. Workers switch workspace context based on task metadata. Enables: coordinated changes across frontend and backend repos.

**UC-21: Scaling to 50-100 agents**
Large fleets with many workers. Requires: efficient task indexing (not O(n) scan), namespaced task boards (per-team within a fleet), delegated administration (sub-leads manage their teams), and rate-limited notifications (don't flood Discord with 100 status updates).

---

## Step 2: Non-Functional Requirements

### Scale

**Near-term (MVP):**
- **Agents:** 3-10 per fleet. Single fleet.
- **Active tasks:** 10-50. Lifetime total: hundreds.
- **Design for simplicity** — O(n) scans, single JSON file, no indexing.

**Medium-term (6-12 months):**
- **Agents:** 10-50 per fleet. Multiple fleets (2-5) potentially coordinating.
- **Active tasks:** 50-200 across fleets. Lifetime total: thousands.
- **Need:** indexed queries (by assignee, status, project), namespaced task boards, cross-fleet references.

**Long-term (1-2 years):**
- **Agents:** 50-100+ across many fleets.
- **Active tasks:** hundreds. Lifetime total: tens of thousands.
- **Need:** task archival (move completed tasks out of active store), query API (not just file reads), notification batching/summarization, delegated administration.

**Sync bottleneck (Linus):** at 50+ agents, SCP-based sync breaks down — 50 SSH connections per minute to push task files. Need to switch from push model (fleet pushes to each agent) to pull model (agents fetch from a central endpoint). Implication: even if MVP is file-based, agents should use `fleet task list` (not read tasks.json directly) so the data source can move to HTTP without changing agent behavior.

**Design principle:** start with a flat JSON file that works at small scale. Structure the data model so it can migrate to a database (SQLite, then Postgres) without changing the API contract. All agent access goes through `fleet task` CLI — never raw file reads.

### Reliability

- **Task state must survive:** agent compaction, agent crash, agent restart, server reboot, fleet stop/start
- **MVP has a known SPOF:** the canonical task store lives on the control plane machine. If that machine is down, no new tasks can be created and remote agents have stale reads. Workers can still *read* their local replica and continue current work. **Upgrade path:** replicate the store to the fleet git repo or move to a hosted service (Phase 4). We accept this limitation at MVP scale (one machine, 5 agents) and document it honestly.
- **Read availability:** even when the canonical store is unreachable, workers must be able to read their assignments from their local synced copy and continue working
- **Crash recovery:** on boot, every agent gets its current task list injected into context. Zero manual re-onboarding.
- **Idempotent updates:** duplicate status updates (e.g., from retry) must not corrupt state
- **Partial writes:** if an agent crashes mid-update, the task store must not be corrupted. Use atomic rename (write temp file → rename) rather than in-place modification

### Latency

| Operation | Target | Rationale |
|-----------|--------|-----------|
| Create/assign task | < 1s | File write, instant |
| Read task list | < 100ms | Local file read |
| State propagation to remote | < 60s | Via existing sync cycle |
| Discord notification | < 5s | Via Discord API |
| Post-compaction task load | At boot | Injected by boot-check |

### Consistency

- **Primary concern:** lead updates assignment while worker updates status simultaneously
- **Likelihood:** low — tasks are typically owned by one agent at a time
- **Strategy for MVP:** field-level merge with last-write-wins per field. Read-modify-write with file lock (flock or atomic rename). Status and assignment are separate fields, so concurrent updates to different fields don't conflict.
- **Future:** if conflicts become real, move to an append-only event log

### Availability

- **Offline:** must work without network. File-based storage on local disk.
- **Cross-server:** remote agents need task state. Sync via `fleet sync` (SCP), same pattern as identity/access files today.
- **Offline degradation:** if a remote agent loses SSH connectivity, it continues working on its current tasks and syncs results when reconnected. Tasks assigned during the outage queue up and arrive on next sync.
- **After compaction:** boot-check injects current task summary into agent context. Agent knows its assignments immediately.

### Security

- **MVP: trust-based.** All agents in a fleet are trusted. Any agent can read all tasks.
- **Write permissions by convention:**
  - Lead creates, assigns, reprioritizes, closes
  - Workers update status and add notes on their own tasks
  - Reviewer can request changes
- **Enforcement:** not in MVP. Role field in task metadata enables future enforcement.
- **Human override:** human can edit the task file directly or via CLI

### Observability

- Task state changes logged to fleet activity (visible in `fleet watch`)
- Discord notifications for key transitions: assigned, completed, blocked
- `fleet task board` gives CLI snapshot
- Task file is human-readable (JSON or YAML) for direct inspection

---

## Step 3: API / Interface Design

### CLI Interface (`fleet task`)

```
fleet task create <title> [--assign <agent>] [--priority low|normal|high|urgent]
                          [--parent <task-id>] [--depends-on <task-id>]
                          [--project <name>] [--desc <description>]
fleet task assign <task-id> <agent>
fleet task update <task-id> --status <open|in_progress|done|blocked|cancelled>
                            [--note <text>] [--result <json>]
fleet task list [--assignee <agent>] [--status <status>] [--project <name>]
fleet task show <task-id>
fleet task board                     # human-friendly dashboard
fleet task reassign <task-id> <agent>
fleet task cancel <task-id> [--reason <text>]
fleet task tree                      # hierarchical parent → subtask view
fleet task recap [--since 2h|today]  # summary of recent completions + state changes
fleet task archive [--before 7d]     # move old completed tasks to archive file
```

All commands support `--json` for machine-readable output.

**`fleet task recap`** deserves special attention — this is how the human catches up after being away. It reads the task history and produces a structured report: tasks completed, tasks started, blockers raised, who did what. This is the "fleet worked while you slept, here's what happened" command.

### Agent Interface (programmatic)

Agents interact with tasks through the CLI (via Bash tool). No MCP server or special tooling for MVP — the CLI is the API. This keeps the interface uniform: agents and humans use the same commands.

```bash
# Lead creates and assigns
fleet task create "Fix watchdog try/catch" --assign John-Carmack --priority high

# Worker updates
fleet task update task-003 --status in_progress
fleet task update task-003 --status done --note "Committed in 6c00826" \
  --result '{"commits":["6c00826"],"files_changed":5}'

# Worker signals block
fleet task update task-007 --status blocked --note "Need API credentials from lead"

# Any agent reads the board
fleet task list --status in_progress
fleet task list --assignee Donald-Knuth
```

### Notification Contract

On key transitions, `fleet task` posts a Discord message to the fleet's command channel:

- **assigned:** "@Worker you've been assigned: [task title] (task-003). Run `fleet task show task-003` for details."
- **completed:** "@Lead task-003 done by Worker: [summary]"
- **blocked:** "@Lead task-007 blocked by Worker: [reason]"
- **reassigned:** "@NewWorker task-003 reassigned to you from @OldWorker."

Notifications are the push mechanism. `fleet task list` is the pull mechanism. Both are necessary.

### Boot-Check Integration

`fleet boot-check <agent>` injects a task summary into the agent's context on startup:

```
## Your Current Tasks
- [task-003] HIGH: Fix watchdog try/catch — status: in_progress
- [task-009] NORMAL: Review adapter changes — status: open
Run `fleet task show <id>` for details.
```

This is how tasks survive compaction: the boot-check reads the task store and regenerates the summary.

---

## Step 4: Data Model

### Core Entities

**Task:**

```typescript
interface Task {
  // Identity
  id: string                    // "task-001" — monotonic, human-readable
  title: string                 // short summary
  description?: string          // detailed instructions

  // Ownership
  createdBy: string             // agent name or "human"
  assignee?: string             // agent name
  project?: string              // logical project grouping
  workspace?: string            // target workspace/repo for this task

  // Status
  status: "open" | "in_progress" | "done" | "blocked" | "cancelled"
  priority: "low" | "normal" | "high" | "urgent"
  blockedReason?: string        // set when status is "blocked"

  // Hierarchy
  parentId?: string             // parent task (for decomposition)
  dependsOn?: string[]          // task IDs that must complete first

  // Results (filled on completion)
  result?: {
    summary?: string
    commits?: string[]
    filesChanged?: string[]
    prUrl?: string
    testsPassed?: boolean
    [key: string]: unknown      // extensible
  }

  // Timeline
  createdAt: string             // ISO 8601
  updatedAt: string
  startedAt?: string            // when moved to in_progress
  completedAt?: string          // when moved to done

  // Audit trail
  notes: TaskNote[]
}

interface TaskNote {
  timestamp: string
  author: string                // agent name or "human"
  type: "comment" | "status_change" | "assignment" | "priority_change"
  text: string
  oldValue?: string             // previous status/assignee (for state transitions)
  newValue?: string             // new status/assignee
}
```

**TaskStore (file format):**

```typescript
interface TaskStore {
  version: 1                    // schema version for forward compatibility
  fleet: string
  nextId: number                // monotonic counter for ID generation
  tasks: Task[]
}
```

### Design Decisions on the Data Model

1. **Human-readable IDs** (`task-001` not UUIDs) — agents and humans type these in CLI commands. Must be short and unambiguous within a fleet. Cross-fleet references use `fleet:task-001`.

2. **Flat task list, not a tree** — parent/child relationships via `parentId` field, not nested objects. Enables simple queries (filter by status) without tree traversal. Hierarchy is a view concern, not a storage concern.

3. **Notes as append-only log** — notes are never edited or deleted. They form the audit trail. Status changes are reflected in top-level fields, not derived from notes.

4. **Result is a structured bag** — not free text. Agents attach commits, files, PRs. This enables programmatic post-mortem queries like "show me all commits from this sprint."

5. **Schema version field** — enables non-breaking migrations as the model evolves. Reader checks version and applies migration if needed.

6. **`dependsOn` as simple ID list** — not a full DAG scheduler. The CLI can warn if you try to start a task whose dependencies aren't done. Enforcement is advisory, not blocking — an agent can override if needed.

7. **Definition vs execution are currently unified.** The Task entity merges "what needs to be done" (title, description, priority, dependsOn) with "what was done" (status, result, notes, startedAt). This works for MVP but will need to split when task templates (UC-19) arrive — a template is a definition without execution, and a recurring task creates new execution records from the same definition. The split point is clear: definition fields are immutable after creation; execution fields change throughout the lifecycle.

### Status State Machine

Valid transitions — the CLI enforces these:

```
open --> in_progress    (worker starts)
open --> cancelled      (lead cancels)
open --> blocked        (dependency not met, or external block)
in_progress --> done    (worker completes)
in_progress --> blocked (worker hits obstacle)
in_progress --> cancelled (lead cancels)
blocked --> open        (block resolved, back to queue)
blocked --> in_progress (block resolved, worker resumes immediately)
blocked --> cancelled   (lead cancels)
done --> open           (lead reopens — rejected in review)
```

Invalid transitions (CLI rejects with error):
- `done --> in_progress` (must reopen to `open` first)
- `cancelled --> *` (cancelled is terminal; create a new task instead)
- Any transition by a non-assigned agent on `in_progress/done` (advisory warning, not hard block)

### Dependency Cycle Detection

When `--depends-on` is set, the CLI walks the dependency chain to verify no cycle exists before writing. Algorithm: depth-first traversal from the new dependency back through `dependsOn` fields. If the current task ID appears in the chain, reject with error: "Circular dependency detected: task-003 -> task-007 -> task-003". O(n) where n is task count — trivial at our scale.

---

## Step 5: Architecture

### Storage Layer

**MVP: Single JSON file**

```
~/.fleet/tasks/<fleet-name>.json
```

- Read: `JSON.parse(readFileSync(...))`
- Write: atomic rename (`writeFileSync(tmpFile, ...) → renameSync(tmpFile, file)`)
- Concurrency: `flock` advisory lock on a `.lock` file during read-modify-write
- All local agents on the same machine share this file directly

**Canonical store location:** The task store lives on the machine where `fleet.yaml` lives (the fleet control plane). This is typically the machine where the human runs fleet CLI commands. It may or may not be the same machine as the lead agent.

**Cross-server reads (canonical → remote):**

1. `fleet sync` SCPs `tasks.json` to each remote agent's state directory (read-only replica)
2. Remote agent reads its local copy
3. Sync runs on boot-check and periodically (same interval as identity/access sync)

**Cross-server writes (remote → canonical) — committed design:**

Remote agents write back via SSH to the fleet controller. No hand-waving.

```
Remote agent runs: fleet task update task-003 --status done --result "..."
    │
    ├──→ Detect: canonical tasks.json exists locally?
    │     Yes → local atomic write
    │     No  → SSH to controller: ssh <host> "cd <fleet-dir> && fleet task update ..."
    │
    └──→ On success, update local replica for read-after-write consistency
```

If SSH is unavailable, the update queues in `~/.fleet/tasks/pending-updates.jsonl` (append-only). Next successful `fleet sync` replays pending updates against the canonical store.

**SPOF acknowledgment:** The controller machine is a single point of failure for writes. Remote agents queue updates locally when it's down, but can't create new tasks or see other agents' updates. Acceptable at MVP scale (3-10 agents). Upgrade path: lightweight HTTP task server that multiple machines can reach (Phase 4).

**Future: SQLite**

When the JSON file exceeds ~1000 tasks or query patterns get complex, migrate to SQLite:
- Same file path, `.sqlite` extension
- Same CLI interface, different backend
- Indexed queries by status, assignee, project
- Built-in transactions replace flock

### Notification Layer

```
fleet task create/update
    │
    ├──→ Write to tasks.json (atomic)
    │
    ├──→ Discord notification (if key transition)
    │     └── Post to fleet's command channel via DiscordApi
    │
    └──→ fleet sync (if remote agents exist)
          └── SCP updated tasks.json to remote state dirs
```

### Context Re-Injection (Core Design)

This is the reason the feature exists. When an agent compacts or restarts, its context window loses awareness of assigned tasks. The data is safe on disk, but the agent doesn't know it exists. Context re-injection bridges this gap.

**Two mechanisms, two triggers:**

**Mechanism 1: Boot-time injection (cold start / restart)**

Triggered by `fleet boot-check <agent>` during the wrapper script's restart loop, before Claude Code starts.

```
fleet boot-check <agent>
    │
    ├──→ Read tasks.json from canonical store
    ├──→ Filter by role:
    │     Worker: assignee == this agent, status in (open, in_progress, blocked)
    │     Lead:   ALL active tasks — full board state
    ├──→ Generate tasks-context.md (separate file, NOT appended to identity.md)
    ├──→ Write to <stateDir>/tasks-context.md
    └──→ Claude Code loads it via --append-system-prompt-file
```

**Why a separate file?** Identity.md is the agent's permanent identity (role, rules, roster). Task context is ephemeral and changes every boot. Mixing them means regenerating identity.md on every task change. Separate files, separate lifecycles.

**Mechanism 2: Live re-injection (after compaction, no restart)**

Triggered by watchdog or lead when it detects compaction (output shows "Context compacted" pattern).

```
Watchdog/Lead detects compaction
    │
    ├──→ Regenerate tasks-context.md for the compacted agent
    └──→ runtime.sendKeys(): summary reminding agent of its tasks
         "Your current tasks: [T-003] Fix watchdog (in_progress), [T-007] Add disk check (open)"
```

Best-effort — the agent may or may not process the injected message. Boot-time injection is the reliable path; live re-injection is the fast path.

**Content format — Worker:**

```markdown
## Your Current Tasks
- **[task-003]** HIGH — Fix watchdog daemon loop
  Status: in_progress | Workspace: ~/open-fleet
  Description: Wrap try/catch around main loop, add compact cooldown
- **[task-007]** NORMAL — Add local disk check
  Status: open | Workspace: ~/open-fleet
Run `fleet task show <id>` for details. `fleet task update <id> --status done --result "..."` when complete.
```

**Content format — Lead:**

```markdown
## Fleet Task Board
**In Progress (2):**
- [task-003] Fix watchdog — John-Carmack (HIGH)
- [task-006] Infra setup — Linus-Torvalds (NORMAL)

**Blocked (1):**
- [task-007] API integration — Ken-Thompson — BLOCKED: waiting on API key

**Open (1):**
- [task-008] Add retry logic — unassigned (MEDIUM)

Run `fleet task board` for live state. `fleet task create/assign/update` to manage.
```

**Size constraints:**
- Max injection: 2000 characters (preserves context window budget)
- Over limit: show highest-priority first, append "[+N more — run `fleet task list --mine`]"
- Descriptions truncated to 100 chars; full detail via `fleet task show`

**Failure handling (critical — injection must NEVER block agent boot):**
- tasks.json missing or corrupt → boot-check warns and continues. Agent starts without task context.
- tasks-context.md write fails → warn and continue. Agent can run `fleet task list` manually.
- Task injection is additive and failure-tolerant. A worker with no task context is degraded but functional. A worker that won't start is useless.

### Component Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Human CLI   │     │  Lead Agent  │     │ Worker Agent │
│  fleet task  │     │  fleet task  │     │  fleet task  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────┬───────┴────────────────────┘
                    ▼
           ┌────────────────┐
           │   Task CLI     │
           │  (src/commands/ │
           │   task.ts)     │
           └───────┬────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
   ┌─────────────┐  ┌──────────────┐
   │ tasks.json  │  │  Discord API │
   │ (canonical) │  │ (notify)     │
   └──────┬──────┘  └──────────────┘
          │
          ▼ (fleet sync)
   ┌─────────────┐
   │ tasks.json  │
   │ (remote     │
   │  replicas)  │
   └─────────────┘
```

---

## Step 6: Trade-offs

### What we're choosing

1. **File-based over database** — simplicity, portability, no dependencies. Works on any machine with a filesystem. Trade-off: no concurrent transactions, limited query capability, manual migration path.

2. **CLI as API over MCP/REST** — agents already have Bash. No new tool registration, no plugin changes. Trade-off: slightly more verbose for agents (run a shell command vs call a typed function), parsing CLI output.

3. **Canonical store on control plane over distributed** — single source of truth on the machine where `fleet` CLI and `fleet.yaml` live (not necessarily the lead agent's machine). No conflict resolution needed. Trade-off: remote agents have stale reads (eventual consistency via sync), control plane is a known SPOF for writes. Remote writes queue locally via pending-updates and replay on reconnect. Acceptable at MVP scale; upgrade path is HTTP task server (Phase 4).

4. **Push notifications via Discord over polling** — agents are already on Discord, notifications are free. Trade-off: notification delivery depends on Discord API availability; if Discord is down, agents must fall back to polling `fleet task list`.

5. **Human-readable IDs over UUIDs** — ergonomic for CLI use, easy to type. Trade-off: IDs are only unique within a fleet; cross-fleet references need `fleet:task-id` prefix. ID collision is impossible (monotonic counter) but IDs don't carry semantic meaning.

6. **Advisory role enforcement over strict ACL** — any agent can technically call any command. Roles are recorded in metadata for auditing but not enforced. Trade-off: a misbehaving agent could corrupt task state. Acceptable because all agents are trusted within a fleet.

7. **Flat list with `depends_on` over full DAG scheduler** — the lead agent sequences work manually. `depends_on` is advisory (CLI warns, doesn't block). Trade-off: no automatic parallel execution planning or critical-path analysis. The lead is smart enough to schedule — we don't need an optimizer. Reconsider when fleet size makes manual sequencing impractical (20+ agents).

8. **Active/archive split over single store with retention** — completed tasks are moved to a separate archive file by `fleet task archive`. Active file stays small and fast; archive grows unbounded without performance impact.

### What we're giving up (and when we'd reconsider)

- **Real-time sync** — reconsider when fleets span 3+ servers and task latency becomes a user complaint
- **Strict consistency** — reconsider when concurrent task updates cause actual data loss (not theoretical)
- **Database backend** — reconsider when task count exceeds ~1000 or complex queries are needed
- **Typed API (MCP tool)** — reconsider when CLI parsing becomes a reliability issue for agents
- **Cross-fleet coordination** — reconsider when multiple fleets exist and need to share work; likely requires a shared task registry service
- **Automated scheduling** — reconsider when manual lead assignment becomes the bottleneck; implement as a layer on top of the same task store

---

---

## Implementation Plan

### Phase 1: MVP (target: this week)
- `src/commands/task.ts` — CLI command with create, assign, update, list, show, board, mine
- `src/tasks/store.ts` — file-based TaskStore with atomic writes and flock
- `src/tasks/types.ts` — Task, TaskNote, TaskStore interfaces
- Boot-check integration: inject task summary into agent context on startup
- `fleet sync` extended to include tasks.json
- Discord notifications on assign, done, blocked

### Phase 2: Decomposition + Dependencies (2-4 weeks)
- Parent/child relationships and `fleet task split`
- `dependsOn` with advisory enforcement (warn on premature start)
- Board view renders task tree (`fleet task tree`)
- Structured result reporting (commits, files, PRs)
- `fleet task recap` for human catch-up summaries

### Phase 3: Scale + Automation (1-3 months)
- SQLite backend behind TaskStore interface
- Auto-scheduling daemon (match unassigned tasks to idle agents)
- Time tracking analytics (started_at -> completed_at)
- Task templates for common workflows
- Task archival (`fleet task archive`)

### Phase 4: Federation (6-12 months)
- HTTP API for task store (replaces SCP sync, solves push-to-50-agents bottleneck)
- Cross-fleet task references (`fleet:task-id` namespace)
- Multi-fleet dashboard
- Pull-based sync for remote agents

---

## Review Findings — Resolved

All review findings have been folded into the main design body. Summary of what was raised and where it was resolved:

**Use Cases:**
- Lead context recovery (Ken) -> Added UC-14
- Stale task from dead agent (Linus) -> Added UC-15
- Task health distinct from agent health (Knuth) -> Addressed via UC-15 + watchdog integration

**Requirements:**
- SPOF contradiction (Linus, Carmack, Knuth) -> Reliability section now honestly states MVP SPOF with upgrade path
- Task store vs Discord authority (Ken) -> "Source of Truth" section added: store is authoritative from day one
- Task system must be non-load-bearing (Knuth) -> Failure handling in context re-injection section: warn and continue, never block boot
- Data persistence vs context re-injection are separate problems (Carmack) -> Context re-injection elevated to first-class section

**Data Model:**
- Missing workspace field (Linus, Carmack) -> Added to Task schema
- Definition vs execution conflated (Ken) -> Noted in design decision #7 with template split point
- Missing status state machine (Knuth) -> Added with valid/invalid transitions
- Missing dependency cycle detection (Knuth) -> Added DFS algorithm description
- Notes need typed events (Carmack) -> TaskNote now has `type` and `oldValue`/`newValue` fields
- Task.fleet redundant with TaskStore.fleet (Knuth) -> Removed from Task, lives at store level

**Architecture:**
- Canonical store location unclear (Ken, Carmack) -> Clarified: control plane machine (where fleet.yaml lives)
- Remote write path hand-waved (Linus, Carmack, Knuth) -> Concrete SSH-back design with pending-updates fallback
- Three storage migrations is risky (Linus) -> SPOF mitigated via git auto-commit; migration count acknowledged as trade-off
- Advisory enforcement risk is hallucination, not malice (Ken) -> Noted in trade-off #6

**Trade-offs:**
- UC-13 contradicts advisory depends_on (Knuth) -> Reworded: "should not be started" not "is not actionable"
- Archive can break dependency lookups (Knuth) -> Dependency targets cannot be archived

---

*Document owned by Ken Thompson. Architecture and Steps 3-6 by Donald Knuth. CLI features by John Carmack. Infra and ops perspective by Linus Torvalds. All review findings integrated 2026-04-01.*

<!-- Raw review notes preserved below for reference -->
<!--
### Ken Thompson — Design Thinking Review

**Are the use cases correct?**

UC-1 through UC-13 are solid — they describe real problems we hit today. UC-2 (task survival after compaction) is the most important and should be the litmus test for the whole design: if it doesn't solve this one, nothing else matters.

However, the use cases have a conceptual gap: **there's no UC for "lead recovers its own context."** We have UC-2 for workers, UC-10 for human bypass when lead is down, but nothing for: "Lead agent compacts, reboots, and needs to reconstruct its understanding of what the whole team is doing." The lead is the *heaviest* user of task state — it needs the full board, not just its own assignments. This is arguably more critical than UC-2 because a confused lead makes bad assignments, which cascades to the whole team.

**Proposed UC-14a:** Lead recovers orchestration context after compaction. Boot-check injects full board state (all active tasks, all assignees, all blockers), not just "your tasks." The lead needs the team picture, not a personal to-do list.

**Are the requirements right?**

The reliability requirements are correct in principle but miss one thing: **task state and agent identity are now coupled.** If boot-check injects tasks into identity context, a failure in the task system (corrupt file, missing file) could break agent boot entirely. The design should specify that task injection is *additive and failure-tolerant* — if tasks.json is missing or corrupt, boot-check should warn and continue, not block the agent from starting. A worker with no task context is better than a worker that won't start.

The consistency model (last-write-wins per field) is the right call for this scale. But the design doesn't address a subtler consistency question: **what's the source of truth when Discord and tasks.json disagree?** If the lead assigns a task via Discord @mention (the way we work today) but doesn't create it in the task store, is it a task? The design implicitly assumes all orchestration goes through `fleet task`, but the transition period where some tasks are Discord messages and some are in the store will be messy. We should acknowledge this and decide: is the task store authoritative from day one, or is it supplementary to Discord?

**Is the data model capturing the right concepts?**

The Task entity is conceptually right but conflates two things: **the task definition** (what needs to be done) and **the task execution record** (what was actually done). `title`, `description`, `priority`, `dependsOn` are definition. `status`, `result`, `notes`, `startedAt`, `completedAt` are execution. These have different lifecycles — a task template (UC-19) is a definition without execution. A recurring task creates new execution records from the same definition. The current flat model works for MVP but will need to split when templates arrive. Worth noting in the design decisions.

**Are the trade-offs right?**

The canonical-store-on-lead's-machine trade-off has an unstated assumption: **the lead runs on the same machine as the fleet CLI.** If the lead is on a remote server (which is a supported configuration), then the "canonical store" is on a different machine than where `fleet task` runs from the human's terminal. The design should clarify: canonical store is on the machine where `fleet` CLI executes (the control plane), not necessarily the lead's machine.

The "advisory role enforcement" trade-off is correct for now, but the design should note that agents can accidentally corrupt task state by misunderstanding CLI arguments — not maliciously, but because an AI agent might hallucinate a task ID or pass wrong flags. This is the real risk, not a "misbehaving agent."

---

*Document owned by Ken Thompson. Input from full fleet team. UC-10, partial-write requirement, Steps 3-6 added by Donald Knuth. UC-11/12/13, offline degradation, dependency scoping, and `recap`/`tree`/`archive` CLI additions by John Carmack. Scale and sync concerns by Linus Torvalds.*



### Linus Torvalds -- Ops & Production Perspective

**Use Cases: Missing a critical one.**
There is no use case for "task goes stale because the assigned agent died." UC-8 covers fleet-wide disruption (all agents crash and restart), and UC-2 covers an agent picking up tasks after restart. But neither covers the scenario where an agent dies silently and DOESN'T restart -- the task sits in_progress with nobody working on it. Need a UC for: "system detects that a task's assignee is unresponsive and escalates to the lead." This is a daily reality, not an edge case.

**Requirements: SPOF contradiction.**
The reliability requirements state "no single point of failure" but the architecture puts the canonical store on one machine (the lead's). These two statements can't both be true. Either relax the requirement to "single point of failure is acceptable at MVP scale" (honest) or change the architecture to store tasks in a replicated location (the fleet git repo, for example). The current doc promises reliability it doesn't deliver.

**Data Model: Missing workspace field.**
UC-20 describes multi-repo tasks, but the Task interface has no `workspace` or `repo` field. An agent needs to know WHERE the work happens, not just WHAT the work is. Without this, multi-repo tasks are a stated requirement with no data model support. Add `workspace?: string` to the Task schema -- even if MVP doesn't use it, the field should exist from day one to avoid a migration.

**Architecture: Sync model is half-designed.**
The architecture describes canonical to remote sync (push via SCP) but doesn't design remote to canonical (how do remote worker updates get back?). This is the hardest part of the distributed system and it's left as "or: post via Discord." If we're honest that remote agents can't update tasks directly and must ask the lead via Discord to update on their behalf, that's a valid design -- but it should be stated explicitly as a constraint, not hand-waved as an alternative. Alternatively, remote agents could SSH back to the canonical machine and run `fleet task update` there -- that's simpler and more reliable than Discord-as-RPC.

**Trade-offs: File-based to sync to eventually HTTP is three migrations.**
The phasing plan goes: JSON file, then add SCP sync, then replace with SQLite, then add HTTP API. That's three storage migrations over 12 months. Each migration is a reliability risk. Consider whether starting with a simple HTTP endpoint (even just a Bun server serving a JSON file behind an API) from Phase 1 would avoid two of those migrations. The CLI interface stays the same either way -- it's an internal architecture choice, not a user-facing one.

**Trade-off I agree with: CLI as API.**
Using the CLI as the agent interface (not MCP, not REST) is the right call. Agents already have Bash. It's the same interface for humans and agents. It's testable from the command line. Don't add complexity here.

**Overall assessment:** The design thinking is sound -- use cases are mostly complete, the data model captures the right concepts, and the trade-offs are reasonable. The two real gaps are: (1) the SPOF contradiction needs honest resolution, and (2) the remote sync story needs a concrete design, not a hand-wave. Fix those and this is ready to build.

### John Carmack — Design Thinking Review

**Are the use cases right?**

The core use cases (UC-1 through UC-13) nail the actual problem. UC-2 (task survival after compaction) is the single most valuable — everything else is secondary. Ken's addition of "lead recovers its own context" is the most important gap — I missed it too. A confused lead is worse than a confused worker because bad assignments cascade to the whole team. Linus's stale-task-with-dead-agent UC is equally critical — it's a daily reality we already deal with.

The extended use cases (UC-14 through UC-21) reveal a conceptual tension the design doesn't resolve. We're simultaneously designing for a *5-agent shared to-do list* and a *100-agent distributed work scheduler*. These are fundamentally different systems. The risk: full-vision UCs pull MVP thinking toward abstractions (fleet namespacing, delegated admin) that add conceptual weight without delivering value today. The extended UCs should inform the data model (include a `fleet` field now) but should NOT drive architectural choices about how agents access task state.

**Are the requirements right?**

Reliability is correctly #1, but the design conflates two different problems that need separate solutions: **data persistence** and **context re-injection.** Data persistence is straightforward — write a file, it survives restarts. Context re-injection is the hard part — getting the right data back into an agent's working memory at exactly the right moment after compaction. The requirements should treat these as separate concerns. The data problem is solved by the task store. The context problem is solved by boot-check injection. The design underspecifies the second one, which is the harder problem and the entire reason we're building this.

Agreeing with Linus: the "no single point of failure" requirement contradicts the canonical-store-on-one-machine architecture. Be honest: MVP has a SPOF. That's acceptable. Don't promise what we're not delivering.

The consistency requirements are correctly deprioritized, but should explicitly name the one dangerous scenario: **lead reassigns a task at the same moment the worker marks it done.** The worker's "done" overwrites the reassignment; the new assignee never learns about the task. This isn't a technical problem to solve — it's a procedural reality to document.

**Is the data model right?**

Missing concept: **task scope/workspace.** Our agents are tied to workspaces via channels. A task should carry *where* to work, not just *what* to do. Linus flagged the same gap. Add `workspace` to the task assignment, not just the result.

Ken's observation about definition vs execution is sharp. The flat model merges "what to do" with "what was done." This works for MVP but breaks when templates (UC-19) need to instantiate the same definition multiple times. Worth flagging as a known limitation, not something to solve now.

The `notes` array needs to distinguish **state transitions from commentary.** `fleet task recap` needs to produce "3 completed, 1 blocked" — that requires querying typed events, not parsing free-text notes. Either add `history: TaskEvent[]` alongside notes, or add a `type` field to TaskNote.

**Is the architecture sound?**

The canonical-store model has an identity problem that multiple reviewers caught: *where does the store actually live?* "Lead's machine" is ambiguous when the human runs `fleet task` from a laptop and the lead agent runs on a server. The architecture needs one clear answer: the canonical store lives wherever `fleet.yaml` lives (the fleet config directory). All remote access routes through that machine.

Linus is right that the remote-to-canonical sync is the hardest part and it's hand-waved. "Post via Discord" as an alternative to SSH-back is not a real design — it turns Discord into an RPC channel, which is fragile and unstructured. Pick one: remote agents SSH back to run `fleet task update` on the canonical machine, or remote agents are read-only and report results via Discord for the lead to record. Both are valid. The design should commit to one.

**Are the trade-offs right?**

Sound for MVP. One I'd sharpen: the design says "all access goes through CLI, never raw file reads" to support a future storage backend swap. This is trading present simplicity for hypothetical future flexibility. If an agent can read a JSON file in 1ms, forcing it through a CLI subprocess for a migration that may never happen is premature. Better trade-off: raw file reads are fine for reads in MVP. CLI is the write interface. Revisit the read path only when storage actually changes.

**Overall:** The design thinking is 85% right. The core use cases, data model concepts, and fundamental trade-offs are sound. The gaps are: (1) context re-injection needs to be a first-class design concern, not a one-paragraph afterthought, (2) the SPOF contradiction needs honest acknowledgment, (3) remote sync needs a committed design, and (4) the extended use cases should inform but not drive MVP architecture. Fix those four and ship it.

*— John Carmack*

### Donald Knuth — Design Rigor Review

**Are the use cases correct?**

UC-1 through UC-13 capture the real problems. Ken's UC-14a (lead recovers orchestration context) and Linus's stale-task observation are both important gaps that multiple reviewers converged on independently — which is a good signal that they're real.

There's a missing concept the use cases don't address: **task health as distinct from agent health.** The watchdog monitors agent liveness (is the tmux session alive?). But a task can be "in_progress" while its agent is healthy but has compacted and moved on to other work. The boot-check injection addresses restarts, but not mid-session compaction. A task in_progress for N hours without a note update is stale regardless of agent liveness. This needs its own use case — it's a different failure mode from anything currently listed.

I agree with Carmack that the extended use cases (UC-14 through UC-21) create a conceptual tension. The design is trying to serve two masters: a simple shared to-do list for 5 agents, and a distributed work scheduler for 100. These pull in different directions. The extended UCs should inform field choices in the data model (include `fleet`, `workspace`, `project` fields now) but should not drive how the MVP accesses or syncs task state.

**Are the requirements right?**

Ken identified a coupling risk: task injection at boot could block agent startup if tasks.json is corrupt. I'd elevate this to a design principle: **the task system is a layer on top of the fleet, not load-bearing infrastructure.** If the task store is missing, corrupt, or unavailable, agents still work — they just lose orchestration context. Today's fleet works without tasks. Tomorrow's fleet should degrade gracefully to today's behavior when the task system fails. This should be stated as a requirement, not just an implementation detail.

Carmack's distinction between data persistence and context re-injection is the sharpest observation in all four reviews. The data problem (write a file, it survives) is trivial. The context problem (get the right information back into an agent's working memory at the right moment) is the entire reason this system exists. The requirements underweight the context re-injection problem. It deserves its own section.

**Is the data model capturing the right concepts?**

Two correctness concerns at the model level:

1. **Status has no state machine.** Any status can transition to any other. Can "done" revert to "in_progress"? Can "cancelled" become "open"? Without defined transitions, "correctness" is undefined. The design should specify valid transitions. Even if enforcement is deferred, the *design* should say what's intended. Proposed valid transitions:
   - open → in_progress, cancelled
   - in_progress → done, blocked, cancelled
   - blocked → in_progress, cancelled
   - done → in_progress (reopen — explicit, audited)
   - cancelled → (terminal)

2. **Dependencies can form cycles.** `dependsOn` is an unconstrained list. Task A depends on B, B depends on A — both permanently stuck. A compacted lead could easily create this by forgetting existing dependencies. The data model needs a stated invariant: the dependency graph must be a DAG. Whether this is enforced at write time or detected at read time is an implementation choice, but the *invariant* should be in the design.

Additional model gaps flagged by others that I agree with:
- `Task.fleet` is redundant with `TaskStore.fleet` (store once, at store level)
- Missing `workspace` field (Linus and Carmack both flagged)
- `notes` needs typed events for state transitions, not just free-text (Carmack's point — `fleet task recap` needs to query structured history)

**Are the trade-offs right?**

One internal contradiction: UC-13 says "Task B is not actionable until A is done" but Trade-off #7 says "depends_on is advisory (CLI warns, doesn't block)." Pick advisory for MVP, but reword UC-13: "should not be started" rather than "is not actionable."

The archive trade-off has an integrity gap: if an active task has `dependsOn: ["task-003"]` and task-003 is archived, the dependency lookup returns nothing. The design should specify: tasks referenced as active dependencies cannot be archived, or dependency checks search both stores.

**Is the architecture thinking sound?**

The core approach is right: file-based, CLI as API, Discord for notifications, boot-check for context re-injection. Three reviewers (Linus, Carmack, and I) independently flagged the same two gaps:

1. **SPOF contradiction.** "No single point of failure" vs canonical-store-on-one-machine. Be honest: MVP has a SPOF for writes. That's acceptable at this scale. Don't promise otherwise.

2. **Remote write path is undesigned.** The sync model is one-directional (push canonical → remote). Workers must write. The design must commit to one of: (a) remote agents SSH back to run `fleet task update` on the canonical machine, or (b) remote agents are read-only and report via Discord. Both are valid. "Or alternatively..." is not a design.

Carmack's point about where the canonical store lives is also important: it should be where `fleet.yaml` lives (the control plane), not "the lead's machine" — these may be different.

**Overall:** The design thinking is sound at its core. Three things to resolve before building: (1) commit to a remote write strategy, (2) acknowledge the SPOF honestly, (3) define the status state machine. Everything else is solid and ready to implement.

*— Donald Knuth*


### Linus Torvalds -- Revisions to Architecture

#### SPOF: Honest Assessment

**MVP reality:** The canonical task store on one machine IS a single point of failure for writes. This is acceptable at 3-10 agents on 1-2 servers. Stating it honestly:

- If the canonical machine goes down, no new tasks can be created or updated.
- Workers can still READ their last-synced task list and continue working.
- Workers cannot report completion -- they accumulate results locally and sync when the machine returns.
- The human can still coordinate via Discord (fallback to today's behavior).

**Mitigation (MVP):** The task store lives in the fleet config directory (where fleet.yaml lives), which should be a git repo. After every write, auto-commit tasks.json. This gives us: backup (git history), replication (git push), and recovery (git clone on a new machine). The SPOF for writes remains, but data loss risk drops to near zero.

**Upgrade path (Phase 3+):** Move to an HTTP task service. Any machine can host it. Agents connect via URL in fleet.yaml. No more file sync, no more SPOF -- standard service availability patterns apply.

#### Remote Write Path: Concrete Design

**MVP approach: Remote agents SSH back to the canonical machine to run fleet task update.**

How it works:
1. Remote agent needs to update a task (e.g., mark done).
2. Agent runs: `ssh <canonical-host> "cd <fleet-dir> && fleet task update task-003 --status done --note 'Fixed in abc123'"`
3. The update happens on the canonical machine, atomically, with flock.
4. fleet sync pushes the updated tasks.json to all remotes on the next cycle.

Why this works:
- SSH is already configured for every remote agent (fleet setup-server handles this).
- fleet task CLI is already installed on the canonical machine.
- No new infrastructure. No new protocol. No Discord-as-RPC hack.
- Writes are always against the canonical store -- no merge conflicts possible.

Constraints:
- Requires SSH connectivity from remote back to canonical. If the remote can SSH out (which it can -- that's how it was set up), reverse SSH works. If firewalls block reverse SSH, the remote agent must use the fallback: report via Discord for the lead to record.
- Adds latency to remote writes (SSH round-trip). Acceptable -- agents think for minutes, a 1-second SSH call is noise.

Configuration: fleet.yaml gains a `control_plane` field:

```yaml
fleet:
  name: my-fleet
  control_plane: user@control-host  # where fleet CLI + tasks.json live
```

Remote agents use this for SSH-back writes. Local agents write directly.

**Fallback for restricted networks:** If reverse SSH is blocked, remote agents are read-only for task state. They report results via Discord. The lead (or a local agent) transcribes results into the task store. This is explicitly a degraded mode, not the default.
-->
