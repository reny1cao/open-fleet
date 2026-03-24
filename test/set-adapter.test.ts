import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { saveConfig, loadConfig } from "../src/core/config"
import { setAdapter } from "../src/commands/set-adapter"
import type { FleetConfig } from "../src/core/types"

const originalFleetConfig = process.env.FLEET_CONFIG

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
    },
  }
}

afterEach(() => {
  if (originalFleetConfig === undefined) {
    delete process.env.FLEET_CONFIG
  } else {
    process.env.FLEET_CONFIG = originalFleetConfig
  }
})

describe("setAdapter", () => {
  it("updates an existing agent to the requested adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-set-adapter-"))
    try {
      saveConfig(makeConfig(), dir)
      process.env.FLEET_CONFIG = join(dir, "fleet.yaml")

      await setAdapter("lead", "codex", {})

      const updated = loadConfig(dir)
      expect(updated.agents.lead.agentAdapter).toBe("codex")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
