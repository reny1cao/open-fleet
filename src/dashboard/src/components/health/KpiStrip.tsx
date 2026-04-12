import type { Agent, Task } from "../../lib/types"

interface Props {
  agents: Agent[]
  tasks: Task[]
}

export function KpiStrip({ agents, tasks }: Props) {
  const alive = agents.filter((a) => a.status === "alive").length
  const stale = agents.filter((a) => a.status === "stale").length
  const dead = agents.filter((a) => a.status === "dead").length
  const blocked = tasks.filter((t) => t.status === "blocked").length

  return (
    <div className="flex gap-24px px-16px py-12px overflow-x-auto">
      <Kpi value={alive} label="Alive" color="text-status-green" />
      {stale > 0 && <Kpi value={stale} label="Stale" color="text-status-amber" />}
      {dead > 0 && <Kpi value={dead} label="Dead" color="text-status-red" />}
      <Kpi value={blocked} label="Blocked" color={blocked > 0 ? "text-status-red" : "text-text-muted"} />
    </div>
  )
}

function Kpi({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-2px min-w-0">
      <span className={`text-kpi tabular-nums ${color}`}>{value}</span>
      <span className="text-caption text-muted">{label}</span>
    </div>
  )
}
