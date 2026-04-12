import type { Task } from "../../lib/types"

interface Props {
  tasks: Task[]
}

const pills: { status: string; label: string; color: string }[] = [
  { status: "in_progress", label: "In Progress", color: "bg-status-green/20 text-status-green" },
  { status: "review", label: "Review", color: "bg-status-amber/20 text-status-amber" },
  { status: "blocked", label: "Blocked", color: "bg-status-red/20 text-status-red" },
  { status: "open", label: "Open", color: "bg-[#1a1a1a] text-secondary" },
]

export function StatusCounts({ tasks }: Props) {
  const active = (tasks ?? []).filter((t) => t.status !== "done" && t.status !== "cancelled")

  return (
    <div className="px-16px py-8px">
      <div className="flex flex-wrap gap-8px">
        {pills.map(({ status, label, color }) => {
          const count = active.filter((t) => t.status === status).length
          return (
            <div
              key={status}
              className={`flex items-center gap-4px px-8px py-4px rounded-card text-caption font-medium ${color}`}
            >
              <span className="font-mono tabular-nums">{count}</span>
              <span>{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
