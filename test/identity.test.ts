import { describe, it, expect } from "bun:test"
import { buildIdentityPrompt, buildRosterClaudeMd, writeRoster, updateAllRosters } from "../src/core/identity"
import { resolveStateDir } from "../src/core/config"
import { readFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import type { FleetConfig } from "../src/core/types"

const config: FleetConfig = {
  fleet: { name: "crew" },
  discord: { channelId: "chan123" },
  defaults: { workspace: "~/workspace" },
  agents: {
    pm: { role: "lead", tokenEnv: "T_PM", server: "local", identity: "identities/pm.md" },
    worker: { role: "worker", tokenEnv: "T_W", server: "local", identity: "identities/worker.md" },
  },
}
const botIds = { pm: "111", worker: "222" }

describe("buildIdentityPrompt", () => {
  it("contains agent name and role", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("pm")
    expect(prompt).toContain("lead")
    expect(prompt).toContain("111")
  })

  it("does NOT contain team roster (roster is in CLAUDE.md now)", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).not.toContain("## Team")
  })

  it("contains channel info", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("chan123")
  })

  it("contains Discord formatting rules", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("Do NOT use markdown tables")
    expect(prompt).toContain("2000 chars")
  })

  it("contains reply-via-Discord rule", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt.toLowerCase()).toContain("discord reply")
  })
})

describe("buildRosterClaudeMd", () => {
  it("contains peer names and bot IDs", () => {
    const roster = buildRosterClaudeMd("pm", config, botIds)
    expect(roster).toContain("worker")
    expect(roster).toContain("222")
  })

  it("does not contain self as a peer", () => {
    const roster = buildRosterClaudeMd("pm", config, botIds)
    // pm should be in the header but not as a teammate entry
    expect(roster).toContain("pm")
    expect(roster).not.toContain("- **pm**")
  })

  it("contains mention syntax", () => {
    const roster = buildRosterClaudeMd("pm", config, botIds)
    expect(roster).toContain("<@222>")
  })
})

describe("writeRoster", () => {
  const TMP = join(import.meta.dir, ".tmp-roster-test")

  it("writes .claude/CLAUDE.md to stateDir", () => {
    mkdirSync(TMP, { recursive: true })
    writeRoster("pm", config, botIds, TMP)
    const content = readFileSync(join(TMP, ".claude", "CLAUDE.md"), "utf8")
    expect(content).toContain("worker")
    expect(content).toContain("222")
    rmSync(TMP, { recursive: true })
  })
})

describe("updateAllRosters", () => {
  const TMP = join(import.meta.dir, ".tmp-all-roster-test")

  it("updates roster for every agent", () => {
    const mockResolve = (name: string) => join(TMP, name)
    updateAllRosters(config, botIds, mockResolve)

    const pmRoster = readFileSync(join(TMP, "pm", ".claude", "CLAUDE.md"), "utf8")
    const workerRoster = readFileSync(join(TMP, "worker", ".claude", "CLAUDE.md"), "utf8")

    expect(pmRoster).toContain("worker")
    expect(pmRoster).not.toContain("- **pm**")
    expect(workerRoster).toContain("pm")
    expect(workerRoster).not.toContain("- **worker**")

    rmSync(TMP, { recursive: true })
  })
})

// Task 3: Collaboration norms
describe("buildIdentityPrompt — collaboration norms", () => {
  it("contains ack norm (immediately + react)", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt.toLowerCase()).toContain("immediately")
    expect(prompt.toLowerCase()).toContain("react")
  })

  it("contains failure norm (can't)", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("can't")
  })

  it("contains handoff norm (@mention)", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("@mention")
  })

  it("contains completion norm (finish)", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt.toLowerCase()).toContain("finish")
  })

  it("does NOT contain old 'Report concisely' rule", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).not.toContain("Report concisely")
  })
})

// Task 4: Manager knowledge injection
const managerConfig: FleetConfig = {
  fleet: { name: "crew" },
  structure: { topology: "star", lead: "pm" },
  discord: { channelId: "chan123" },
  defaults: { workspace: "~/workspace" },
  agents: {
    pm: { role: "lead", tokenEnv: "T_PM", server: "local", identity: "identities/pm.md" },
    worker: { role: "worker", tokenEnv: "T_W", server: "local", identity: "identities/worker.md" },
  },
}

describe("buildIdentityPrompt — manager knowledge injection", () => {
  it("lead's identity contains fleet management commands", () => {
    const prompt = buildIdentityPrompt("pm", managerConfig, botIds)
    expect(prompt).toContain("fleet status")
    expect(prompt).toContain("fleet doctor")
    expect(prompt).toContain("fleet inject")
    expect(prompt.toLowerCase()).toContain("coordinator")
  })

  it("worker's identity does NOT contain Fleet Management section", () => {
    const prompt = buildIdentityPrompt("worker", managerConfig, botIds)
    expect(prompt).not.toContain("Fleet Management")
  })
})
