import { create } from "zustand"
import type { Agent, Task, ActivityEvent, Sprint, ClassifiedError, View } from "../lib/types"
import { api } from "../lib/api"

interface FleetStore {
  // Data
  agents: Agent[]
  tasks: Task[]
  activity: ActivityEvent[]
  sprints: Sprint[]
  alerts: ClassifiedError[]

  // UI state
  view: View
  connected: boolean
  loading: boolean
  lastFetchTs: string | null

  // Actions — lifecycle
  reset: () => void

  // Actions — data
  setAgents: (agents: Agent[]) => void
  setTasks: (tasks: Task[]) => void
  setActivity: (activity: ActivityEvent[]) => void
  setSprints: (sprints: Sprint[]) => void
  updateTask: (task: Task) => void
  updateAgent: (partial: { name: string } & Partial<Agent>) => void
  pushActivity: (event: ActivityEvent) => void
  pushAlert: (error: ClassifiedError) => void
  dismissAlert: (index: number) => void

  // Actions — UI
  setView: (view: View) => void
  setConnected: (connected: boolean) => void

  // Actions — fetch
  fetchAll: () => Promise<void>
}

export const useFleetStore = create<FleetStore>((set, get) => ({
  agents: [],
  tasks: [],
  activity: [],
  sprints: [],
  alerts: [],

  view: "operations",
  connected: false,
  loading: true,
  lastFetchTs: null,

  reset: () => set({ agents: [], tasks: [], activity: [], sprints: [], alerts: [], connected: false, loading: true, lastFetchTs: null }),

  setAgents: (agents) => set({ agents }),
  setTasks: (tasks) => set({ tasks }),
  setActivity: (activity) => set({ activity }),
  setSprints: (sprints) => set({ sprints }),

  updateTask: (task) =>
    set((s) => ({
      tasks: s.tasks.some((t) => t.id === task.id)
        ? s.tasks.map((t) => (t.id === task.id ? task : t))
        : [...s.tasks, task],
    })),

  updateAgent: (partial) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.name === partial.name ? { ...a, ...partial } : a)),
    })),

  pushActivity: (event) =>
    set((s) => ({
      activity: [event, ...s.activity].slice(0, 200),
    })),

  pushAlert: (error) =>
    set((s) => ({
      alerts: [error, ...s.alerts].slice(0, 50),
    })),

  dismissAlert: (index) =>
    set((s) => ({
      alerts: s.alerts.filter((_, i) => i !== index),
    })),

  setView: (view) => set({ view }),
  setConnected: (connected) => set({ connected }),

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
        lastFetchTs: new Date().toISOString(),
      })
    } catch {
      set({ loading: false })
    }
  },
}))
