import { loadTaskStore, saveTaskStore, createTask, updateTask, getTask, listTasks, activeTasks, sortByPriority } from "../tasks/store"
import type { TaskStatus, TaskPriority, TaskResult } from "../tasks/types"
import { notifyTaskAssigned, notifyTaskDone, notifyTaskBlocked, notifyTaskReassigned, notifyTaskReview, notifyTaskVerify } from "../tasks/notify"
import { findConfigDir, loadConfig, resolveStateDir, sessionName } from "../core/config"
import { readHeartbeat, readRemoteHeartbeat } from "../core/heartbeat"
import { loadState, getAgentState } from "../watchdog/state"
import { resolveRuntime } from "../runtime/resolve"
import { existsSync, readdirSync, statSync, readFileSync } from "fs"
import { join, resolve, extname, relative } from "path"
import { homedir } from "os"

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
const MAX_PROJECT = 200
const MAX_BLOCKED_REASON = 2000

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

async function parseBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return await req.json() as Record<string, unknown>
  } catch {
    return null
  }
}

function expandHome(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

function resolveProjectDir(project: string): string | null {
  try {
    const configDir = findConfigDir()
    const config = loadConfig(configDir)

    // 1. Match channel label (e.g., "fleet-dev" → workspace)
    const channelDef = config.discord.channels[project]
    if (channelDef?.workspace) {
      const dir = expandHome(channelDef.workspace)
      if (existsSync(dir)) return dir
    }

    // 2. Search channels for workspace path containing project name
    for (const [, ch] of Object.entries(config.discord.channels)) {
      if (ch.workspace && ch.workspace.includes(project)) {
        const dir = expandHome(ch.workspace)
        if (existsSync(dir)) return dir
      }
    }

    // 3. Fallback: ~/workspace/<project>
    const fallback = join(homedir(), 'workspace', project)
    if (existsSync(fallback)) return fallback

    return null
  } catch {
    return null
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
  const parsed = new Date(since)
  if (!isNaN(parsed.getTime())) return parsed
  return new Date(now.getTime() - 2 * 3600000) // default 2h
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

    // GET /agents — no auth required (dashboard fetches this directly)
    if (req.method === "GET" && path === "/agents") {
      try {
        const configDir = findConfigDir()
        const config = loadConfig(configDir)
        const watchdogState = loadState()
        const taskStore = loadTaskStore()

        const agents = await Promise.all(
          Object.entries(config.agents).map(async ([name, def]) => {
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

            const agentWatch = getAgentState(watchdogState, name)
            const activeTasks = taskStore.tasks.filter(
              t => t.assignee === name && (t.status === "in_progress" || t.status === "review")
            )

            // Recent activity: last 5 events from this agent's tasks
            const recentEvents: { timestamp: string; taskId: string; type: string; text: string }[] = []
            for (const task of taskStore.tasks) {
              for (const note of task.notes) {
                if (note.author === name) {
                  recentEvents.push({ timestamp: note.timestamp, taskId: task.id, type: note.type, text: note.text })
                }
              }
            }
            recentEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            const recentActivity = recentEvents.slice(0, 5)

            // Daily stats
            const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()
            const todayCompleted = taskStore.tasks.filter(t => t.assignee === name && t.completedAt && t.completedAt >= todayStart).length
            const todayEvents = recentEvents.filter(e => e.timestamp >= todayStart).length

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
              activeTasks: activeTasks.map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, startedAt: t.startedAt })),
              recentActivity,
              dailyStats: { completed: todayCompleted, events: todayEvents },
            }
          })
        )

        return json({ agents })
      } catch (err) {
        return badRequest(`Failed to load agent status: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // GET /activity — chronological stream of task events (no auth, for dashboard)
    if (req.method === "GET" && path === "/activity") {
      try {
        const store = loadTaskStore()
        const since = parseSince(url.searchParams.get("since") ?? "2h")
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200)

        const events: { timestamp: string; agent: string; taskId: string; taskTitle: string; type: string; text: string }[] = []

        for (const task of store.tasks) {
          // Task creation events
          if (new Date(task.createdAt) >= since) {
            events.push({
              timestamp: task.createdAt,
              agent: task.createdBy,
              taskId: task.id,
              taskTitle: task.title,
              type: "created",
              text: `Created: "${task.title}"${task.assignee ? ` → ${task.assignee}` : ""}`,
            })
          }
          // Note events
          for (const note of task.notes) {
            if (new Date(note.timestamp) >= since) {
              events.push({
                timestamp: note.timestamp,
                agent: note.author,
                taskId: task.id,
                taskTitle: task.title,
                type: note.type,
                text: note.text,
              })
            }
          }
        }

        events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        return json({ events: events.slice(0, limit), since: since.toISOString() })
      } catch (err) {
        return badRequest(`Failed to load activity: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // GET /agents/:name/logs — last N lines of tmux output (no auth, for dashboard)
    const logsMatch = path.match(/^\/agents\/([^/]+)\/logs$/)
    if (req.method === "GET" && logsMatch) {
      try {
        const agentName = decodeURIComponent(logsMatch[1])
        const lines = Math.min(parseInt(url.searchParams.get("lines") ?? "30"), 200)
        const configDir = findConfigDir()
        const config = loadConfig(configDir)

        if (!config.agents[agentName]) return notFound(`Agent not found: ${agentName}`)

        const session = sessionName(config.fleet.name, agentName)
        const runtime = resolveRuntime(agentName, config)
        const output = await runtime.captureOutput(session, lines)

        return json({ agent: agentName, lines: output.split("\n") })
      } catch (err) {
        return json({ agent: logsMatch[1], lines: [], error: err instanceof Error ? err.message : String(err) })
      }
    }

    // GET /docs/:project — doc index for a project (no auth)
    const docsIndexMatch = path.match(/^\/docs\/([^/]+)$/)
    if (req.method === "GET" && docsIndexMatch) {
      try {
        const project = decodeURIComponent(docsIndexMatch[1])
        const projectDir = resolveProjectDir(project)
        if (!projectDir) return notFound(`Project not found: ${project}`)

        const docs: { name: string; path: string; size: number; modified: string }[] = []
        const MAX_DOC_SIZE = 50000
        const scanFile = (filePath: string, displayPath: string) => {
          try {
            const st = statSync(filePath)
            if (!st.isFile() || st.size > MAX_DOC_SIZE) return
            if (extname(filePath) !== '.md') return
            docs.push({ name: displayPath.replace(/\.md$/, ''), path: displayPath, size: st.size, modified: st.mtime.toISOString() })
          } catch {}
        }

        // Priority 1: STATUS.md
        const statusPath = join(projectDir, 'STATUS.md')
        if (existsSync(statusPath)) scanFile(statusPath, 'STATUS.md')

        // Priority 2: wiki/projects/<project>.md
        const wikiDir = join(projectDir, 'wiki', 'projects')
        if (existsSync(wikiDir)) {
          for (const f of readdirSync(wikiDir)) scanFile(join(wikiDir, f), `wiki/projects/${f}`)
        }

        // Priority 3: docs/*.md (top-level only, no subdirs)
        const docsDir = join(projectDir, 'docs')
        if (existsSync(docsDir)) {
          for (const f of readdirSync(docsDir)) scanFile(join(docsDir, f), `docs/${f}`)
        }

        // Priority 4: wiki/shared.md + wiki/roles/
        const sharedPath = join(projectDir, 'wiki', 'shared.md')
        if (existsSync(sharedPath)) scanFile(sharedPath, 'wiki/shared.md')
        const rolesDir = join(projectDir, 'wiki', 'roles')
        if (existsSync(rolesDir)) {
          for (const f of readdirSync(rolesDir)) scanFile(join(rolesDir, f), `wiki/roles/${f}`)
        }

        return json({ project, docs })
      } catch (err) {
        return badRequest(`Failed to list docs: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // GET /docs/:project/*path — raw markdown content (no auth)
    const docsContentMatch = path.match(/^\/docs\/([^/]+)\/(.+)$/)
    if (req.method === "GET" && docsContentMatch) {
      try {
        const project = decodeURIComponent(docsContentMatch[1])
        const docPath = decodeURIComponent(docsContentMatch[2])
        const projectDir = resolveProjectDir(project)
        if (!projectDir) return notFound(`Project not found: ${project}`)

        // Prevent path traversal
        const fullPath = resolve(projectDir, docPath)
        if (!fullPath.startsWith(resolve(projectDir))) return badRequest("Invalid path")
        if (!existsSync(fullPath)) return notFound(`Doc not found: ${docPath}`)

        const st = statSync(fullPath)
        if (!st.isFile()) return notFound(`Not a file: ${docPath}`)
        if (st.size > 50000) return badRequest(`Doc exceeds 50KB limit`)

        const content = readFileSync(fullPath, 'utf8')
        return json({ project, path: docPath, content, size: st.size, modified: st.mtime.toISOString() })
      } catch (err) {
        if (err instanceof Response) throw err
        return badRequest(`Failed to read doc: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (!checkAuth(req)) return unauthorized()

    const method = req.method

    // POST /agents/:name/restart — trigger agent restart
    const restartMatch = path.match(/^\/agents\/([^/]+)\/restart$/)
    if (method === "POST" && restartMatch) {
      try {
        const agentName = decodeURIComponent(restartMatch[1])
        const configDir = findConfigDir()
        const config = loadConfig(configDir)

        if (!config.agents[agentName]) return notFound(`Agent not found: ${agentName}`)

        const session = sessionName(config.fleet.name, agentName)
        const runtime = resolveRuntime(agentName, config)
        await runtime.sendKeys(session, "/exit")

        return json({ agent: agentName, status: "restart_triggered", session })
      } catch (err) {
        return badRequest(`Failed to restart agent: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

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
      if (!body) return badRequest("invalid JSON body")
      const title = body.title as string | undefined
      if (!title) return badRequest("title is required")
      if (title.length > MAX_TITLE) return badRequest(`title exceeds ${MAX_TITLE} characters`)
      const description = body.description as string | undefined
      if (description && description.length > MAX_DESCRIPTION) return badRequest(`description exceeds ${MAX_DESCRIPTION} characters`)
      const project = body.project as string | undefined
      if (project && project.length > MAX_PROJECT) return badRequest(`project exceeds ${MAX_PROJECT} characters`)
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
        project,
      })
      saveTaskStore(store)

      // Fire-and-forget notification — use creator as sender so it comes from their bot
      if (task.assignee) notifyTaskAssigned(task, task.createdBy).catch(e => console.error('[notify]', e.message))

      return json(task, 201)
    }

    // PATCH /tasks/:id — update a task
    const taskUpdateMatch = path.match(/^\/tasks\/(task-\d+)$/)
    if (method === "PATCH" && taskUpdateMatch) {
      const body = await parseBody(req)
      if (!body) return badRequest("invalid JSON body")
      const note = body.note as string | undefined
      if (note && note.length > MAX_NOTE) return badRequest(`note exceeds ${MAX_NOTE} characters`)
      const blockedReason = body.blockedReason as string | undefined
      if (blockedReason && blockedReason.length > MAX_BLOCKED_REASON) return badRequest(`blockedReason exceeds ${MAX_BLOCKED_REASON} characters`)
      const newStatus = body.status as TaskStatus | undefined
      const validStatuses = new Set(["backlog", "open", "in_progress", "review", "verify", "done", "blocked", "cancelled"])
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
          blockedReason,
          author: body.author as string | undefined,
        })
        saveTaskStore(store)

        // Fire-and-forget notifications (skip if quiet)
        // Use author (the agent making the update) as sender so the notification
        // comes from the worker's bot, not the lead's bot
        const quiet = body.quiet === true
        const sender = (body.author as string | undefined) ?? task.assignee
        if (!quiet) {
          if (newStatus === "done") notifyTaskDone(task, sender).catch(e => console.error('[notify]', e.message))
          else if (newStatus === "blocked") notifyTaskBlocked(task, sender).catch(e => console.error('[notify]', e.message))
          else if (newStatus === "review") notifyTaskReview(task, sender).catch(e => console.error('[notify]', e.message))
          else if (newStatus === "verify") notifyTaskVerify(task, sender).catch(e => console.error('[notify]', e.message))
          if (newAssignee !== undefined && newAssignee !== oldAssignee) {
            notifyTaskReassigned(task, oldAssignee, newAssignee, sender).catch(e => console.error('[notify]', e.message))
          }
        }

        return json(task)
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : String(err))
      }
    }

    return new Response(JSON.stringify({ error: "Not found", endpoints: ["GET /dashboard", "GET /agents", "GET /agents/:name/logs", "GET /activity", "GET /docs/:project", "GET /docs/:project/*path", "POST /agents/:name/restart", "GET /tasks", "GET /tasks/:id", "GET /tasks/board", "POST /tasks", "PATCH /tasks/:id"] }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  },
})

console.log(`[fleet-server] Listening on http://${server.hostname}:${server.port}`)
