import { describe, it, expect, afterEach } from "bun:test"
import { status } from "../src/commands/status"
import { setupFleetDir, captureConsole, SMOKE_MINIMAL_YAML } from "./smoke-helpers"

let cleanup: (() => void) | null = null
let consoleCap: ReturnType<typeof captureConsole> | null = null

afterEach(() => {
  consoleCap?.restore()
  consoleCap = null
  cleanup?.()
  cleanup = null
})

// Use only local agents to avoid SSH calls
const TWO_LOCAL_AGENTS_YAML = `\
fleet:
  name: status-test

discord:
  channels:
    default:
      id: "123456789012345678"

defaults:
  workspace: ~/workspace

agents:
  lead:
    role: lead
    server: local
    identity: identities/lead.md
  coder:
    role: coder
    server: local
    identity: identities/coder.md
`

describe("smoke: status", () => {
  it("outputs valid JSON with correct shape", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await status({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1) // solo agent

    const agent = parsed[0]
    expect(agent).toHaveProperty("name")
    expect(agent).toHaveProperty("server")
    expect(agent).toHaveProperty("role")
    expect(agent).toHaveProperty("state")
    expect(agent).toHaveProperty("session")
    expect(agent).toHaveProperty("heartbeat")
    expect(agent).toHaveProperty("lastSeen")
    expect(agent).toHaveProperty("ageSec")
  })

  it("reports all agents from config", async () => {
    const fleet = setupFleetDir(TWO_LOCAL_AGENTS_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await status({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.length).toBe(2)

    const names = parsed.map((a: any) => a.name).sort()
    expect(names).toEqual(["coder", "lead"])
  })

  it("shows agents as 'off' or 'error' (no real tmux sessions)", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await status({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    for (const agent of parsed) {
      expect(["off", "error"]).toContain(agent.state)
    }
  })

  it("shows heartbeat as 'unknown' when no heartbeat file exists", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await status({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    for (const agent of parsed) {
      expect(agent.heartbeat).toBe("unknown")
    }
  })

  it("produces non-empty plain text output", async () => {
    const fleet = setupFleetDir(TWO_LOCAL_AGENTS_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()

    await status({ json: false })

    consoleCap.restore()
    const output = consoleCap.logs.join("\n")
    // Should contain agent names
    expect(output).toContain("lead")
    expect(output).toContain("coder")
  })
})
