import { useEffect, useState, useCallback } from "react"
import { useFleetStore } from "./hooks/use-fleet-store"
import { useSSE } from "./hooks/use-sse"
import { hasToken, clearToken } from "./lib/api"
import { Shell } from "./components/layout/Shell"
import { LoginScreen } from "./components/LoginScreen"
import { OperationsView } from "./components/operations/OperationsView"
import { BoardView } from "./components/board/BoardView"
import { TimelineView } from "./components/timeline/TimelineView"
import { SprintView } from "./components/sprint/SprintView"

export function App() {
  const [authenticated, setAuthenticated] = useState(hasToken)
  const view = useFleetStore((s) => s.view)
  const setView = useFleetStore((s) => s.setView)
  const connected = useFleetStore((s) => s.connected)
  const loading = useFleetStore((s) => s.loading)
  const fetchAll = useFleetStore((s) => s.fetchAll)

  // Initial data fetch when authenticated
  useEffect(() => {
    if (authenticated) fetchAll()
  }, [authenticated, fetchAll])

  // SSE connection (only when authenticated)
  useSSE(authenticated)

  const reset = useFleetStore((s) => s.reset)

  const handleSignOut = useCallback(() => {
    clearToken()
    reset()
    setAuthenticated(false)
  }, [reset])

  if (!authenticated) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading fleet data...</div>
      </div>
    )
  }

  return (
    <Shell view={view} onViewChange={setView} connected={connected} onSignOut={handleSignOut}>
      {view === "operations" && <OperationsView />}
      {view === "board" && <BoardView />}
      {view === "timeline" && <TimelineView />}
      {view === "sprint" && <SprintView />}
    </Shell>
  )
}
