import type { ClassifiedError } from "../../lib/types"
import { X } from "lucide-react"

interface Props {
  alerts: ClassifiedError[]
  onDismiss: (index: number) => void
}

export function AlertBanner({ alerts, onDismiss }: Props) {
  const critical = alerts.filter((a) => a.severity === "critical" || a.severity === "fatal")
  if (critical.length === 0) return null

  return (
    <div className="px-16px py-8px space-y-4px">
      {critical.slice(0, 3).map((alert, i) => (
        <div
          key={i}
          className="flex items-start gap-8px px-12px py-8px rounded-card bg-[#1a0000] border border-status-red/20"
        >
          <div className="flex-1 min-w-0">
            <div className="text-caption font-medium text-status-red">
              {alert.affectedAgent && <span>{alert.affectedAgent}: </span>}
              {alert.category}
            </div>
            <p className="text-caption text-text-secondary mt-2px">{alert.message}</p>
            <p className="text-caption text-muted mt-2px">
              {alert.recovery}
              {alert.needsHuman && " \u00b7 needs human"}
            </p>
          </div>
          <button
            onClick={() => onDismiss(i)}
            className="text-muted hover:text-secondary p-2px flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
