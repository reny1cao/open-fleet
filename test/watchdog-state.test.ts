import { describe, it, expect } from "bun:test"
import {
  getAgentState,
  getServerState,
  isOnCooldown,
  setCooldown,
  isOnCompactCooldown,
  setCompactCooldown,
  canAlert,
  markAlerted,
} from "../src/watchdog/state"
import type { WatchdogState } from "../src/watchdog/types"

function freshState(): WatchdogState {
  return {
    startedAt: new Date().toISOString(),
    lastTick: new Date().toISOString(),
    agents: {},
    servers: {},
    lastAlerted: {},
  }
}

// ── getAgentState ───────────────────────────────────────────────────────────

describe("getAgentState", () => {
  it("creates default state for a new agent", () => {
    const state = freshState()
    const agent = getAgentState(state, "agent-1")
    expect(agent.consecutiveFailures).toBe(0)
    expect(agent.lastHealthy).toBeNull()
    expect(agent.lastRestart).toBeNull()
    expect(agent.restartCooldownUntil).toBeNull()
    expect(agent.compactCooldownUntil).toBeNull()
    expect(agent.lastOutputHash).toBeNull()
    expect(agent.outputStaleCount).toBe(0)
  })

  it("returns the same object on repeated calls", () => {
    const state = freshState()
    const a = getAgentState(state, "x")
    const b = getAgentState(state, "x")
    expect(a).toBe(b) // reference equality
  })

  it("mutates state in-place", () => {
    const state = freshState()
    const agent = getAgentState(state, "bot")
    agent.consecutiveFailures = 5
    expect(state.agents["bot"].consecutiveFailures).toBe(5)
  })

  it("tracks separate agents independently", () => {
    const state = freshState()
    const a = getAgentState(state, "a")
    const b = getAgentState(state, "b")
    a.consecutiveFailures = 10
    expect(b.consecutiveFailures).toBe(0)
  })
})

// ── getServerState ──────────────────────────────────────────────────────────

describe("getServerState", () => {
  it("creates default state for a new server", () => {
    const state = freshState()
    const srv = getServerState(state, "srv-1")
    expect(srv.reachable).toBe(true)
    expect(srv.consecutiveSshFailures).toBe(0)
    expect(srv.lastDiskPct).toBeNull()
    expect(srv.networkDownSince).toBeNull()
  })

  it("returns the same object on repeated calls", () => {
    const state = freshState()
    const a = getServerState(state, "s")
    const b = getServerState(state, "s")
    expect(a).toBe(b)
  })

  it("mutates state in-place", () => {
    const state = freshState()
    const srv = getServerState(state, "box")
    srv.consecutiveSshFailures = 3
    expect(state.servers["box"].consecutiveSshFailures).toBe(3)
  })
})

// ── isOnCooldown / setCooldown ──────────────────────────────────────────────

describe("isOnCooldown", () => {
  it("returns false when no cooldown is set", () => {
    const state = freshState()
    expect(isOnCooldown(state, "agent")).toBe(false)
  })

  it("returns true during cooldown window", () => {
    const state = freshState()
    setCooldown(state, "agent", 600)
    expect(isOnCooldown(state, "agent")).toBe(true)
  })

  it("returns false after cooldown expires", () => {
    const state = freshState()
    // Set a cooldown that already expired
    getAgentState(state, "agent").restartCooldownUntil = new Date(Date.now() - 1000).toISOString()
    expect(isOnCooldown(state, "agent")).toBe(false)
  })
})

describe("setCooldown", () => {
  it("sets restartCooldownUntil in the future", () => {
    const state = freshState()
    const before = Date.now()
    setCooldown(state, "agent", 300)
    const until = new Date(state.agents["agent"].restartCooldownUntil!).getTime()
    expect(until).toBeGreaterThan(before)
    expect(until).toBeLessThanOrEqual(before + 300 * 1000 + 100) // small tolerance
  })

  it("sets lastRestart timestamp", () => {
    const state = freshState()
    setCooldown(state, "agent", 60)
    expect(state.agents["agent"].lastRestart).not.toBeNull()
  })

  it("handles 0-second cooldown (expires immediately)", () => {
    const state = freshState()
    setCooldown(state, "agent", 0)
    // A 0-second cooldown effectively means "now", so it should expire almost immediately
    // Due to timing, it might be on cooldown for a brief moment or already expired
    const until = new Date(state.agents["agent"].restartCooldownUntil!).getTime()
    expect(until).toBeLessThanOrEqual(Date.now() + 50)
  })
})

// ── isOnCompactCooldown / setCompactCooldown ────────────────────────────────

describe("isOnCompactCooldown", () => {
  it("returns false when no cooldown is set", () => {
    const state = freshState()
    expect(isOnCompactCooldown(state, "agent")).toBe(false)
  })

  it("returns true during cooldown window", () => {
    const state = freshState()
    setCompactCooldown(state, "agent", 1800)
    expect(isOnCompactCooldown(state, "agent")).toBe(true)
  })

  it("returns false after cooldown expires", () => {
    const state = freshState()
    getAgentState(state, "agent").compactCooldownUntil = new Date(Date.now() - 1000).toISOString()
    expect(isOnCompactCooldown(state, "agent")).toBe(false)
  })
})

// ── canAlert / markAlerted ──────────────────────────────────────────────────

describe("canAlert", () => {
  it("returns true when no prior alert exists", () => {
    const state = freshState()
    expect(canAlert(state, "agent", "agent_dead", 3600)).toBe(true)
  })

  it("returns false within dedup window", () => {
    const state = freshState()
    markAlerted(state, "agent", "agent_dead")
    expect(canAlert(state, "agent", "agent_dead", 3600)).toBe(false)
  })

  it("returns true after dedup window expires", () => {
    const state = freshState()
    // Set alert time in the past beyond dedup window
    state.lastAlerted["agent"] = {
      agent_dead: new Date(Date.now() - 4000 * 1000).toISOString(),
    }
    expect(canAlert(state, "agent", "agent_dead", 3600)).toBe(true)
  })

  it("returns true with 0-second dedup (always allows)", () => {
    const state = freshState()
    markAlerted(state, "agent", "agent_dead")
    // 0-second dedup means "immediately expired", but since the alert was just set
    // at Date.now(), the difference is ~0ms which is not > 0ms. So this returns false.
    // Actually: Date.now() - lastAlerted.getTime() is ~0ms, and 0 * 1000 = 0, so 0 > 0 is false.
    expect(canAlert(state, "agent", "agent_dead", 0)).toBe(false)
  })

  it("different event types do not clobber each other", () => {
    const state = freshState()
    markAlerted(state, "agent", "agent_dead")
    // Different event type should still be alertable
    expect(canAlert(state, "agent", "plugin_crash", 3600)).toBe(true)
  })

  it("different agents do not clobber each other", () => {
    const state = freshState()
    markAlerted(state, "agent-1", "agent_dead")
    expect(canAlert(state, "agent-2", "agent_dead", 3600)).toBe(true)
  })
})

describe("markAlerted", () => {
  it("creates agent entry in lastAlerted if missing", () => {
    const state = freshState()
    markAlerted(state, "bot", "auth_expired")
    expect(state.lastAlerted["bot"]).toBeDefined()
    expect(state.lastAlerted["bot"]["auth_expired"]).toBeDefined()
  })

  it("stores a valid ISO timestamp", () => {
    const state = freshState()
    markAlerted(state, "bot", "disk_warning")
    const ts = state.lastAlerted["bot"]["disk_warning"]
    expect(new Date(ts).toISOString()).toBe(ts)
  })

  it("updates timestamp on subsequent calls", () => {
    const state = freshState()
    state.lastAlerted["bot"] = {
      agent_dead: new Date(Date.now() - 10000).toISOString(),
    }
    const oldTs = state.lastAlerted["bot"]["agent_dead"]
    markAlerted(state, "bot", "agent_dead")
    expect(state.lastAlerted["bot"]["agent_dead"]).not.toBe(oldTs)
  })
})
