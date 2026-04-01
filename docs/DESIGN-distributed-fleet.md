# Distributed Fleet Architecture — Design Document

> Owner: Ken Thompson. Last updated: 2026-04-01.

---

## Step 1: What Breaks Today and Why

Every mechanism below assumes agents can read/write files on the control plane machine. When agents run on different machines, each one fails.

### Filesystem-dependent mechanisms

**1. Fleet config discovery (`findConfigDir()`)**
- **How it works:** Walks up the directory tree looking for `fleet.yaml`
- **Fails because:** Workers and remote agents don't have `fleet.yaml`. It only exists on the control plane.
- **What breaks:** Every `fleet` CLI command. `fleet task`, `fleet status`, `fleet doctor`, `fleet sync` — all of them.
- **Affected:** ALL remote agents, ALL workers not on control plane machine

**2. Task store access (`~/.fleet/tasks/<fleet>.json`)**
- **How it works:** Direct file read/write via `loadTaskStore()` / `saveTaskStore()`
- **Fails because:** The task file only exists on the control plane. Workers can't read or write it.
- **What breaks:** `fleet task create/update/list/board/show` — the entire task system
- **Affected:** ALL agents not on the control plane machine

**3. Identity generation and updates**
- **How it works:** `writeBootIdentity()` and `writeRoster()` generate identity.md and CLAUDE.md from fleet.yaml + bot token validation
- **Fails because:** Requires fleet.yaml + Discord API access + write access to state dir. Remote agents get files SCP'd at start time but never updated.
- **What breaks:** Identity template changes (like task workflow instructions) never reach running agents
- **Affected:** ALL remote agents after any identity template change

**4. Boot-check pre-flight**
- **How it works:** Regenerates access.json, checks plugin patches, verifies identity, injects task context
- **Fails because:** Remote agents skip boot-check entirely (`adapter.ts:134` — `bootCheckCmd = null` for remote)
- **What breaks:** Remote agents never get task context injected. Access.json never refreshed. Plugin patches never verified.
- **Affected:** ALL remote agents

**5. Fleet sync (`fleet sync`)**
- **How it works:** Regenerates identity/access/roster files and SCPs them to remote state dirs
- **Fails because:** Only pushes identity.md, access.json, CLAUDE.md. Does NOT include tasks.json, tasks-context.md, or any task state. Also: push-only — no pull mechanism for remotes.
- **What breaks:** Task state never reaches remote agents. Remote agents can't trigger a sync.
- **Affected:** ALL remote agents

**6. Auto-patch after start**
- **How it works:** Runs `fleet patch` after agent launch to fix Discord plugin bot IDs
- **Fails because:** `fleet patch` requires fleet.yaml to find all fleet configurations and bot IDs
- **What breaks:** Silent failure on remote agents (caught by empty catch block). Plugin may have stale bot IDs.
- **Affected:** ALL remote agents

**7. Watchdog health monitoring**
- **How it works:** Reads heartbeat files, checks tmux sessions, reads agent output
- **Fails because:** Requires local tmux access or SSH to each remote. Watchdog runs on control plane only.
- **What breaks:** If watchdog is down, no monitoring exists. Remote agents can't self-monitor.
- **Affected:** Fleet-wide monitoring depends on single control plane machine

**8. Concurrent file editing (docs, shared files)**
- **How it works:** Agents directly read/write shared files in the repo
- **Fails because:** Multiple agents editing the same file at the same time causes "File modified since read" errors. No locking, no merge, no branch isolation.
- **What breaks:** Parallel doc editing, concurrent code changes to same file
- **Affected:** ALL agents working on shared files

### Summary: the local-first assumption

```
Control plane machine         Remote agent machine
+------------------+         +------------------+
| fleet.yaml       |         | (none)           |
| .env             |         | (none)           |
| ~/.fleet/tasks/  |         | (stale copy)     |
| ~/.fleet/state/* |         | identity.md      |
| fleet CLI        |         | access.json      |
| watchdog         |         | CLAUDE.md        |
| full access      |         | Claude Code only |
+------------------+         +------------------+
```

Remote agents are second-class citizens. They can receive Discord messages and write code, but they can't participate in fleet orchestration.

---

## Step 2: Options for Distributed State

### Option A: Extend SCP sync (incremental improvement)

**Idea:** Add more files to `fleet sync`: tasks.json, tasks-context.md, a minimal fleet config stub. Run sync on a cron. Remote writes via SSH back to controller.

**Pros:** No new infrastructure. Uses existing SSH/SCP. Incremental change.
**Cons:** Still push-only (controller must be alive). Still eventual consistency. Doesn't fix `fleet task` needing fleet.yaml. Sync latency grows with agent count. Doesn't fix concurrent edits.

**Effort:** Small (hours). **Impact:** Medium — fixes task reads, doesn't fix task writes or config discovery.

### Option B: Embed fleet metadata in agent state dir

**Idea:** During `fleet start`, write a `fleet-context.json` to each agent's state dir containing: fleet name, agent name, agent role, control plane host, task store path. `fleet task` reads this instead of walking for fleet.yaml.

**Pros:** Zero new infrastructure. Works immediately for local and remote agents. `fleet task` becomes usable everywhere. SCP already copies state dir files.
**Cons:** Doesn't fix writes (remote agents still need a write path back). Doesn't fix sync. Another file to keep in sync.

**Effort:** Small (hours). **Impact:** HIGH — unblocks `fleet task` reads for all agents.

### Option C: Git as sync mechanism

**Idea:** Task store, identity files, and fleet config live in a git repo that all agents can pull from. Writes are git commits. Sync is git pull. Conflicts resolved by git merge.

**Pros:** Distributed by design. Every agent has a full copy. Audit trail for free. Works offline. Existing tooling.
**Cons:** Merge conflicts on JSON (task store). Requires all agents have git push access to same remote. Commit noise (every task update = a commit). Git is not designed for high-frequency structured data updates.

**Effort:** Medium (days). **Impact:** Medium — fixes sync but adds merge complexity.

### Option D: HTTP task API on control plane

**Idea:** A lightweight HTTP server (Bun) on the control plane that serves the task store API. Agents call HTTP endpoints instead of file reads. One new process.

**Pros:** Clean API. Works from anywhere with network access. Solves reads AND writes. Real-time capable (WebSocket for push notifications). Single source of truth.
**Cons:** New process to run and monitor. Network dependency. Auth required. More infrastructure to maintain. Overkill for 5 agents.

**Effort:** Large (days-week). **Impact:** HIGH — solves everything but adds operational complexity.

### Option E: Discord as state bus

**Idea:** Use a dedicated Discord channel as the task state bus. Tasks are Discord messages in a structured format. Agents read task state by fetching channel history. Updates are new messages.

**Pros:** Zero new infrastructure. All agents already have Discord access. Works cross-server by design. Push notifications built in.
**Cons:** Discord message history is limited and slow to query. No structured queries (can't filter by assignee without scanning all messages). Rate-limited. Fragile (message format parsing). Abuses Discord's intended purpose.

**Effort:** Medium (days). **Impact:** Low — too many limitations for structured data.

### Option F: Minimal config stub + SSH-back writes (hybrid of A + B)

**Idea:** Combine Option B (embed fleet metadata in state dir) with SSH-back writes from the design doc. Every agent gets a `fleet-context.json` with fleet name, role, and controller host. `fleet task` reads use local task store copy. `fleet task` writes SSH back to controller. `fleet sync` distributes tasks.json alongside identity files.

**Pros:** Minimal new infrastructure. Fixes reads immediately. Fixes writes with one SSH round-trip. Uses existing SSH setup. Incremental — no big architecture change.
**Cons:** Controller is still SPOF for writes. SSH latency for writes (~1s). Requires reverse SSH access.

**Effort:** Small-medium (day). **Impact:** HIGH — fixes the top issues from the infra audit with minimal change.

---

## Step 3: Minimal Change That Fixes the Most Issues

### Recommendation: Option F — fleet-context.json + SSH-back writes

This is the smallest change that unblocks all four agents' top issue (can't use fleet commands) while keeping the architecture simple.

### What to build

**1. `fleet-context.json` — written to every agent's state dir at start**

```json
{
  "fleet": "dev",
  "agent": "Ken-Thompson",
  "role": "worker",
  "controlPlane": "user@sg-dev",
  "stateDir": "/home/dev/.fleet/state/discord-coder2",
  "fleetDir": "/home/dev/path-to-fleet-config"
}
```

Generated by the adapter during `fleet start`. SCP'd to remote agents alongside identity.md.

**2. `fleet task` reads fleet-context.json when fleet.yaml is missing**

```
findConfigDir() fails → fall back to:
  1. Read <stateDir>/fleet-context.json
  2. Extract fleet name → resolve task store path (~/.fleet/tasks/<fleet>.json)
  3. For reads: use local copy
  4. For writes: if controlPlane is set, SSH to controller and run the command there
```

**3. Add tasks.json to `fleet sync` file list**

One line change in `sync.ts` — SCP `~/.fleet/tasks/<fleet>.json` to each remote agent's `~/.fleet/tasks/` directory.

**4. Add tasks-context.json to remote agent SCP in adapter.ts**

Already done in `f2f859c` — tasks-context.md is SCP'd. Just need to ensure `fleet sync` also refreshes it.

### What this fixes

| Issue | Fixed? |
|-------|--------|
| Workers can't run `fleet task` (Ken #1, Carmack #1, Knuth #1, Linus #1) | YES — fleet-context.json provides fleet name |
| Task store stale on remotes (Knuth #2, Linus #2) | YES — fleet sync includes tasks.json |
| Remote agents can't write tasks (Carmack #2) | YES — SSH-back to controller |
| Identity updates require restart (Ken #2, Carmack #3, Knuth #4) | PARTIAL — fleet sync refreshes files but running session still uses old identity |
| Concurrent file edits (Carmack #4, Knuth #5) | NO — separate problem, needs branch isolation |

### What this does NOT fix (and that's OK for now)

- Live identity reload (requires Claude Code platform support or restart)
- Concurrent file editing (needs git workflow changes, not architecture)
- Message delivery during tool calls (Claude Code platform constraint)
- Self-update/rollback (ops tooling, not architecture)

### Implementation plan

1. Add `fleet-context.json` generation to `adapter.ts` start flow (~30 min)
2. Update `findConfigDir()` to fall back to fleet-context.json (~30 min)
3. Add SSH-back write path to `fleet task` for remote agents (~1 hr)
4. Add tasks.json + tasks-context.md to `fleet sync` (~30 min)
5. Test end-to-end: create task on controller, verify visible on remote agent (~30 min)

**Total: ~3 hours. Unblocks the entire team.**

---

---

## Review Notes

### John Carmack — Pragmatic Review

**Option F is the right call.** Smallest change, biggest impact, no new infrastructure. I agree with the recommendation.

**Three refinements:**

**1. fleet-context.json should be the ONLY fallback, not a new config system.**
Keep it minimal: `{ "fleet": "dev" }` is the minimum viable content. Fleet name is all `fleet task` needs to find the store at `~/.fleet/tasks/<fleet>.json`. Don't put controlPlane host, role, or fleetDir in there yet — that's speculative. Add fields when a concrete feature needs them. The SSH-back write path needs controlPlane, so add it then, not before.

**2. The SSH-back write path has a chicken-and-egg problem.**
fleet-context.json needs to know the controller's SSH host. But the controller is defined in fleet.yaml's `servers` config — which workers don't have. The adapter knows the server at start time. So: the adapter writes `controlPlane` into fleet-context.json at start, derived from the fleet config. This works because the adapter runs on the control plane when starting remote agents.

**3. Skip the SSH-back write path for Phase 1.**
Hot take: just get reads working first. Workers can read task state, see their assignments, check the board. For writes, they can report completion via Discord (the habit that already works) and the lead updates the task store. This is the 80/20 — reads are the blocker, writes are a convenience. Ship reads in 1 hour, add SSH-back writes later.

**Proposed Phase 1 (1 hour):**
1. Generate `fleet-context.json` with `{ "fleet": "dev" }` in adapter.ts
2. `loadTaskStore()` in `store.ts` — if `findConfigDir()` throws, read fleet name from `fleet-context.json` in the state dir (FLEET_STATE_DIR or DISCORD_STATE_DIR env var)
3. Add tasks.json to `fleet sync`
4. Done. Workers can read tasks.

*— John Carmack*

---

### Donald Knuth — Correctness Review

**Option F is correct. Carmack's Phase 1 simplification is the right call — ship reads first.**

Three issues with the full Option F that Carmack's phasing sidesteps:

**1. SSH-back requires reverse SSH that doesn't exist.**
Linus flagged this in the infra audit: `fleet setup-server` configures controller→agent SSH, not agent→controller. Option F's write path needs the reverse direction — SSH keys, firewall rules, controller's SSH server accepting agent connections. This is the hardest part of Option F and it's not in the implementation plan. Carmack is right to defer it: reads are the blocker, writes can use Discord as the interim channel.

**2. fleet-context.json discovery must be precise.**
The agent might run `fleet task` from any working directory. Where does `loadTaskStore()` look for fleet-context.json? The reliable path: read `DISCORD_STATE_DIR` env var (set by the adapter at launch), then look for `fleet-context.json` there. Both `DISCORD_STATE_DIR` and `FLEET_SELF` are always set inside the wrapper script. Don't walk the directory tree — use the env var directly.

**3. Staleness after sync needs to be acknowledged, not solved.**
After `fleet sync` pushes tasks.json to remotes, the remote reads a snapshot. Any changes on the controller after sync are invisible until the next sync. For Phase 1, this is acceptable: agents read the latest synced state and can always run `fleet task list` to refresh (which reads the local copy). Document the staleness model: "remote task data is as fresh as the last `fleet sync`." Don't try to solve it with periodic cron or push-on-write yet — that's Phase 2.

**Agreement with Carmack's Phase 1:**
`{ "fleet": "dev" }` is the minimum viable fleet-context.json. Fleet name → task store path (`~/.fleet/tasks/dev.json`). That's all reads need. Skip controlPlane, role, fleetDir until SSH-back writes are implemented. One hour, unblocks reads for all agents.

**One addition to the Phase 1 plan:** `fleet sync` should also regenerate `tasks-context.md` (the boot-check injection file) when it pushes tasks.json. Otherwise remote agents get the raw task store but not the formatted context injection. This is a 2-line change in sync.ts.

*— Donald Knuth*

---

*Document owned by Ken Thompson. Input from full fleet team.*
