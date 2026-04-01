import { loadTaskStore, saveTaskStore, createTask, updateTask, getTask, listTasks, activeTasks, sortByPriority } from "../tasks/store"
import type { TaskStatus, TaskPriority, TaskResult } from "../tasks/types"
import { notifyTaskAssigned, notifyTaskDone, notifyTaskBlocked, notifyTaskReassigned } from "../tasks/notify"

const PORT = parseInt(process.env.FLEET_API_PORT ?? "4680")
const HOST = process.env.FLEET_API_HOST ?? "127.0.0.1" // localhost only by default — set to 0.0.0.0 for remote access
const API_TOKEN = process.env.FLEET_API_TOKEN ?? ""

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } })
}

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { "Content-Type": "application/json" } })
}

function notFound(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), { status: 404, headers: { "Content-Type": "application/json" } })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

function checkAuth(req: Request): boolean {
  if (!API_TOKEN) return true // no token configured = no auth required
  const header = req.headers.get("Authorization")
  return header === `Bearer ${API_TOKEN}`
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json() as Record<string, unknown>
  } catch {
    return {}
  }
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    if (!checkAuth(req)) return unauthorized()

    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    // GET /tasks — list tasks with optional filters
    if (method === "GET" && path === "/tasks") {
      const store = loadTaskStore()
      const assignee = url.searchParams.get("assignee") ?? undefined
      const status = url.searchParams.get("status") as TaskStatus | undefined
      const project = url.searchParams.get("project") ?? undefined
      const tasks = sortByPriority(listTasks(store, { assignee, status, project }))
      return json(tasks)
    }

    // GET /tasks/board — active tasks grouped by status
    if (method === "GET" && path === "/tasks/board") {
      const store = loadTaskStore()
      const active = activeTasks(store)
      const board: Record<string, typeof active> = {}
      for (const t of active) {
        if (!board[t.status]) board[t.status] = []
        board[t.status].push(t)
      }
      return json(board)
    }

    // GET /tasks/:id — single task detail
    const taskShowMatch = path.match(/^\/tasks\/(task-\d+)$/)
    if (method === "GET" && taskShowMatch) {
      const store = loadTaskStore()
      const task = getTask(store, taskShowMatch[1])
      if (!task) return notFound(`Task not found: ${taskShowMatch[1]}`)
      return json(task)
    }

    // POST /tasks — create a task
    if (method === "POST" && path === "/tasks") {
      const body = await parseBody(req)
      const title = body.title as string | undefined
      if (!title) return badRequest("title is required")

      const store = loadTaskStore()
      const task = createTask(store, {
        title,
        assignee: body.assignee as string | undefined,
        priority: (body.priority as TaskPriority) ?? "normal",
        description: body.description as string | undefined,
        workspace: body.workspace as string | undefined,
        parentId: body.parentId as string | undefined,
        dependsOn: body.dependsOn as string[] | undefined,
        createdBy: body.createdBy as string | undefined,
        project: body.project as string | undefined,
      })
      saveTaskStore(store)

      // Fire-and-forget notification
      if (task.assignee) notifyTaskAssigned(task).catch(() => {})

      return json(task, 201)
    }

    // PATCH /tasks/:id — update a task
    const taskUpdateMatch = path.match(/^\/tasks\/(task-\d+)$/)
    if (method === "PATCH" && taskUpdateMatch) {
      const body = await parseBody(req)
      const store = loadTaskStore()
      const oldAssignee = getTask(store, taskUpdateMatch[1])?.assignee
      const newStatus = body.status as TaskStatus | undefined
      const newAssignee = body.assignee as string | undefined

      try {
        const task = updateTask(store, taskUpdateMatch[1], {
          status: newStatus,
          assignee: newAssignee,
          note: body.note as string | undefined,
          result: body.result as TaskResult | undefined,
          blockedReason: body.blockedReason as string | undefined,
          author: body.author as string | undefined,
        })
        saveTaskStore(store)

        // Fire-and-forget notifications
        if (newStatus === "done") notifyTaskDone(task).catch(() => {})
        else if (newStatus === "blocked") notifyTaskBlocked(task).catch(() => {})
        if (newAssignee !== undefined && newAssignee !== oldAssignee) {
          notifyTaskReassigned(task, oldAssignee, newAssignee).catch(() => {})
        }

        return json(task)
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : String(err))
      }
    }

    return new Response(JSON.stringify({ error: "Not found", endpoints: ["GET /tasks", "GET /tasks/:id", "GET /tasks/board", "POST /tasks", "PATCH /tasks/:id"] }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  },
})

console.log(`[fleet-server] Listening on http://${server.hostname}:${server.port}`)
