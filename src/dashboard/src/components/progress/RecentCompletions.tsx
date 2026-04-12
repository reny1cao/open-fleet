import type { Task } from "../../lib/types"
import { timeAgo } from "../../lib/format"

interface Props {
  tasks: Task[]
}

export function RecentCompletions({ tasks }: Props) {
  // Tasks completed in the last 24h
  const cutoff = Date.now() - 24 * 3600_000
  const recent = (tasks ?? [])
    .filter((t) => t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() > cutoff)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
    .slice(0, 10)

  return (
    <div className="px-16px py-8px">
      <h3 className="text-caption text-muted mb-8px">
        Completed today ({recent.length})
      </h3>
      {recent.length === 0 ? (
        <p className="text-caption text-muted py-8px">No completions in the last 24h</p>
      ) : (
        <div className="space-y-4px">
          {recent.map((task) => (
            <div key={task.id} className="flex items-baseline gap-8px py-2px">
              <span className="font-mono text-caption text-muted flex-shrink-0">{task.id}</span>
              <span className="text-body text-primary truncate flex-1 min-w-0">{task.title}</span>
              <span className="text-mono text-muted font-mono flex-shrink-0">
                {task.completedAt ? timeAgo(task.completedAt) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
