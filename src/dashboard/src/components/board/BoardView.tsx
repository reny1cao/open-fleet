import { useState, useRef, useCallback } from "react"
import { useFleetStore } from "../../hooks/use-fleet-store"
import type { Task, TaskStatus } from "../../lib/types"
import { api } from "../../lib/api"
import { BoardColumn } from "./BoardColumn"
import { CreateTaskSheet } from "./CreateTaskSheet"
import { cn } from "../../lib/cn"

/* ── Valid status transitions (mirrors server) ── */

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

/* ── Column definitions ── */

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "verify", label: "VERIFY", color: "blue" },
  { status: "review", label: "REVIEW", color: "blue" },
  { status: "in_progress", label: "IN PROGRESS", color: "green" },
  { status: "blocked", label: "BLOCKED", color: "red" },
  { status: "open", label: "OPEN", color: "gray" },
  { status: "backlog", label: "BACKLOG", color: "gray" },
]

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/* ── Component ── */

export function BoardView() {
  const tasks = useFleetStore((s) => s.tasks ?? [])
  const sprints = useFleetStore((s) => s.sprints ?? [])
  const updateTask = useFleetStore((s) => s.updateTask)

  const [sprintFilter, setSprintFilter] = useState<string>("all")
  const [mobileColumn, setMobileColumn] = useState(2) // Start at IN PROGRESS
  const [showCreate, setShowCreate] = useState(false)
  const [createInStatus, setCreateInStatus] = useState<TaskStatus>("open")
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const touchStartX = useRef(0)

  /* ── Filtering ── */

  const active = (tasks ?? []).filter(
    (t) => t?.status !== "done" && t?.status !== "cancelled",
  )
  const filtered = active.filter((t) => {
    if (sprintFilter !== "all" && t?.sprintId !== sprintFilter) return false
    return true
  })

  /* ── Sorting helper ── */

  const tasksForColumn = (status: TaskStatus): Task[] =>
    filtered
      .filter((t) => t?.status === status)
      .sort((a, b) => (PRIORITY_ORDER[a?.priority] ?? 2) - (PRIORITY_ORDER[b?.priority] ?? 2))

  /* ── Drag & drop handlers ── */

  const handleDragStart = useCallback((taskId: string) => {
    setDragTaskId(taskId)
    setDropError(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }, [])

  const handleDrop = useCallback(
    async (targetStatus: TaskStatus) => {
      if (!dragTaskId) return
      const task = (tasks ?? []).find((t) => t?.id === dragTaskId)
      if (!task || task.status === targetStatus) {
        setDragTaskId(null)
        return
      }

      const valid = VALID_TRANSITIONS[task.status] ?? []
      if (!valid.includes(targetStatus)) {
        setDropError(`Cannot move ${task.id} from ${task.status} to ${targetStatus}`)
        setTimeout(() => setDropError(null), 3000)
        setDragTaskId(null)
        return
      }

      try {
        const updated = await api.updateTask(task.id, { status: targetStatus })
        updateTask(updated)
      } catch (err) {
        setDropError(
          `Failed to update ${task.id}: ${err instanceof Error ? err.message : "unknown error"}`,
        )
        setTimeout(() => setDropError(null), 3000)
      }
      setDragTaskId(null)
    },
    [dragTaskId, tasks, updateTask],
  )

  /* ── Mobile swipe ── */

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? 0
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const endX = e.changedTouches[0]?.clientX ?? 0
      const diff = endX - touchStartX.current
      if (Math.abs(diff) > 60) {
        if (diff < 0 && mobileColumn < COLUMNS.length - 1) setMobileColumn((c) => c + 1)
        if (diff > 0 && mobileColumn > 0) setMobileColumn((c) => c - 1)
      }
    },
    [mobileColumn],
  )

  /* ── Create task from column ── */

  const handleCreateInColumn = (status: TaskStatus) => {
    setCreateInStatus(status)
    setShowCreate(true)
  }

  return (
    <div className="max-w-[1400px] mx-auto px-16px py-12px">
      {/* ── Header / filters ── */}
      <div className="flex flex-wrap items-center gap-8px mb-12px">
        <h2 className="text-section text-primary mr-8px">Board</h2>

        {/* Sprint filter */}
        {(sprints ?? []).length > 0 && (
          <select
            value={sprintFilter}
            onChange={(e) => setSprintFilter(e.target.value)}
            className="text-caption px-8px py-4px rounded-card border border-border bg-surface text-secondary focus:outline-none focus:ring-1 focus:ring-status-blue"
          >
            <option value="all">All sprints</option>
            {(sprints ?? []).map((s) => (
              <option key={s?.id} value={s?.id}>{s?.name}</option>
            ))}
          </select>
        )}

        <div className="flex-1" />

        {/* Task count */}
        <span className="text-caption text-muted tabular-nums">
          {filtered.length} task{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Error toast ── */}
      {dropError && (
        <div className="mb-12px px-12px py-8px bg-status-red/20 border border-status-red/30 rounded-card text-caption text-status-red flex items-center justify-between">
          <span>{dropError}</span>
          <button
            onClick={() => setDropError(null)}
            className="ml-8px text-status-red hover:text-status-red/70"
          >
            <span className="text-body">&times;</span>
          </button>
        </div>
      )}

      {/* ── Mobile: single column with swipe ── */}
      <div className="md:hidden">
        {/* Indicator dots */}
        <div className="flex justify-center gap-8px mb-12px">
          {COLUMNS.map((col, i) => {
            const count = tasksForColumn(col.status).length
            return (
              <button
                key={col.status}
                onClick={() => setMobileColumn(i)}
                className={cn(
                  "w-[8px] h-[8px] rounded-full transition-colors",
                  i === mobileColumn
                    ? "bg-status-blue"
                    : count > 0
                      ? "bg-status-gray"
                      : "bg-border",
                )}
                title={`${col.label} (${count})`}
              />
            )
          })}
        </div>

        {/* Swipeable area */}
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="min-h-[60vh]"
        >
          {COLUMNS[mobileColumn] && (
            <BoardColumn
              column={COLUMNS[mobileColumn]}
              tasks={tasksForColumn(COLUMNS[mobileColumn].status)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              dragTaskId={dragTaskId}
              onCreateTask={handleCreateInColumn}
            />
          )}
        </div>
      </div>

      {/* ── Desktop: 6-column grid ── */}
      <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-6 gap-8px">
        {COLUMNS.map((col) => (
          <BoardColumn
            key={col.status}
            column={col}
            tasks={tasksForColumn(col.status)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            dragTaskId={dragTaskId}
            onCreateTask={handleCreateInColumn}
          />
        ))}
      </div>

      {/* ── Create task sheet ── */}
      {showCreate && (
        <CreateTaskSheet
          defaultStatus={createInStatus}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}
