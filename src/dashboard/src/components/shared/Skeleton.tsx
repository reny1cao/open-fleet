import { cn } from "../../lib/cn"

interface Props {
  className?: string
}

export function Skeleton({ className }: Props) {
  return (
    <div className={cn("animate-pulse rounded-card bg-[#1a1a1a]", className)} />
  )
}

export function SkeletonKpiStrip() {
  return (
    <div className="flex gap-24px px-16px py-16px">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex flex-col gap-4px">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonAgentRows() {
  return (
    <div className="px-16px space-y-8px">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  )
}

export function SkeletonHealthPanel() {
  return (
    <div className="space-y-24px">
      <SkeletonKpiStrip />
      <SkeletonAgentRows />
    </div>
  )
}
