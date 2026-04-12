import { useState } from "react"
import type { TaskStatus, TaskPriority } from "../../lib/types"
import { useFleetStore } from "../../hooks/use-fleet-store"
import { api } from "../../lib/api"
import { X } from "lucide-react"

interface Props {
  defaultStatus: TaskStatus
  onClose: () => void
}

export function CreateTaskSheet({ defaultStatus, onClose }: Props) {
  const agents = useFleetStore((s) => s.agents ?? [])
  const updateTask = useFleetStore((s) => s.updateTask)

  const [title, setTitle] = useState("")
  const [assignee, setAssignee] = useState("")
  const [priority, setPriority] = useState<TaskPriority>("normal")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tasks created via board default to open unless placed in backlog
  const status: TaskStatus = defaultStatus === "backlog" ? "backlog" : "open"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      const task = await api.createTask({
        title: title.trim(),
        assignee: assignee || undefined,
        priority,
        status,
      })
      updateTask(task)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task")
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Sheet / Dialog */}
      <form
        onSubmit={handleSubmit}
        className="relative w-full md:max-w-[400px] bg-surface border border-border rounded-card rounded-b-none md:rounded-card p-16px flex flex-col gap-12px max-h-[80vh] overflow-y-auto"
        style={{ paddingBottom: "calc(16px + var(--safe-area-bottom, 0px))" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-section text-primary">Create Task</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-[24px] h-[24px] flex items-center justify-center rounded-card text-muted hover:text-secondary transition-colors"
          >
            <X className="w-[16px] h-[16px]" />
          </button>
        </div>

        {/* Title input */}
        <input
          type="text"
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          className="w-full px-12px py-8px text-body text-primary bg-border-subtle border border-border rounded-card placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-status-blue"
        />

        {/* Assignee select */}
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="w-full px-12px py-8px text-body text-primary bg-border-subtle border border-border rounded-card focus:outline-none focus:ring-1 focus:ring-status-blue"
        >
          <option value="">Unassigned</option>
          {(agents ?? []).map((a) => (
            <option key={a?.name} value={a?.name}>{a?.name}</option>
          ))}
        </select>

        {/* Priority select */}
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className="w-full px-12px py-8px text-body text-primary bg-border-subtle border border-border rounded-card focus:outline-none focus:ring-1 focus:ring-status-blue"
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>

        {/* Status indicator */}
        <p className="text-caption text-muted">
          Will be created as <span className="font-medium text-secondary">{status}</span>
        </p>

        {/* Error */}
        {error && (
          <p className="text-caption text-status-red">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!title.trim() || submitting}
          className="w-full py-8px text-body font-medium text-primary bg-status-blue rounded-card hover:bg-status-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Creating..." : "Create Task"}
        </button>
      </form>
    </div>
  )
}
