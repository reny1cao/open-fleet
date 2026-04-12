import { Check } from "lucide-react"

interface Props {
  goals: string[] | undefined
}

export function GoalsChecklist({ goals }: Props) {
  if (!goals || goals.length === 0) return null

  return (
    <div className="px-16px py-8px">
      <h3 className="text-caption text-muted mb-4px">Goals</h3>
      <div className="space-y-2px">
        {goals.map((goal, i) => {
          // Goals starting with [x] or [X] are checked
          const checked = /^\[x\]/i.test(goal.trim())
          const text = goal.replace(/^\[[xX ]\]\s*/, "")

          return (
            <div key={i} className="flex items-start gap-8px py-2px">
              <span className={`flex-shrink-0 w-4 h-4 mt-0.5 rounded-card border flex items-center justify-center ${
                checked
                  ? "bg-status-green/20 border-status-green"
                  : "border-border"
              }`}>
                {checked && <Check size={10} className="text-status-green" />}
              </span>
              <span className={`text-body ${checked ? "text-secondary line-through" : "text-primary"}`}>
                {text}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
