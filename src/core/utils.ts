import { existsSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { homedir } from "os"

// ── Path expansion ───────────────────────────────────────────────────────────

/** Expand leading ~ to the user's home directory. */
export function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  if (p === "~") return homedir()
  return p
}

// ── Version comparison ───────────────────────────────────────────────────────

/** Compare two dotted version strings numerically (e.g. "0.0.4" vs "0.0.10"). */
export function compareVersionSegments(a: string, b: string): number {
  const aParts = a.split(".").map(Number)
  const bParts = b.split(".").map(Number)
  const max = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < max; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// ── Plugin paths ─────────────────────────────────────────────────────────────

/** Relative to $HOME — versioned plugin cache. */
export const PLUGIN_CACHE_ROOT = ".claude/plugins/cache/claude-plugins-official/discord"

/** Relative to $HOME — flat marketplace layout. */
export const PLUGIN_MARKETPLACE_ROOT = ".claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord"

/**
 * Find all installed Discord plugin server.ts paths (cache + marketplace).
 * Returns newest cache version first, then marketplace path if it exists.
 */
export function resolvePluginServerPaths(): string[] {
  const paths: string[] = []

  // Cache directory (versioned: cache/.../discord/0.0.4/server.ts)
  const cacheRoot = join(homedir(), PLUGIN_CACHE_ROOT)
  if (existsSync(cacheRoot)) {
    const versions = readdirSync(cacheRoot)
      .filter((entry) => {
        const entryPath = join(cacheRoot, entry)
        const serverPath = join(entryPath, "server.ts")
        return statSync(entryPath).isDirectory() && existsSync(serverPath)
      })
      .sort(compareVersionSegments)
    if (versions.length > 0) {
      paths.push(join(cacheRoot, versions[versions.length - 1], "server.ts"))
    }
  }

  // Marketplace directory (flat: marketplaces/.../discord/server.ts)
  const marketplacePath = join(homedir(), PLUGIN_MARKETPLACE_ROOT, "server.ts")
  if (existsSync(marketplacePath)) {
    paths.push(marketplacePath)
  }

  return paths
}

// ── CLI color helpers ────────────────────────────────────────────────────────

export const COLORS = {
  pass: "\x1b[32m",   // green
  warn: "\x1b[33m",   // yellow
  fail: "\x1b[31m",   // red
  info: "\x1b[36m",   // cyan
  reset: "\x1b[0m",
} as const

export function colorLabel(status: string): string {
  const color = COLORS[status as keyof typeof COLORS] ?? ""
  return `${color}[${status}]${COLORS.reset}`
}
