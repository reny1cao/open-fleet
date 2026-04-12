import type { TaskStatus } from "../../lib/types"
import { cn } from "../../lib/cn"

export interface TimelineBlockData {
  taskId: string
  title: string
  status: TaskStatus
  startMs: number
  endMs: number
  assignee?: string
}

interface Props {
  block: TimelineBlockData
  rangeStartMs: number
  rangeEndMs: number
}

const STATUS_BG: Record<string, string> = {
  in_progress: "bg-status-blue/10",
  review: "bg-status-amber/10",
  verify: "bg-status-amber/10",
  blocked: "bg-status-red/10",
  done: "bg-status-green/10",
  cancelled: "bg-status-gray/10",
  open: "bg-status-gray/10",
  backlog: "bg-status-gray/10",
}

const STATUS_BORDER: Record<string, string> = {
  in_progress: "border-l-status-blue",
  review: "border-l-status-amber",
  verify: "border-l-status-amber",
  blocked: "border-l-status-red",
  done: "border-l-status-green",
  cancelled: "border-l-status-gray",
  open: "border-l-status-gray",
  backlog: "border-l-status-gray",
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "In Progress",
  review: "Review",
  verify: "Verify",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
  open: "Open",
  backlog: "Backlog",
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  const remainMin = min % 60
  return remainMin > 0 ? `${hr}h ${remainMin}m` : `${hr}h`
}

export function TimelineBlock({ block, rangeStartMs, rangeEndMs }: Props) {
  const range = rangeEndMs - rangeStartMs
  if (range <= 0) return null

  // Clamp block to visible range
  const clampedStart = Math.max(block.startMs, rangeStartMs)
  const clampedEnd = Math.min(block.endMs, rangeEndMs)
  if (clampedEnd <= clampedStart) return null

  const leftPct = ((clampedStart - rangeStartMs) / range) * 100
  const widthPct = ((clampedEnd - clampedStart) / range) * 100

  // Minimum 0.3% so tiny tasks remain visible (at least ~2px on a 700px track)
  const displayWidth = Math.max(widthPct, 0.3)
  const showId = widthPct > 8

  const bg = STATUS_BG[block.status] ?? "bg-status-gray/10"
  const borderColor = STATUS_BORDER[block.status] ?? "border-l-status-gray"
  const statusLabel = STATUS_LABEL[block.status] ?? block.status
  const duration = formatElapsed(block.endMs - block.startMs)

  const tooltip = `${block.taskId} - ${block.title}\nStatus: ${statusLabel}\nDuration: ${duration}`

  return (
    <div
      className={cn(
        "absolute top-[2px] bottom-[2px] rounded-card border-l-[3px] overflow-hidden",
        "flex items-center",
        bg,
        borderColor,
      )}
      style={{
        left: `${leftPct}%`,
        width: `${displayWidth}%`,
        minWidth: "2px",
      }}
      title={tooltip}
    >
      {showId && (
        <span className="font-mono text-mono text-secondary px-4px truncate">
          {block.taskId}
        </span>
      )}
    </div>
  )
}
