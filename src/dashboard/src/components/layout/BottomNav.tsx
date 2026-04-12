import type { View } from "../../lib/types"
import { Activity, BarChart3, Columns3, Clock } from "lucide-react"

const tabs: { view: View; label: string; Icon: typeof Activity }[] = [
  { view: "health", label: "Health", Icon: Activity },
  { view: "progress", label: "Progress", Icon: BarChart3 },
  { view: "board", label: "Board", Icon: Columns3 },
  { view: "timeline", label: "Timeline", Icon: Clock },
]

interface Props {
  current: View
  onChange: (view: View) => void
}

export function BottomNav({ current, onChange }: Props) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-surface border-t border-border md:hidden"
      style={{ paddingBottom: "var(--safe-area-bottom)" }}
    >
      <div className="flex justify-around items-center h-14">
        {tabs.map(({ view, label, Icon }) => (
          <button
            key={view}
            onClick={() => onChange(view)}
            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
              current === view ? "text-text-primary" : "text-text-muted"
            }`}
          >
            <Icon size={18} strokeWidth={current === view ? 2 : 1.5} />
            <span className="text-[10px] mt-1">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
