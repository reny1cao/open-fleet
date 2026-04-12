import { timeShort } from "../../lib/format"

interface Props {
  state: "connected" | "silent" | "degraded" | "offline"
  lastUpdatedTs: string | null
}

export function ConnectionBanner({ state, lastUpdatedTs }: Props) {
  if (state === "connected" || state === "silent") return null

  const ts = lastUpdatedTs ? timeShort(lastUpdatedTs) : "unknown"

  if (state === "degraded") {
    return (
      <div className="px-16px py-8px bg-[#1a1400] border-b border-status-amber/20 text-caption text-status-amber flex items-center gap-8px">
        <span className="w-1.5 h-1.5 rounded-full bg-status-amber animate-pulse" />
        Reconnecting... Last update: {ts}
      </div>
    )
  }

  return (
    <div className="px-16px py-8px bg-[#1a0000] border-b border-status-red/20 text-caption text-status-red flex items-center gap-8px">
      <span className="w-1.5 h-1.5 rounded-full bg-status-red" />
      Connection lost. Last update: {ts}
    </div>
  )
}
