import { useRef, useEffect } from "react"
import type { ActivityEvent } from "../../lib/types"
import { timeShort, truncate } from "../../lib/format"

const typeIcon: Record<string, string> = {
  created: "+",
  status_change: "\u2192",
  assignment: "\u21bb",
  comment: "\u25cb",
  priority_change: "\u25b2",
}

const typeColor: Record<string, string> = {
  created: "text-green-500 dark:text-green-400",
  status_change: "text-blue-500 dark:text-blue-400",
  assignment: "text-purple-500 dark:text-purple-400",
  comment: "text-gray-500 dark:text-gray-400",
  priority_change: "text-orange-500 dark:text-orange-400",
}

interface Props {
  events: ActivityEvent[]
}

export function ActivityFeed({ events }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLengthRef = useRef(events.length)

  // Auto-scroll to top when new events arrive (only if already near top)
  useEffect(() => {
    if (events.length > prevLengthRef.current && scrollRef.current) {
      if (scrollRef.current.scrollTop < 50) {
        scrollRef.current.scrollTop = 0
      }
    }
    prevLengthRef.current = events.length
  }, [events.length])

  return (
    <div>
      <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
        Activity
        <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
          {events.length} events
        </span>
      </h2>
      <div ref={scrollRef} className="space-y-0.5 max-h-[65vh] overflow-y-auto pr-1">
        {events.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">
            No recent activity
          </p>
        )}
        {events.map((event, i) => (
          <div
            key={`${event.timestamp}-${event.taskId}-${i}`}
            className="flex gap-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800/50 rounded px-1.5 -mx-1.5 transition-colors"
          >
            {/* Time */}
            <span className="text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0 w-10">
              {timeShort(event.timestamp)}
            </span>

            {/* Type icon */}
            <span className={`flex-shrink-0 w-3 text-center font-mono ${typeColor[event.type] ?? typeColor.comment}`}>
              {typeIcon[event.type] ?? "\u25cb"}
            </span>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <span className="font-medium">{event.agent}</span>
              {event.taskId && (
                <span className="font-mono text-gray-500 dark:text-gray-400 ml-1">{event.taskId}</span>
              )}
              <p className="text-gray-600 dark:text-gray-400 mt-0.5 leading-tight">
                {truncate(event.text, 80)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
