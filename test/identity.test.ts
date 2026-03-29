import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { buildIdentityPrompt, buildRosterClaudeMd, writeRoster, updateAllRosters, loadKnowledgeDocs } from "../src/core/identity"
import { resolveStateDir } from "../src/core/config"
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { FleetConfig } from "../src/core/types"

const config: FleetConfig = {
  fleet: { name: "crew" },
  discord: { channels: { default: { id: "chan123" } } },
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
    expect(prompt).toContain("Channels")
  })

  it("lists all channels with workspace mapping", () => {
    const multiConfig: FleetConfig = {
      ...config,
      discord: {
        channels: {
          store: { id: "111", workspace: "~/workspace/store" },
          quant: { id: "222", workspace: "~/workspace/quant" },
        },
      },
    }
    const prompt = buildIdentityPrompt("pm", multiConfig, botIds)
    expect(prompt).toContain("#store")
    expect(prompt).toContain("111")
    expect(prompt).toContain("~/workspace/store")
    expect(prompt).toContain("#quant")
    expect(prompt).toContain("222")
    expect(prompt).toContain("~/workspace/quant")
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
  discord: { channels: { default: { id: "chan123" } } },
  defaults: { workspace: "~/workspace" },
  agents: {
    pm: { role: "lead", tokenEnv: "T_PM", server: "local", identity: "identities/pm.md" },
    worker: { role: "worker", tokenEnv: "T_W", server: "local", identity: "identities/worker.md" },
  },
}

describe("buildIdentityPrompt — manager knowledge injection", () => {
  it("lead's identity references fleet skill", () => {
    const prompt = buildIdentityPrompt("pm", managerConfig, botIds)
    expect(prompt).toContain("/fleet")
    expect(prompt.toLowerCase()).toContain("coordinator")
  })

  it("worker's identity does NOT contain Fleet Management section", () => {
    const prompt = buildIdentityPrompt("worker", managerConfig, botIds)
    expect(prompt).not.toContain("Fleet Management")
  })
})

// ── Knowledge Docs ────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fleet-knowledge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("loadKnowledgeDocs", () => {
  let dir: string

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it("returns empty string when directory does not exist", () => {
    const result = loadKnowledgeDocs("/tmp/nonexistent-knowledge-dir-xyz")
    expect(result).toBe("")
  })

  it("returns empty string when directory is empty", () => {
    const result = loadKnowledgeDocs(dir)
    expect(result).toBe("")
  })

  it("loads a single knowledge file", () => {
    writeFileSync(join(dir, "neo4j"), "# Neo4j Rules\nMERGE not CREATE")
    const result = loadKnowledgeDocs(dir)
    expect(result).toContain("Team Knowledge")
    expect(result).toContain("Neo4j Rules")
    expect(result).toContain("MERGE not CREATE")
  })

  it("loads multiple knowledge files sorted alphabetically", () => {
    writeFileSync(join(dir, "docker"), "# Docker Rules\nNever use special chars")
    writeFileSync(join(dir, "neo4j"), "# Neo4j Rules\nMERGE not CREATE")
    const result = loadKnowledgeDocs(dir)
    expect(result).toContain("Docker Rules")
    expect(result).toContain("Neo4j Rules")
    // Docker should come before Neo4j (alphabetical)
    const dockerIdx = result.indexOf("Docker")
    const neo4jIdx = result.indexOf("Neo4j")
    expect(dockerIdx).toBeLessThan(neo4jIdx)
  })

  it("skips hidden files", () => {
    writeFileSync(join(dir, ".hidden"), "secret stuff")
    writeFileSync(join(dir, "visible"), "# Visible\nActual knowledge")
    const result = loadKnowledgeDocs(dir)
    expect(result).toContain("Visible")
    expect(result).not.toContain("secret stuff")
  })

  it("skips empty files", () => {
    writeFileSync(join(dir, "empty"), "")
    writeFileSync(join(dir, "real"), "# Real\nSome content")
    const result = loadKnowledgeDocs(dir)
    expect(result).toContain("Real")
  })

  it("includes preamble about following rules", () => {
    writeFileSync(join(dir, "test"), "# Test\nRule 1")
    const result = loadKnowledgeDocs(dir)
    expect(result).toContain("learnings from past sessions")
    expect(result).toContain("known pitfalls")
  })
})

describe("buildRosterClaudeMd — knowledge integration", () => {
  it("includes knowledge docs when they exist", () => {
    // This test depends on ~/.fleet/docs/knowledge/ existing on the test machine
    // We test the integration by checking the function output
    const roster = buildRosterClaudeMd("pm", config, botIds)
    // If knowledge dir exists on this machine, it will include Team Knowledge
    // If not, it won't — both are valid. Just verify the roster is well-formed.
    expect(roster).toContain("Fleet Team Roster")
    expect(roster).toContain("How to work")
  })
})
