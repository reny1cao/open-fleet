import { useState, useMemo } from "react"
import { useFleetStore } from "../../hooks/use-fleet-store"
import type { Task, TaskStatus } from "../../lib/types"
import { cn } from "../../lib/cn"
import { timeShort } from "../../lib/format"
import { TimelineBlock, type TimelineBlockData } from "./TimelineBlock"
import { TimelineLegend } from "./TimelineLegend"
import { Skeleton } from "../shared/Skeleton"
import { ChevronDown, ChevronRight } from "lucide-react"

/* ── Constants ── */

const RANGE_OPTIONS = [4, 8, 12, 24] as const
type RangeHours = (typeof RANGE_OPTIONS)[number]

const ACTIVE_STATUSES: Set<TaskStatus> = new Set([
  "in_progress",
  "review",
  "verify",
  "blocked",
])

/* ── Helpers ── */

function buildBlocks(
  tasks: Task[],
  agentName: string,
  rangeStartMs: number,
  rangeEndMs: number,
): TimelineBlockData[] {
  const now = Date.now()
  return (tasks ?? [])
    .filter((t) => t?.assignee === agentName)
    .map((t) => {
      const startMs = t?.startedAt
        ? new Date(t.startedAt).getTime()
        : new Date(t?.createdAt ?? now).getTime()
      const endMs = t?.completedAt
        ? new Date(t.completedAt).getTime()
        : ACTIVE_STATUSES.has(t?.status)
          ? now
          : startMs // for backlog/open/cancelled, just a point
      return {
        taskId: t?.id ?? "",
        title: t?.title ?? "",
        status: t?.status ?? ("open" as TaskStatus),
        startMs,
        endMs: Math.max(endMs, startMs + 60_000), // at least 1 min so block is visible
        assignee: agentName,
      }
    })
    .filter((b) => b.endMs > rangeStartMs && b.startMs < rangeEndMs)
}

function generateTimeLabels(
  rangeStartMs: number,
  rangeEndMs: number,
  rangeHours: number,
): { label: string; pct: number }[] {
  const range = rangeEndMs - rangeStartMs
  if (range <= 0) return []

  // Pick step: 1h for <=8h, 2h for 12h, 4h for 24h
  const stepHours = rangeHours <= 8 ? 1 : rangeHours <= 12 ? 2 : 4
  const stepMs = stepHours * 3600_000

  // Snap to the first hour boundary at or after rangeStart
  const firstHour = Math.ceil(rangeStartMs / stepMs) * stepMs
  const labels: { label: string; pct: number }[] = []

  for (let ms = firstHour; ms <= rangeEndMs; ms += stepMs) {
    const pct = ((ms - rangeStartMs) / range) * 100
    labels.push({
      label: timeShort(new Date(ms).toISOString()),
      pct,
    })
  }
  return labels
}

/* ── Skeleton loading ── */

function SkeletonTimeline() {
  return (
    <div className="max-w-[1400px] mx-auto px-16px py-12px space-y-12px">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-4 w-64" />
      <div className="space-y-8px mt-16px">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-8px">
            <Skeleton className="h-8 w-24 flex-shrink-0" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Main component ── */

export function TimelineView() {
  const agents = useFleetStore((s) => s.agents ?? [])
  const tasks = useFleetStore((s) => s.tasks ?? [])
  const loading = useFleetStore((s) => s.loading)

  const [rangeHours, setRangeHours] = useState<RangeHours>(12)
  const [idleExpanded, setIdleExpanded] = useState(false)

  const now = Date.now()
  const rangeEndMs = now
  const rangeStartMs = now - rangeHours * 3600_000

  /* ── Build agent rows with their blocks ── */

  const agentRows = useMemo(() => {
    return (agents ?? []).map((agent) => {
      const blocks = buildBlocks(tasks, agent?.name ?? "", rangeStartMs, rangeEndMs)
      return {
        name: agent?.name ?? "",
        status: agent?.status ?? "unknown",
        blocks,
        hasActivity: blocks.length > 0,
      }
    })
  }, [agents, tasks, rangeStartMs, rangeEndMs])

  // Sort: active agents first, idle last
  const sorted = useMemo(() => {
    return [...agentRows].sort((a, b) => {
      if (a.hasActivity && !b.hasActivity) return -1
      if (!a.hasActivity && b.hasActivity) return 1
      return a.name.localeCompare(b.name)
    })
  }, [agentRows])

  const activeAgents = sorted.filter((a) => a.hasActivity)
  const idleAgents = sorted.filter((a) => !a.hasActivity)

  /* ── Time labels ── */

  const timeLabels = useMemo(
    () => generateTimeLabels(rangeStartMs, rangeEndMs, rangeHours),
    [rangeStartMs, rangeEndMs, rangeHours],
  )

  /* ── Now indicator position ── */

  const nowPct = ((now - rangeStartMs) / (rangeEndMs - rangeStartMs)) * 100

  if (loading) return <SkeletonTimeline />

  return (
    <div className="max-w-[1400px] mx-auto px-16px py-12px">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-8px mb-8px">
        <h2 className="text-section text-primary">Timeline</h2>

        {/* Range selector pills */}
        <div className="flex items-center gap-4px">
          {RANGE_OPTIONS.map((h) => (
            <button
              key={h}
              onClick={() => setRangeHours(h)}
              className={cn(
                "px-8px py-4px rounded-card text-caption font-medium transition-colors",
                h === rangeHours
                  ? "bg-status-blue text-primary"
                  : "bg-border-subtle text-secondary hover:text-primary",
              )}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="mb-16px">
        <TimelineLegend />
      </div>

      {/* ── Empty state ── */}
      {(agents ?? []).length === 0 && (
        <div className="text-center py-48px">
          <p className="text-body text-secondary">No agents registered</p>
          <p className="text-caption text-muted mt-4px">
            Agents appear here when they connect
          </p>
        </div>
      )}

      {(agents ?? []).length > 0 && (
        <>
          {/* ── Desktop: Horizontal Gantt ── */}
          <div className="hidden md:block">
            {/* Time axis */}
            <div className="flex items-end mb-4px">
              <div className="w-[120px] flex-shrink-0" />
              <div className="flex-1 relative h-[20px]">
                {timeLabels.map((tl, i) => (
                  <span
                    key={i}
                    className="absolute font-mono text-mono text-muted whitespace-nowrap -translate-x-1/2"
                    style={{ left: `${tl.pct}%` }}
                  >
                    {tl.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Active agents */}
            {activeAgents.map((row) => (
              <div
                key={row.name}
                className="flex items-center mb-4px group"
              >
                <div className="w-[120px] flex-shrink-0 pr-8px text-right">
                  <span className="text-caption text-secondary truncate block">
                    {row.name}
                  </span>
                </div>
                <div className="flex-1 relative h-[28px] bg-border-subtle rounded-card overflow-hidden">
                  {/* Now indicator */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-status-blue/40 z-10"
                    style={{ left: `${nowPct}%` }}
                  />
                  {row.blocks.map((block) => (
                    <TimelineBlock
                      key={block.taskId}
                      block={block}
                      rangeStartMs={rangeStartMs}
                      rangeEndMs={rangeEndMs}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Idle agents (collapsible) */}
            {idleAgents.length > 0 && (
              <div className="mt-8px">
                <button
                  onClick={() => setIdleExpanded(!idleExpanded)}
                  className="flex items-center gap-4px text-caption text-muted hover:text-secondary transition-colors mb-4px"
                >
                  {idleExpanded ? (
                    <ChevronDown className="w-[14px] h-[14px]" />
                  ) : (
                    <ChevronRight className="w-[14px] h-[14px]" />
                  )}
                  <span>
                    {idleAgents.length} idle agent{idleAgents.length !== 1 ? "s" : ""}
                  </span>
                </button>
                {idleExpanded &&
                  idleAgents.map((row) => (
                    <div
                      key={row.name}
                      className="flex items-center mb-4px"
                    >
                      <div className="w-[120px] flex-shrink-0 pr-8px text-right">
                        <span className="text-caption text-muted truncate block">
                          {row.name}
                        </span>
                      </div>
                      <div className="flex-1 relative h-[28px] bg-border-subtle rounded-card overflow-hidden">
                        {/* Now indicator */}
                        <div
                          className="absolute top-0 bottom-0 w-px bg-status-blue/40 z-10"
                          style={{ left: `${nowPct}%` }}
                        />
                        {/* Empty track */}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* ── Mobile: Vertical timeline ── */}
          <div className="md:hidden space-y-16px">
            {/* Active agents */}
            {activeAgents.map((row) => (
              <div key={row.name}>
                <div className="flex items-center gap-8px mb-4px">
                  <span className="text-caption text-secondary font-medium">
                    {row.name}
                  </span>
                  <span className="text-caption text-muted">
                    {row.blocks.length} task{row.blocks.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-4px pl-8px border-l border-border">
                  {row.blocks
                    .sort((a, b) => b.startMs - a.startMs)
                    .map((block) => (
                      <MobileBlock key={block.taskId} block={block} />
                    ))}
                </div>
              </div>
            ))}

            {/* Idle agents (collapsible) */}
            {idleAgents.length > 0 && (
              <div>
                <button
                  onClick={() => setIdleExpanded(!idleExpanded)}
                  className="flex items-center gap-4px text-caption text-muted hover:text-secondary transition-colors mb-4px"
                >
                  {idleExpanded ? (
                    <ChevronDown className="w-[14px] h-[14px]" />
                  ) : (
                    <ChevronRight className="w-[14px] h-[14px]" />
                  )}
                  <span>
                    {idleAgents.length} idle agent{idleAgents.length !== 1 ? "s" : ""}
                  </span>
                </button>
                {idleExpanded && (
                  <div className="space-y-4px pl-8px">
                    {idleAgents.map((row) => (
                      <div key={row.name} className="flex items-center gap-8px py-4px">
                        <span className="text-caption text-muted">{row.name}</span>
                        <span className="text-caption text-muted">-- no activity --</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Mobile block (vertical layout) ── */

const MOBILE_STATUS_BG: Record<string, string> = {
  in_progress: "bg-status-blue/10",
  review: "bg-status-amber/10",
  verify: "bg-status-amber/10",
  blocked: "bg-status-red/10",
  done: "bg-status-green/10",
  cancelled: "bg-status-gray/10",
  open: "bg-status-gray/10",
  backlog: "bg-status-gray/10",
}

const MOBILE_STATUS_ACCENT: Record<string, string> = {
  in_progress: "border-l-status-blue",
  review: "border-l-status-amber",
  verify: "border-l-status-amber",
  blocked: "border-l-status-red",
  done: "border-l-status-green",
  cancelled: "border-l-status-gray",
  open: "border-l-status-gray",
  backlog: "border-l-status-gray",
}

function MobileBlock({ block }: { block: TimelineBlockData }) {
  const bg = MOBILE_STATUS_BG[block.status] ?? "bg-status-gray/10"
  const accent = MOBILE_STATUS_ACCENT[block.status] ?? "border-l-status-gray"
  const durationMs = block.endMs - block.startMs
  const durationLabel =
    durationMs < 60_000
      ? "<1m"
      : durationMs < 3600_000
        ? `${Math.floor(durationMs / 60_000)}m`
        : `${Math.floor(durationMs / 3600_000)}h ${Math.floor((durationMs % 3600_000) / 60_000)}m`

  return (
    <div
      className={cn(
        "px-8px py-4px rounded-card border-l-[3px]",
        bg,
        accent,
      )}
    >
      <div className="flex items-center gap-4px">
        <span className="font-mono text-mono text-muted">{block.taskId}</span>
        <span className="font-mono text-mono text-muted ml-auto flex-shrink-0">
          {durationLabel}
        </span>
      </div>
      <p className="text-caption text-secondary truncate">{block.title}</p>
    </div>
  )
}
