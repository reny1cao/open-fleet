import type { ReactNode } from "react"
import type { View } from "../../lib/types"
import { BottomNav } from "./BottomNav"
import { TopNav } from "./TopNav"

interface Props {
  view: View
  onViewChange: (view: View) => void
  connected: boolean
  children: ReactNode
}

export function Shell({ view, onViewChange, connected, children }: Props) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav current={view} onChange={onViewChange} connected={connected} />

      {/* Mobile header */}
      <header className="md:hidden flex items-center h-11 px-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <h1 className="text-sm font-semibold">Fleet Dashboard</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {connected ? "Live" : "Offline"}
          </span>
        </div>
      </header>

      <main className="flex-1 pb-16 md:pb-0">
        {children}
      </main>

      <BottomNav current={view} onChange={onViewChange} />
    </div>
  )
}
