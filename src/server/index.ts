import { loadTaskStore, saveTaskStore, createTask, updateTask, getTask, listTasks, activeTasks, sortByPriority, createSprint, closeSprint, listSprints, getActiveSprint } from "../tasks/store"
import type { TaskStatus, TaskPriority, TaskResult } from "../tasks/types"
import { notifyTaskAssigned, notifyTaskDone, notifyTaskBlocked, notifyTaskReassigned, notifyTaskReview, notifyTaskVerify } from "../tasks/notify"
import { findConfigDir, loadConfig, resolveStateDir, sessionName } from "../core/config"
import { readHeartbeat, readRemoteHeartbeat } from "../core/heartbeat"
import { loadState, getAgentState } from "../watchdog/state"
import { resolveRuntime } from "../runtime/resolve"
import { existsSync, readdirSync, statSync, readFileSync } from "fs"
import { join, resolve, extname, relative } from "path"
import { homedir } from "os"
import { handleSSE, broadcast } from "./sse"
import { startHeartbeatTick, getAgentSummaryCache } from "./heartbeat-tick"

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

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" }

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } })
}

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } })
}

function notFound(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } })
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

// Dashboard static file serving
// Priority: Vite build (src/dashboard/dist/) → fallback to legacy dashboard.html
const DASHBOARD_DIST = resolve(join(new URL(".", import.meta.url).pathname, "..", "dashboard", "dist"))
const LEGACY_DASHBOARD_HTML = await Bun.file(new URL("dashboard.html", import.meta.url).pathname).text()

// Check for Vite build per-request with a short TTL cache (5s) to avoid hitting
// the filesystem on every request while still picking up new builds without restart.
let _viteBuildCache: { value: boolean; expires: number } = { value: false, expires: 0 }
function hasViteBuild(): boolean {
  const now = Date.now()
  if (now < _viteBuildCache.expires) return _viteBuildCache.value
  const result = existsSync(join(DASHBOARD_DIST, "index.html"))
  _viteBuildCache = { value: result, expires: now + 5000 }
  return result
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

function serveDashboardFile(filePath: string): Response | null {
  const resolved = resolve(filePath)
  // Prevent path traversal
  if (!resolved.startsWith(DASHBOARD_DIST)) return null
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null

  const ext = extname(resolved)
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
  const content = readFileSync(resolved)
  const headers: Record<string, string> = { "Content-Type": contentType }
  // Cache static assets (hashed filenames) aggressively
  if (ext === ".js" || ext === ".css") {
    headers["Cache-Control"] = "public, max-age=31536000, immutable"
  }
  return new Response(content, { headers })
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // CORS preflight — allow cross-origin requests from dashboard
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      })
    }

    // GET /dashboard — serve the web UI (no auth required)
    if (path === "/dashboard" || path === "/dashboard/") {
      if (hasViteBuild()) {
        const indexHtml = readFileSync(join(DASHBOARD_DIST, "index.html"), "utf8")
        return new Response(indexHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      }
      return new Response(LEGACY_DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    // GET /dashboard/* — serve Vite build static assets (JS, CSS, images)
    if (hasViteBuild() && path.startsWith("/dashboard/")) {
      const assetPath = path.slice("/dashboard/".length)
      const filePath = join(DASHBOARD_DIST, assetPath)
      const response = serveDashboardFile(filePath)
      if (response) return response
      // SPA fallback: serve index.html for client-side routing
      const indexHtml = readFileSync(join(DASHBOARD_DIST, "index.html"), "utf8")
      return new Response(indexHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    }

    // GET /assets/* — Vite build assets (JS, CSS bundles) served at root /assets/ path
    if (hasViteBuild() && path.startsWith("/assets/")) {
      const filePath = join(DASHBOARD_DIST, path.slice(1))
      const response = serveDashboardFile(filePath)
      if (response) return response
    }

    // GET /favicon.ico — serve from Vite build if available
    if (path === "/favicon.ico") {
      if (hasViteBuild()) {
        const filePath = join(DASHBOARD_DIST, "favicon.ico")
        const response = serveDashboardFile(filePath)
        if (response) return response
      }
      return new Response(null, { status: 204 })
    }

    // GET /events — SSE event stream (auth via query param since EventSource can't set headers)
    if (req.method === "GET" && path === "/events") {
      const token = url.searchParams.get("token")
      if (token !== API_TOKEN) return unauthorized()
      return handleSSE(req)
    }

    // GET /sprints/current — active sprint with task stats (no auth, for dashboard)
    if (req.method === "GET" && path === "/sprints/current") {
      const store = loadTaskStore()
      const active = getActiveSprint(store)
      if (!active) return json(null)
      const sprintTasks = listTasks(store, { sprintId: active.id })
      const done = sprintTasks.filter(t => t.status === "done").length
      const blocked = sprintTasks.filter(t => t.status === "blocked").length
      const inProgress = sprintTasks.filter(t => t.status === "in_progress").length
      const inReview = sprintTasks.filter(t => t.status === "review").length
      const inVerify = sprintTasks.filter(t => t.status === "verify").length
      const open = sprintTasks.filter(t => t.status === "open" || t.status === "backlog").length
      const cancelled = sprintTasks.filter(t => t.status === "cancelled").length

      // Days remaining (null if no endDate)
      let daysRemaining: number | null = null
      if (active.endDate) {
        const end = new Date(active.endDate)
        const now = new Date()
        daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000))
      }

      return json({
        sprint: active,
        stats: { total: sprintTasks.length, done, blocked, inProgress, inReview, inVerify, open, cancelled, daysRemaining },
        tasks: sprintTasks,
      })
    }

    // GET /tasks/stats — summary counts for dashboard (no auth)
    if (req.method === "GET" && path === "/tasks/stats") {
      const store = loadTaskStore()
      const tasks = store.tasks

      const byStatus: Record<string, number> = {}
      const byAssignee: Record<string, number> = {}
      const byProject: Record<string, number> = {}
      const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()
      let completedToday = 0

      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
        if (t.assignee) byAssignee[t.assignee] = (byAssignee[t.assignee] ?? 0) + 1
        if (t.project) byProject[t.project] = (byProject[t.project] ?? 0) + 1
        if (t.status === "done" && t.completedAt && t.completedAt >= todayStart) completedToday++
      }

      return json({ total: tasks.length, byStatus, byAssignee, byProject, completedToday })
    }

    // GET /agents/summary — cached agent state, max 15s stale, no SSH in request path
    if (req.method === "GET" && path === "/agents/summary") {
      const cached = getAgentSummaryCache()
      if (!cached) {
        // No tick has run yet — fall through to /agents for live data
        return json({ agents: [], updatedAt: null, stale: true })
      }
      return json(cached)
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

    // ══════════════════════════════════════════════════════════════
    // SKILL ENDPOINTS (no auth — read-only, same as /agents, /activity)
    // ══════════════════════════════════════════════════════════════

    const SKILLS_DIR = join(homedir(), ".fleet", "skills")

    // GET /skills?project=<name> — list skills (global + optional project-scoped)
    if (req.method === "GET" && path === "/skills") {
      try {
        const skills: { name: string; description: string; tags: string[]; scope: string; size: number; modified: string }[] = []
        const projectFilter = url.searchParams.get("project")

        function scanSkillsIn(dir: string, scope: string) {
          if (!existsSync(dir)) return
          for (const entry of readdirSync(dir)) {
            if (entry.startsWith(".")) continue
            const skillDir = join(dir, entry)
            if (!statSync(skillDir).isDirectory()) continue
            const skillFile = join(skillDir, "SKILL.md")
            if (!existsSync(skillFile)) continue

            const stat = statSync(skillFile)
            if (stat.size > 50 * 1024) continue

            const raw = readFileSync(skillFile, "utf8")
            const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
            let name = entry
            let description = ""
            let tags: string[] = []

            if (fmMatch) {
              const fm = fmMatch[1]
              const nameMatch = fm.match(/^name:\s*(.+)$/m)
              const descMatch = fm.match(/^description:\s*(.+)$/m)
              const tagsMatch = fm.match(/^tags:\s*\[(.+)\]$/m)
              if (nameMatch) name = nameMatch[1].trim()
              if (descMatch) description = descMatch[1].trim()
              if (tagsMatch) tags = tagsMatch[1].split(",").map(t => t.trim())
            }

            skills.push({ name, description, tags, scope, size: stat.size, modified: stat.mtime.toISOString() })
          }
        }

        // Global skills
        scanSkillsIn(SKILLS_DIR, "global")

        // Project-scoped skills (from workspace/.fleet/skills/)
        if (projectFilter) {
          try {
            const configDir = findConfigDir()
            const config = loadConfig(configDir)
            const channels = config.discord?.channels || {}
            for (const [, ch] of Object.entries(channels)) {
              const ws = (ch as { workspace?: string }).workspace
              if (!ws) continue
              const expanded = ws.replace(/^~/, homedir())
              if (expanded.includes(projectFilter) || projectFilter === Object.keys(channels).find(k => (channels[k] as { workspace?: string }).workspace === ws)) {
                const projectSkillsDir = join(expanded, ".fleet", "skills")
                scanSkillsIn(projectSkillsDir, projectFilter)
              }
            }
          } catch {}
        }

        return json({ skills, count: skills.length })
      } catch (err) {
        return badRequest(`Failed to list skills: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // GET /skills/:name — read skill content (directory-per-skill: ~/.fleet/skills/<name>/SKILL.md)
    const skillMatch = path.match(/^\/skills\/([^/]+)$/)
    if (req.method === "GET" && skillMatch) {
      try {
        const skillName = decodeURIComponent(skillMatch[1])
        const safeName = skillName.replace(/[^a-zA-Z0-9._-]/g, "")
        const filePath = join(SKILLS_DIR, safeName, "SKILL.md")
        const resolved = resolve(filePath)
        if (!resolved.startsWith(resolve(SKILLS_DIR))) {
          return badRequest("Path traversal detected")
        }
        if (!existsSync(filePath)) {
          return notFound(`Skill not found: ${skillName}`)
        }
        const raw = readFileSync(filePath, "utf8")
        const stat = statSync(filePath)
        return json({ name: safeName, content: raw, size: stat.size })
      } catch (err) {
        return badRequest(`Failed to read skill: ${err instanceof Error ? err.message : String(err)}`)
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

        broadcast("agent:restart", { agent: agentName, by: "dashboard" })

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
      const sprintId = url.searchParams.get("sprintId") ?? undefined
      const tasks = sortByPriority(listTasks(store, { assignee, status, project, sprintId }))
      return json(tasks)
    }

    // GET /tasks/board — active tasks grouped by status
    if (method === "GET" && path === "/tasks/board") {
      const store = loadTaskStore()
      const project = url.searchParams.get("project") ?? undefined
      const boardSprintId = url.searchParams.get("sprintId") ?? undefined
      let active = activeTasks(store)
      if (project) active = active.filter(t => t.project === project)
      if (boardSprintId) active = active.filter(t => t.sprintId === boardSprintId)
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
      const status = body.status as string | undefined
      if (status && status !== "open" && status !== "backlog") return badRequest(`invalid create status: "${status}". Must be: open, backlog`)

      // Validate dependsOn IDs exist
      const store = loadTaskStore()
      const dependsOn = body.dependsOn as string[] | undefined
      if (dependsOn) {
        for (const depId of dependsOn) {
          if (!getTask(store, depId)) return badRequest(`dependency not found: ${depId}`)
        }
      }

      const sprintId = body.sprintId as string | undefined
      if (sprintId) {
        const { getSprint } = await import("../tasks/store")
        if (!getSprint(store, sprintId)) return badRequest(`sprint not found: ${sprintId}`)
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
        status: status as "open" | "backlog" | undefined,
        sprintId,
      })
      saveTaskStore(store)

      // SSE broadcast
      broadcast("task:created", { task })

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

      const newPriority = body.priority as TaskPriority | undefined
      if (newPriority && !VALID_PRIORITIES.has(newPriority)) return badRequest(`invalid priority: "${newPriority}"`)
      const newSprintId = body.sprintId as string | undefined

      const store = loadTaskStore()
      const existingTask = getTask(store, taskUpdateMatch[1])
      const oldAssignee = existingTask?.assignee
      const oldPriority = existingTask?.priority
      const oldSprintId = existingTask?.sprintId
      const newAssignee = body.assignee as string | undefined

      if (newSprintId) {
        const { getSprint } = await import("../tasks/store")
        if (!getSprint(store, newSprintId)) return badRequest(`sprint not found: ${newSprintId}`)
      }

      try {
        const oldStatus = getTask(store, taskUpdateMatch[1])?.status
        const task = updateTask(store, taskUpdateMatch[1], {
          status: newStatus,
          assignee: newAssignee,
          priority: newPriority,
          sprintId: newSprintId,
          note,
          result: body.result as TaskResult | undefined,
          blockedReason,
          author: body.author as string | undefined,
        })
        saveTaskStore(store)

        // SSE broadcasts
        const changes: string[] = []
        if (newStatus && newStatus !== oldStatus) changes.push("status")
        if (newAssignee !== undefined && newAssignee !== oldAssignee) changes.push("assignee")
        if (newPriority && newPriority !== oldPriority) changes.push("priority")
        if (newSprintId !== undefined && newSprintId !== oldSprintId) changes.push("sprintId")
        if (note) changes.push("note")
        if (body.result) changes.push("result")
        broadcast("task:updated", { task, changes })
        if (newStatus && newStatus !== oldStatus) {
          broadcast("task:status", { taskId: task.id, from: oldStatus, to: newStatus, agent: (body.author as string | undefined) ?? task.assignee })
        }
        if (newAssignee !== undefined && newAssignee !== oldAssignee) {
          broadcast("task:assigned", { taskId: task.id, from: oldAssignee, to: newAssignee })
        }

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


    // --- Sprint endpoints ---

    // GET /sprints — list all sprints
    if (method === "GET" && path === "/sprints") {
      const store = loadTaskStore()
      const sprints = listSprints(store)
      return json(sprints)
    }

    // POST /sprints — create a new sprint
    if (method === "POST" && path === "/sprints") {
      const body = await parseBody(req)
      if (!body) return badRequest("invalid JSON body")
      const name = body.name as string | undefined
      if (!name) return badRequest("name is required")
      if (name.length > 100) return badRequest("name exceeds 100 characters")

      const store = loadTaskStore()
      try {
        const sprint = createSprint(store, {
          name,
          startDate: body.startDate as string | undefined,
          endDate: body.endDate as string | undefined,
          goals: body.goals as string | undefined,
        })
        saveTaskStore(store)
        broadcast("sprint:created", { sprint })
        return json(sprint, 201)
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : String(err))
      }
    }

    // PATCH /sprints/:id/close — close a sprint
    const sprintCloseMatch = path.match(/^\/sprints\/(sprint-\d+)\/close$/)
    if (method === "PATCH" && sprintCloseMatch) {
      const store = loadTaskStore()
      try {
        const sprint = closeSprint(store, sprintCloseMatch[1])
        saveTaskStore(store)
        broadcast("sprint:closed", { sprint })
        return json(sprint)
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : String(err))
      }
    }

    return new Response(JSON.stringify({ error: "Not found", endpoints: ["GET /dashboard", "GET /events", "GET /agents", "GET /agents/:name/logs", "GET /activity", "GET /docs/:project", "GET /docs/:project/*path", "GET /skills", "GET /skills/:name", "GET /tasks/stats", "GET /sprints/current", "POST /agents/:name/restart", "GET /tasks", "GET /tasks/:id", "GET /tasks/board", "POST /tasks", "PATCH /tasks/:id", "GET /sprints", "POST /sprints", "PATCH /sprints/:id/close"] }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  },
})

console.log(`[fleet-server] Listening on http://${server.hostname}:${server.port}`)

// Start heartbeat polling → SSE broadcast tick
startHeartbeatTick()
console.log(`[fleet-server] Heartbeat tick started (15s interval)`)
