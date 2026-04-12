import { create } from "zustand"
import type { Agent, Task, ActivityEvent, Sprint, ClassifiedError } from "../lib/types"
import { api } from "../lib/api"

type ConnectionState = "connected" | "silent" | "degraded" | "offline"
type View = "health" | "progress" | "board" | "timeline"

interface FleetStore {
  // Data
  agents: Agent[]
  tasks: Task[]
  activity: ActivityEvent[]
  sprints: Sprint[]
  alerts: ClassifiedError[]

  // Connection
  connected: boolean
  connectionState: ConnectionState
  lastUpdatedTs: string | null

  // UI
  view: View
  loading: boolean

  // Lifecycle
  reset: () => void
  fetchAll: () => Promise<void>

  // Data mutations
  setAgents: (agents: Agent[]) => void
  updateTask: (task: Task) => void
  updateAgent: (partial: { name: string } & Partial<Agent>) => void
  pushActivity: (event: ActivityEvent) => void
  pushAlert: (error: ClassifiedError) => void
  dismissAlert: (index: number) => void

  // UI mutations
  setView: (view: View) => void
  setConnected: (connected: boolean) => void
  setConnectionState: (state: ConnectionState) => void
  setLastUpdatedTs: (ts: string) => void
}

const INITIAL_VIEW = (localStorage.getItem("fleet_view") as View) ?? "health"

export const useFleetStore = create<FleetStore>((set) => ({
  agents: [],
  tasks: [],
  activity: [],
  sprints: [],
  alerts: [],

  connected: false,
  connectionState: "offline",
  lastUpdatedTs: null,

  view: INITIAL_VIEW,
  loading: true,

  reset: () => set({
    agents: [], tasks: [], activity: [], sprints: [], alerts: [],
    connected: false, connectionState: "offline", loading: true, lastUpdatedTs: null,
  }),

  fetchAll: async () => {
    set({ loading: true })
    try {
      const [agents, tasks, activity, sprints] = await Promise.all([
        api.fetchAgents().catch(() => [] as Agent[]),
        api.fetchTasks().catch(() => [] as Task[]),
        api.fetchActivity().catch(() => [] as ActivityEvent[]),
        api.fetchSprints().catch(() => [] as Sprint[]),
      ])
      set({
        agents: agents ?? [],
        tasks: tasks ?? [],
        activity: activity ?? [],
        sprints: sprints ?? [],
        loading: false,
        lastUpdatedTs: new Date().toISOString(),
      })
    } catch {
      set({ loading: false })
    }
  },

  setAgents: (agents) => set({ agents }),

  updateTask: (task) =>
    set((s) => ({
      tasks: (s.tasks ?? []).some((t) => t.id === task.id)
        ? s.tasks.map((t) => (t.id === task.id ? task : t))
        : [...(s.tasks ?? []), task],
    })),

  updateAgent: (partial) =>
    set((s) => ({
      agents: (s.agents ?? []).map((a) => (a.name === partial.name ? { ...a, ...partial } : a)),
    })),

  pushActivity: (event) =>
    set((s) => ({
      activity: [event, ...(s.activity ?? [])].slice(0, 200),
    })),

  pushAlert: (error) =>
    set((s) => ({
      alerts: [error, ...(s.alerts ?? [])].slice(0, 50),
    })),

  dismissAlert: (index) =>
    set((s) => ({
      alerts: (s.alerts ?? []).filter((_, i) => i !== index),
    })),

  setView: (view) => {
    localStorage.setItem("fleet_view", view)
    set({ view })
  },
  setConnected: (connected) => set({ connected }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setLastUpdatedTs: (lastUpdatedTs) => set({ lastUpdatedTs }),
}))
