import { useState } from "react"
import type { Agent, ClassifiedError } from "../../lib/types"
import { elapsed, truncate, timeAgo } from "../../lib/format"
import { ChevronRight, AlertTriangle, RotateCcw } from "lucide-react"
import { api } from "../../lib/api"

const statusAccent: Record<string, string> = {
  alive: "border-accent-green",
  stale: "border-accent-amber",
  dead: "border-accent-red",
  off: "border-accent-gray",
  unknown: "border-accent-gray",
}

const statusShape: Record<string, string> = {
  alive: "\u25cf",    // filled circle
  stale: "\u25d1",    // half circle
  dead: "\u2715",     // X
  off: "\u25cb",      // empty circle
  unknown: "\u25cb",
}

interface Props {
  agent: Agent
  alerts: ClassifiedError[]
}

export function AgentRow({ agent, alerts }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const activeTasks = agent.activeTasks ?? []
  const recentActivity = agent.recentActivity ?? []
  const currentTask = activeTasks[0]
  const agentAlerts = (alerts ?? []).filter((a) => a.affectedAgent === agent.name)
  const lastAction = recentActivity[0]

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await api.restartAgent(agent.name)
    } catch {
      // Error handled silently — agent status will update via SSE
    }
    setRestarting(false)
  }

  return (
    <div className={`bg-surface rounded-card ${statusAccent[agent.status] ?? statusAccent.unknown}`}>
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-8px px-12px py-8px text-left"
      >
        {/* Status shape */}
        <span className={`text-caption flex-shrink-0 w-4 text-center ${
          agent.status === "alive" ? "text-status-green" :
          agent.status === "stale" ? "text-status-amber" :
          agent.status === "dead" ? "text-status-red" :
          "text-status-gray"
        }`}>
          {statusShape[agent.status] ?? statusShape.unknown}
        </span>

        {/* Name */}
        <span className="text-body font-medium min-w-[72px] truncate">{agent.name}</span>

        {/* Current task */}
        {currentTask ? (
          <span className="text-caption text-secondary truncate flex-1 min-w-0">
            <span className="font-mono text-muted">{currentTask.id}</span>
            {" "}
            {truncate(currentTask.title, 40)}
          </span>
        ) : (
          <span className="text-caption text-muted flex-1">idle</span>
        )}

        {/* Elapsed time */}
        {currentTask?.startedAt && (
          <span className="text-mono text-muted flex-shrink-0 font-mono">
            {elapsed(currentTask.startedAt)}
          </span>
        )}

        {/* Error badge */}
        {agentAlerts.length > 0 && (
          <span className="flex items-center gap-2px text-caption text-status-red flex-shrink-0">
            <AlertTriangle size={12} />
            {agentAlerts.length}
          </span>
        )}

        {/* Chevron */}
        <ChevronRight
          size={14}
          className={`text-muted flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-12px pb-12px space-y-8px border-t border-border">
          {/* Meta */}
          <div className="flex flex-wrap gap-x-12px gap-y-2px pt-8px text-caption text-muted">
            <span>{agent.role}</span>
            <span>
              {agent.status}
              {agent.heartbeat?.ageSec != null && agent.status === "alive" && ` ${agent.heartbeat.ageSec}s`}
            </span>
            <span>{agent.server}</span>
            {agent.watchdog?.consecutiveFailures > 0 && (
              <span className="text-status-red">{agent.watchdog.consecutiveFailures} failures</span>
            )}
            {agent.watchdog?.lastRestart && (
              <span>restart {timeAgo(agent.watchdog.lastRestart)}</span>
            )}
          </div>

          {/* Errors */}
          {agentAlerts.length > 0 && (
            <div className="space-y-4px">
              {agentAlerts.slice(0, 3).map((alert, i) => (
                <div key={i} className="px-8px py-4px rounded-card bg-[#1a0000] text-caption">
                  <span className="font-medium text-status-red">{alert.category}</span>
                  <span className="text-secondary"> — {alert.message}</span>
                  <div className="text-muted mt-2px">
                    {alert.recovery}{alert.needsHuman && " \u00b7 needs human"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Active tasks */}
          {activeTasks.map((task) => (
            <div key={task.id} className="px-8px py-8px rounded-card bg-[#0d0d0d]">
              <div className="flex items-center gap-8px">
                <span className="font-mono text-caption text-muted">{task.id}</span>
                <span className={`text-[10px] px-4px py-0.5 rounded-card font-medium ${
                  task.priority === "urgent" ? "bg-status-red/20 text-status-red" :
                  task.priority === "high" ? "bg-status-amber/20 text-status-amber" :
                  "bg-[#1a1a1a] text-secondary"
                }`}>
                  {task.priority.toUpperCase()}
                </span>
                <span className={`text-[10px] px-4px py-0.5 rounded-card ${
                  task.status === "review" ? "bg-status-amber/20 text-status-amber" :
                  task.status === "verify" ? "bg-status-blue/20 text-status-blue" :
                  task.status === "blocked" ? "bg-status-red/20 text-status-red" :
                  "bg-status-green/20 text-status-green"
                }`}>
                  {task.status.replace("_", " ")}
                </span>
              </div>
              <p className="text-body mt-4px">{task.title}</p>
              {task.startedAt && (
                <p className="text-caption text-muted mt-2px font-mono">{elapsed(task.startedAt)} ago</p>
              )}
            </div>
          ))}

          {activeTasks.length === 0 && !lastAction && (
            <p className="text-caption text-muted">No active tasks</p>
          )}

          {/* Last action */}
          {lastAction && (
            <div className="text-caption text-muted">
              Last: {lastAction.taskId && <span className="font-mono">{lastAction.taskId}</span>}{" "}
              {truncate(lastAction.text, 50)}{" "}
              <span className="text-text-muted">{timeAgo(lastAction.timestamp)}</span>
            </div>
          )}

          {/* Footer: stats + actions */}
          <div className="flex items-center justify-between pt-4px border-t border-border">
            <div className="text-caption text-muted">
              Done: <span className="text-secondary font-mono">{agent.dailyStats?.completed ?? 0}</span>
              {" \u00b7 "}
              Events: <span className="text-secondary font-mono">{agent.dailyStats?.events ?? 0}</span>
            </div>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-4px text-caption text-muted hover:text-status-amber transition-colors disabled:opacity-40"
            >
              <RotateCcw size={12} className={restarting ? "animate-spin" : ""} />
              {restarting ? "Restarting..." : "Restart"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
