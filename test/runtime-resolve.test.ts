import { describe, it, expect } from "bun:test"
import { resolveRuntime } from "../src/runtime/resolve"
import { TmuxLocal } from "../src/runtime/tmux"
import { TmuxRemote } from "../src/runtime/remote"
import type { FleetConfig } from "../src/core/types"

function makeConfig(overrides?: Partial<FleetConfig>): FleetConfig {
  return {
    fleet: { name: "test-fleet", mission: "testing" },
    discord: { channels: {} },
    agents: {},
    ...overrides,
  } as FleetConfig
}

describe("resolveRuntime", () => {
  it("returns TmuxLocal for a local agent", () => {
    const config = makeConfig({
      agents: {
        "bot-1": { server: "local", role: "coder", token: "env:T" },
      },
    })
    const runtime = resolveRuntime("bot-1", config)
    expect(runtime).toBeInstanceOf(TmuxLocal)
  })

  it("returns TmuxRemote for a remote agent with valid server config", () => {
    const config = makeConfig({
      agents: {
        "bot-2": { server: "remote-box", role: "coder", token: "env:T" },
      },
      servers: {
        "remote-box": { sshHost: "10.0.0.5", user: "ubuntu" },
      },
    })
    const runtime = resolveRuntime("bot-2", config)
    expect(runtime).toBeInstanceOf(TmuxRemote)
  })

  it("throws for an unknown agent name", () => {
    const config = makeConfig()
    expect(() => resolveRuntime("nonexistent", config)).toThrow("Unknown agent")
  })

  it("throws when remote server config is missing", () => {
    const config = makeConfig({
      agents: {
        "bot-3": { server: "missing-server", role: "coder", token: "env:T" },
      },
    })
    expect(() => resolveRuntime("bot-3", config)).toThrow("not defined in fleet.yaml")
  })

  it("distinguishes between multiple agents on different runtimes", () => {
    const config = makeConfig({
      agents: {
        "local-agent": { server: "local", role: "lead", token: "env:T1" },
        "remote-agent": { server: "srv", role: "coder", token: "env:T2" },
      },
      servers: {
        srv: { sshHost: "192.168.1.1", user: "deploy" },
      },
    })
    expect(resolveRuntime("local-agent", config)).toBeInstanceOf(TmuxLocal)
    expect(resolveRuntime("remote-agent", config)).toBeInstanceOf(TmuxRemote)
  })
})
