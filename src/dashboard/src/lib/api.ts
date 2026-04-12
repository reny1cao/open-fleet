import type { Agent, Task, ActivityEvent, Sprint } from "./types"

const TOKEN_KEY = "fleet_token"

// Token resolution: URL param (one-time) → localStorage (persistent)
// If token is in URL, save to localStorage and strip from URL
const urlToken = new URLSearchParams(window.location.search).get("token")
if (urlToken) {
  localStorage.setItem(TOKEN_KEY, urlToken)
  window.history.replaceState({}, "", window.location.pathname)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function hasToken(): boolean {
  return !!getToken()
}

/** Validate a token by calling an authenticated endpoint. Returns true if valid. */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await fetch("/tasks/stats", {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

function headers(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: headers() })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const api = {
  fetchAgents: async () => {
    const res = await get<{ agents: Agent[]; stale: boolean }>("/agents/summary")
    return Array.isArray(res.agents) ? res.agents : Array.isArray(res) ? res as Agent[] : []
  },
  fetchAgentsLive: () => get<Agent[]>("/agents"),
  fetchTasks: () => get<Task[]>("/tasks"),
  fetchActivity: async (since = "4h", limit = 50) => {
    const res = await get<{ events: ActivityEvent[] } | ActivityEvent[]>(`/activity?since=${since}&limit=${limit}`)
    return Array.isArray(res) ? res : Array.isArray(res.events) ? res.events : []
  },
  fetchSprints: () => get<Sprint[]>("/sprints"),

  updateTask: (id: string, body: Record<string, unknown>) => patch<Task>(`/tasks/${id}`, body),
  createTask: (body: Record<string, unknown>) => post<Task>("/tasks", body),
  restartAgent: (name: string) => post<{ agent: string; status: string }>(`/agents/${name}/restart`, {}),

  eventsUrl: () => {
    const token = getToken()
    return token ? `/events?token=${token}` : "/events"
  },
}
