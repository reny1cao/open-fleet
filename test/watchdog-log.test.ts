import { describe, it, expect } from "bun:test"
import { createEvent } from "../src/watchdog/log"

describe("createEvent", () => {
  it("returns all required WatchdogEvent fields", () => {
    const event = createEvent("watchdog_start", "info")
    expect(event).toHaveProperty("timestamp")
    expect(event).toHaveProperty("type")
    expect(event).toHaveProperty("server")
    expect(event).toHaveProperty("severity")
    expect(event).toHaveProperty("details")
    expect(event).toHaveProperty("action")
    expect(event).toHaveProperty("actionResult")
  })

  it("produces a valid ISO timestamp", () => {
    const event = createEvent("agent_dead", "critical")
    const parsed = new Date(event.timestamp)
    expect(parsed.toISOString()).toBe(event.timestamp)
  })

  it("sets type and severity from arguments", () => {
    const event = createEvent("plugin_crash", "warn")
    expect(event.type).toBe("plugin_crash")
    expect(event.severity).toBe("warn")
  })

  it("defaults server to 'local'", () => {
    const event = createEvent("watchdog_start", "info")
    expect(event.server).toBe("local")
  })

  it("defaults details to empty object", () => {
    const event = createEvent("watchdog_start", "info")
    expect(event.details).toEqual({})
  })

  it("defaults action and actionResult to null", () => {
    const event = createEvent("watchdog_start", "info")
    expect(event.action).toBeNull()
    expect(event.actionResult).toBeNull()
  })

  it("passes through agent when provided", () => {
    const event = createEvent("agent_dead", "critical", { agent: "bot-1" })
    expect(event.agent).toBe("bot-1")
  })

  it("passes through all optional fields when provided", () => {
    const event = createEvent("restart_completed", "info", {
      agent: "my-agent",
      server: "remote-1",
      details: { exitCode: 0, duration: 5.2 },
      action: "restart",
      actionResult: "success",
    })
    expect(event.agent).toBe("my-agent")
    expect(event.server).toBe("remote-1")
    expect(event.details).toEqual({ exitCode: 0, duration: 5.2 })
    expect(event.action).toBe("restart")
    expect(event.actionResult).toBe("success")
  })
})
