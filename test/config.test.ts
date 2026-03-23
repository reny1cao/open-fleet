import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  loadConfig,
  saveConfig,
  loadEnv,
  getToken,
  resolveStateDir,
  sessionName,
  findConfigDir,
  writeGlobalConfig,
} from "../src/core/config"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `fleet-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const VALID_FLEET_YAML = `\
fleet:
  name: test-fleet
  mission: testing

discord:
  channels:
    default:
      id: "111222333"
  server_id: "999888777"
  user_id: "555444333"

defaults:
  workspace: ~/workspace
  runtime: claude

agents:
  hub:
    role: hub
    token_env: DISCORD_BOT_TOKEN_HUB
    server: local
    identity: identities/hub.md
  worker-1:
    role: worker
    token_env: DISCORD_BOT_TOKEN_WORKER1
    server: local
    state_dir: ~/.fleet/state/discord-worker1
    identity: identities/worker-1.md

servers:
  staging:
    ssh_host: staging-server
    user: dev
`

const MINIMAL_FLEET_YAML = `\
fleet:
  name: mini-fleet

discord:
  channels:
    default:
      id: "123"

defaults:
  workspace: ~/workspace

agents:
  solo:
    role: worker
    server: local
    identity: identities/solo.md
`

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadConfig", () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("parses a valid fleet.yaml correctly", () => {
    writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
    const config = loadConfig(dir)

    expect(config.fleet.name).toBe("test-fleet")
    expect(config.fleet.mission).toBe("testing")
    expect(config.discord.channels["default"].id).toBe("111222333")
    expect(config.discord.serverId).toBe("999888777")
    expect(config.discord.userId).toBe("555444333")
    expect(config.defaults.workspace).toBe("~/workspace")
    expect(config.defaults.runtime).toBe("claude")
    expect(config.defaults.agentAdapter).toBe("claude")
  })

  it("parses agent fields correctly", () => {
    writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
    const config = loadConfig(dir)

    expect(config.agents["hub"]).toBeDefined()
    expect(config.agents["hub"].agentAdapter).toBe("claude")
    expect(config.agents["hub"].role).toBe("hub")
    expect(config.agents["hub"].tokenEnv).toBe("DISCORD_BOT_TOKEN_HUB")
    expect(config.agents["hub"].server).toBe("local")
    expect(config.agents["hub"].identity).toBe("identities/hub.md")

    expect(config.agents["worker-1"]).toBeDefined()
    expect(config.agents["worker-1"].agentAdapter).toBe("claude")
    expect(config.agents["worker-1"].tokenEnv).toBe("DISCORD_BOT_TOKEN_WORKER1")
    expect(config.agents["worker-1"].stateDir).toBe("~/.fleet/state/discord-worker1")
  })

  it("parses server config with camelCase", () => {
    writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
    const config = loadConfig(dir)

    expect(config.servers).toBeDefined()
    expect(config.servers!["staging"]).toBeDefined()
    expect(config.servers!["staging"].sshHost).toBe("staging-server")
    expect(config.servers!["staging"].user).toBe("dev")
  })

  it("derives tokenEnv from agent name if token_env not set", () => {
    const yaml = `\
fleet:
  name: test-fleet
discord:
  channels:
    default:
      id: "123"
defaults:
  workspace: ~/workspace
agents:
  my-bot:
    role: worker
    server: local
    identity: identities/my-bot.md
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    const config = loadConfig(dir)
    // my-bot → DISCORD_BOT_TOKEN_MY_BOT (upper, hyphens → underscores)
    expect(config.agents["my-bot"].tokenEnv).toBe("DISCORD_BOT_TOKEN_MY_BOT")
  })

  it("supports agentAdapter defaults and per-agent override", () => {
    const yaml = `\
fleet:
  name: adapter-fleet
discord:
  channels:
    default:
      id: "123"
defaults:
  workspace: ~/workspace
  agent_adapter: codex
agents:
  coder:
    role: worker
    server: local
    identity: identities/coder.md
  lead:
    role: lead
    agent_adapter: claude
    server: local
    identity: identities/lead.md
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    const config = loadConfig(dir)

    expect(config.defaults.agentAdapter).toBe("codex")
    expect(config.agents["coder"].agentAdapter).toBe("codex")
    expect(config.agents["lead"].agentAdapter).toBe("claude")
  })

  it("throws when fleet.yaml is missing", () => {
    expect(() => loadConfig(dir)).toThrow("fleet.yaml not found")
  })

  it("throws when fleet.name is missing", () => {
    const yaml = `\
fleet: {}
discord:
  channels:
    default:
      id: "123"
defaults:
  workspace: ~/workspace
agents:
  hub:
    role: hub
    server: local
    identity: identities/hub.md
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    expect(() => loadConfig(dir)).toThrow()
  })

  it("throws when agents section is empty", () => {
    const yaml = `\
fleet:
  name: broken
discord:
  channels:
    default:
      id: "123"
defaults:
  workspace: ~/workspace
agents: {}
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    expect(() => loadConfig(dir)).toThrow()
  })

  it("throws when agents section is missing", () => {
    const yaml = `\
fleet:
  name: broken
discord:
  channels:
    default:
      id: "123"
defaults:
  workspace: ~/workspace
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    expect(() => loadConfig(dir)).toThrow()
  })

  it("parses multiple channels with workspace", () => {
    const yaml = `\
fleet:
  name: test-fleet
discord:
  channels:
    store:
      id: "111"
      workspace: ~/workspace/store
    quant:
      id: "222"
      workspace: ~/workspace/quant
defaults:
  workspace: ~/workspace
agents:
  hub:
    role: hub
    server: local
    identity: identities/hub.md
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    const config = loadConfig(dir)
    expect(Object.keys(config.discord.channels)).toHaveLength(2)
    expect(config.discord.channels["store"].id).toBe("111")
    expect(config.discord.channels["store"].workspace).toBe("~/workspace/store")
    expect(config.discord.channels["quant"].id).toBe("222")
  })

  it("throws when discord.channels is empty", () => {
    const yaml = `\
fleet:
  name: broken
discord:
  channels: {}
defaults:
  workspace: ~/workspace
agents:
  hub:
    role: hub
    server: local
    identity: identities/hub.md
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    expect(() => loadConfig(dir)).toThrow()
  })
})

describe("findConfigDir", () => {
  let dir: string
  let origEnv: Record<string, string | undefined>

  beforeEach(() => {
    dir = makeTempDir()
    origEnv = {
      FLEET_CONFIG: process.env.FLEET_CONFIG,
      FLEET_DIR: process.env.FLEET_DIR,
    }
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it("finds fleet.yaml in the given startDir", () => {
    writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
    delete process.env.FLEET_CONFIG
    delete process.env.FLEET_DIR
    const found = findConfigDir(dir)
    expect(found).toBe(dir)
  })

  it("prefers FLEET_CONFIG env var over startDir", () => {
    const configDir = makeTempDir()
    try {
      writeFileSync(join(configDir, "fleet.yaml"), VALID_FLEET_YAML)
      process.env.FLEET_CONFIG = join(configDir, "fleet.yaml")
      const found = findConfigDir(dir)
      expect(found).toBe(configDir)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it("falls back to FLEET_DIR when startDir has no fleet.yaml", () => {
    const fleetDir = makeTempDir()
    try {
      writeFileSync(join(fleetDir, "fleet.yaml"), VALID_FLEET_YAML)
      delete process.env.FLEET_CONFIG
      process.env.FLEET_DIR = fleetDir
      const found = findConfigDir(dir)
      expect(found).toBe(fleetDir)
    } finally {
      rmSync(fleetDir, { recursive: true, force: true })
    }
  })

  it("throws when fleet.yaml cannot be found anywhere", () => {
    delete process.env.FLEET_CONFIG
    delete process.env.FLEET_DIR
    const isolatedGlobalConfigDir = makeTempDir()
    try {
      expect(() => findConfigDir(dir, isolatedGlobalConfigDir)).toThrow("fleet.yaml not found")
    } finally {
      rmSync(isolatedGlobalConfigDir, { recursive: true, force: true })
    }
  })
})

describe("loadEnv", () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("parses a .env file into key-value pairs", () => {
    writeFileSync(
      join(dir, ".env"),
      "DISCORD_BOT_TOKEN_HUB=token-abc-123\nDISCORD_BOT_TOKEN_WORKER1=token-xyz-456\n"
    )
    const env = loadEnv(dir)
    expect(env["DISCORD_BOT_TOKEN_HUB"]).toBe("token-abc-123")
    expect(env["DISCORD_BOT_TOKEN_WORKER1"]).toBe("token-xyz-456")
  })

  it("ignores comment lines and blank lines", () => {
    writeFileSync(
      join(dir, ".env"),
      "# This is a comment\n\nFOO=bar\n   \nBAZ=qux\n"
    )
    const env = loadEnv(dir)
    expect(Object.keys(env)).toHaveLength(2)
    expect(env["FOO"]).toBe("bar")
    expect(env["BAZ"]).toBe("qux")
  })

  it("returns empty object when .env file does not exist", () => {
    const env = loadEnv(dir)
    expect(env).toEqual({})
  })

  it("handles values with = signs in them", () => {
    writeFileSync(join(dir, ".env"), "TOKEN=abc=def=ghi\n")
    const env = loadEnv(dir)
    expect(env["TOKEN"]).toBe("abc=def=ghi")
  })
})

describe("getToken", () => {
  let dir: string
  let origToken: string | undefined

  beforeEach(() => {
    dir = makeTempDir()
    origToken = process.env.DISCORD_BOT_TOKEN_HUB
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (origToken === undefined) delete process.env.DISCORD_BOT_TOKEN_HUB
    else process.env.DISCORD_BOT_TOKEN_HUB = origToken
  })

  it("finds token from .env file", () => {
    writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
    writeFileSync(join(dir, ".env"), "DISCORD_BOT_TOKEN_HUB=secret-hub-token\n")
    delete process.env.DISCORD_BOT_TOKEN_HUB

    const config = loadConfig(dir)
    const token = getToken("hub", config, dir)
    expect(token).toBe("secret-hub-token")
  })

  it("prefers process.env over .env file", () => {
    writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
    writeFileSync(join(dir, ".env"), "DISCORD_BOT_TOKEN_HUB=file-token\n")
    process.env.DISCORD_BOT_TOKEN_HUB = "env-token"

    const config = loadConfig(dir)
    const token = getToken("hub", config, dir)
    expect(token).toBe("env-token")
  })

  it("throws when token is missing from both process.env and .env", () => {
    writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
    delete process.env.DISCORD_BOT_TOKEN_HUB

    const config = loadConfig(dir)
    expect(() => getToken("hub", config, dir)).toThrow()
  })
})

describe("resolveStateDir", () => {
  it("returns ~/.fleet/state/<fleetName>-<agentName> for agents without explicit stateDir", () => {
    const yaml = `\
fleet:
  name: test-fleet
discord:
  channels:
    default:
      id: "123"
defaults:
  workspace: ~/workspace
agents:
  hub:
    role: hub
    server: local
    identity: identities/hub.md
  worker-1:
    role: worker
    server: local
    identity: identities/worker-1.md
`
    const dir = makeTempDir()
    try {
      writeFileSync(join(dir, "fleet.yaml"), yaml)
      const config = loadConfig(dir)
      expect(resolveStateDir("hub", config)).toBe(`${process.env.HOME}/.fleet/state/test-fleet-hub`)
      expect(resolveStateDir("worker-1", config)).toBe(`${process.env.HOME}/.fleet/state/test-fleet-worker-1`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("expands ~ in explicit stateDir", () => {
    const dir = makeTempDir()
    try {
      writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
      const config = loadConfig(dir)
      // worker-1 has state_dir: ~/.fleet/state/discord-worker1
      const stateDir = resolveStateDir("worker-1", config)
      expect(stateDir).toBe(`${process.env.HOME}/.fleet/state/discord-worker1`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("sessionName", () => {
  it("returns fleetName-agentName format", () => {
    expect(sessionName("my-fleet", "hub")).toBe("my-fleet-hub")
    expect(sessionName("my-fleet", "worker-1")).toBe("my-fleet-worker-1")
  })
})

describe("findConfigDir with global config", () => {
  let fleetDir: string
  let globalConfigDir: string
  let origEnv: Record<string, string | undefined>

  beforeEach(() => {
    fleetDir = makeTempDir()
    globalConfigDir = makeTempDir()
    origEnv = {
      FLEET_CONFIG: process.env.FLEET_CONFIG,
      FLEET_DIR: process.env.FLEET_DIR,
    }
    delete process.env.FLEET_CONFIG
    delete process.env.FLEET_DIR
  })

  afterEach(() => {
    rmSync(fleetDir, { recursive: true, force: true })
    rmSync(globalConfigDir, { recursive: true, force: true })
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it("falls back to global config.json when no other source has fleet.yaml", () => {
    writeFileSync(join(fleetDir, "fleet.yaml"), VALID_FLEET_YAML)
    writeFileSync(
      join(globalConfigDir, "config.json"),
      JSON.stringify({ defaultFleet: fleetDir }, null, 2) + "\n"
    )
    // startDir has no fleet.yaml, env vars cleared
    const nonexistent = join(globalConfigDir, "nonexistent-startdir")
    const found = findConfigDir(nonexistent, globalConfigDir)
    expect(found).toBe(fleetDir)
  })

  it("ignores global config if the pointed fleet dir has no fleet.yaml", () => {
    // globalConfigDir/config.json points to fleetDir but fleetDir has no fleet.yaml
    writeFileSync(
      join(globalConfigDir, "config.json"),
      JSON.stringify({ defaultFleet: fleetDir }, null, 2) + "\n"
    )
    const nonexistent = join(globalConfigDir, "nonexistent-startdir")
    expect(() => findConfigDir(nonexistent, globalConfigDir)).toThrow("fleet.yaml not found")
  })

})

describe("writeGlobalConfig", () => {
  let fleetDir: string
  let fakeHome: string
  let origHome: string | undefined

  beforeEach(() => {
    fleetDir = makeTempDir()
    fakeHome = makeTempDir()
    origHome = process.env.HOME
  })

  afterEach(() => {
    rmSync(fleetDir, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
  })

  it("writes ~/.fleet/config.json with defaultFleet set to the given dir", () => {
    process.env.HOME = fakeHome
    writeGlobalConfig(fleetDir)
    const { readFileSync: rfs, existsSync: efs } = require("fs")
    const configPath = join(fakeHome, ".fleet", "config.json")
    expect(efs(configPath)).toBe(true)
    const parsed = JSON.parse(rfs(configPath, "utf8"))
    expect(parsed.defaultFleet).toBe(fleetDir)
  })
})

describe("server validation", () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("throws when agent server is not local and not in servers", () => {
    const yaml = `\
fleet:
  name: test-fleet
discord:
  channels:
    default:
      id: "123"
defaults:
  workspace: ~/workspace
agents:
  ops:
    role: worker
    server: singapore
    identity: identities/ops.md
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    expect(() => loadConfig(dir)).toThrow("singapore")
  })

  it("accepts agent server that exists in servers config", () => {
    const yaml = `\
fleet:
  name: test-fleet
discord:
  channels:
    default:
      id: "123"
defaults:
  workspace: ~/workspace
servers:
  singapore:
    ssh_host: sg-server
    user: deploy
agents:
  ops:
    role: worker
    server: singapore
    identity: identities/ops.md
`
    writeFileSync(join(dir, "fleet.yaml"), yaml)
    const config = loadConfig(dir)
    expect(config.agents.ops.server).toBe("singapore")
  })
})

describe("saveConfig", () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("round-trips a config through save and load", () => {
    writeFileSync(join(dir, "fleet.yaml"), VALID_FLEET_YAML)
    const original = loadConfig(dir)
    saveConfig(original, dir)
    const reloaded = loadConfig(dir)

    expect(reloaded.fleet.name).toBe(original.fleet.name)
    expect(reloaded.discord.channels["default"].id).toBe(original.discord.channels["default"].id)
    expect(reloaded.defaults.agentAdapter).toBe(original.defaults.agentAdapter)
    expect(reloaded.agents["hub"].agentAdapter).toBe(original.agents["hub"].agentAdapter)
    expect(reloaded.agents["hub"].tokenEnv).toBe(original.agents["hub"].tokenEnv)
    expect(reloaded.agents["worker-1"].stateDir).toBe(original.agents["worker-1"].stateDir)
  })
})
