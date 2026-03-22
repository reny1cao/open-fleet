import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { findConfigDir, loadEnv } from "../core/config"
import { DiscordApi } from "../channel/discord/api"

const PLUGIN_SERVER_PATH = join(
  homedir(),
  ".claude/plugins/cache/claude-plugins-official/discord/0.0.1/server.ts"
)

export async function patch(opts?: { json?: boolean }): Promise<void> {
  const log = opts?.json ? () => {} : console.log.bind(console)
  const warn = opts?.json ? () => {} : console.warn.bind(console)

  // 1. Check server.ts exists
  if (!existsSync(PLUGIN_SERVER_PATH)) {
    warn(`warn: server.ts not found at ${PLUGIN_SERVER_PATH}`)
    return
  }

  // 2. Load .env and collect all DISCORD_BOT_TOKEN_* values
  const configDir = findConfigDir()
  const env = loadEnv(configDir)

  const tokens: string[] = []
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("DISCORD_BOT_TOKEN_") && value.trim()) {
      tokens.push(value.trim())
    }
  }

  if (tokens.length === 0) {
    warn("warn: no DISCORD_BOT_TOKEN_* entries found in .env — nothing to patch")
    return
  }

  // 3. Validate each token to get bot IDs
  const discord = new DiscordApi()
  const botIds: string[] = []

  for (const token of tokens) {
    try {
      const info = await discord.validateToken(token)
      botIds.push(info.id)
    } catch (err) {
      warn(`warn: token validation failed — ${err instanceof Error ? err.message : err}`)
    }
  }

  if (botIds.length === 0) {
    warn("warn: no valid bot IDs resolved — server.ts not modified")
    return
  }

  // 4. Read server.ts
  const content = readFileSync(PLUGIN_SERVER_PATH, "utf8")

  // 5. Build replacement string (native TS — no shell quoting issues)
  const lines = botIds.map(id => `  '${id}',`).join("\n")
  const replacement = `const PARTNER_BOT_IDS = new Set([\n${lines}\n])`

  const PATTERN = /const PARTNER_BOT_IDS = new Set\(\[[\s\S]*?\]\)/
  const patternFound = PATTERN.test(content)
  const updated = content.replace(PATTERN, replacement)
  const changed = updated !== content

  if (!patternFound) {
    warn("warn: PARTNER_BOT_IDS pattern not found in server.ts — no changes made")
  } else if (!changed) {
    // Pattern found but content is already identical — already up to date
    log(`PARTNER_BOT_IDS already up to date (${botIds.length} bot ID(s))`)
  } else {
    // 6. Write updated server.ts
    writeFileSync(PLUGIN_SERVER_PATH, updated, "utf8")
    log(`Updated PARTNER_BOT_IDS with ${botIds.length} bot ID(s)`)
    for (const id of botIds) {
      log(`  ${id}`)
    }
  }

  // 7. Check STATE_DIR patch
  if (!content.includes("DISCORD_STATE_DIR")) {
    warn(
      "warn: STATE_DIR patch not detected (DISCORD_STATE_DIR env var support missing). " +
        "It should be in the upstream plugin — check if your plugin version is up to date."
    )
  }

  if (opts?.json) {
    console.log(JSON.stringify({ botIds, changed }, null, 2))
  }
}
