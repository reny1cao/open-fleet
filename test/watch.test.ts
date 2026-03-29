import { describe, it, expect } from "bun:test"
import { formatState, buildSnapshot, type AgentSnapshot } from "../src/commands/watch"

describe("watch formatState", () => {
  it("shows alive for on + alive heartbeat", () => {
    const snap = buildSnapshot("agent1", "worker", "local", "on", "alive", 10, "")
    const { tag, color } = formatState(snap)
    expect(tag).toBe("[alive]")
    expect(color).toContain("32") // green
  })

  it("shows stale for on + stale heartbeat", () => {
    const snap = buildSnapshot("agent1", "worker", "local", "on", "stale", 90, "")
    const { tag } = formatState(snap)
    expect(tag).toBe("[stale]")
  })

  it("shows hung for on + dead heartbeat", () => {
    const snap = buildSnapshot("agent1", "worker", "local", "on", "dead", 600, "")
    const { tag } = formatState(snap)
    expect(tag).toBe("[hung?]")
  })

  it("shows on for running with unknown heartbeat", () => {
    const snap = buildSnapshot("agent1", "worker", "local", "on", "unknown", null, "")
    const { tag } = formatState(snap)
    expect(tag.trim()).toBe("[on]")
  })

  it("shows off for not running", () => {
    const snap = buildSnapshot("agent1", "worker", "local", "off", "unknown", null, "")
    const { tag } = formatState(snap)
    expect(tag.trim()).toBe("[off]")
  })

  it("shows err for error state", () => {
    const snap = buildSnapshot("agent1", "worker", "local", "error", "unknown", null, "")
    const { tag } = formatState(snap)
    expect(tag.trim()).toBe("[err]")
  })
})

describe("watch buildSnapshot", () => {
  it("creates a valid snapshot", () => {
    const snap = buildSnapshot("test-agent", "lead", "singapore", "on", "alive", 5, "Working on task...")
    expect(snap.name).toBe("test-agent")
    expect(snap.role).toBe("lead")
    expect(snap.server).toBe("singapore")
    expect(snap.state).toBe("on")
    expect(snap.heartbeat).toBe("alive")
    expect(snap.ageSec).toBe(5)
    expect(snap.lastLine).toBe("Working on task...")
  })

  it("handles null age", () => {
    const snap = buildSnapshot("agent", "worker", "local", "off", "unknown", null, "")
    expect(snap.ageSec).toBeNull()
  })
})
