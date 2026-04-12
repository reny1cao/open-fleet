import type { Task } from "../../lib/types"
import { cn } from "../../lib/cn"
import { elapsed, truncate } from "../../lib/format"
import { GripVertical } from "lucide-react"

const STATUS_ACCENT: Record<string, string> = {
  backlog: "border-accent-gray",
  open: "border-accent-gray",
  in_progress: "border-accent-green",
  review: "border-accent-blue",
  verify: "border-accent-blue",
  blocked: "border-accent-red",
  done: "border-accent-green",
  cancelled: "border-accent-gray",
}

const PRIORITY_STYLE: Record<string, { badge: string; label: string }> = {
  urgent: { badge: "bg-status-red/20 text-status-red", label: "URG" },
  high: { badge: "bg-status-amber/20 text-status-amber", label: "HI" },
  normal: { badge: "bg-status-gray/20 text-status-gray", label: "NOR" },
  low: { badge: "bg-status-gray/20 text-muted", label: "LOW" },
}

function isStale(task: Task): boolean {
  const now = Date.now()
  if (task.status === "in_progress" && task.startedAt) {
    return now - new Date(task.startedAt).getTime() > 4 * 3600_000
  }
  if (task.status === "review" && task.updatedAt) {
    return now - new Date(task.updatedAt).getTime() > 2 * 3600_000
  }
  if (task.status === "blocked" && task.updatedAt) {
    return now - new Date(task.updatedAt).getTime() > 1 * 3600_000
  }
  return false
}

interface Props {
  task: Task
  onDragStart: (taskId: string) => void
  isDragging: boolean
}

export function TaskCard({ task, onDragStart, isDragging }: Props) {
  const stale = isStale(task)
  const accent = STATUS_ACCENT[task.status] ?? "border-accent-gray"
  const priority = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.normal

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        onDragStart(task.id)
      }}
      className={cn(
        "bg-surface border border-border rounded-card p-12px transition-all",
        "cursor-grab active:cursor-grabbing",
        accent,
        stale && "ring-1 ring-status-amber/40",
        isDragging && "opacity-40 scale-95",
      )}
    >
      {/* Header: grip + priority + ID */}
      <div className="flex items-center gap-4px">
        <GripVertical className="w-[14px] h-[14px] text-muted flex-shrink-0" />
        <span className={cn("text-caption px-4px py-px rounded-card font-medium", priority.badge)}>
          {priority.label}
        </span>
        <span className="font-mono text-mono text-muted">{task.id}</span>
      </div>

      {/* Title */}
      <p className="mt-4px text-body text-primary line-clamp-2 leading-tight">
        {truncate(task.title, 80)}
      </p>

      {/* Footer: assignee + elapsed */}
      <div className="mt-8px flex items-center justify-between">
        <span className="text-caption text-secondary truncate">
          {task.assignee ?? "unassigned"}
        </span>
        {task.startedAt && (
          <span className="text-mono font-mono text-muted tabular-nums flex-shrink-0 ml-4px">
            {elapsed(task.startedAt)}
          </span>
        )}
      </div>

      {/* Blocked reason */}
      {task.status === "blocked" && task.blockedReason && (
        <p className="mt-4px text-caption text-status-red leading-tight">
          {truncate(task.blockedReason, 60)}
        </p>
      )}
    </div>
  )
}
