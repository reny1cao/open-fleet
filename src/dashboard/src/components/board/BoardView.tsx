import { useState, useRef, useCallback } from "react"
import { useFleetStore } from "../../hooks/use-fleet-store"
import type { Task, TaskStatus } from "../../lib/types"
import { TaskCard } from "./TaskCard"
import { CreateTaskForm } from "./CreateTaskForm"
import { api } from "../../lib/api"

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["open", "in_progress", "cancelled"],
  open: ["backlog", "in_progress", "cancelled", "blocked"],
  in_progress: ["review", "done", "blocked", "cancelled"],
  review: ["verify", "in_progress", "blocked", "cancelled"],
  verify: ["done", "in_progress", "blocked", "cancelled"],
  blocked: ["open", "in_progress", "cancelled"],
  done: ["open"],
  cancelled: [],
}

const columns: { status: TaskStatus; label: string; color: string }[] = [
  { status: "verify", label: "VERIFY", color: "border-t-blue-500" },
  { status: "review", label: "REVIEW", color: "border-t-purple-500" },
  { status: "in_progress", label: "IN PROGRESS", color: "border-t-green-500" },
  { status: "blocked", label: "BLOCKED", color: "border-t-red-500" },
  { status: "open", label: "OPEN", color: "border-t-gray-400" },
  { status: "backlog", label: "BACKLOG", color: "border-t-gray-300" },
]

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

export function BoardView() {
  const tasks = useFleetStore((s) => s.tasks ?? [])
  const sprints = useFleetStore((s) => s.sprints ?? [])
  const updateTask = useFleetStore((s) => s.updateTask)
  const [sprintFilter, setSprintFilter] = useState<string>("all")
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const [mobileColumn, setMobileColumn] = useState(2) // Start at IN PROGRESS
  const [showCreate, setShowCreate] = useState(false)
  const [createInStatus, setCreateInStatus] = useState<TaskStatus>("open")
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const touchStartX = useRef(0)

  const active = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")
  const filtered = active.filter((t) => {
    if (sprintFilter !== "all" && t.sprintId !== sprintFilter) return false
    if (projectFilter !== "all" && t.project !== projectFilter) return false
    return true
  })

  const projects = [...new Set(active.map((t) => t.project).filter(Boolean))] as string[]

  // Drag and drop handlers
  const handleDragStart = useCallback((taskId: string) => {
    setDragTaskId(taskId)
    setDropError(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }, [])

  const handleDrop = useCallback(async (targetStatus: TaskStatus) => {
    if (!dragTaskId) return
    const task = tasks.find((t) => t.id === dragTaskId)
    if (!task || task.status === targetStatus) {
      setDragTaskId(null)
      return
    }

    const valid = VALID_TRANSITIONS[task.status]
    if (!valid?.includes(targetStatus)) {
      setDropError(`Cannot move ${task.id} from ${task.status} to ${targetStatus}`)
      setTimeout(() => setDropError(null), 3000)
      setDragTaskId(null)
      return
    }

    try {
      const updated = await api.updateTask(task.id, { status: targetStatus })
      updateTask(updated)
    } catch (err) {
      setDropError(`Failed to update ${task.id}: ${err instanceof Error ? err.message : "unknown error"}`)
      setTimeout(() => setDropError(null), 3000)
    }
    setDragTaskId(null)
  }, [dragTaskId, tasks, updateTask])

  // Mobile swipe
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(diff) > 60) {
      if (diff < 0 && mobileColumn < columns.length - 1) setMobileColumn((c) => c + 1)
      if (diff > 0 && mobileColumn > 0) setMobileColumn((c) => c - 1)
    }
  }, [mobileColumn])

  const handleCreateInColumn = (status: TaskStatus) => {
    setCreateInStatus(status)
    setShowCreate(true)
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-3">
      {/* Header: filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold mr-2">Board</h2>

        {/* Sprint filter */}
        {sprints.length > 0 && (
          <select
            value={sprintFilter}
            onChange={(e) => setSprintFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <option value="all">All sprints</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}

        {/* Project filter */}
        {projects.length > 1 && (
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}

        <div className="flex-1" />

        {/* Task count */}
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {filtered.length} tasks
        </span>
      </div>

      {/* Drop error toast */}
      {dropError && (
        <div className="mb-3 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
          {dropError}
        </div>
      )}

      {/* Mobile: column indicator dots + swipe */}
      <div className="md:hidden">
        <div className="flex justify-center gap-1.5 mb-3">
          {columns.map((col, i) => {
            const count = filtered.filter((t) => t.status === col.status).length
            return (
              <button
                key={col.status}
                onClick={() => setMobileColumn(i)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === mobileColumn ? "bg-blue-500" : count > 0 ? "bg-gray-400 dark:bg-gray-500" : "bg-gray-200 dark:bg-gray-700"
                }`}
                title={`${col.label} (${count})`}
              />
            )
          })}
        </div>
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="min-h-[60vh]"
        >
          <BoardColumn
            column={columns[mobileColumn]}
            tasks={filtered
              .filter((t) => t.status === columns[mobileColumn].status)
              .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2))}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            dragTaskId={dragTaskId}
            onCreateTask={handleCreateInColumn}
          />
        </div>
      </div>

      {/* Desktop: all columns */}
      <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-6 gap-3">
        {columns.map((col) => (
          <BoardColumn
            key={col.status}
            column={col}
            tasks={filtered
              .filter((t) => t.status === col.status)
              .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2))}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            dragTaskId={dragTaskId}
            onCreateTask={handleCreateInColumn}
          />
        ))}
      </div>

      {/* Create task modal */}
      {showCreate && (
        <CreateTaskForm
          defaultStatus={createInStatus}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}

// --- Board Column ---

interface BoardColumnProps {
  column: { status: TaskStatus; label: string; color: string }
  tasks: Task[]
  onDragStart: (taskId: string) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (status: TaskStatus) => void
  dragTaskId: string | null
  onCreateTask: (status: TaskStatus) => void
}

function BoardColumn({ column, tasks, onDragStart, onDragOver, onDrop, dragTaskId, onCreateTask }: BoardColumnProps) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      className={`min-h-[200px] rounded-lg transition-colors border-t-2 ${column.color} ${
        dragOver ? "bg-blue-50/50 dark:bg-blue-900/10" : ""
      }`}
      onDragOver={(e) => {
        onDragOver(e)
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => {
        setDragOver(false)
        onDrop(column.status)
      }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{column.label}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">({tasks.length})</span>
        </div>
        <button
          onClick={() => onCreateTask(column.status)}
          className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          title="Create task"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      {/* Cards */}
      <div className="px-1.5 pb-2 space-y-1.5">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onDragStart={onDragStart}
            isDragging={dragTaskId === task.id}
          />
        ))}
      </div>
    </div>
  )
}
