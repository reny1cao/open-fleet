import { describe, it, expect, afterEach } from "bun:test"
import { move } from "../src/commands/move"
import { loadConfig } from "../src/core/config"
import { setupFleetDir, captureConsole, SMOKE_MULTI_YAML, SMOKE_MINIMAL_YAML } from "./smoke-helpers"

let cleanup: (() => void) | null = null
let consoleCap: ReturnType<typeof captureConsole> | null = null

afterEach(() => {
  consoleCap?.restore()
  consoleCap = null
  cleanup?.()
  cleanup = null
})

describe("smoke: move", () => {
  it("moves an agent from local to remote server", async () => {
    const fleet = setupFleetDir(SMOKE_MULTI_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await move("hub", "staging", { json: false })

    consoleCap.restore()
    const output = consoleCap.logs.join("\n")
    expect(output).toContain("Moved hub")
    expect(output).toContain("staging")

    // Verify config was rewritten
    const config = loadConfig(fleet.dir)
    expect(config.agents.hub.server).toBe("staging")
  })

  it("returns correct JSON on move", async () => {
    const fleet = setupFleetDir(SMOKE_MULTI_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await move("hub", "staging", { json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.agent).toBe("hub")
    expect(parsed.from).toBe("local")
    expect(parsed.to).toBe("staging")
    expect(parsed.status).toBe("moved")
  })

  it("reports no_change when already on target server", async () => {
    const fleet = setupFleetDir(SMOKE_MULTI_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await move("hub", "local", { json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.status).toBe("no_change")
  })

  it("throws on unknown agent", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup

    expect(move("nonexistent", "local", {})).rejects.toThrow("Unknown agent")
  })

  it("throws on unknown server", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup

    expect(move("solo", "bogus-server", {})).rejects.toThrow("not defined")
  })

  it("move to 'local' always valid without server config", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    // solo is already on local — no_change but no error
    await move("solo", "local", { json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.status).toBe("no_change")
  })

  it("persists config changes through save+reload", async () => {
    const fleet = setupFleetDir(SMOKE_MULTI_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await move("hub", "staging", {})
    consoleCap.restore()

    // Reload from disk
    const reloaded = loadConfig(fleet.dir)
    expect(reloaded.agents.hub.server).toBe("staging")
    // Other agents unchanged
    expect(reloaded.agents["worker-1"].server).toBe("staging")
  })
})
