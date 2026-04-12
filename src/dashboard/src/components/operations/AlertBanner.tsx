import type { ClassifiedError } from "../../lib/types"

interface Props {
  alerts: ClassifiedError[]
  onDismiss: (index: number) => void
}

const severityStyles: Record<string, string> = {
  info: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
  warning: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
  critical: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
  fatal: "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700",
}

export function AlertBanner({ alerts, onDismiss }: Props) {
  return (
    <div className="mb-4 space-y-2">
      <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
        Alerts ({alerts.length})
      </h3>
      {alerts.slice(0, 5).map((alert, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${
            severityStyles[alert.severity] ?? severityStyles.warning
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">
              {alert.affectedAgent && <span>{alert.affectedAgent}: </span>}
              {alert.category}
            </div>
            <p className="text-xs mt-0.5 text-gray-600 dark:text-gray-400">{alert.message}</p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
              Recovery: {alert.recovery}
              {alert.needsHuman && " (needs human)"}
            </p>
          </div>
          <button
            onClick={() => onDismiss(i)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-0.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
