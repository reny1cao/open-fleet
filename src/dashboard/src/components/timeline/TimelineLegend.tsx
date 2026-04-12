import { cn } from "../../lib/cn"

const LEGEND_ITEMS = [
  { label: "Done", color: "bg-status-green" },
  { label: "In Progress", color: "bg-status-blue" },
  { label: "Review / Verify", color: "bg-status-amber" },
  { label: "Blocked", color: "bg-status-red" },
  { label: "Idle", color: "bg-status-gray" },
] as const

export function TimelineLegend() {
  return (
    <div className="flex flex-wrap items-center gap-12px">
      {LEGEND_ITEMS.map((item) => (
        <div key={item.label} className="flex items-center gap-4px">
          <span
            className={cn("w-[8px] h-[8px] rounded-full flex-shrink-0", item.color)}
          />
          <span className="text-caption text-muted">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
