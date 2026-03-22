import { describe, it, expect, afterEach } from "bun:test"
import { mkdirSync, existsSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { writeAccessConfig, readAccessConfig } from "../src/channel/discord/access"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `fleet-access-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("writeAccessConfig", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it("creates access.json in the given stateDir", () => {
    dir = makeTempDir()
    writeAccessConfig(dir, {
      partnerBotIds: ["111222333444555666"],
      channelId: "999888777666555444",
      requireMention: true,
    })
    expect(existsSync(join(dir, "access.json"))).toBe(true)
  })

  it("creates stateDir if it does not exist (mkdir -p behaviour)", () => {
    const base = makeTempDir()
    dir = base
    const nested = join(base, "deep", "nested", "dir")
    writeAccessConfig(nested, {
      partnerBotIds: ["111"],
      channelId: "222",
      requireMention: false,
    })
    expect(existsSync(join(nested, "access.json"))).toBe(true)
  })

  it("uses correct field name dmPolicy (not 'policy')", () => {
    dir = makeTempDir()
    writeAccessConfig(dir, {
      partnerBotIds: ["bot1"],
      channelId: "chan1",
      requireMention: true,
    })
    const cfg = readAccessConfig(dir)
    expect((cfg as Record<string, unknown>).dmPolicy).toBeDefined()
    expect((cfg as Record<string, unknown>).policy).toBeUndefined()
  })

  it("dmPolicy value is 'allowlist' (not 'whitelist')", () => {
    dir = makeTempDir()
    writeAccessConfig(dir, {
      partnerBotIds: ["bot1"],
      channelId: "chan1",
      requireMention: true,
    })
    const cfg = readAccessConfig(dir)
    expect(cfg.dmPolicy).toBe("allowlist")
  })

  it("uses correct field name allowFrom (not 'allowedUserIds', not 'allowedFrom')", () => {
    dir = makeTempDir()
    writeAccessConfig(dir, {
      partnerBotIds: ["bot1"],
      channelId: "chan1",
      requireMention: true,
    })
    const cfg = readAccessConfig(dir)
    expect((cfg as Record<string, unknown>).allowFrom).toBeDefined()
    expect((cfg as Record<string, unknown>).allowedUserIds).toBeUndefined()
    expect((cfg as Record<string, unknown>).allowedFrom).toBeUndefined()
  })

  it("allowFrom contains the partner bot IDs", () => {
    dir = makeTempDir()
    const partnerBotIds = ["111222333444555666", "999888777666555444"]
    writeAccessConfig(dir, {
      partnerBotIds,
      channelId: "chan1",
      requireMention: true,
    })
    const cfg = readAccessConfig(dir)
    expect(cfg.allowFrom).toEqual(partnerBotIds)
  })

  it("groups is keyed by channelId", () => {
    dir = makeTempDir()
    const channelId = "1484935861769601169"
    writeAccessConfig(dir, {
      partnerBotIds: ["bot1"],
      channelId,
      requireMention: true,
    })
    const cfg = readAccessConfig(dir)
    expect(cfg.groups[channelId]).toBeDefined()
  })

  it("group entry has requireMention set correctly", () => {
    dir = makeTempDir()
    const channelId = "123"
    writeAccessConfig(dir, {
      partnerBotIds: ["bot1"],
      channelId,
      requireMention: false,
    })
    const cfg = readAccessConfig(dir)
    expect(cfg.groups[channelId].requireMention).toBe(false)
  })

  it("group entry has allowFrom as empty array", () => {
    dir = makeTempDir()
    const channelId = "123"
    writeAccessConfig(dir, {
      partnerBotIds: ["bot1"],
      channelId,
      requireMention: true,
    })
    const cfg = readAccessConfig(dir)
    expect(cfg.groups[channelId].allowFrom).toEqual([])
  })

  it("pending is an empty object", () => {
    dir = makeTempDir()
    writeAccessConfig(dir, {
      partnerBotIds: ["bot1"],
      channelId: "chan1",
      requireMention: true,
    })
    const cfg = readAccessConfig(dir)
    expect(cfg.pending).toEqual({})
  })
})

describe("readAccessConfig", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it("reads back exactly what was written", () => {
    dir = makeTempDir()
    const channelId = "1484935861769601169"
    const partnerBotIds = ["1484936271708291124"]
    writeAccessConfig(dir, { partnerBotIds, channelId, requireMention: true })
    const cfg = readAccessConfig(dir)

    expect(cfg.dmPolicy).toBe("allowlist")
    expect(cfg.allowFrom).toEqual(partnerBotIds)
    expect(cfg.groups[channelId].requireMention).toBe(true)
    expect(cfg.groups[channelId].allowFrom).toEqual([])
    expect(cfg.pending).toEqual({})
  })

  it("throws when access.json does not exist", () => {
    dir = makeTempDir()
    expect(() => readAccessConfig(dir)).toThrow()
  })
})
