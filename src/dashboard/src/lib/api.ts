import type { Agent, Task, ActivityEvent, Sprint } from "./types"

// Cache token at module load — Shell strips it from URL via history.replaceState
const token = new URLSearchParams(window.location.search).get("token")

function getToken(): string | null {
  return token
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
  fetchAgents: () => get<Agent[]>("/agents/summary"),
  fetchAgentsLive: () => get<Agent[]>("/agents"),
  fetchTasks: () => get<Task[]>("/tasks"),
  fetchActivity: (since = "4h", limit = 50) =>
    get<ActivityEvent[]>(`/activity?since=${since}&limit=${limit}`),
  fetchSprints: () => get<Sprint[]>("/sprints"),

  updateTask: (id: string, body: Record<string, unknown>) => patch<Task>(`/tasks/${id}`, body),
  createTask: (body: Record<string, unknown>) => post<Task>("/tasks", body),
  restartAgent: (name: string) => post<{ agent: string; status: string }>(`/agents/${name}/restart`, {}),

  eventsUrl: () => {
    const token = getToken()
    return token ? `/events?token=${token}` : "/events"
  },
}
