import { writeFileSync, readFileSync, mkdirSync } from "fs"
import { join } from "path"

// ── Types ─────────────────────────────────────────────────────────────────────
// NOTE: If src/channel/types.ts (Task 3) exists, import AccessConfig and
// AccessConfigOpts from there and remove these local declarations.

export interface AccessConfigOpts {
  /** Bot IDs allowed to DM this bot */
  partnerBotIds: string[]
  /** Discord channel ID for the group gate entry */
  channelId: string
  /** Whether the bot requires a @mention before responding in the channel */
  requireMention: boolean
}

export interface AccessGroupEntry {
  requireMention: boolean
  allowFrom: string[]
}

export interface AccessConfig {
  /** DM policy — must be "allowlist" to match the Discord plugin gate() schema */
  dmPolicy: "allowlist"
  /** Top-level list of bot/user IDs allowed to DM this bot */
  allowFrom: string[]
  /** Per-channel gate entries keyed by channel ID */
  groups: Record<string, AccessGroupEntry>
  /** Pending pairing requests — kept empty on initial write */
  pending: Record<string, never>
}

// ── writeAccessConfig ─────────────────────────────────────────────────────────

/**
 * Write access.json to stateDir with the Discord plugin's gate() schema.
 * Creates stateDir (and any parents) if it does not exist.
 */
export function writeAccessConfig(stateDir: string, opts: AccessConfigOpts): void {
  mkdirSync(stateDir, { recursive: true })

  const config: AccessConfig = {
    dmPolicy: "allowlist",
    allowFrom: opts.partnerBotIds,
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
