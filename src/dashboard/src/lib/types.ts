export type AgentStatus = "alive" | "stale" | "dead" | "off" | "unknown"
export type TaskStatus = "backlog" | "open" | "in_progress" | "review" | "verify" | "done" | "blocked" | "cancelled"
export type TaskPriority = "low" | "normal" | "high" | "urgent"

export interface Agent {
  name: string
  role: string
  server: string
  workspace: string
  channels: string[]
  status: AgentStatus
  heartbeat: {
    state: string
    lastSeen: string | null
    ageSec: number | null
  }
  watchdog: {
    lastHealthy: string | null
    consecutiveFailures: number
    lastRestart: string | null
    outputStaleCount: number
  }
  activeTasks: { id: string; title: string; status: TaskStatus; priority: TaskPriority; startedAt?: string }[]
  recentActivity: { timestamp: string; taskId: string; type: string; text: string }[]
  dailyStats: { completed: number; events: number }
}

export interface TaskNote {
  timestamp: string
  author: string
  type: string
  text: string
  oldValue?: string
  newValue?: string
}

export interface TaskResult {
  summary?: string
  commits?: string[]
  filesChanged?: string[]
  prUrl?: string
  testsPassed?: boolean
}

export interface Task {
  id: string
  title: string
  description?: string
  createdBy: string
  assignee?: string
  project?: string
  workspace?: string
  status: TaskStatus
  priority: TaskPriority
  blockedReason?: string
  parentId?: string
  dependsOn?: string[]
  result?: TaskResult
  sprintId?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  notes: TaskNote[]
}

export interface Sprint {
  id: string
  name: string
  startDate: string
  endDate: string
  goals?: string[]
  status: "active" | "closed"
  createdAt: string
  closedAt?: string
}

export interface ActivityEvent {
  timestamp: string
  agent: string
  taskId: string
  taskTitle: string
  type: string
  text: string
}

export interface ClassifiedError {
  category: string
  severity: "info" | "warning" | "critical" | "fatal"
  recovery: string
  retryable: boolean
  message: string
  needsHuman: boolean
  affectedAgent?: string
  rawError: string
}

export type View = "health" | "progress" | "board" | "timeline"
