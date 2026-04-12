import { useFleetStore } from "../../hooks/use-fleet-store"
import { AgentCard } from "./AgentCard"
import { ActivityFeed } from "./ActivityFeed"
import { AlertBanner } from "./AlertBanner"

export function OperationsView() {
  const agents = useFleetStore((s) => s.agents)
  const tasks = useFleetStore((s) => s.tasks)
  const activity = useFleetStore((s) => s.activity)
  const alerts = useFleetStore((s) => s.alerts)
  const sprints = useFleetStore((s) => s.sprints)
  const dismissAlert = useFleetStore((s) => s.dismissAlert)

  const alive = agents.filter((a) => a.status === "alive").length
  const stale = agents.filter((a) => a.status === "stale").length
  const dead = agents.filter((a) => a.status === "dead").length
  const activeTasks = tasks.filter((t) => t.status === "in_progress" || t.status === "review" || t.status === "verify")
  const blockedTasks = tasks.filter((t) => t.status === "blocked")
  const doneTasks = tasks.filter((t) => t.status === "done")
  const activeSprint = sprints.find((s) => s.status === "active")
  const sprintTasks = activeSprint ? tasks.filter((t) => t.sprintId === activeSprint.id) : []
  const sprintDone = sprintTasks.filter((t) => t.status === "done").length

  // Sort agents: alive first, then stale, then dead/off/unknown
  const sortedAgents = [...agents].sort((a, b) => {
    const order: Record<string, number> = { alive: 0, stale: 1, dead: 2, off: 3, unknown: 4 }
    return (order[a.status] ?? 4) - (order[b.status] ?? 4)
  })

  return (
    <div className="max-w-7xl mx-auto px-4 py-3">
      {/* Status summary bar */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-fleet-alive" />
          <span className="font-medium">{alive}</span>
          <span className="text-gray-500 dark:text-gray-400">online</span>
        </div>
        {stale > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-fleet-stale" />
            <span className="font-medium">{stale}</span>
            <span className="text-gray-500 dark:text-gray-400">stale</span>
          </div>
        )}
        {dead > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-fleet-dead" />
            <span className="font-medium">{dead}</span>
            <span className="text-gray-500 dark:text-gray-400">dead</span>
          </div>
        )}
        <span className="text-gray-300 dark:text-gray-600 hidden sm:inline">|</span>
        <span className="text-gray-600 dark:text-gray-300">
          <span className="font-medium">{activeTasks.length}</span> active
        </span>
        {blockedTasks.length > 0 && (
          <span className="text-red-600 dark:text-red-400">
            <span className="font-medium">{blockedTasks.length}</span> blocked
          </span>
        )}
        <span className="text-gray-500 dark:text-gray-400">
          <span className="font-medium">{doneTasks.length}</span> done
        </span>
        {activeSprint && sprintTasks.length > 0 && (
          <>
            <span className="text-gray-300 dark:text-gray-600 hidden sm:inline">|</span>
            <span className="text-gray-600 dark:text-gray-300 text-xs flex items-center gap-1.5">
              {activeSprint.name}:
              <span className="inline-flex items-center gap-1">
                <span className="w-16 h-1.5 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden inline-block">
                  <span
                    className="h-full bg-blue-500 rounded-full block"
                    style={{ width: `${(sprintDone / sprintTasks.length) * 100}%` }}
                  />
                </span>
                <span className="tabular-nums">{sprintDone}/{sprintTasks.length}</span>
              </span>
            </span>
          </>
        )}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && <AlertBanner alerts={alerts} onDismiss={dismissAlert} />}

      {/* Main content: agents + activity */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-6">
        {/* Agent cards */}
        <div className="lg:col-span-2 space-y-1.5">
          {sortedAgents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} alerts={alerts} />
          ))}
          {agents.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
              No agents registered
            </p>
          )}
        </div>

        {/* Activity feed */}
        <div className="mt-4 lg:mt-0 lg:sticky lg:top-4 lg:self-start">
          <ActivityFeed events={activity} />
        </div>
      </div>
    </div>
  )
}
