import { mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// ── Temp dir ────────────────────────────────────────────────────────────────

export function makeTempDir(): string {
  const dir = join(tmpdir(), `fleet-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ── Env isolation ───────────────────────────────────────────────────────────

export function saveEnv(...keys: string[]): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {}
  for (const k of keys) {
    saved[k] = process.env[k]
  }
  return saved
}

export function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

// ── Console capture ─────────────────────────────────────────────────────────

export function captureConsole(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = []
  const errors: string[] = []
  const origLog = console.log
  const origError = console.error
  const origWarn = console.warn

  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "))
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "))
  console.warn = (...args: unknown[]) => errors.push(args.map(String).join(" "))

  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog
      console.error = origError
      console.warn = origWarn
    },
  }
}

// ── process.exit interception ───────────────────────────────────────────────

export class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

export function interceptExit(): () => void {
  const orig = process.exit
  process.exit = ((code?: number) => {
    throw new ExitError(code ?? 0)
  }) as never
  return () => {
    process.exit = orig
  }
}

// ── Fixtures (valid 18-digit snowflakes) ────────────────────────────────────

export const SMOKE_MINIMAL_YAML = `\
fleet:
  name: smoke-fleet

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
`

export const SMOKE_MULTI_YAML = `\
fleet:
  name: smoke-multi
  mission: smoke testing

discord:
  channels:
    default:
      id: "123456789012345678"
    ops:
      id: "987654321098765432"
  server_id: "111222333444555666"

defaults:
  workspace: ~/workspace

agents:
  hub:
    role: lead
    server: local
    identity: identities/hub.md
  worker-1:
    role: coder
    server: staging
    identity: identities/worker-1.md

servers:
  staging:
    ssh_host: 10.0.0.5
    user: deploy
`

export const SMOKE_INVALID_SNOWFLAKE_YAML = `\
fleet:
  name: bad-fleet

discord:
  channels:
    default:
      id: "not-a-snowflake"

defaults:
  workspace: ~/workspace

agents:
  solo:
    role: worker
    server: local
    identity: identities/solo.md
`

// ── Setup helper ────────────────────────────────────────────────────────────

export function setupFleetDir(yaml: string): { dir: string; cleanup: () => void } {
  const dir = makeTempDir()
  writeFileSync(join(dir, "fleet.yaml"), yaml)
  const saved = saveEnv("FLEET_CONFIG", "FLEET_DIR")
  process.env.FLEET_CONFIG = join(dir, "fleet.yaml")
  delete process.env.FLEET_DIR

  return {
    dir,
    cleanup: () => {
      restoreEnv(saved)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
