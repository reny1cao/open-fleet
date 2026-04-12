import type { View } from "../../lib/types"

const tabs: { view: View; label: string }[] = [
  { view: "operations", label: "Operations" },
  { view: "board", label: "Board" },
  { view: "timeline", label: "Timeline" },
  { view: "sprint", label: "Sprint" },
]

interface Props {
  current: View
  onChange: (view: View) => void
  connected: boolean
  onSignOut: () => void
}

export function TopNav({ current, onChange, connected, onSignOut }: Props) {
  return (
    <header className="hidden md:flex items-center h-12 px-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
      <h1 className="text-sm font-semibold mr-6">Fleet Dashboard</h1>
      <nav className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.view}
            onClick={() => onChange(tab.view)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              current === tab.view
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>
        <button
          onClick={onSignOut}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
