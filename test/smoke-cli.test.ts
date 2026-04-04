import { describe, it, expect, afterEach } from "bun:test"
import { main } from "../src/cli"
import {
  setupFleetDir,
  captureConsole,
  interceptExit,
  ExitError,
  SMOKE_MINIMAL_YAML,
  SMOKE_MULTI_YAML,
} from "./smoke-helpers"

let cleanup: (() => void) | null = null
let consoleCap: ReturnType<typeof captureConsole> | null = null
let restoreExit: (() => void) | null = null

afterEach(() => {
  consoleCap?.restore()
  consoleCap = null
  restoreExit?.()
  restoreExit = null
  cleanup?.()
  cleanup = null
})

describe("smoke: CLI dispatch", () => {
  it("fleet help prints usage text", async () => {
    consoleCap = captureConsole()

    await main(["node", "fleet", "help"])

    consoleCap.restore()
    const output = consoleCap.logs.join("\n")
    expect(output).toContain("fleet — Agent fleet CLI")
    expect(output).toContain("Usage:")
  })

  it("fleet --version prints version string", async () => {
    consoleCap = captureConsole()

    await main(["node", "fleet", "--version"])

    consoleCap.restore()
    const output = consoleCap.logs.join("\n")
    expect(output).toContain("fleet 0.1.0")
  })

  it("unknown command exits 1 with error message", async () => {
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    let exitCode: number | null = null
    try {
      await main(["node", "fleet", "bogus"])
    } catch (err) {
      if (err instanceof ExitError) exitCode = err.code
      else throw err
    }

    consoleCap.restore()
    expect(exitCode).toBe(1)
    const stderr = consoleCap.errors.join("\n")
    expect(stderr).toContain("Unknown command")
  })

  it("fleet start without agent arg exits 1 with usage hint", async () => {
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    let exitCode: number | null = null
    try {
      await main(["node", "fleet", "start"])
    } catch (err) {
      if (err instanceof ExitError) exitCode = err.code
      else throw err
    }

    consoleCap.restore()
    expect(exitCode).toBe(1)
    const stderr = consoleCap.errors.join("\n")
    expect(stderr).toContain("Usage:")
  })

  it("fleet validate dispatches correctly with valid config", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    // Should not throw — valid config
    await main(["node", "fleet", "validate", "--json"])

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.valid).toBe(true)
  })

  it("fleet move dispatches with correct arg parsing", async () => {
    const fleet = setupFleetDir(SMOKE_MULTI_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await main(["node", "fleet", "move", "hub", "staging", "--json"])

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.status).toBe("moved")
    expect(parsed.to).toBe("staging")
  })

  it("fleet status --json dispatches and returns array", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await main(["node", "fleet", "status", "--json"])

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(parsed[0].name).toBe("solo")
  })
})
