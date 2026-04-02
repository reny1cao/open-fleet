import { loadTaskStore, saveTaskStore, createTask, updateTask, getTask, listTasks, activeTasks, sortByPriority } from "../tasks/store"
import type { TaskStatus, TaskPriority, TaskResult } from "../tasks/types"
import { notifyTaskAssigned, notifyTaskDone, notifyTaskBlocked, notifyTaskReassigned, notifyTaskReview, notifyTaskVerify } from "../tasks/notify"
import { findConfigDir, loadConfig, resolveStateDir } from "../core/config"
import { readHeartbeat, readRemoteHeartbeat } from "../core/heartbeat"
import { loadState, getAgentState } from "../watchdog/state"

const PORT = parseInt(process.env.FLEET_API_PORT ?? "4680")
const HOST = process.env.FLEET_API_HOST ?? "127.0.0.1" // localhost only by default — set to Tailscale IP for remote access
const API_TOKEN = process.env.FLEET_API_TOKEN

if (!API_TOKEN) {
  console.error("[fleet-server] FATAL: FLEET_API_TOKEN is required. Set it in your environment or .env file.")
  process.exit(1)
}

const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"])
const MAX_TITLE = 500
const MAX_DESCRIPTION = 5000
const MAX_NOTE = 2000

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

// Load dashboard HTML at startup
const DASHBOARD_HTML = await Bun.file(new URL("dashboard.html", import.meta.url).pathname).text()

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // GET /dashboard — serve the web UI (no auth required, JS handles it via token param)
    if (path === "/dashboard" || path === "/dashboard/") {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    if (!checkAuth(req)) return unauthorized()

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
      const project = url.searchParams.get("project") ?? undefined
      let active = activeTasks(store)
      if (project) active = active.filter(t => t.project === project)
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
      if (title.length > MAX_TITLE) return badRequest(`title exceeds ${MAX_TITLE} characters`)
      const description = body.description as string | undefined
      if (description && description.length > MAX_DESCRIPTION) return badRequest(`description exceeds ${MAX_DESCRIPTION} characters`)
      const priority = (body.priority as string) ?? "normal"
      if (!VALID_PRIORITIES.has(priority)) return badRequest(`invalid priority: "${priority}". Must be: low, normal, high, urgent`)

      // Validate dependsOn IDs exist
      const store = loadTaskStore()
      const dependsOn = body.dependsOn as string[] | undefined
      if (dependsOn) {
        for (const depId of dependsOn) {
          if (!getTask(store, depId)) return badRequest(`dependency not found: ${depId}`)
        }
      }

      const task = createTask(store, {
        title,
        assignee: body.assignee as string | undefined,
        priority: priority as TaskPriority,
        description,
        workspace: body.workspace as string | undefined,
        parentId: body.parentId as string | undefined,
        dependsOn,
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
      const note = body.note as string | undefined
      if (note && note.length > MAX_NOTE) return badRequest(`note exceeds ${MAX_NOTE} characters`)
      const newStatus = body.status as TaskStatus | undefined
      const validStatuses = new Set(["open", "in_progress", "review", "verify", "done", "blocked", "cancelled"])
      if (newStatus && !validStatuses.has(newStatus)) return badRequest(`invalid status: "${newStatus}"`)

      const store = loadTaskStore()
      const oldAssignee = getTask(store, taskUpdateMatch[1])?.assignee
      const newAssignee = body.assignee as string | undefined

      try {
        const task = updateTask(store, taskUpdateMatch[1], {
          status: newStatus,
          assignee: newAssignee,
          note,
          result: body.result as TaskResult | undefined,
          blockedReason: body.blockedReason as string | undefined,
          author: body.author as string | undefined,
        })
        saveTaskStore(store)

        // Fire-and-forget notifications (skip if quiet)
        const quiet = body.quiet === true
        if (!quiet) {
          if (newStatus === "done") notifyTaskDone(task).catch(() => {})
          else if (newStatus === "blocked") notifyTaskBlocked(task).catch(() => {})
          else if (newStatus === "review") notifyTaskReview(task).catch(() => {})
          else if (newStatus === "verify") notifyTaskVerify(task).catch(() => {})
          if (newAssignee !== undefined && newAssignee !== oldAssignee) {
            notifyTaskReassigned(task, oldAssignee, newAssignee).catch(() => {})
          }
        }

        return json(task)
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : String(err))
      }
    }

    // GET /agents — real agent status with heartbeat + watchdog state
    if (method === "GET" && path === "/agents") {
      try {
        const configDir = findConfigDir()
        const config = loadConfig(configDir)
        const watchdogState = loadState()
        const taskStore = loadTaskStore()

        const agents = await Promise.all(
          Object.entries(config.agents).map(async ([name, def]) => {
            // Read heartbeat (local or remote)
            let heartbeat
            const isRemote = def.server !== "local" && config.servers?.[def.server]
            if (isRemote) {
              const serverConfig = config.servers![def.server]
              const rawStateDir = def.stateDir ?? `~/.fleet/state/${config.fleet.name}-${name}`
              heartbeat = await readRemoteHeartbeat(rawStateDir, serverConfig)
            } else {
              const stateDir = resolveStateDir(name, config)
              heartbeat = readHeartbeat(stateDir)
            }

            // Watchdog state
            const agentWatch = getAgentState(watchdogState, name)

            // Current task (active in_progress or review)
            const activeTasks = taskStore.tasks.filter(
              t => t.assignee === name && (t.status === "in_progress" || t.status === "review")
            )

            // Derive combined status
            let status: string = heartbeat.state
            if (heartbeat.state === "dead" && agentWatch.consecutiveFailures === 0) {
              status = "off"
            }

            return {
              name,
              role: def.role,
              server: def.server,
              workspace: def.workspace ?? config.defaults.workspace,
              channels: def.channels,
              status,
              heartbeat: {
                state: heartbeat.state,
                lastSeen: heartbeat.lastSeen,
                ageSec: heartbeat.ageSec,
              },
              watchdog: {
                lastHealthy: agentWatch.lastHealthy,
                consecutiveFailures: agentWatch.consecutiveFailures,
                lastRestart: agentWatch.lastRestart,
                outputStaleCount: agentWatch.outputStaleCount,
              },
              activeTasks: activeTasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
            }
          })
        )

        return json({ agents })
      } catch (err) {
        return badRequest(`Failed to load agent status: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return new Response(JSON.stringify({ error: "Not found", endpoints: ["GET /tasks", "GET /tasks/:id", "GET /tasks/board", "POST /tasks", "PATCH /tasks/:id", "GET /agents"] }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  },
})

console.log(`[fleet-server] Listening on http://${server.hostname}:${server.port}`)
