import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { loadConfig } from "../core/config"
import { sshRun } from "../runtime/remote"
import type { ServerConfig } from "../core/types"

const PLUGIN_ROOT_RELATIVE = ".claude/plugins/cache/claude-plugins-official/discord"
const PATTERN = /const PARTNER_BOT_IDS = new Set\(\[[\s\S]*?\]\)/
const MESSAGE_CREATE_NEEDLE = "client.on('messageCreate', msg => {"
const BOT_DROP_NEEDLE = "if (msg.author.bot) return"
const PARTNER_BOT_IDS_COMMENT = [
  "// Allow messages from partner bots to enable cross-bot collaboration.",
  "// Loop safety: requireMention in group config means only explicit @mentions trigger responses.",
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

function resolveLocalPluginServerPath(): string | null {
  const pluginRoot = join(homedir(), PLUGIN_ROOT_RELATIVE)
  if (!existsSync(pluginRoot)) {
    return null
  }

  const versions = readdirSync(pluginRoot)
    .filter((entry) => {
      const entryPath = join(pluginRoot, entry)
      const serverPath = join(entryPath, "server.ts")
      return statSync(entryPath).isDirectory() && existsSync(serverPath)
    })
    .sort(compareVersionSegments)

  if (versions.length === 0) {
    return null
  }

  return join(pluginRoot, versions[versions.length - 1], "server.ts")
}

function remoteResolvePluginServerPathCmd(): string {
  const root = `$HOME/${PLUGIN_ROOT_RELATIVE}`
  return [
    `ROOT='${root}'`,
    "if [ ! -d \"$ROOT\" ]; then exit 0; fi",
    "ls -1d \"$ROOT\"/*/server.ts 2>/dev/null | sort -V | tail -n 1",
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

  // 2. Patch local server.ts
  const localPluginPath = resolveLocalPluginServerPath()
  if (localPluginPath && existsSync(localPluginPath)) {
    const content = readFileSync(localPluginPath, "utf8")
    const { updated, changed, patternFound } = patchContent(content, replacement)

    if (!patternFound) {
      warn("warn: PARTNER_BOT_IDS pattern not found in local server.ts")
    } else if (!changed) {
      log(`  Local: already up to date (${botIds.length} bot IDs)`)
    } else {
      writeFileSync(localPluginPath, updated, "utf8")
      log(`  Local: updated PARTNER_BOT_IDS (${botIds.length} bot IDs)`)
    }

    // Check STATE_DIR patch
    if (!content.includes("DISCORD_STATE_DIR")) {
      warn(
        "  warn: STATE_DIR patch not detected — check if your plugin version is up to date."
      )
    }
  } else {
    warn(`  warn: local Discord plugin server.ts not found under ~/${PLUGIN_ROOT_RELATIVE}`)
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
      const { stdout: remotePathRaw, ok: pathOk } = await sshRun(
        server,
        remoteResolvePluginServerPathCmd(),
        { throwOnError: false }
      )
      const remotePath = remotePathRaw.trim()

      if (!pathOk || !remotePath) {
        warn(`  ${server.sshHost}: server.ts not found — skipped`)
        continue
      }

      const { stdout: content, ok: readOk } = await sshRun(
        server,
        `cat '${remotePath}'`,
        { throwOnError: false }
      )
      if (!readOk) {
        warn(`  ${server.sshHost}: server.ts not found — skipped`)
        continue
      }

      const { updated, changed, patternFound } = patchContent(content, replacement)
      if (!patternFound) {
        warn(`  ${server.sshHost}: PARTNER_BOT_IDS pattern not found`)
      } else if (!changed) {
        log(`  ${server.sshHost}: already up to date`)
      } else {
        // Write via heredoc to avoid quoting issues
        const escapedContent = updated.replace(/'/g, "'\\''")
        // Use a temp file to avoid shell escaping issues with large content
        const { writeFileSync: writeLocal, unlinkSync } = await import("fs")
        const tmpLocal = `/tmp/fleet-patch-${Date.now()}.ts`
        writeLocal(tmpLocal, updated)
        const { scp: scpFn } = await import("../runtime/remote")
        await scpFn(server, tmpLocal, remotePath)
        try { unlinkSync(tmpLocal) } catch {}
        log(`  ${server.sshHost}: updated PARTNER_BOT_IDS (${botIds.length} bot IDs)`)
      }
    } catch (err) {
      warn(`  ${server.sshHost}: failed — ${err instanceof Error ? err.message : err}`)
    }
  }

  if (opts?.json) {
    console.log(JSON.stringify({ botIds, remoteServers: remoteServers.map(s => s.sshHost) }, null, 2))
  }
}
