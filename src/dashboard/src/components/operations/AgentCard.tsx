import { useState } from "react"
import type { Agent, ClassifiedError } from "../../lib/types"
import { elapsed, truncate, timeAgo } from "../../lib/format"

const statusColor: Record<string, string> = {
  alive: "bg-fleet-alive",
  stale: "bg-fleet-stale",
  dead: "bg-fleet-dead",
  off: "bg-fleet-off",
  unknown: "bg-fleet-off",
}

const statusLabel: Record<string, string> = {
  alive: "alive",
  stale: "stale",
  dead: "dead",
  off: "offline",
  unknown: "unknown",
}

interface Props {
  agent: Agent
  alerts: ClassifiedError[]
}

export function AgentCard({ agent, alerts }: Props) {
  const [expanded, setExpanded] = useState(false)
  const activeTasks = agent.activeTasks ?? []
  const recentActivity = agent.recentActivity ?? []
  const currentTask = activeTasks[0]
  const agentAlerts = (alerts ?? []).filter((a) => a.affectedAgent === agent.name)
  const hasError = agentAlerts.length > 0
  const worstSeverity = hasError
    ? agentAlerts.some((a) => a.severity === "fatal") ? "fatal"
    : agentAlerts.some((a) => a.severity === "critical") ? "critical"
    : "warning"
    : null
  const lastAction = recentActivity[0]

  return (
    <div className={`bg-white dark:bg-slate-800 rounded-lg border transition-colors ${
      hasError && worstSeverity === "fatal" ? "border-red-400 dark:border-red-600" :
      hasError && worstSeverity === "critical" ? "border-red-300 dark:border-red-700" :
      "border-gray-200 dark:border-slate-700"
    }`}>
      {/* Collapsed row (always visible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor[agent.status] ?? statusColor.unknown}`} />
        <span className="font-medium text-sm min-w-[80px] truncate">{agent.name}</span>

        {/* Current task or idle */}
        {currentTask ? (
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate min-w-0 flex-1">
            {currentTask.id}: {truncate(currentTask.title, 28)}
            {currentTask.startedAt && (
              <span className="text-gray-400 dark:text-gray-500"> {elapsed(currentTask.startedAt)}</span>
            )}
          </span>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500 flex-1">idle</span>
        )}

        {/* Error badge */}
        {hasError && (
          <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
            worstSeverity === "fatal" ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" :
            worstSeverity === "critical" ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" :
            "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
          }`}>
            {agentAlerts.length} err
          </span>
        )}

        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-slate-700 pt-2 space-y-2">
          {/* Agent meta */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="capitalize">{agent.role}</span>
            <span>
              {statusLabel[agent.status] ?? "unknown"}
              {agent.heartbeat?.ageSec != null && agent.status === "alive" && ` ${agent.heartbeat.ageSec}s`}
            </span>
            <span>{agent.server}</span>
            {agent.watchdog?.consecutiveFailures > 0 && (
              <span className="text-red-500 dark:text-red-400">
                {agent.watchdog.consecutiveFailures} consecutive failures
              </span>
            )}
            {agent.watchdog?.lastRestart && (
              <span>last restart {timeAgo(agent.watchdog.lastRestart)}</span>
            )}
          </div>

          {/* Agent errors */}
          {agentAlerts.length > 0 && (
            <div className="space-y-1">
              {agentAlerts.slice(0, 3).map((alert, i) => (
                <div key={i} className="bg-red-50 dark:bg-red-900/20 rounded px-2 py-1.5 text-xs">
                  <span className="font-medium text-red-700 dark:text-red-300">{alert.category}</span>
                  <span className="text-red-600 dark:text-red-400"> — {alert.message}</span>
                  <div className="text-red-500 dark:text-red-500 mt-0.5">
                    Recovery: {alert.recovery}{alert.needsHuman && " (needs human)"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Active tasks */}
          {activeTasks.map((task) => (
            <div
              key={task.id}
              className="bg-gray-50 dark:bg-slate-700/50 rounded px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{task.id}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  task.priority === "urgent" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
                  task.priority === "high" ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300" :
                  "bg-gray-100 dark:bg-slate-600 text-gray-600 dark:text-gray-300"
                }`}>
                  {task.priority.toUpperCase()}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  task.status === "review" ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300" :
                  task.status === "verify" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" :
                  task.status === "blocked" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
                  "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                }`}>
                  {task.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-sm">{task.title}</p>
              {task.startedAt && (
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Started {elapsed(task.startedAt)} ago
                </p>
              )}
            </div>
          ))}

          {activeTasks.length === 0 && !lastAction && (
            <p className="text-xs text-gray-400 dark:text-gray-500">No active tasks</p>
          )}

          {/* Last action */}
          {lastAction && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              <span className="text-gray-400 dark:text-gray-500">Last action:</span>{" "}
              {lastAction.taskId && <span className="font-mono">{lastAction.taskId}</span>}{" "}
              {truncate(lastAction.text, 60)}{" "}
              <span className="text-gray-400 dark:text-gray-500">{timeAgo(lastAction.timestamp)}</span>
            </div>
          )}

          {/* Footer stats */}
          <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-slate-700">
            <span>Done today: <span className="font-medium text-gray-700 dark:text-gray-300">{agent.dailyStats?.completed ?? 0}</span></span>
            <span>Events: <span className="font-medium text-gray-700 dark:text-gray-300">{agent.dailyStats?.events ?? 0}</span></span>
          </div>
        </div>
      )}
    </div>
  )
}
