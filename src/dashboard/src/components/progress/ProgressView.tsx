import { useFleetStore } from "../../hooks/use-fleet-store"
import { SprintBar } from "./SprintBar"
import { GoalsChecklist } from "./GoalsChecklist"
import { RecentCompletions } from "./RecentCompletions"
import { StatusCounts } from "./StatusCounts"
import { Skeleton } from "../shared/Skeleton"

export function ProgressView() {
  const tasks = useFleetStore((s) => s.tasks ?? [])
  const sprints = useFleetStore((s) => s.sprints ?? [])
  const loading = useFleetStore((s) => s.loading)

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-24px py-16px">
        <div className="px-16px space-y-8px">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-2 w-full" />
        </div>
        <div className="px-16px space-y-4px">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
        </div>
        <div className="px-16px space-y-4px">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      </div>
    )
  }

  const activeSprint = sprints.find((s) => s.status === "active") ?? null

  // Compute stats from tasks if sprint exists
  const sprintTasks = activeSprint
    ? tasks.filter((t) => t.sprintId === activeSprint.id)
    : null
  const stats = sprintTasks
    ? {
        total: sprintTasks.length,
        done: sprintTasks.filter((t) => t.status === "done").length,
        blocked: sprintTasks.filter((t) => t.status === "blocked").length,
        inProgress: sprintTasks.filter((t) => t.status === "in_progress").length,
        open: sprintTasks.filter((t) => t.status === "open" || t.status === "backlog").length,
      }
    : null

  // Parse goals: sprint.goals is string[] or possibly a single string
  const goals = activeSprint?.goals

  return (
    <div className="max-w-3xl mx-auto pb-24px">
      <SprintBar sprint={activeSprint} stats={stats} />
      <GoalsChecklist goals={goals} />
      <StatusCounts tasks={tasks} />
      <RecentCompletions tasks={tasks} />
    </div>
  )
}
