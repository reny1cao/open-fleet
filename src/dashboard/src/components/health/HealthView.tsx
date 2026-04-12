import { useFleetStore } from "../../hooks/use-fleet-store"
import { KpiStrip } from "./KpiStrip"
import { AlertBanner } from "./AlertBanner"
import { AgentRow } from "./AgentRow"
import { SkeletonHealthPanel } from "../shared/Skeleton"

const STATUS_SORT: Record<string, number> = {
  dead: 0,
  stale: 1,
  unknown: 2,
  off: 3,
  alive: 4,
}

export function HealthView() {
  const agents = useFleetStore((s) => s.agents ?? [])
  const tasks = useFleetStore((s) => s.tasks ?? [])
  const alerts = useFleetStore((s) => s.alerts ?? [])
  const loading = useFleetStore((s) => s.loading)
  const dismissAlert = useFleetStore((s) => s.dismissAlert)

  if (loading) return <SkeletonHealthPanel />

  // Sort: dead/blocked first, alive last
  const sorted = [...agents].sort((a, b) => {
    const aHasError = (alerts ?? []).some((e) => e.affectedAgent === a.name)
    const bHasError = (alerts ?? []).some((e) => e.affectedAgent === b.name)
    if (aHasError !== bHasError) return aHasError ? -1 : 1
    return (STATUS_SORT[a.status] ?? 3) - (STATUS_SORT[b.status] ?? 3)
  })

  return (
    <div className="max-w-3xl mx-auto">
      <KpiStrip agents={agents} tasks={tasks} />

      <AlertBanner alerts={alerts} onDismiss={dismissAlert} />

      <div className="px-16px space-y-4px pb-24px">
        {sorted.map((agent) => (
          <AgentRow key={agent.name} agent={agent} alerts={alerts} />
        ))}
        {agents.length === 0 && (
          <div className="text-center py-48px">
            <p className="text-body text-secondary">No agents registered</p>
            <p className="text-caption text-muted mt-4px">Agents appear here when they connect</p>
          </div>
        )}
      </div>
    </div>
  )
}
