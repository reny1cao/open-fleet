/**
 * HTTP client for the fleet task API.
 * Used when FLEET_API_URL is set (remote agents).
 * Mirrors the store.ts API but routes through HTTP.
 */

import type { Task, TaskStatus, TaskPriority, TaskResult, Sprint } from "./types"

function apiUrl(): string | undefined {
  return process.env.FLEET_API_URL
}

function apiToken(): string | undefined {
  return process.env.FLEET_API_TOKEN
}

async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const base = apiUrl()
  if (!base) throw new Error("FLEET_API_URL not set")

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  const token = apiToken()
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { ...headers, ...opts?.headers },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API error ${res.status}: ${body}`)
  }

  return res
}

/** Check if we should use the HTTP API instead of local file store */
export function useHttpApi(): boolean {
  return !!apiUrl()
}

/** GET /tasks — list all tasks, optionally filtered */
export async function httpListTasks(filters?: {
  assignee?: string
  status?: TaskStatus
  project?: string
  sprintId?: string
}): Promise<Task[]> {
  const params = new URLSearchParams()
  if (filters?.assignee) params.set("assignee", filters.assignee)
  if (filters?.status) params.set("status", filters.status)
  if (filters?.project) params.set("project", filters.project)
  if (filters?.sprintId) params.set("sprintId", filters.sprintId)

  const qs = params.toString()
  const res = await apiFetch(`/tasks${qs ? `?${qs}` : ""}`)
  return res.json()
}

/** GET /tasks/:id */
export async function httpGetTask(taskId: string): Promise<Task> {
  const res = await apiFetch(`/tasks/${taskId}`)
  return res.json()
}

/** POST /tasks — create a new task */
export async function httpCreateTask(opts: {
  title: string
  assignee?: string
  priority?: TaskPriority
  description?: string
  workspace?: string
  parentId?: string
  dependsOn?: string[]
  project?: string
  status?: "open" | "backlog"
  sprintId?: string
}): Promise<Task> {
  const res = await apiFetch("/tasks", {
    method: "POST",
    body: JSON.stringify({ ...opts, createdBy: process.env.FLEET_SELF }),
  })
  return res.json()
}

/** PATCH /tasks/:id — update a task */
export async function httpUpdateTask(taskId: string, opts: {
  status?: TaskStatus
  assignee?: string
  note?: string
  result?: TaskResult
  blockedReason?: string
  quiet?: boolean
}): Promise<Task> {
  const res = await apiFetch(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...opts, author: process.env.FLEET_SELF }),
  })
  return res.json()
}

/** GET /tasks/board — get active tasks grouped by status */
export async function httpGetBoard(): Promise<Record<string, Task[]>> {
  const res = await apiFetch("/tasks/board")
  return res.json()
}

// --- Sprint HTTP client ---

/** GET /sprints — list all sprints */
export async function httpListSprints(): Promise<Sprint[]> {
  const res = await apiFetch("/sprints")
  return res.json()
}

/** POST /sprints — create a new sprint */
export async function httpCreateSprint(opts: {
  name: string
  startDate?: string
  endDate?: string
  goals?: string
}): Promise<Sprint> {
  const res = await apiFetch("/sprints", {
    method: "POST",
    body: JSON.stringify(opts),
  })
  return res.json()
}

/** PATCH /sprints/:id/close — close a sprint */
export async function httpCloseSprint(sprintId: string): Promise<Sprint> {
  const res = await apiFetch(`/sprints/${sprintId}/close`, {
    method: "PATCH",
  })
  return res.json()
}
