import { writeFileSync, readFileSync, mkdirSync } from "fs"
import { join } from "path"
import type { AccessConfig, AccessConfigOpts } from "../types"

// ── writeAccessConfig ─────────────────────────────────────────────────────────

/**
 * Write access.json to stateDir with the Discord plugin's gate() schema.
 * Creates stateDir (and any parents) if it does not exist.
 */
export function writeAccessConfig(stateDir: string, opts: AccessConfigOpts): void {
  mkdirSync(stateDir, { recursive: true })

  const config: AccessConfig = {
    dmPolicy: "allowlist",
    allowFrom: [...opts.partnerBotIds, ...(opts.userId ? [opts.userId] : [])],
    groups: {
      [opts.channelId]: {
        requireMention: opts.requireMention,
        allowFrom: [],
      },
    },
    pending: {},
  }

  writeFileSync(join(stateDir, "access.json"), JSON.stringify(config, null, 2))
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
