import { useEffect, useState, useCallback } from "react"
import { useFleetStore } from "./hooks/use-fleet-store"
import { useConnection } from "./hooks/use-connection"
import { hasToken, clearToken } from "./lib/api"
import { Shell } from "./components/layout/Shell"
import { LoginScreen } from "./components/LoginScreen"
import { HealthView } from "./components/health/HealthView"
import { ProgressView } from "./components/progress/ProgressView"
import { BoardView } from "./components/board/BoardView"
import { TimelineView } from "./components/timeline/TimelineView"

export function App() {
  const [authenticated, setAuthenticated] = useState(hasToken)
  const view = useFleetStore((s) => s.view)
  const setView = useFleetStore((s) => s.setView)
  const connectionState = useFleetStore((s) => s.connectionState)
  const lastUpdatedTs = useFleetStore((s) => s.lastUpdatedTs)
  const loading = useFleetStore((s) => s.loading)
  const fetchAll = useFleetStore((s) => s.fetchAll)
  const reset = useFleetStore((s) => s.reset)

  // Initial data fetch when authenticated
  useEffect(() => {
    if (authenticated) fetchAll()
  }, [authenticated, fetchAll])

  // SSE connection
  useConnection(authenticated)

  const handleSignOut = useCallback(() => {
    clearToken()
    reset()
    setAuthenticated(false)
  }, [reset])

  if (!authenticated) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} />
  }

  return (
    <Shell
      view={view}
      onViewChange={setView}
      connectionState={connectionState}
      lastUpdatedTs={lastUpdatedTs}
      onSignOut={handleSignOut}
    >
      {view === "health" && <HealthView />}
      {view === "progress" && <ProgressView />}
      {view === "board" && <BoardView />}
      {view === "timeline" && <TimelineView />}
    </Shell>
  )
}
