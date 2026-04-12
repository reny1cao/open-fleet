import { useFleetStore } from "../../hooks/use-fleet-store"

export function SprintView() {
  const sprints = useFleetStore((s) => s.sprints ?? [])
  const activeSprint = sprints.find((s) => s.status === "active")

  if (!activeSprint) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-4">
        <h2 className="text-sm font-semibold mb-4">Sprint</h2>
        <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-500 text-sm gap-2">
          <p>No active sprint</p>
          <button className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors">
            Create Sprint
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      <h2 className="text-sm font-semibold mb-1">{activeSprint.name}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {activeSprint.startDate} — {activeSprint.endDate}
      </p>
      <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500 text-sm">
        Sprint detail view — Phase 3
      </div>
    </div>
  )
}
