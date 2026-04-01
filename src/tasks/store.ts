import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { findConfigDir, loadConfig } from "../core/config"
import type { Task, TaskStore, TaskStatus, TaskPriority, TaskNote, TaskResult } from "./types"
import { isValidTransition } from "./types"

function tasksDir(): string {
  return join(homedir(), ".fleet", "tasks")
}

function tasksFilePath(fleet: string): string {
  return join(tasksDir(), `${fleet}.json`)
}

function defaultStore(fleet: string): TaskStore {
  return { version: 1, fleet, nextId: 1, tasks: [] }
}

export function loadTaskStore(fleet?: string): TaskStore {
  if (!fleet) {
    const configDir = findConfigDir()
    const config = loadConfig(configDir)
    fleet = config.fleet.name
  }
  const filePath = tasksFilePath(fleet)
  if (!existsSync(filePath)) return defaultStore(fleet)
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as TaskStore
    return data
  } catch {
    console.warn(`[tasks] Corrupt task store at ${filePath}, starting fresh`)
    return defaultStore(fleet)
  }
}

export function saveTaskStore(store: TaskStore): void {
  const dir = tasksDir()
  mkdirSync(dir, { recursive: true })
  const filePath = tasksFilePath(store.fleet)
  const tmpPath = filePath + `.tmp.${Date.now()}`
  writeFileSync(tmpPath, JSON.stringify(store, null, 2) + "\n", "utf8")
  renameSync(tmpPath, filePath)
}

function nextTaskId(store: TaskStore): string {
  const id = `task-${String(store.nextId).padStart(3, "0")}`
  store.nextId++
  return id
}

export function createTask(
  store: TaskStore,
  opts: {
    title: string
    assignee?: string
    priority?: TaskPriority
    description?: string
    workspace?: string
    parentId?: string
    dependsOn?: string[]
    createdBy?: string
    project?: string
  }
): Task {
  const now = new Date().toISOString()
  const task: Task = {
    id: nextTaskId(store),
    title: opts.title,
    description: opts.description,
    createdBy: opts.createdBy ?? process.env.FLEET_SELF ?? "human",
    assignee: opts.assignee,
    fleet: store.fleet,
    project: opts.project,
    workspace: opts.workspace,
    status: "open",
    priority: opts.priority ?? "normal",
    parentId: opts.parentId,
    dependsOn: opts.dependsOn,
    createdAt: now,
    updatedAt: now,
    notes: [],
  }
  store.tasks.push(task)
  return task
}

export function updateTask(
  store: TaskStore,
  taskId: string,
  opts: {
    status?: TaskStatus
    note?: string
    result?: TaskResult
    blockedReason?: string
    author?: string
  }
): Task {
  const task = store.tasks.find((t) => t.id === taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const now = new Date().toISOString()
  const author = opts.author ?? process.env.FLEET_SELF ?? "human"

  if (opts.status && opts.status !== task.status) {
    if (!isValidTransition(task.status, opts.status)) {
      throw new Error(`Invalid transition: ${task.status} → ${opts.status}`)
    }
    const oldStatus = task.status
    task.status = opts.status
    task.notes.push({ timestamp: now, author, text: `Status: ${oldStatus} → ${opts.status}` })

    if (opts.status === "in_progress" && !task.startedAt) {
      task.startedAt = now
    }
    if (opts.status === "done") {
      task.completedAt = now
    }
    if (opts.status === "blocked" && opts.blockedReason) {
      task.blockedReason = opts.blockedReason
    }
    if (opts.status !== "blocked") {
      task.blockedReason = undefined
    }
  }

  if (opts.note) {
    task.notes.push({ timestamp: now, author, text: opts.note })
  }

  if (opts.result) {
    task.result = opts.result
  }

  task.updatedAt = now
  return task
}

export function getTask(store: TaskStore, taskId: string): Task | undefined {
  return store.tasks.find((t) => t.id === taskId)
}

export function listTasks(
  store: TaskStore,
  filters?: {
    assignee?: string
    status?: TaskStatus
    project?: string
  }
): Task[] {
  let tasks = store.tasks
  if (filters?.assignee) {
    tasks = tasks.filter((t) => t.assignee === filters.assignee)
  }
  if (filters?.status) {
    tasks = tasks.filter((t) => t.status === filters.status)
  }
  if (filters?.project) {
    tasks = tasks.filter((t) => t.project === filters.project)
  }
  return tasks
}

export function activeTasks(store: TaskStore): Task[] {
  return store.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
}
