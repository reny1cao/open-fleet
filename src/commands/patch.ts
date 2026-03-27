import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { loadConfig } from "../core/config"
import { sshRun } from "../runtime/remote"
import type { ServerConfig } from "../core/types"

const PLUGIN_CACHE_ROOT = ".claude/plugins/cache/claude-plugins-official/discord"
const PLUGIN_MARKETPLACE_ROOT = ".claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord"
const PATTERN = /const PARTNER_BOT_IDS = new Set\(\[[\s\S]*?\]\)/
const MESSAGE_CREATE_NEEDLE = "client.on('messageCreate', msg => {"
const BOT_DROP_NEEDLE = "if (msg.author.bot) return"
const PARTNER_BOT_IDS_COMMENT = [
  "// Allow messages from partner bots to enable cross-bot collaboration.",
  "// Loop safety: requireMention in group config means only explicit @mentions trigger responses.",
].join("\n")

// Mention fallback patch: Discord.js msg.mentions.has() fails for bot-to-bot
// mentions without GuildMembers intent. This adds a raw content check.
const MENTION_FALLBACK_NEEDLE = "  if (client.user && msg.mentions.has(client.user)) return true"
const MENTION_FALLBACK_REPLACEMENT = [
  "  if (client.user && msg.mentions.has(client.user)) return true",
  "  // Fallback: check raw content for <@BOT_ID> — msg.mentions may miss bot",
  "  // mentions without GuildMembers intent (needed for bot-to-bot messaging).",
  "  if (client.user && msg.content.includes(`<@${client.user.id}>`)) return true",
].join("\n")

function compareVersionSegments(a: string, b: string): number {
  const aParts = a.split(".").map(part => Number(part))
  const bParts = b.split(".").map(part => Number(part))
  const max = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < max; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function resolveLocalPluginServerPaths(): string[] {
  const paths: string[] = []

  // Check cache directory (versioned: cache/.../discord/0.0.4/server.ts)
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

  // Check marketplace directory (flat: marketplaces/.../discord/server.ts)
  const marketplacePath = join(homedir(), PLUGIN_MARKETPLACE_ROOT, "server.ts")
  if (existsSync(marketplacePath)) {
    paths.push(marketplacePath)
  }

  return paths
}

function remoteResolvePluginServerPathsCmd(): string {
  const cacheRoot = `$HOME/${PLUGIN_CACHE_ROOT}`
  const marketplaceRoot = `$HOME/${PLUGIN_MARKETPLACE_ROOT}`
  return [
    `CACHE_ROOT="${cacheRoot}"`,
    `MARKET_ROOT="${marketplaceRoot}"`,
    "PATHS=''",
    "if [ -d \"$CACHE_ROOT\" ]; then PATHS=$(ls -1d \"$CACHE_ROOT\"/*/server.ts 2>/dev/null | sort -V | tail -n 1); fi",
    "if [ -f \"$MARKET_ROOT/server.ts\" ]; then PATHS=\"$PATHS $MARKET_ROOT/server.ts\"; fi",
    "echo $PATHS",
  ].join("; ")
}

/**
 * Collect ALL bot IDs from ALL registered fleets via bot-ids.json.
 * Falls back to current fleet's .env if bot-ids.json not found.
 */
function collectAllBotIds(): string[] {
  const configJsonPath = join(homedir(), ".fleet", "config.json")
  const allIds = new Set<string>()

  if (existsSync(configJsonPath)) {
    try {
      const { fleets } = JSON.parse(readFileSync(configJsonPath, "utf8")) as {
        fleets?: Record<string, string>
      }
      if (fleets) {
        for (const [, fleetDir] of Object.entries(fleets)) {
          const botIdsPath = join(fleetDir, "bot-ids.json")
          if (existsSync(botIdsPath)) {
            const ids = JSON.parse(readFileSync(botIdsPath, "utf8")) as Record<string, string>
            for (const id of Object.values(ids)) {
              allIds.add(id)
            }
          }
        }
      }
    } catch {}
  }

  return [...allIds]
}

/**
 * Collect ALL unique remote servers from ALL registered fleets.
 */
function collectAllRemoteServers(): ServerConfig[] {
  const configJsonPath = join(homedir(), ".fleet", "config.json")
  const seen = new Map<string, ServerConfig>() // sshHost → config

  if (existsSync(configJsonPath)) {
    try {
      const { fleets } = JSON.parse(readFileSync(configJsonPath, "utf8")) as {
        fleets?: Record<string, string>
      }
      if (fleets) {
        for (const [, fleetDir] of Object.entries(fleets)) {
          const yamlPath = join(fleetDir, "fleet.yaml")
          if (!existsSync(yamlPath)) continue
          try {
            const config = loadConfig(fleetDir)
            if (config.servers) {
              for (const srv of Object.values(config.servers)) {
                if (!seen.has(srv.sshHost)) {
                  seen.set(srv.sshHost, srv)
                }
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  return [...seen.values()]
}

function buildReplacement(botIds: string[]): string {
  const lines = botIds.map(id => `  '${id}',`).join("\n")
  return `const PARTNER_BOT_IDS = new Set([\n${lines}\n])`
}

function patchMentionFallback(content: string): { updated: string; changed: boolean } {
  // Already patched — the fallback line is present
  if (content.includes("msg.content.includes(`<@${client.user.id}>`")) {
    return { updated: content, changed: false }
  }
  if (!content.includes(MENTION_FALLBACK_NEEDLE)) {
    return { updated: content, changed: false }
  }
  const updated = content.replace(MENTION_FALLBACK_NEEDLE, MENTION_FALLBACK_REPLACEMENT)
  return { updated, changed: updated !== content }
}

function patchContent(content: string, replacement: string): { updated: string; changed: boolean; patternFound: boolean } {
  if (PATTERN.test(content)) {
    const updated = content.replace(PATTERN, replacement)
    return { updated, changed: updated !== content, patternFound: true }
  }

  if (!content.includes(MESSAGE_CREATE_NEEDLE) || !content.includes(BOT_DROP_NEEDLE)) {
    return { updated: content, changed: false, patternFound: false }
  }

  const withPartnerBlock = content.replace(
    MESSAGE_CREATE_NEEDLE,
    `${PARTNER_BOT_IDS_COMMENT}\n${replacement}\n\n${MESSAGE_CREATE_NEEDLE}`
  )
  const updated = withPartnerBlock.replace(
    BOT_DROP_NEEDLE,
    "if (msg.author.bot && !PARTNER_BOT_IDS.has(msg.author.id)) return"
  )
  return { updated, changed: updated !== content, patternFound: true }
}

export async function patch(opts?: { json?: boolean }): Promise<void> {
  const log = opts?.json ? () => {} : console.log.bind(console)
  const warn = opts?.json ? () => {} : console.warn.bind(console)

  // 1. Collect bot IDs from ALL fleets
  const botIds = collectAllBotIds()

  if (botIds.length === 0) {
    warn("warn: no bot IDs found in any fleet's bot-ids.json — nothing to patch")
    return
  }

  const replacement = buildReplacement(botIds)

  // 2. Patch local server.ts (both cache and marketplace paths)
  const localPluginPaths = resolveLocalPluginServerPaths()
  if (localPluginPaths.length === 0) {
    warn(`  warn: local Discord plugin server.ts not found under cache or marketplace`)
  }
  for (const localPluginPath of localPluginPaths) {
    const label = localPluginPath.includes("marketplace") ? "Marketplace" : "Cache"
    let content = readFileSync(localPluginPath, "utf8")
    let fileChanged = false

    const { updated, changed, patternFound } = patchContent(content, replacement)

    if (!patternFound) {
      warn(`  warn: ${label}: PARTNER_BOT_IDS pattern not found`)
    } else if (!changed) {
      log(`  ${label}: PARTNER_BOT_IDS already up to date (${botIds.length} bot IDs)`)
    } else {
      content = updated
      fileChanged = true
      log(`  ${label}: updated PARTNER_BOT_IDS (${botIds.length} bot IDs)`)
    }

    // Apply mention fallback patch
    const mentionResult = patchMentionFallback(content)
    if (mentionResult.changed) {
      content = mentionResult.updated
      fileChanged = true
      log(`  ${label}: mention fallback patch applied`)
    } else if (content.includes("msg.content.includes(`<@${client.user.id}>`")) {
      log(`  ${label}: mention fallback already applied`)
    }

    if (fileChanged) {
      writeFileSync(localPluginPath, content, "utf8")
    }

    // Check STATE_DIR patch
    if (!content.includes("DISCORD_STATE_DIR")) {
      warn(
        `  warn: ${label}: STATE_DIR patch not detected — check if your plugin version is up to date.`
      )
    }
  }

  // 3. Patch remote servers
  const remoteServers = collectAllRemoteServers()
  for (const server of remoteServers) {
    try {
      // Read remote server.ts
      const { stdout: remoteHome, ok: homeOk } = await sshRun(server, "echo $HOME", { throwOnError: false })
      if (!homeOk) {
        warn(`  ${server.sshHost}: SSH failed — skipped`)
        continue
      }
      const { stdout: remotePathsRaw, ok: pathOk } = await sshRun(
        server,
        remoteResolvePluginServerPathsCmd(),
        { throwOnError: false }
      )
      const remotePaths = remotePathsRaw.trim().split(/\s+/).filter(Boolean)

      if (!pathOk || remotePaths.length === 0) {
        warn(`  ${server.sshHost}: server.ts not found — skipped`)
        continue
      }

      for (const remotePath of remotePaths) {
        const { stdout: content, ok: readOk } = await sshRun(
          server,
          `cat '${remotePath}'`,
          { throwOnError: false }
        )
        if (!readOk) continue

        const { updated, changed, patternFound } = patchContent(content, replacement)
        let finalContent = changed ? updated : content
        if (!patternFound) {
          warn(`  ${server.sshHost}: PARTNER_BOT_IDS pattern not found`)
        } else if (!changed) {
          log(`  ${server.sshHost}: already up to date`)
        } else {
          log(`  ${server.sshHost}: updated PARTNER_BOT_IDS (${botIds.length} bot IDs)`)
        }

        const mentionResult = patchMentionFallback(finalContent)
        if (mentionResult.changed) {
          finalContent = mentionResult.updated
          log(`  ${server.sshHost}: mention fallback patch applied`)
        }

        if (changed || mentionResult.changed) {
          const { writeFileSync: writeLocal, unlinkSync } = await import("fs")
          const tmpLocal = `/tmp/fleet-patch-${Date.now()}.ts`
          writeLocal(tmpLocal, finalContent)
          const { scp: scpFn } = await import("../runtime/remote")
          await scpFn(server, tmpLocal, remotePath)
          try { unlinkSync(tmpLocal) } catch {}
        }
      }
    } catch (err) {
      warn(`  ${server.sshHost}: failed — ${err instanceof Error ? err.message : err}`)
    }
  }

  if (opts?.json) {
    console.log(JSON.stringify({ botIds, remoteServers: remoteServers.map(s => s.sshHost) }, null, 2))
  }
}
