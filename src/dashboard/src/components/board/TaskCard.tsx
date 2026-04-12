import type { Task } from "../../lib/types"
import { elapsed, truncate } from "../../lib/format"

const priorityStyle: Record<string, string> = {
  urgent: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  high: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
  normal: "bg-gray-100 dark:bg-slate-600 text-gray-600 dark:text-gray-300",
  low: "bg-gray-50 dark:bg-slate-700 text-gray-500 dark:text-gray-400",
}

interface Props {
  task: Task
  onDragStart: (taskId: string) => void
  isDragging: boolean
}

export function TaskCard({ task, onDragStart, isDragging }: Props) {
  const stale =
    (task.status === "in_progress" && task.startedAt && Date.now() - new Date(task.startedAt).getTime() > 4 * 3600_000) ||
    (task.status === "review" && task.updatedAt && Date.now() - new Date(task.updatedAt).getTime() > 2 * 3600_000) ||
    (task.status === "blocked" && task.updatedAt && Date.now() - new Date(task.updatedAt).getTime() > 1 * 3600_000)

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        onDragStart(task.id)
      }}
      className={`bg-white dark:bg-slate-800 rounded-lg border p-2 text-sm cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? "opacity-40 scale-95" : "opacity-100"
      } ${
        stale ? "border-yellow-300 dark:border-yellow-700" : "border-gray-200 dark:border-slate-700"
      } ${
        task.status === "blocked" ? "border-l-2 border-l-red-400" : ""
      }`}
    >
      {/* Header: ID + priority */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{task.id}</span>
        <span className={`text-[10px] px-1 py-px rounded font-medium ${priorityStyle[task.priority] ?? priorityStyle.normal}`}>
          {task.priority === "normal" ? "N" : task.priority[0].toUpperCase()}
        </span>
        {task.dependsOn && task.dependsOn.length > 0 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500" title={`Depends on: ${task.dependsOn.join(", ")}`}>
            dep:{task.dependsOn.length}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="mt-1 text-xs leading-tight">{truncate(task.title, 60)}</p>

      {/* Footer: assignee + time */}
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span className="truncate">{task.assignee ?? "unassigned"}</span>
        {task.startedAt && (
          <span className="tabular-nums flex-shrink-0 ml-1">{elapsed(task.startedAt)}</span>
        )}
      </div>

      {/* Blocked reason */}
      {task.status === "blocked" && task.blockedReason && (
        <p className="mt-1 text-[10px] text-red-600 dark:text-red-400 leading-tight">
          {truncate(task.blockedReason, 50)}
        </p>
      )}
    </div>
  )
}
