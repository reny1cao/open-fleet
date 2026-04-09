import { existsSync, readdirSync, statSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

/**
 * Discord plugin path constants.
 * Shared utility — replaces 3 copies in boot-check.ts, patch.ts, doctor.ts.
 */
export const PLUGIN_CACHE_ROOT = ".claude/plugins/cache/claude-plugins-official/discord"
export const PLUGIN_MARKETPLACE_ROOT = ".claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord"

function compareVersionSegments(a: string, b: string): number {
  const aParts = a.split(".").map(Number)
  const bParts = b.split(".").map(Number)
  const max = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < max; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Resolve the Discord plugin server.ts path.
 * Checks cache (versioned) first, then marketplace fallback.
 * Returns null if not found.
 */
export function resolvePluginPath(): string | null {
  const cacheRoot = join(homedir(), PLUGIN_CACHE_ROOT)
  if (existsSync(cacheRoot)) {
    const versions = readdirSync(cacheRoot)
      .filter((entry: string) => {
        const entryPath = join(cacheRoot, entry)
        const serverPath = join(entryPath, "server.ts")
        return statSync(entryPath).isDirectory() && existsSync(serverPath)
      })
      .sort(compareVersionSegments)
    if (versions.length > 0) {
      return join(cacheRoot, versions[versions.length - 1], "server.ts")
    }
  }

  const marketplacePath = join(homedir(), PLUGIN_MARKETPLACE_ROOT, "server.ts")
  if (existsSync(marketplacePath)) return marketplacePath

  return null
}

/**
 * Read and return the plugin source code.
 * Returns null if the plugin is not found.
 */
export function readPluginSource(): string | null {
  const path = resolvePluginPath()
  if (!path) return null
  return readFileSync(path, "utf8")
}
