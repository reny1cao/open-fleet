# Infrastructure Issues — Honest Audit

> Collected from all fleet agents, 2026-04-01. Owner: Ken Thompson.

---

## Ken Thompson — Worker Agent (local, Singapore)

### 1. No fleet.yaml on worker machines
**Severity: HIGH — breaks the task system entirely**

I cannot run any `fleet task` commands because there's no `fleet.yaml` on my machine. The CLI requires fleet config to locate the task store, but workers only get identity.md, access.json, and CLAUDE.md pushed to their state dir. The fleet config lives on the control plane machine only.

This means: the entire task orchestration system we just built is unusable by workers unless they happen to be on the same machine as the fleet config. `fleet task list --mine`, `fleet task update`, `fleet task board` — none of these work for me.

**Impact:** Workers can't update task status, can't check assignments, can't use the task workflow. The system we spent 3 hours building is unreachable from my agent.

### 2. Identity/config updates require restart
**Severity: MEDIUM**

When Carmack added task workflow instructions to the identity template, I didn't get them. My identity.md was generated at boot time. To pick up changes, I need a full restart or manual `fleet sync`. There's no live reload of identity content — `access.json` has a 30s static reload, but identity.md is loaded once at start via `--append-system-prompt-file`.

**Impact:** Config changes don't propagate until restart. During a work session, agents run on stale identity/instructions.

### 3. open-fleet repo location inconsistency
**Severity: LOW (resolved, but cost us time)**

At the start of this session, `open-fleet` was at `~/open-fleet`. Steve wanted it at `~/workspace/open-fleet`. Linus reported a stale duplicate on SG server. We spent time checking, moving, and confirming paths. The fleet config and channel workspace mappings don't enforce where repos live — it's convention, not config.

### 4. git pull conflicts on shared repo
**Severity: MEDIUM**

First `git pull` of the session failed because local uncommitted changes conflicted with remote. The error required stash/reset to resolve. When multiple agents commit to the same repo, pulls can fail and block work.

### 5. No way to discover teammates' state
**Severity: LOW**

I can't see if other agents are online, busy, or compacted. Discord presence isn't exposed. The only way to know if a teammate received my message is to wait for a reply. If they're compacted or stuck, I don't know — I just wait.

### 6. Message delivery is invisible during tool calls
**Severity: MEDIUM — affects coordination**

When I'm executing a tool call (writing files, running tests), incoming Discord messages queue as system reminders. I process them when my current action completes, but there's no backpressure signal — the sender has no idea their message is queued. This is a Claude Code platform constraint, not a fleet bug, but it breaks the coordination loop.

### 7. docs not committed
**Severity: LOW**

PROJECT-OVERVIEW.md and DESIGN-task-orchestration.md were created but never committed to git (they're in untracked files). Multiple agents edited them concurrently, which caused repeated `File has been modified since read` errors during edits. No merge strategy for concurrent doc editing.

---

<!-- Sections for other agents below — write your issues directly -->

## John Carmack — Worker Agent (local, Singapore)

### 1. Task store is unreachable from workers
**Severity: HIGH — confirms Ken's #1**

Same problem Ken described. I built the task CLI, tested it from the fleet config directory, and it worked. But workers don't have fleet.yaml — they have a state dir with identity.md, access.json, and CLAUDE.md. The `fleet task` commands call `findConfigDir()` which walks up the directory tree looking for fleet.yaml. On a worker machine, it doesn't exist. The entire task system is inaccessible.

**Root cause:** `fleet task` was designed as a control-plane command but assigned as a worker-plane workflow. The store path (`~/.fleet/tasks/<fleet>.json`) is resolvable, but the fleet name comes from fleet.yaml which workers don't have.

**Fix options:** (a) SCP tasks.json + a minimal config stub to worker state dirs during fleet sync, (b) embed fleet name in the worker's state dir so `fleet task` can find the store without fleet.yaml, (c) make `fleet task` accept a `--fleet` flag to bypass config lookup.

### 2. Cross-server task sync doesn't exist yet
**Severity: HIGH**

We designed cross-server sync (SSH back to controller for writes, SCP for reads) in the design doc but never built it. Remote agents can't read or write tasks. The entire task system is local-only to the control plane machine. This is the same underlying problem as #1 but for remote agents specifically.

### 3. Identity updates don't propagate without restart
**Severity: MEDIUM — confirms Ken's #2**

I pushed task workflow instructions to identity.ts but nobody received them. Identity.md is generated once at `fleet start` and loaded via `--append-system-prompt-file`. There's no mechanism to hot-reload it. CLAUDE.md (roster) reloads every turn, but identity.md does not.

**Workaround:** `fleet sync` regenerates and SCPs the files, but the running agent's Claude Code session still has the old identity loaded. Only a restart picks up identity changes.

### 4. Concurrent file edits cause constant failures
**Severity: MEDIUM**

Throughout this session, every shared file edit (PROJECT-OVERVIEW.md, DESIGN-task-orchestration.md, INFRA-ISSUES.md) triggered "File has been modified since read" errors because teammates were editing the same file. I had to re-read and retry every time. There's no file-level locking or merge strategy for concurrent edits.

This isn't just annoying — it slows down parallel work significantly. When Steve says "everyone write to this doc," half our edits fail on first attempt.

### 5. No feedback loop when notifications fail
**Severity: LOW**

Task notifications are fire-and-forget with `.catch(() => {})`. If the Discord API is down or the token is invalid, the notification silently fails. The task creator thinks the assignee was notified, but the assignee never got the message. No retry, no fallback, no visibility into delivery status.

### 6. `fleet task` requires running from fleet config directory
**Severity: MEDIUM**

Even on the control plane, `fleet task create` only works if you `cd` to the fleet config directory first (or set FLEET_DIR). When I tested from `~/workspace/open-fleet` it produced no output because `findConfigDir()` couldn't find fleet.yaml. This is a UX trap — the command silently fails if you're in the wrong directory.

## Donald Knuth — Reviewer Agent (remote, Singapore server)

### 1. Remote agents can't participate in fleet orchestration at all
**Severity: HIGH — confirms Ken #1 and Carmack #1**

Third independent confirmation. No `fleet.yaml` on my machine means zero `fleet` commands work. Not just tasks — I can't run `fleet status`, `fleet doctor`, `fleet sync`, or anything. The fleet CLI was designed for the controller. Remote agents are pure Discord endpoints that can code but can't orchestrate.

**My specific experience:** Steve asked me to run `fleet task list --mine`. I couldn't. He assigned me task-005 via the task system. The task store on my machine had stale test data, not the real tasks. I had to work from Steve's Discord description instead of the task system we built.

### 2. Task store is stale on remote agents
**Severity: HIGH — extends Carmack #2**

`~/.fleet/tasks/dev.json` on my machine contains Carmack's test data from early in the session, not the 6+ real tasks Steve created later. `fleet sync` doesn't include tasks.json (it was in the design plan but never implemented). Even if `fleet task` worked, it would show wrong data.

### 3. Message delivery failures are completely silent
**Severity: MEDIUM**

Steve couldn't receive our @mentions in real-time. My code trace (task-005) found that delivery requires three conditions to all be true: PARTNER_BOT_IDS patched, channel ID in access.json groups, and bot @mentioned in content. If any fails, the message is silently dropped. No error to the sender, no retry, no diagnostic. The sender has no way to know their message was lost. I traced the full code path through `server.ts gate()` — any `return { action: 'drop' }` is silent.

### 4. Identity never regenerated after template changes
**Severity: MEDIUM — confirms Ken #2, Carmack #3**

Steve asked if I had the "Task Workflow" section. I didn't. `grep "Task Workflow" identity.md` returns 0. My identity was generated before `cf90df8`. The only way to get new identity content is restart or manual `fleet sync` from the controller. No agent in this session received the task workflow instructions without a restart.

### 5. Concurrent file editing is a constant tax
**Severity: MEDIUM — confirms Carmack #4**

I hit "File has been modified since read" errors 6+ times this session on the design doc, watchdog files, and this very document. Every shared file edit is a race. The fleet workflow (everyone on master, everyone edits the same files, no branch isolation) guarantees this. It's not catastrophic but it's a steady drag on velocity.

### 6. .gitignore pattern blocked source code silently
**Severity: LOW (fixed)**

`.gitignore` had `watchdog/` which matched `src/watchdog/`. A runtime state pattern was silently ignoring source files for git operations. I caught it during review and fixed to `/watchdog/`. Broad gitignore patterns that can match source directories are dangerous — they fail silently.

## Linus Torvalds — Ops Agent (remote, Singapore server)

### 1. Remote servers have no fleet tooling
**Severity: HIGH — confirms Ken #1, Carmack #1, Knuth #1**

Fourth independent confirmation. No `fleet.yaml`, no `fleet` CLI on remote agent machines. Remote agents are bare tmux sessions running Claude Code with a Discord plugin. Zero fleet commands work. Zero task system access.

### 2. fleet sync doesn't include tasks.json
**Severity: HIGH — confirms Knuth #2**

The design doc says `fleet sync` should distribute tasks.json. It doesn't. Task store only exists on the control plane. Remote agents have stale or missing task data.

### 3. Restart is slow and fragile
**Severity: HIGH**

Agent restarts take 30-60 seconds. The wrapper script sleeps 3s between retries. Boot-check validates tokens via Discord API (network round-trip for every agent). If Discord API is slow, boot takes minutes. During restart, the agent is completely offline — no messages received, no work done.

### 4. No health visibility from agent perspective
**Severity: MEDIUM**

As an ops agent, I should be able to check fleet health. But `fleet status`, `fleet doctor`, `fleet watch` all require fleet.yaml. I can't check the health of the fleet I'm part of. I have to ask Steve (the lead) to check for me.

### 5. SCP sync is push-only, no pull
**Severity: MEDIUM**

`fleet sync` pushes files FROM controller TO remotes. There's no mechanism for a remote agent to pull fresh config. If the controller doesn't run sync, remote agents stay stale indefinitely.

### 6. SSH key management is manual
**Severity: MEDIUM**

`fleet setup-server` installs tools but doesn't configure SSH keys for agent-to-controller access. The design doc's "SSH back to controller" write path requires reverse SSH, which isn't set up by default.

### 7. No monitoring of the fleet process itself
**Severity: LOW**

The watchdog monitors agents, but nothing monitors the watchdog. If the watchdog crashes, nobody knows. Same for the fleet CLI itself — if the control plane machine reboots, agents keep running but orchestration is gone.

### 8. Tmux session names can collide
**Severity: LOW**

Session names are `<fleet>-<agent>`. If two fleets have agents with the same name on the same machine, sessions collide. Edge case but no guard against it.

### 9. No self-update or rollback
**Severity: LOW**

Update is manual SSH + git pull. No tests run post-update. No rollback if it breaks running agents.

### 10. Entry point confusion
**Severity: LOW (fixed)**

`bun run src/cli.ts` silently succeeds with no output. Correct entry point is `src/index.ts`. Cost 10 min debugging.

---

## Root Cause Analysis

**The pattern across all agents:** Issues #1 (all agents), #2 (Carmack, Knuth, Linus), #4 (Linus), and #5 (Linus) all stem from one root cause:

**Fleet assumes all agents run on the same machine with direct filesystem access.**

The moment you have remote agents or agents on different machines, every file-based mechanism breaks: task store writes, config discovery, identity updates, doc editing. The architecture is local-first but the use case is distributed.

**Priority 1 fixes (unblock workers):**
- Make `fleet task` work without fleet.yaml (embed fleet name in state dir or accept `--fleet` flag)
- Add tasks.json to `fleet sync` file list

**Priority 2 fixes (improve reliability):**
- Live identity reload or at least `fleet sync` triggering identity refresh
- File locking or branch isolation for concurrent edits

---

*Document owned by Ken Thompson. All agents contribute directly.*
