import type { ReactNode } from "react"
import type { View } from "../../lib/types"
import { BottomNav } from "./BottomNav"
import { ConnectionBanner } from "./ConnectionBanner"
import { timeShort } from "../../lib/format"

interface Props {
  view: View
  onViewChange: (view: View) => void
  connectionState: "connected" | "silent" | "degraded" | "offline"
  lastUpdatedTs: string | null
  onSignOut: () => void
  children: ReactNode
}

const tabs: { view: View; label: string }[] = [
  { view: "health", label: "Health" },
  { view: "progress", label: "Progress" },
  { view: "board", label: "Board" },
  { view: "timeline", label: "Timeline" },
]

export function Shell({ view, onViewChange, connectionState, lastUpdatedTs, onSignOut, children }: Props) {
  const isConnected = connectionState === "connected" || connectionState === "silent"

  return (
    <div className="min-h-screen flex flex-col">
      {/* Desktop top nav */}
      <header className="hidden md:flex items-center h-12 px-16px bg-surface border-b border-border">
        <h1 className="text-body font-semibold mr-24px">Fleet</h1>
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.view}
              onClick={() => onViewChange(tab.view)}
              className={`px-12px py-1.5 text-caption rounded-card transition-colors ${
                view === tab.view
                  ? "bg-[#1a1a1a] text-primary font-medium"
                  : "text-secondary hover:text-primary hover:bg-[#1a1a1a]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-16px">
          <div className="flex items-center gap-8px">
            <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-status-green" : connectionState === "degraded" ? "bg-status-amber" : "bg-status-red"}`} />
            <span className="text-caption text-muted">
              {lastUpdatedTs ? timeShort(lastUpdatedTs) : "--:--"}
            </span>
          </div>
          <button onClick={onSignOut} className="text-caption text-muted hover:text-secondary transition-colors">
            Sign out
          </button>
        </div>
      </header>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center h-11 px-16px bg-surface border-b border-border">
        <h1 className="text-body font-semibold">Fleet</h1>
        <div className="ml-auto flex items-center gap-12px">
          <div className="flex items-center gap-4px">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-status-green" : connectionState === "degraded" ? "bg-status-amber" : "bg-status-red"}`} />
            <span className="text-caption text-muted">
              {lastUpdatedTs ? timeShort(lastUpdatedTs) : "--:--"}
            </span>
          </div>
          <button onClick={onSignOut} className="text-caption text-muted hover:text-secondary">
            Out
          </button>
        </div>
      </header>

      {/* Connection banner */}
      <ConnectionBanner state={connectionState} lastUpdatedTs={lastUpdatedTs} />

      <main className="flex-1 pb-16 md:pb-0">
        {children}
      </main>

      <BottomNav current={view} onChange={onViewChange} />
    </div>
  )
}
