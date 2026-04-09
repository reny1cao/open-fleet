import { readFileSync, mkdirSync } from "fs"
import { join } from "path"
import type { AccessConfig, AccessConfigOpts } from "../types"
import { atomicWriteJsonSync } from "../../core/atomic-write"

// ── writeAccessConfig ─────────────────────────────────────────────────────────

/**
 * Write access.json to stateDir with the Discord plugin's gate() schema.
 * Creates stateDir (and any parents) if it does not exist.
 */
export function writeAccessConfig(stateDir: string, opts: AccessConfigOpts): void {
  mkdirSync(stateDir, { recursive: true })

  const groups: Record<string, { requireMention: boolean; allowFrom: string[] }> = {}
  for (const ch of Object.values(opts.channels)) {
    groups[ch.id] = {
      requireMention: opts.requireMention,
      allowFrom: [],
    }
  }

  const config: AccessConfig = {
    dmPolicy: "allowlist",
    allowFrom: [...opts.partnerBotIds, ...(opts.userId ? [opts.userId] : [])],
    groups,
    pending: {},
  }

  atomicWriteJsonSync(join(stateDir, "access.json"), config)
}

// ── readAccessConfig ──────────────────────────────────────────────────────────

/**
 * Read and parse access.json from stateDir.
 * Throws if the file does not exist or is not valid JSON.
 */
export function readAccessConfig(stateDir: string): AccessConfig {
  const raw = readFileSync(join(stateDir, "access.json"), "utf8")
  return JSON.parse(raw) as AccessConfig
}
