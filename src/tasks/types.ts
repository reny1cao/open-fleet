export type TaskStatus = "backlog" | "open" | "in_progress" | "review" | "verify" | "done" | "blocked" | "cancelled"
export type TaskPriority = "low" | "normal" | "high" | "urgent"

export type TaskNoteType = "comment" | "status_change" | "assignment" | "priority_change"

export interface TaskNote {
  timestamp: string
  author: string
  type: TaskNoteType
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
  [key: string]: unknown
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

  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string

  notes: TaskNote[]
}

export interface TaskStore {
  version: 1
  fleet: string
  nextId: number
  tasks: Task[]
}

// Valid status transitions
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["open", "in_progress", "cancelled"],
  open: ["in_progress", "cancelled", "blocked"],
  in_progress: ["review", "done", "blocked", "cancelled"],
  review: ["verify", "in_progress", "blocked", "cancelled"],
  verify: ["done", "in_progress", "blocked", "cancelled"],
  blocked: ["open", "in_progress", "cancelled"],
  done: ["open"],
  cancelled: [],
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function validTransitionsFrom(status: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[status] ?? []
}

/** Build a helpful error message for an invalid transition, suggesting the shortest valid path. */
export function transitionError(from: TaskStatus, to: TaskStatus): string {
  const valid = validTransitionsFrom(from)
  const validList = valid.length > 0 ? valid.join(", ") : "none (terminal state)"

  // Find a 1-hop path: from → X → to
  const intermediate = valid.find(mid => VALID_TRANSITIONS[mid]?.includes(to))
  const hint = intermediate
    ? `\nHint: ${from} → ${intermediate} → ${to}`
    : ""

  return `Invalid transition: ${from} → ${to}. Valid from ${from}: ${validList}${hint}`
}
