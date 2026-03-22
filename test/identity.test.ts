import { describe, it, expect } from "bun:test"
import { buildIdentityPrompt } from "../src/core/identity"
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

  it("contains team roster with peer bot IDs but not self", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    // peer worker should appear with their bot ID
    expect(prompt).toContain("worker")
    expect(prompt).toContain("222")
    // self bot ID should only appear in header, not duplicated as a peer entry
    // Verify the peer section lists worker but not pm as a peer
    const teamSection = prompt.split("## Team")[1]?.split("##")[0] ?? ""
    expect(teamSection).toContain("worker")
    expect(teamSection).not.toContain("- pm")
  })

  it("contains channel info", () => {
    const prompt = buildIdentityPrompt("pm", config, botIds)
    expect(prompt).toContain("chan123")
    const channelSection = prompt.split("## Channel")[1]?.split("##")[0] ?? ""
    expect(channelSection).toContain("chan123")
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
