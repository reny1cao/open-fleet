import type { Sprint } from "../../lib/types"

interface Props {
  sprint: Sprint | null
  stats: { total: number; done: number; blocked: number; inProgress: number; open: number } | null
}

export function SprintBar({ sprint, stats }: Props) {
  if (!sprint || !stats) {
    return (
      <div className="px-16px py-16px">
        <div className="text-center py-24px">
          <p className="text-body text-secondary">No active sprint</p>
          <p className="text-caption text-muted mt-4px">Create a sprint to track time-boxed progress</p>
        </div>
      </div>
    )
  }

  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
  const endDate = new Date(sprint.endDate)
  const now = new Date()
  const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / 86_400_000))

  return (
    <div className="px-16px py-12px">
      <div className="flex items-baseline justify-between mb-8px">
        <h2 className="text-section">{sprint.name}</h2>
        <span className="text-mono text-muted font-mono">{daysLeft}d left</span>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-8px">
        <div className="flex-1 h-2 bg-border-subtle rounded-card overflow-hidden">
          <div
            className="h-full bg-status-green rounded-card transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-caption text-secondary font-mono tabular-nums min-w-[48px] text-right">
          {stats.done}/{stats.total}
        </span>
      </div>
    </div>
  )
}
