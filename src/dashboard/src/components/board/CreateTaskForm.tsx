import { useState } from "react"
import type { TaskStatus, TaskPriority } from "../../lib/types"
import { useFleetStore } from "../../hooks/use-fleet-store"
import { api } from "../../lib/api"

interface Props {
  defaultStatus: TaskStatus
  onClose: () => void
}

export function CreateTaskForm({ defaultStatus, onClose }: Props) {
  const agents = useFleetStore((s) => s.agents ?? [])
  const updateTask = useFleetStore((s) => s.updateTask)

  const [title, setTitle] = useState("")
  const [assignee, setAssignee] = useState("")
  const [priority, setPriority] = useState<TaskPriority>("normal")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status = defaultStatus === "backlog" ? "backlog" : "open"

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
        description: description.trim() || undefined,
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="relative w-full md:max-w-md bg-white dark:bg-slate-800 rounded-t-xl md:rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3 max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">Create Task</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Title */}
        <input
          type="text"
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Description */}
        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />

        {/* Assignee + Priority row */}
        <div className="flex gap-2">
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900"
          >
            <option value="">Unassigned</option>
            {agents.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>

          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="w-28 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        {/* Status indicator */}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Will be created as <span className="font-medium">{status}</span>
        </p>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!title.trim() || submitting}
          className="w-full py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Creating..." : "Create Task"}
        </button>
      </form>
    </div>
  )
}
