import { describe, expect, it } from "bun:test"
import { getAgentAdapterKind } from "../src/agents/resolve"
import type { FleetConfig } from "../src/core/types"

function makeConfig(): FleetConfig {
  return {
    fleet: { name: "test-fleet" },
    discord: {
      channels: {
        default: { id: "123" },
      },
    },
    defaults: {
      workspace: "~/workspace",
      agentAdapter: "claude",
    },
    agents: {
      lead: {
        role: "lead",
        tokenEnv: "DISCORD_BOT_TOKEN_LEAD",
        server: "local",
        identity: "identities/lead.md",
      },
      coder: {
        agentAdapter: "codex",
        role: "worker",
        tokenEnv: "DISCORD_BOT_TOKEN_CODER",
        server: "local",
        identity: "identities/coder.md",
      },
    },
  }
}

describe("getAgentAdapterKind", () => {
  it("falls back to defaults.agentAdapter", () => {
    const config = makeConfig()
    expect(getAgentAdapterKind("lead", config)).toBe("claude")
  })

  it("uses a per-agent override when present", () => {
    const config = makeConfig()
    expect(getAgentAdapterKind("coder", config)).toBe("codex")
  })
})
