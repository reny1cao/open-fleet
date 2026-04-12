import { useState } from "react"
import type { Task, TaskStatus } from "../../lib/types"
import { cn } from "../../lib/cn"
import { TaskCard } from "./TaskCard"
import { Plus } from "lucide-react"

const COLUMN_TOP_BORDER: Record<string, string> = {
  verify: "var(--status-blue)",
  review: "var(--status-blue)",
  in_progress: "var(--status-green)",
  blocked: "var(--status-red)",
  open: "var(--status-gray)",
  backlog: "var(--status-gray)",
  done: "var(--status-green)",
  cancelled: "var(--status-gray)",
}

interface Props {
  column: { status: TaskStatus; label: string; color: string }
  tasks: Task[]
  onDragStart: (taskId: string) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (status: TaskStatus) => void
  dragTaskId: string | null
  onCreateTask: (status: TaskStatus) => void
}

export function BoardColumn({ column, tasks, onDragStart, onDragOver, onDrop, dragTaskId, onCreateTask }: Props) {
  const [isDragOver, setIsDragOver] = useState(false)
  const topColor = COLUMN_TOP_BORDER[column.status] ?? "var(--status-gray)"

  return (
    <div
      className={cn(
        "min-h-[200px] rounded-card transition-colors",
        isDragOver && "bg-status-blue/5",
      )}
      style={{ borderTop: `3px solid ${topColor}` }}
      onDragOver={(e) => {
        onDragOver(e)
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={() => {
        setIsDragOver(false)
        onDrop(column.status)
      }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-8px py-8px">
        <div className="flex items-center gap-8px">
          <span className="text-caption font-semibold text-muted uppercase tracking-wide">
            {column.label}
          </span>
          <span className="text-caption text-muted tabular-nums">
            {(tasks ?? []).length}
          </span>
        </div>
        <button
          onClick={() => onCreateTask(column.status)}
          className="w-[24px] h-[24px] flex items-center justify-center rounded-card text-muted hover:text-secondary transition-colors"
          title={`Create task in ${column.label}`}
        >
          <Plus className="w-[14px] h-[14px]" />
        </button>
      </div>

      {/* Cards */}
      <div className="px-4px pb-8px flex flex-col gap-8px">
        {(tasks ?? []).map((task) => (
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
