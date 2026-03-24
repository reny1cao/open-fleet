import { describe, expect, it } from "bun:test"
import {
  expandHomePath,
  resolveBundledCodexWorkerCommand,
  resolveCodexRemoteBundleDir,
  resolveCodexStateDir,
  resolveLocalCodexWorkerCommand,
  resolveRemoteCodexWorkerCommand,
} from "../src/agents/codex/bootstrap"

describe("expandHomePath", () => {
  it("expands tilde-prefixed paths", () => {
    expect(expandHomePath("~/workspace", "/home/dev")).toBe("/home/dev/workspace")
    expect(expandHomePath("~", "/home/dev")).toBe("/home/dev")
  })

  it("leaves absolute paths unchanged", () => {
    expect(expandHomePath("/srv/workspace", "/home/dev")).toBe("/srv/workspace")
  })
})

describe("resolveCodexStateDir", () => {
  it("uses the configured state_dir when present", () => {
    expect(resolveCodexStateDir("forge", "~/state/forge", "/home/dev")).toBe("/home/dev/state/forge")
  })

  it("falls back to the default per-agent state dir", () => {
    expect(resolveCodexStateDir("forge", undefined, "/home/dev")).toBe("/home/dev/.fleet/state/discord-forge")
  })
})

describe("resolveCodexRemoteBundleDir", () => {
  it("stages the worker under the agent state dir", () => {
    expect(resolveCodexRemoteBundleDir("/home/dev/.fleet/state/discord-forge")).toBe(
      "/home/dev/.fleet/state/discord-forge/fleet-runtime",
    )
  })
})

describe("Codex worker commands", () => {
  it("preserves the existing local bun command", () => {
    expect(resolveLocalCodexWorkerCommand("/tmp/src/index.ts", "forge")).toBe(
      "bun run '/tmp/src/index.ts' run-agent 'forge'",
    )
  })

  it("uses the staged binary for remote workers", () => {
    expect(resolveRemoteCodexWorkerCommand("/tmp/fleet-next", "citadel")).toBe(
      "'/tmp/fleet-next' run-agent 'citadel'",
    )
  })

  it("uses the staged Bun bundle for remote workers", () => {
    expect(resolveBundledCodexWorkerCommand("/tmp/fleet-remote.mjs", "citadel")).toBe(
      "bun '/tmp/fleet-remote.mjs' run-agent 'citadel'",
    )
  })
})
