import { loadTaskStore, saveTaskStore, createTask, updateTask, getTask, listTasks, activeTasks, sortByPriority } from "../tasks/store"
import type { TaskStatus, TaskPriority, TaskResult } from "../tasks/types"

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
    default:
      throw new Error(
        "Usage: fleet task <create|update|list|board|show>\n" +
        "  fleet task create <title> [--assign <agent>] [--priority <p>] [--workspace <ws>] [--desc <d>]\n" +
        "  fleet task update <task-id> --status <status> [--note <text>] [--result <json>]\n" +
        "  fleet task list [--assignee <agent>] [--status <status>] [--mine]\n" +
        "  fleet task board\n" +
        "  fleet task show <task-id>"
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

  const store = loadTaskStore()

  // Dependency cycle detection
  if (dependsOn && dependsOn.length > 0) {
    for (const depId of dependsOn) {
      if (!getTask(store, depId)) {
        throw new Error(`Dependency not found: ${depId}`)
      }
    }
  }

  const created = createTask(store, { title, assignee: assign, priority, workspace, description, parentId, dependsOn, project })
  saveTaskStore(store)

  if (opts.json) {
    console.log(JSON.stringify(created))
  } else {
    const parts = [`Created ${created.id}: "${created.title}"`]
    if (created.assignee) parts.push(`assigned to ${created.assignee}`)
    parts.push(`[${formatPriority(created.priority)}]`)
    console.log(parts.join(" — "))
  }
}

async function taskUpdate(args: string[], opts: { json?: boolean }): Promise<void> {
  const taskId = args[0]
  if (!taskId || taskId.startsWith("--")) throw new Error("Usage: fleet task update <task-id> --status <status>")

  let status: TaskStatus | undefined
  let note: string | undefined
  let resultJson: string | undefined
  let blockedReason: string | undefined

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--status" && args[i + 1]) { status = args[++i] as TaskStatus; continue }
    if (args[i] === "--note" && args[i + 1]) { note = args[++i]; continue }
    if (args[i] === "--result" && args[i + 1]) { resultJson = args[++i]; continue }
    if (args[i] === "--reason" && args[i + 1]) { blockedReason = args[++i]; continue }
    if (args[i] === "--json") continue
  }

  if (!status && !note && !resultJson) {
    throw new Error("Usage: fleet task update <task-id> --status <status> [--note <text>] [--result <json>]")
  }

  let result: TaskResult | undefined
  if (resultJson) {
    try {
      result = JSON.parse(resultJson) as TaskResult
    } catch {
      throw new Error(`Invalid --result JSON: ${resultJson}`)
    }
  }

  const store = loadTaskStore()
  const updated = updateTask(store, taskId, { status, note, result, blockedReason })
  saveTaskStore(store)

  if (opts.json) {
    console.log(JSON.stringify(updated))
  } else {
    const parts = [`${updated.id}: ${formatStatus(updated.status)}`]
    if (note) parts.push(`note: "${truncate(note, 60)}"`)
    console.log(parts.join(" — "))
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

  const store = loadTaskStore()
  const tasks = sortByPriority(listTasks(store, { assignee, status, project }))

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
    const ws = t.workspace ? ` [${t.workspace}]` : ""
    const blocked = t.status === "blocked" && t.blockedReason ? ` — BLOCKED: ${t.blockedReason}` : ""
    console.log(`  ${t.id}  [${formatPriority(t.priority)}]  ${formatStatus(t.status)}${assignedTo}${ws}  ${truncate(t.title, 60)}${blocked}`)
  }
  console.log(`\n${tasks.length} task(s)`)
}

async function taskBoard(_args: string[], opts: { json?: boolean }): Promise<void> {
  const store = loadTaskStore()
  const active = activeTasks(store)

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
    open: [],
    in_progress: [],
    blocked: [],
    review: [],
  }
  for (const t of active) {
    if (byStatus[t.status]) byStatus[t.status].push(t)
  }

  const sections: [string, typeof active][] = [
    ["IN PROGRESS", sortByPriority(byStatus.in_progress)],
    ["BLOCKED", sortByPriority(byStatus.blocked)],
    ["OPEN", sortByPriority(byStatus.open)],
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

  const done = store.tasks.filter((t) => t.status === "done").length
  const cancelled = store.tasks.filter((t) => t.status === "cancelled").length
  console.log(`\n${totalShown} active | ${done} done | ${cancelled} cancelled`)
}

async function taskShow(args: string[], opts: { json?: boolean }): Promise<void> {
  const taskId = args[0]
  if (!taskId || taskId.startsWith("--")) throw new Error("Usage: fleet task show <task-id>")

  const store = loadTaskStore()
  const t = getTask(store, taskId)
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
