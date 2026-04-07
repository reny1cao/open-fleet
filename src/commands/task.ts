import { loadTaskStore, saveTaskStore, createTask, updateTask, getTask, listTasks, activeTasks, sortByPriority } from "../tasks/store"
import type { TaskStatus, TaskPriority, TaskResult } from "../tasks/types"
import { notifyTaskAssigned, notifyTaskDone, notifyTaskBlocked, notifyTaskReassigned, notifyTaskReview, notifyTaskVerify } from "../tasks/notify"
import { useHttpApi, httpCreateTask, httpUpdateTask, httpListTasks, httpGetTask, httpGetBoard } from "../tasks/client"

function formatPriority(p: string): string {
  switch (p) {
    case "urgent": return "URGENT"
    case "high": return "HIGH"
    case "normal": return "NORMAL"
    case "low": return "LOW"
    default: return p.toUpperCase()
  }
}

function formatStatus(s: string): string {
  switch (s) {
    case "in_progress": return "in_progress"
    case "blocked": return "BLOCKED"
    case "review": return "review"
    case "verify": return "verify"
    default: return s
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 3) + "..."
}

export async function task(args: string[], opts: { json?: boolean }): Promise<void> {
  const subcommand = args[0]

  switch (subcommand) {
    case "create":
      return taskCreate(args.slice(1), opts)
    case "update":
      return taskUpdate(args.slice(1), opts)
    case "list":
      return taskList(args.slice(1), opts)
    case "board":
      return taskBoard(args.slice(1), opts)
    case "show":
      return taskShow(args.slice(1), opts)
    case "recap":
      return taskRecap(args.slice(1), opts)
    case "comment":
      return taskComment(args.slice(1), opts)
    default:
      throw new Error(
        "Usage: fleet task <create|update|comment|list|board|show|recap>\n" +
        "  fleet task create <title> [--assign <agent>] [--priority <p>] [--workspace <ws>] [--desc <d>] [--project <proj>]\n" +
        "  fleet task update <task-id> --status <status> [--assign <agent>] [--note <text>] [--result <json>] [--quiet]\n" +
        "  fleet task comment <task-id> <text>        Post a comment/update to a task\n" +
        "  fleet task list [--assignee <agent>] [--status <status>] [--project <proj>] [--mine]\n" +
        "  fleet task board [--project <proj>]\n" +
        "  fleet task show <task-id>\n" +
        "  fleet task recap [--since 2h|4h|today|24h]"
      )
  }
}

async function taskCreate(args: string[], opts: { json?: boolean }): Promise<void> {
  // Parse title: first non-flag argument
  let title: string | undefined
  let assign: string | undefined
  let priority: TaskPriority = "normal"
  let workspace: string | undefined
  let description: string | undefined
  let parentId: string | undefined
  let project: string | undefined
  let dependsOn: string[] | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--assign" && args[i + 1]) { assign = args[++i]; continue }
    if (args[i] === "--priority" && args[i + 1]) { priority = args[++i] as TaskPriority; continue }
    if (args[i] === "--workspace" && args[i + 1]) { workspace = args[++i]; continue }
    if (args[i] === "--desc" && args[i + 1]) { description = args[++i]; continue }
    if (args[i] === "--parent" && args[i + 1]) { parentId = args[++i]; continue }
    if (args[i] === "--project" && args[i + 1]) { project = args[++i]; continue }
    if (args[i] === "--depends-on" && args[i + 1]) {
      dependsOn = dependsOn ?? []
      dependsOn.push(args[++i])
      continue
    }
    if (args[i] === "--json") continue
    if (!title) { title = args[i]; continue }
  }

  if (!title) throw new Error("Usage: fleet task create <title> [--assign <agent>]")

  let created
  if (useHttpApi()) {
    created = await httpCreateTask({ title, assignee: assign, priority, workspace, description, parentId, dependsOn, project })
  } else {
    const store = loadTaskStore()
    if (dependsOn && dependsOn.length > 0) {
      for (const depId of dependsOn) {
        if (!getTask(store, depId)) throw new Error(`Dependency not found: ${depId}`)
      }
    }
    created = createTask(store, { title, assignee: assign, priority, workspace, description, parentId, dependsOn, project })
    saveTaskStore(store)
  }

  if (opts.json) {
    console.log(JSON.stringify(created))
  } else {
    const parts = [`Created ${created.id}: "${created.title}"`]
    if (created.assignee) parts.push(`assigned to ${created.assignee}`)
    parts.push(`[${formatPriority(created.priority)}]`)
    console.log(parts.join(" — "))
  }

  // Notifications: local mode only — server handles them in HTTP mode
  const self = process.env.FLEET_SELF
  if (!useHttpApi() && created.assignee) {
    notifyTaskAssigned(created, self).catch(e => console.error('[notify]', e.message))
  }
}

async function taskUpdate(args: string[], opts: { json?: boolean }): Promise<void> {
  const taskId = args[0]
  if (!taskId || taskId.startsWith("--")) throw new Error("Usage: fleet task update <task-id> --status <status>")

  let status: TaskStatus | undefined
  let assign: string | undefined
  let note: string | undefined
  let resultJson: string | undefined
  let blockedReason: string | undefined
  let quiet = false

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--status" && args[i + 1]) { status = args[++i] as TaskStatus; continue }
    if (args[i] === "--assign" && args[i + 1]) { assign = args[++i]; continue }
    if (args[i] === "--note" && args[i + 1]) { note = args[++i]; continue }
    if (args[i] === "--result" && args[i + 1]) { resultJson = args[++i]; continue }
    if (args[i] === "--reason" && args[i + 1]) { blockedReason = args[++i]; continue }
    if (args[i] === "--quiet") { quiet = true; continue }
    if (args[i] === "--json") continue
  }

  if (!status && !note && !resultJson && assign === undefined) {
    throw new Error("Usage: fleet task update <task-id> --status <status> [--assign <agent>] [--note <text>] [--result <json>]")
  }

  let result: TaskResult | undefined
  if (resultJson) {
    try {
      result = JSON.parse(resultJson) as TaskResult
    } catch {
      throw new Error(`Invalid --result JSON: ${resultJson}`)
    }
  }

  let updated
  let oldAssignee: string | undefined
  if (useHttpApi()) {
    updated = await httpUpdateTask(taskId, { status, assignee: assign, note, result, blockedReason, quiet })
    oldAssignee = undefined // server handles notifications
  } else {
    const store = loadTaskStore()
    oldAssignee = getTask(store, taskId)?.assignee
    updated = updateTask(store, taskId, { status, assignee: assign, note, result, blockedReason })
    saveTaskStore(store)
  }

  if (opts.json) {
    console.log(JSON.stringify(updated))
  } else {
    const parts = [`${updated.id}: ${formatStatus(updated.status)}`]
    if (assign !== undefined && assign !== oldAssignee) parts.push(`reassigned to ${assign || "unassigned"}`)
    if (note) parts.push(`note: "${truncate(note, 60)}"`)
    console.log(parts.join(" — "))
  }

  // Notifications: local mode only — server handles them in HTTP mode
  if (!quiet && !useHttpApi()) {
    const self = process.env.FLEET_SELF
    if (status === "done") {
      notifyTaskDone(updated, self).catch(e => console.error('[notify]', e.message))
    } else if (status === "blocked") {
      notifyTaskBlocked(updated, self).catch(e => console.error('[notify]', e.message))
    } else if (status === "review") {
      notifyTaskReview(updated, self).catch(e => console.error('[notify]', e.message))
    } else if (status === "verify") {
      notifyTaskVerify(updated, self).catch(e => console.error('[notify]', e.message))
    }
    if (assign !== undefined && assign !== oldAssignee) {
      notifyTaskReassigned(updated, oldAssignee, assign, self).catch(e => console.error('[notify]', e.message))
    }
  }
}

async function taskComment(args: string[], opts: { json?: boolean }): Promise<void> {
  const taskId = args[0]
  if (!taskId || taskId.startsWith("--")) throw new Error("Usage: fleet task comment <task-id> <text>")

  // Collect remaining args as the comment text (everything after the task ID, except --json)
  const textParts: string[] = []
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--json") continue
    textParts.push(args[i])
  }
  const text = textParts.join(" ")
  if (!text) throw new Error("Usage: fleet task comment <task-id> <text>")

  let updated
  if (useHttpApi()) {
    updated = await httpUpdateTask(taskId, { note: text })
  } else {
    const store = loadTaskStore()
    updated = updateTask(store, taskId, { note: text })
    saveTaskStore(store)
  }

  if (opts.json) {
    console.log(JSON.stringify(updated))
  } else {
    console.log(`${updated.id}: comment added`)
  }
}

async function taskList(args: string[], opts: { json?: boolean }): Promise<void> {
  let assignee: string | undefined
  let status: TaskStatus | undefined
  let project: string | undefined
  let mine = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--assignee" && args[i + 1]) { assignee = args[++i]; continue }
    if (args[i] === "--status" && args[i + 1]) { status = args[++i] as TaskStatus; continue }
    if (args[i] === "--project" && args[i + 1]) { project = args[++i]; continue }
    if (args[i] === "--mine") { mine = true; continue }
    if (args[i] === "--json") continue
  }

  if (mine) {
    assignee = process.env.FLEET_SELF
    if (!assignee) throw new Error("--mine requires FLEET_SELF env var (set when running as a fleet agent)")
  }

  let tasks
  if (useHttpApi()) {
    tasks = await httpListTasks({ assignee, status, project })
  } else {
    const store = loadTaskStore()
    tasks = sortByPriority(listTasks(store, { assignee, status, project }))
  }

  if (opts.json) {
    console.log(JSON.stringify(tasks))
    return
  }

  if (tasks.length === 0) {
    console.log("No tasks found.")
    return
  }

  for (const t of tasks) {
    const assignedTo = t.assignee ? ` → ${t.assignee}` : ""
    const proj = t.project ? ` (${t.project})` : ""
    const blocked = t.status === "blocked" && t.blockedReason ? ` — BLOCKED: ${t.blockedReason}` : ""
    console.log(`  ${t.id}  [${formatPriority(t.priority)}]  ${formatStatus(t.status)}${assignedTo}${proj}  ${truncate(t.title, 60)}${blocked}`)
  }
  console.log(`\n${tasks.length} task(s)`)
}

async function taskBoard(args: string[], opts: { json?: boolean }): Promise<void> {
  let project: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) { project = args[++i]; continue }
    if (args[i] === "--json") continue
  }

  let active
  if (useHttpApi()) {
    const allTasks = await httpListTasks({ project })
    active = allTasks.filter((t: any) => t.status !== "done" && t.status !== "cancelled")
  } else {
    const store = loadTaskStore()
    let tasks = activeTasks(store)
    if (project) tasks = tasks.filter(t => t.project === project)
    active = tasks
  }

  if (opts.json) {
    const board: Record<string, typeof active> = {}
    for (const t of active) {
      if (!board[t.status]) board[t.status] = []
      board[t.status].push(t)
    }
    console.log(JSON.stringify(board))
    return
  }

  const byStatus: Record<string, typeof active> = {
    backlog: [],
    open: [],
    in_progress: [],
    review: [],
    verify: [],
    blocked: [],
  }
  for (const t of active) {
    if (byStatus[t.status]) byStatus[t.status].push(t)
  }

  const sections: [string, typeof active][] = [
    ["VERIFY", sortByPriority(byStatus.verify)],
    ["REVIEW", sortByPriority(byStatus.review)],
    ["IN PROGRESS", sortByPriority(byStatus.in_progress)],
    ["BLOCKED", sortByPriority(byStatus.blocked)],
    ["OPEN", sortByPriority(byStatus.open)],
    ["BACKLOG", sortByPriority(byStatus.backlog)],
  ]

  let totalShown = 0
  for (const [label, tasks] of sections) {
    if (tasks.length === 0) continue
    console.log(`\n${label} (${tasks.length}):`)
    for (const t of tasks) {
      const assignedTo = t.assignee ?? "unassigned"
      const blocked = t.status === "blocked" && t.blockedReason ? ` — ${t.blockedReason}` : ""
      console.log(`  ${t.id}  [${formatPriority(t.priority)}]  ${assignedTo}  ${truncate(t.title, 50)}${blocked}`)
      totalShown++
    }
  }

  if (!useHttpApi()) {
    const store = loadTaskStore()
    const done = store.tasks.filter((t) => t.status === "done").length
    const cancelled = store.tasks.filter((t) => t.status === "cancelled").length
    console.log(`\n${totalShown} active | ${done} done | ${cancelled} cancelled`)
  } else {
    console.log(`\n${totalShown} active`)
  }
}

async function taskShow(args: string[], opts: { json?: boolean }): Promise<void> {
  const taskId = args[0]
  if (!taskId || taskId.startsWith("--")) throw new Error("Usage: fleet task show <task-id>")

  let t
  if (useHttpApi()) {
    t = await httpGetTask(taskId)
  } else {
    const store = loadTaskStore()
    t = getTask(store, taskId)
  }
  if (!t) throw new Error(`Task not found: ${taskId}`)

  if (opts.json) {
    console.log(JSON.stringify(t))
    return
  }

  console.log(`${t.id}: ${t.title}`)
  console.log(`  Status:   ${formatStatus(t.status)}`)
  console.log(`  Priority: ${formatPriority(t.priority)}`)
  console.log(`  Assignee: ${t.assignee ?? "unassigned"}`)
  if (t.workspace) console.log(`  Workspace: ${t.workspace}`)
  if (t.project) console.log(`  Project:  ${t.project}`)
  if (t.description) console.log(`  Description: ${t.description}`)
  if (t.blockedReason) console.log(`  Blocked: ${t.blockedReason}`)
  if (t.parentId) console.log(`  Parent:   ${t.parentId}`)
  if (t.dependsOn?.length) console.log(`  Depends on: ${t.dependsOn.join(", ")}`)
  console.log(`  Created:  ${t.createdAt} by ${t.createdBy}`)
  if (t.startedAt) console.log(`  Started:  ${t.startedAt}`)
  if (t.completedAt) console.log(`  Completed: ${t.completedAt}`)

  if (t.result) {
    console.log(`  Result:`)
    if (t.result.summary) console.log(`    Summary: ${t.result.summary}`)
    if (t.result.commits?.length) console.log(`    Commits: ${t.result.commits.join(", ")}`)
    if (t.result.filesChanged?.length) console.log(`    Files: ${t.result.filesChanged.join(", ")}`)
    if (t.result.prUrl) console.log(`    PR: ${t.result.prUrl}`)
  }

  if (t.notes.length > 0) {
    console.log(`  Notes:`)
    for (const n of t.notes) {
      console.log(`    [${n.timestamp}] ${n.author}: ${n.text}`)
    }
  }
}

function parseSince(since: string): Date {
  const now = new Date()
  if (since === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  const match = since.match(/^(\d+)(h|m|d)$/)
  if (match) {
    const [, amount, unit] = match
    const ms = unit === "h" ? parseInt(amount) * 3600000
      : unit === "m" ? parseInt(amount) * 60000
      : parseInt(amount) * 86400000
    return new Date(now.getTime() - ms)
  }
  // Try ISO date
  const parsed = new Date(since)
  if (!isNaN(parsed.getTime())) return parsed
  throw new Error(`Invalid --since value: "${since}". Use: 2h, 4h, today, 24h, or ISO date`)
}

async function taskRecap(args: string[], opts: { json?: boolean }): Promise<void> {
  let since = "today"

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1]) { since = args[++i]; continue }
    if (args[i] === "--json") continue
  }

  const cutoff = parseSince(since)
  const store = loadTaskStore()

  // Collect all events since cutoff from task notes
  const events: { timestamp: string; taskId: string; title: string; agent: string; type: string; text: string }[] = []

  for (const task of store.tasks) {
    for (const note of task.notes) {
      if (new Date(note.timestamp) >= cutoff) {
        events.push({
          timestamp: note.timestamp,
          taskId: task.id,
          title: task.title,
          agent: note.author,
          type: note.type,
          text: note.text,
        })
      }
    }
    // Also capture tasks created in the window
    if (new Date(task.createdAt) >= cutoff) {
      events.push({
        timestamp: task.createdAt,
        taskId: task.id,
        title: task.title,
        agent: task.createdBy,
        type: "created",
        text: `Created: "${task.title}"${task.assignee ? ` → ${task.assignee}` : ""}`,
      })
    }
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  if (opts.json) {
    console.log(JSON.stringify({ since: cutoff.toISOString(), events }))
    return
  }

  // Summary counts — handle both typed notes and legacy untyped notes (text-based fallback)
  const isStatusDone = (e: typeof events[0]) => e.text.includes("→ done")
  const isStatusBlocked = (e: typeof events[0]) => e.text.includes("→ blocked")
  const isStatusReview = (e: typeof events[0]) => e.text.includes("→ review")
  const isStatusVerify = (e: typeof events[0]) => e.text.includes("→ verify")
  const isStatusChange = (e: typeof events[0]) => e.type === "status_change" || e.text.startsWith("Status:")
  const completed = events.filter(e => isStatusChange(e) && isStatusDone(e))
  const created = events.filter(e => e.type === "created")
  const blocked = events.filter(e => isStatusChange(e) && isStatusBlocked(e))
  const inReview = events.filter(e => isStatusChange(e) && isStatusReview(e))
  const inVerify = events.filter(e => isStatusChange(e) && isStatusVerify(e))
  const assignments = events.filter(e => e.type === "assignment" || e.text.startsWith("Reassigned:"))

  console.log(`\nRecap since ${cutoff.toISOString().slice(0, 16)}:`)
  console.log(`  ${created.length} created | ${completed.length} completed | ${inReview.length} in review | ${inVerify.length} in verify | ${blocked.length} blocked | ${assignments.length} reassigned`)

  // Completed tasks
  if (completed.length > 0) {
    console.log(`\nCompleted:`)
    for (const e of completed) {
      const task = store.tasks.find(t => t.id === e.taskId)
      const result = task?.result?.summary ?? ""
      const resultLine = result ? ` — ${truncate(result, 60)}` : ""
      console.log(`  ${e.taskId}  ${e.agent}  ${truncate(e.title, 40)}${resultLine}`)
    }
  }

  // Blocked tasks
  if (blocked.length > 0) {
    console.log(`\nBlocked:`)
    for (const e of blocked) {
      const task = store.tasks.find(t => t.id === e.taskId)
      const reason = task?.blockedReason ?? ""
      console.log(`  ${e.taskId}  ${e.agent}  ${truncate(e.title, 40)} — ${reason}`)
    }
  }

  // Currently active (in progress, review, verify)
  const activeStatuses = new Set(["in_progress", "review", "verify"])
  const inProgress = store.tasks.filter(t => activeStatuses.has(t.status))
  if (inProgress.length > 0) {
    console.log(`\nActive:`)
    for (const t of sortByPriority(inProgress)) {
      console.log(`  ${t.id}  [${formatPriority(t.priority)}]  ${formatStatus(t.status)}  ${t.assignee ?? "unassigned"}  ${truncate(t.title, 40)}`)
    }
  }

  // Timeline
  if (events.length > 0) {
    console.log(`\nTimeline:`)
    for (const e of events) {
      const time = e.timestamp.slice(11, 16)
      console.log(`  ${time}  ${e.taskId}  ${e.agent}: ${truncate(e.text, 60)}`)
    }
  }

  console.log("")
}
