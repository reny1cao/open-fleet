import { loadTaskStore, saveTaskStore, createSprint, closeSprint, getActiveSprint, listSprints, listTasks, sortByPriority } from "../tasks/store"
import type { Sprint, Task } from "../tasks/types"
import { useHttpApi, httpCreateSprint, httpCloseSprint, httpListSprints, httpListTasks } from "../tasks/client"

export async function sprint(args: string[], opts: { json?: boolean }): Promise<void> {
  const subcommand = args[0]

  switch (subcommand) {
    case "create":
      return sprintCreate(args.slice(1), opts)
    case "close":
      return sprintClose(args.slice(1), opts)
    case "list":
      return sprintList(args.slice(1), opts)
    case "active":
      return sprintActive(opts)
    default:
      throw new Error(
        "Usage: fleet sprint <create|close|list|active>\n" +
        "  fleet sprint create <name> [--start <date>] [--end <date>] [--goals <text>]\n" +
        "  fleet sprint close [sprint-id]              Close active sprint (or by ID)\n" +
        "  fleet sprint list                           List all sprints\n" +
        "  fleet sprint active                         Show active sprint + its tasks"
      )
  }
}

async function sprintCreate(args: string[], opts: { json?: boolean }): Promise<void> {
  let name: string | undefined
  let startDate: string | undefined
  let endDate: string | undefined
  let goals: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1]) { startDate = args[++i]; continue }
    if (args[i] === "--end" && args[i + 1]) { endDate = args[++i]; continue }
    if (args[i] === "--goals" && args[i + 1]) { goals = args[++i]; continue }
    if (args[i] === "--json") continue
    if (!name) { name = args[i]; continue }
  }

  if (!name) throw new Error("Usage: fleet sprint create <name> [--start <date>] [--end <date>] [--goals <text>]")

  let created: Sprint
  if (useHttpApi()) {
    created = await httpCreateSprint({ name, startDate, endDate, goals })
  } else {
    const store = loadTaskStore()
    created = createSprint(store, { name, startDate, endDate, goals })
    saveTaskStore(store)
  }

  if (opts.json) {
    console.log(JSON.stringify(created))
  } else {
    console.log(`Created ${created.id}: "${created.name}" (${created.status})`)
    console.log(`  Start: ${created.startDate}${created.endDate ? ` → ${created.endDate}` : ""}`)
    if (created.goals) console.log(`  Goals: ${created.goals}`)
  }
}

async function sprintClose(args: string[], opts: { json?: boolean }): Promise<void> {
  let sprintId: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") continue
    if (!sprintId) { sprintId = args[i]; continue }
  }

  let closed: Sprint
  if (useHttpApi()) {
    if (!sprintId) {
      const sprints = await httpListSprints()
      const active = sprints.find((s) => s.status === "active")
      if (!active) throw new Error("No active sprint to close.")
      sprintId = active.id
    }
    closed = await httpCloseSprint(sprintId)
  } else {
    const store = loadTaskStore()
    if (!sprintId) {
      const active = getActiveSprint(store)
      if (!active) throw new Error("No active sprint to close.")
      sprintId = active.id
    }
    closed = closeSprint(store, sprintId)
    saveTaskStore(store)
  }

  if (opts.json) {
    console.log(JSON.stringify(closed))
  } else {
    // Count tasks in this sprint by status
    let sprintTasks: Task[]
    if (useHttpApi()) {
      sprintTasks = await httpListTasks({ sprintId: closed.id })
    } else {
      sprintTasks = listTasks(loadTaskStore(), { sprintId: closed.id })
    }
    const done = sprintTasks.filter((t) => t.status === "done").length
    const total = sprintTasks.length
    console.log(`Closed ${closed.id}: "${closed.name}"`)
    console.log(`  ${done}/${total} tasks completed`)
  }
}

async function sprintList(_args: string[], opts: { json?: boolean }): Promise<void> {
  let sprints: Sprint[]
  if (useHttpApi()) {
    sprints = await httpListSprints()
  } else {
    const store = loadTaskStore()
    sprints = listSprints(store)
  }

  if (opts.json) {
    console.log(JSON.stringify(sprints))
    return
  }

  if (sprints.length === 0) {
    console.log("No sprints found.")
    return
  }

  for (const s of sprints) {
    const status = s.status === "active" ? "● ACTIVE" : s.status === "closed" ? "✓ closed" : "○ planned"
    const dates = s.endDate ? `${s.startDate} → ${s.endDate}` : `${s.startDate}`
    console.log(`  ${s.id}  ${status}  "${s.name}"  ${dates}`)
  }
  console.log(`\n${sprints.length} sprint(s)`)
}

async function sprintActive(opts: { json?: boolean }): Promise<void> {
  let activeSpr: Sprint | undefined

  if (useHttpApi()) {
    const sprints = await httpListSprints()
    activeSpr = sprints.find((s) => s.status === "active")
  } else {
    activeSpr = getActiveSprint(loadTaskStore())
  }

  if (!activeSpr) {
    if (opts.json) {
      console.log(JSON.stringify(null))
    } else {
      console.log("No active sprint.")
    }
    return
  }

  let sprintTasks: Task[]
  if (useHttpApi()) {
    sprintTasks = sortByPriority(await httpListTasks({ sprintId: activeSpr.id }))
  } else {
    sprintTasks = sortByPriority(listTasks(loadTaskStore(), { sprintId: activeSpr.id }))
  }

  if (opts.json) {
    console.log(JSON.stringify({ sprint: activeSpr, tasks: sprintTasks }))
    return
  }

  const done = sprintTasks.filter((t) => t.status === "done").length
  console.log(`${activeSpr.id}: "${activeSpr.name}" (${activeSpr.startDate}${activeSpr.endDate ? ` → ${activeSpr.endDate}` : ""})`)
  if (activeSpr.goals) console.log(`  Goals: ${activeSpr.goals}`)
  console.log(`  Progress: ${done}/${sprintTasks.length} tasks done`)

  if (sprintTasks.length > 0) {
    console.log(`\n  Tasks:`)
    for (const t of sprintTasks) {
      const assignee = t.assignee ?? "unassigned"
      const status = t.status === "in_progress" ? "in progress" : t.status
      console.log(`    ${t.id}  [${t.priority.toUpperCase()}]  ${status}  ${assignee}  ${t.title}`)
    }
  }
}
