import { describe, it, expect, afterEach } from "bun:test"
import { writeFileSync } from "fs"
import { join } from "path"
import { validate } from "../src/commands/validate"
import {
  setupFleetDir,
  captureConsole,
  interceptExit,
  ExitError,
  SMOKE_MINIMAL_YAML,
  SMOKE_MULTI_YAML,
  SMOKE_INVALID_SNOWFLAKE_YAML,
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

describe("smoke: validate", () => {
  it("passes on a valid minimal config", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    // Should not throw ExitError — valid config
    await validate({ json: false })

    consoleCap.restore()
    const output = consoleCap.logs.join("\n")
    expect(output).toContain("Fleet Validate")
  })

  it("returns valid JSON on a valid config with --json", async () => {
    const fleet = setupFleetDir(SMOKE_MINIMAL_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    await validate({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.valid).toBe(true)
    expect(Array.isArray(parsed.results)).toBe(true)
    expect(parsed.results.length).toBeGreaterThan(0)
    // Check that parse check passed
    const parseResult = parsed.results.find((r: any) => r.check === "parse")
    expect(parseResult?.status).toBe("pass")
  })

  it("fails on invalid snowflake channel ID", async () => {
    const fleet = setupFleetDir(SMOKE_INVALID_SNOWFLAKE_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    let exitCode: number | null = null
    try {
      await validate({ json: false })
    } catch (err) {
      if (err instanceof ExitError) exitCode = err.code
      else throw err
    }

    expect(exitCode).toBe(1)
  })

  it("returns valid=false JSON on invalid snowflake", async () => {
    const fleet = setupFleetDir(SMOKE_INVALID_SNOWFLAKE_YAML)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    let exitCode: number | null = null
    try {
      await validate({ json: true })
    } catch (err) {
      if (err instanceof ExitError) exitCode = err.code
      else throw err
    }

    expect(exitCode).toBe(1)
    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.valid).toBe(false)
    const channelFail = parsed.results.find((r: any) => r.check === "channel:default")
    expect(channelFail?.status).toBe("fail")
  })

  it("fails on missing agent role", async () => {
    const yaml = `\
fleet:
  name: bad-agent

discord:
  channels:
    default:
      id: "123456789012345678"

defaults:
  workspace: ~/workspace

agents:
  broken:
    server: local
    identity: identities/broken.md
`
    const fleet = setupFleetDir(yaml)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    let exitCode: number | null = null
    try {
      await validate({ json: true })
    } catch (err) {
      if (err instanceof ExitError) exitCode = err.code
      else throw err
    }

    expect(exitCode).toBe(1)
    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.valid).toBe(false)
    const roleFail = parsed.results.find((r: any) => r.check === "agent:broken:role")
    expect(roleFail?.status).toBe("fail")
  })

  it("fails on duplicate tokenEnv", async () => {
    const yaml = `\
fleet:
  name: dup-tokens

discord:
  channels:
    default:
      id: "123456789012345678"

defaults:
  workspace: ~/workspace

agents:
  bot-a:
    role: worker
    token_env: SHARED_TOKEN
    server: local
    identity: identities/a.md
  bot-b:
    role: worker
    token_env: SHARED_TOKEN
    server: local
    identity: identities/b.md
`
    const fleet = setupFleetDir(yaml)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    let exitCode: number | null = null
    try {
      await validate({ json: true })
    } catch (err) {
      if (err instanceof ExitError) exitCode = err.code
      else throw err
    }

    expect(exitCode).toBe(1)
    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    const dupFail = parsed.results.find((r: any) => r.check === "agent:duplicate_token")
    expect(dupFail?.status).toBe("fail")
  })

  it("validates structure block with valid topology and lead", async () => {
    const yaml = `\
fleet:
  name: struct-fleet

discord:
  channels:
    default:
      id: "123456789012345678"

defaults:
  workspace: ~/workspace

structure:
  topology: star
  lead: hub

agents:
  hub:
    role: lead
    server: local
    identity: identities/hub.md
  worker:
    role: coder
    server: local
    identity: identities/worker.md
`
    const fleet = setupFleetDir(yaml)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    await validate({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.valid).toBe(true)
    const topoResult = parsed.results.find((r: any) => r.check === "structure:topology")
    expect(topoResult?.status).toBe("pass")
    const leadResult = parsed.results.find((r: any) => r.check === "structure:lead")
    expect(leadResult?.status).toBe("pass")
  })

  it("warns on unreferenced server", async () => {
    const yaml = `\
fleet:
  name: unused-srv

discord:
  channels:
    default:
      id: "123456789012345678"

defaults:
  workspace: ~/workspace

agents:
  solo:
    role: worker
    server: local
    identity: identities/solo.md

servers:
  orphan:
    ssh_host: 10.0.0.99
    user: deploy
`
    const fleet = setupFleetDir(yaml)
    cleanup = fleet.cleanup
    consoleCap = captureConsole()
    restoreExit = interceptExit()

    // Should not exit(1) — warnings don't cause failure
    await validate({ json: true })

    consoleCap.restore()
    const parsed = JSON.parse(consoleCap.logs.join(""))
    expect(parsed.valid).toBe(true)
    const unusedWarn = parsed.results.find((r: any) => r.check === "server:orphan:unused")
    expect(unusedWarn?.status).toBe("warn")
  })
})
