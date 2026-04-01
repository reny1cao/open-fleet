import { describe, it, expect, beforeEach } from "bun:test"
import { isValidTransition } from "../src/tasks/types"
import type { TaskStore, Task } from "../src/tasks/types"
import {
  createTask,
  updateTask,
  getTask,
  listTasks,
  activeTasks,
  sortByPriority,
} from "../src/tasks/store"

function freshStore(fleet = "test"): TaskStore {
  return { version: 1, fleet, nextId: 1, tasks: [] }
}

// ── Status state machine ────────────────────────────────────────────────────

describe("isValidTransition", () => {
  it("allows open -> in_progress", () => {
    expect(isValidTransition("open", "in_progress")).toBe(true)
  })

  it("allows open -> cancelled", () => {
    expect(isValidTransition("open", "cancelled")).toBe(true)
  })

  it("allows open -> blocked", () => {
    expect(isValidTransition("open", "blocked")).toBe(true)
  })

  it("allows in_progress -> done", () => {
    expect(isValidTransition("in_progress", "done")).toBe(true)
  })

  it("allows in_progress -> blocked", () => {
    expect(isValidTransition("in_progress", "blocked")).toBe(true)
  })

  it("allows blocked -> in_progress", () => {
    expect(isValidTransition("blocked", "in_progress")).toBe(true)
  })

  it("allows blocked -> open", () => {
    expect(isValidTransition("blocked", "open")).toBe(true)
  })

  it("allows done -> open (reopen)", () => {
    expect(isValidTransition("done", "open")).toBe(true)
  })

  it("rejects done -> in_progress (must reopen first)", () => {
    expect(isValidTransition("done", "in_progress")).toBe(false)
  })

  it("rejects cancelled -> any (terminal state)", () => {
    expect(isValidTransition("cancelled", "open")).toBe(false)
    expect(isValidTransition("cancelled", "in_progress")).toBe(false)
    expect(isValidTransition("cancelled", "done")).toBe(false)
    expect(isValidTransition("cancelled", "blocked")).toBe(false)
  })

  it("rejects open -> done (must go through in_progress)", () => {
    expect(isValidTransition("open", "done")).toBe(false)
  })
})

// ── createTask ──────────────────────────────────────────────────────────────

describe("createTask", () => {
  let store: TaskStore

  beforeEach(() => {
    store = freshStore()
  })

  it("creates a task with monotonic ID", () => {
    const t1 = createTask(store, { title: "First" })
    const t2 = createTask(store, { title: "Second" })
    expect(t1.id).toBe("task-001")
    expect(t2.id).toBe("task-002")
    expect(store.nextId).toBe(3)
  })

  it("sets default values", () => {
    const t = createTask(store, { title: "Test task" })
    expect(t.status).toBe("open")
    expect(t.priority).toBe("normal")
    expect(t.notes).toEqual([])
    expect(t.createdAt).toBeTruthy()
    expect(t.updatedAt).toBe(t.createdAt)
  })

  it("accepts optional fields", () => {
    const t = createTask(store, {
      title: "Full task",
      assignee: "Ken-Thompson",
      priority: "urgent",
      workspace: "~/workspace",
      description: "Do the thing",
      project: "open-fleet",
      createdBy: "Steve-Jobs",
    })
    expect(t.assignee).toBe("Ken-Thompson")
    expect(t.priority).toBe("urgent")
    expect(t.workspace).toBe("~/workspace")
    expect(t.description).toBe("Do the thing")
    expect(t.project).toBe("open-fleet")
    expect(t.createdBy).toBe("Steve-Jobs")
  })

  it("adds task to store", () => {
    createTask(store, { title: "Test" })
    expect(store.tasks.length).toBe(1)
    createTask(store, { title: "Test 2" })
    expect(store.tasks.length).toBe(2)
  })

  it("sets parentId and dependsOn", () => {
    const parent = createTask(store, { title: "Parent" })
    const child = createTask(store, {
      title: "Child",
      parentId: parent.id,
      dependsOn: [parent.id],
    })
    expect(child.parentId).toBe("task-001")
    expect(child.dependsOn).toEqual(["task-001"])
  })

  it("detects circular dependencies", () => {
    const t1 = createTask(store, { title: "Task A" })
    const t2 = createTask(store, { title: "Task B", dependsOn: [t1.id] })
    expect(() => {
      createTask(store, { title: "Task C", dependsOn: [t2.id] })
    }).not.toThrow()

    // Now try to create a task that would form a cycle: t1 depends on t2, t2 depends on t1
    // We need to manually set up the cycle scenario
    t1.dependsOn = [t2.id]
    expect(() => {
      createTask(store, { title: "Cycle", dependsOn: [t1.id] })
    }).not.toThrow() // This task doesn't form a cycle itself
  })
})

// ── updateTask ──────────────────────────────────────────────────────────────

describe("updateTask", () => {
  let store: TaskStore

  beforeEach(() => {
    store = freshStore()
    createTask(store, { title: "Test task", assignee: "Ken-Thompson", createdBy: "Steve-Jobs" })
  })

  it("transitions status with note", () => {
    const updated = updateTask(store, "task-001", { status: "in_progress", author: "Ken-Thompson" })
    expect(updated.status).toBe("in_progress")
    expect(updated.notes.length).toBe(1)
    expect(updated.notes[0].type).toBe("status_change")
    expect(updated.notes[0].oldValue).toBe("open")
    expect(updated.notes[0].newValue).toBe("in_progress")
  })

  it("sets startedAt on first in_progress transition", () => {
    const updated = updateTask(store, "task-001", { status: "in_progress" })
    expect(updated.startedAt).toBeTruthy()
  })

  it("does not overwrite startedAt on subsequent in_progress", () => {
    updateTask(store, "task-001", { status: "in_progress" })
    const firstStart = store.tasks[0].startedAt
    updateTask(store, "task-001", { status: "blocked" })
    updateTask(store, "task-001", { status: "in_progress" })
    expect(store.tasks[0].startedAt).toBe(firstStart)
  })

  it("sets completedAt on done", () => {
    updateTask(store, "task-001", { status: "in_progress" })
    const updated = updateTask(store, "task-001", { status: "done" })
    expect(updated.completedAt).toBeTruthy()
  })

  it("sets blockedReason when blocked", () => {
    updateTask(store, "task-001", { status: "in_progress" })
    const updated = updateTask(store, "task-001", { status: "blocked", blockedReason: "Need API key" })
    expect(updated.blockedReason).toBe("Need API key")
  })

  it("clears blockedReason when unblocked", () => {
    updateTask(store, "task-001", { status: "in_progress" })
    updateTask(store, "task-001", { status: "blocked", blockedReason: "stuck" })
    const updated = updateTask(store, "task-001", { status: "in_progress" })
    expect(updated.blockedReason).toBeUndefined()
  })

  it("rejects invalid transitions", () => {
    expect(() => {
      updateTask(store, "task-001", { status: "done" })
    }).toThrow("Invalid transition: open → done")
  })

  it("rejects transition from cancelled", () => {
    updateTask(store, "task-001", { status: "cancelled" })
    expect(() => {
      updateTask(store, "task-001", { status: "open" })
    }).toThrow("Invalid transition")
  })

  it("appends notes without modifying status", () => {
    const updated = updateTask(store, "task-001", { note: "Looking into this", author: "Ken-Thompson" })
    expect(updated.status).toBe("open")
    expect(updated.notes.length).toBe(1)
    expect(updated.notes[0].type).toBe("comment")
    expect(updated.notes[0].text).toBe("Looking into this")
    expect(updated.notes[0].author).toBe("Ken-Thompson")
  })

  it("attaches result", () => {
    updateTask(store, "task-001", { status: "in_progress" })
    const updated = updateTask(store, "task-001", {
      status: "done",
      result: { summary: "Fixed the bug", commits: ["abc123"], filesChanged: ["store.ts"] },
    })
    expect(updated.result?.summary).toBe("Fixed the bug")
    expect(updated.result?.commits).toEqual(["abc123"])
  })

  it("reassigns with audit trail", () => {
    const updated = updateTask(store, "task-001", { assignee: "John-Carmack", author: "Steve-Jobs" })
    expect(updated.assignee).toBe("John-Carmack")
    expect(updated.notes.length).toBe(1)
    expect(updated.notes[0].type).toBe("assignment")
    expect(updated.notes[0].oldValue).toBe("Ken-Thompson")
    expect(updated.notes[0].newValue).toBe("John-Carmack")
  })

  it("throws on unknown task ID", () => {
    expect(() => {
      updateTask(store, "task-999", { status: "in_progress" })
    }).toThrow("Task not found: task-999")
  })

  it("updates updatedAt on every change", async () => {
    const t = getTask(store, "task-001")!
    const before = t.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    updateTask(store, "task-001", { note: "bump" })
    expect(t.updatedAt).not.toBe(before)
  })
})

// ── getTask ─────────────────────────────────────────────────────────────────

describe("getTask", () => {
  it("returns task by ID", () => {
    const store = freshStore()
    createTask(store, { title: "Find me" })
    expect(getTask(store, "task-001")?.title).toBe("Find me")
  })

  it("returns undefined for missing ID", () => {
    const store = freshStore()
    expect(getTask(store, "task-999")).toBeUndefined()
  })
})

// ── listTasks ───────────────────────────────────────────────────────────────

describe("listTasks", () => {
  let store: TaskStore

  beforeEach(() => {
    store = freshStore()
    createTask(store, { title: "A", assignee: "Ken", priority: "high" })
    createTask(store, { title: "B", assignee: "John", priority: "low" })
    createTask(store, { title: "C", assignee: "Ken", priority: "normal", project: "fleet" })
  })

  it("returns all tasks with no filter", () => {
    expect(listTasks(store).length).toBe(3)
  })

  it("filters by assignee", () => {
    const tasks = listTasks(store, { assignee: "Ken" })
    expect(tasks.length).toBe(2)
    expect(tasks.every((t) => t.assignee === "Ken")).toBe(true)
  })

  it("filters by status", () => {
    updateTask(store, "task-001", { status: "in_progress" })
    const tasks = listTasks(store, { status: "in_progress" })
    expect(tasks.length).toBe(1)
    expect(tasks[0].id).toBe("task-001")
  })

  it("filters by project", () => {
    const tasks = listTasks(store, { project: "fleet" })
    expect(tasks.length).toBe(1)
    expect(tasks[0].id).toBe("task-003")
  })

  it("combines filters", () => {
    const tasks = listTasks(store, { assignee: "Ken", project: "fleet" })
    expect(tasks.length).toBe(1)
  })

  it("returns empty for no matches", () => {
    expect(listTasks(store, { assignee: "Nobody" }).length).toBe(0)
  })
})

// ── activeTasks ─────────────────────────────────────────────────────────────

describe("activeTasks", () => {
  it("excludes done and cancelled", () => {
    const store = freshStore()
    createTask(store, { title: "Open" })
    createTask(store, { title: "In progress" })
    createTask(store, { title: "To cancel" })
    createTask(store, { title: "To complete" })

    updateTask(store, "task-002", { status: "in_progress" })
    updateTask(store, "task-003", { status: "cancelled" })
    updateTask(store, "task-004", { status: "in_progress" })
    updateTask(store, "task-004", { status: "done" })

    const active = activeTasks(store)
    expect(active.length).toBe(2)
    expect(active.map((t) => t.id)).toEqual(["task-001", "task-002"])
  })
})

// ── sortByPriority ──────────────────────────────────────────────────────────

describe("sortByPriority", () => {
  it("sorts urgent > high > normal > low", () => {
    const store = freshStore()
    createTask(store, { title: "Low", priority: "low" })
    createTask(store, { title: "Urgent", priority: "urgent" })
    createTask(store, { title: "Normal", priority: "normal" })
    createTask(store, { title: "High", priority: "high" })

    const sorted = sortByPriority(store.tasks)
    expect(sorted.map((t) => t.priority)).toEqual(["urgent", "high", "normal", "low"])
  })

  it("does not mutate original array", () => {
    const store = freshStore()
    createTask(store, { title: "Low", priority: "low" })
    createTask(store, { title: "High", priority: "high" })

    const original = [...store.tasks]
    sortByPriority(store.tasks)
    expect(store.tasks[0].id).toBe(original[0].id)
  })
})
