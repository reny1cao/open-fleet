import { describe, it, expect, afterEach } from "bun:test"
import { setAdapter } from "../src/commands/set-adapter"
import { loadConfig } from "../src/core/config"
import { setupFleetDir, captureConsole, SMOKE_MINIMAL_YAML } from "./smoke-helpers"

let cleanup: (() => void) | null = null
let consoleCap: ReturnType<typeof captureConsole> | null = null

afterEach(() => {
  consoleCap?.restore()
  consoleCap = null
  cleanup?.()
  cleanup = null
})

describe("smoke: set-adapter", () => {
  it("switches claude → codex with JSON output", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await setAdapter("solo", "codex", { json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.agent).toBe("solo")
    expect(parsed.from).toBe("claude")
    expect(parsed.to).toBe("codex")
    expect(parsed.status).toBe("updated")
  })

  it("reports no_change when already using target adapter", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    // Default adapter is "claude", so setting to "claude" should be no-op
    await setAdapter("solo", "claude", { json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.status).toBe("no_change")
  })

  it("inherits default adapter correctly", async () => {
    const yaml = `\
fleet:
  name: codex-default

discord:
  channels:
    default:
      id: "123456789012345678"

defaults:
  workspace: ~/workspace
  agent_adapter: codex

agents:
  bot:
    role: worker
    server: local
    identity: identities/bot.md
`
    const fleet = setupFleetDir(yaml)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    // Agent inherits "codex" from defaults, so setting "codex" is no-op
    await setAdapter("bot", "codex", { json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.status).toBe("no_change")
  })

  it("throws on unknown agent", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup

    expect(setAdapter("ghost", "codex", {})).rejects.toThrow("Unknown agent")
  })

  it("switches codex → claude", async () => {
    const yaml = `\
fleet:
  name: codex-fleet

discord:
  channels:
    default:
      id: "123456789012345678"

defaults:
  workspace: ~/workspace

agents:
  coder:
    role: worker
    agent_adapter: codex
    server: local
    identity: identities/coder.md
`
    const fleet = setupFleetDir(yaml)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await setAdapter("coder", "claude", { json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.from).toBe("codex")
    expect(parsed.to).toBe("claude")
    expect(parsed.status).toBe("updated")
  })

  it("persists adapter change through save+reload", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await setAdapter("solo", "codex", {})
    consoleCap.restore()

    const reloaded = loadConfig(fleet.dir)
    expect(reloaded.agents.solo.agentAdapter).toBe("codex")
  })
})
