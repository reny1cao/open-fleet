import { describe, it, expect, afterEach } from "bun:test"
import { doctor } from "../src/commands/doctor"
import { setupFleetDir, captureConsole, SMOKE_MINIMAL_YAML } from "./smoke-helpers"

let cleanup: (() => void) | null = null
let consoleCap: ReturnType<typeof captureConsole> | null = null

afterEach(() => {
  consoleCap?.restore()
  consoleCap = null
  cleanup?.()
  cleanup = null
})

describe("smoke: doctor", () => {
  it("does not crash and returns valid JSON", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await doctor({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)

    // Every result has the required shape
    for (const r of parsed) {
      expect(r).toHaveProperty("check")
      expect(r).toHaveProperty("status")
      expect(r).toHaveProperty("message")
      expect(["pass", "warn", "fail", "info"]).toContain(r.status)
    }
  }, 30000)

  it("reports config check as pass", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await doctor({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    const configCheck = parsed.find((r: any) => r.check === "config")
    expect(configCheck).toBeDefined()
    expect(configCheck.status).toBe("pass")
  }, 30000)

  it("reports token check as fail (no tokens set)", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    // Ensure no token env var is set
    const tokenKey = "DISCORD_BOT_TOKEN_SOLO"
    const origToken = process.env[tokenKey]
    delete process.env[tokenKey]

    try {
      await doctor({ json: true })
    } finally {
      if (origToken !== undefined) process.env[tokenKey] = origToken
    }

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    const tokenCheck = parsed.find((r: any) => r.check === "token:solo")
    expect(tokenCheck).toBeDefined()
    expect(tokenCheck.status).toBe("fail")
  }, 30000)

  it("includes prerequisite checks in results", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await doctor({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    const prereqChecks = parsed.filter((r: any) => r.check.startsWith("prereq:"))
    expect(prereqChecks.length).toBeGreaterThan(0)

    // bun should be found (we're running in bun)
    const bunCheck = parsed.find((r: any) => r.check === "prereq:bun")
    expect(bunCheck).toBeDefined()
    expect(bunCheck.status).toBe("pass")

    // tmux check should exist (may pass or fail depending on environment)
    const tmuxCheck = parsed.find((r: any) => r.check === "prereq:tmux")
    expect(tmuxCheck).toBeDefined()
    expect(["pass", "fail"]).toContain(tmuxCheck.status)
  }, 30000)
})
