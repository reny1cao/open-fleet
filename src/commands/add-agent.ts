import { findConfigDir, loadConfig, saveConfig, loadEnv, resolveStateDir } from "../core/config"
import { writeBootIdentity, writeRoster, updateAllRosters } from "../core/identity"
import { DiscordApi } from "../channel/discord/api"
import { writeAccessConfig } from "../channel/discord/access"
import { appendFileSync, existsSync, writeFileSync } from "fs"
import { join } from "path"
import type { AgentDef } from "../core/types"

function tokenEnvName(agentName: string): string {
  return `DISCORD_BOT_TOKEN_${agentName.toUpperCase().replace(/-/g, "_")}`
}

export async function addAgent(opts: {
  token: string
  name: string
  role: string
  server?: string
  json?: boolean
}): Promise<void> {
  const { token, name, role, server = "local" } = opts
  const log = opts.json ? () => {} : console.log
  const write = opts.json ? () => {} : (s: string) => process.stdout.write(s)

  // 1. Load existing config
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  // 2. Verify agent name doesn't already exist
  if (config.agents[name]) {
    throw new Error(`Agent "${name}" already exists in fleet.yaml`)
  }

  // 3. Validate token via DiscordApi
  const discord = new DiscordApi()
  write(`Validating token for "${name}"… `)
  const botInfo = await discord.validateToken(token)
  log(`OK  (${botInfo.name} / ${botInfo.id})`)

  // 4. Add agent to config.agents, save fleet.yaml via saveConfig
  const tokenEnv = tokenEnvName(name)
  const agentDef: AgentDef = {
    role,
    tokenEnv,
    server,
    identity: `identities/${name}.md`,
    stateDir: `~/.fleet/state/discord-${name}`,
  }
  config.agents[name] = agentDef
  saveConfig(config, configDir)
  log("  Updated fleet.yaml")

  // 5. Append token to .env
  const envLine = `${tokenEnv}=${token}\n`
  const envPath = join(configDir, ".env")
  if (existsSync(envPath)) {
    appendFileSync(envPath, envLine, "utf8")
  } else {
    writeFileSync(envPath, envLine, "utf8")
  }
  log("  Updated .env")

  // 6. Generate identity file via writeBootIdentity
  // Build botIds map from existing agents (best effort: use "unknown" for others)
  const botIds: Record<string, string> = {}
  botIds[name] = botInfo.id

  // Try to resolve other bot IDs from env
  for (const [agentName, agentEntry] of Object.entries(config.agents)) {
    if (agentName === name) continue
    const envToken = process.env[agentEntry.tokenEnv] ?? loadEnv(configDir)[agentEntry.tokenEnv]
    if (envToken) {
      try {
        const info = await discord.validateToken(envToken)
        botIds[agentName] = info.id
      } catch {
        botIds[agentName] = "unknown"
      }
    } else {
      botIds[agentName] = "unknown"
    }
  }

  const stateDir = resolveStateDir(name, config)
  writeBootIdentity(name, config, botIds, stateDir)
  log(`  Wrote identity.md → ${stateDir}`)

  // 7. Generate access.json via writeAccessConfig
  const partnerBotIds = Object.entries(botIds)
    .filter(([n]) => n !== name)
    .map(([, id]) => id)
    .filter((id) => id !== "unknown")

  writeAccessConfig(stateDir, {
    channelId: config.discord.channelId,
    partnerBotIds,
    requireMention: true,
  })
  log(`  Wrote access.json → ${stateDir}`)

  // 7b. Update ALL agents' roster CLAUDE.md (running agents pick this up on next turn)
  updateAllRosters(config, botIds, resolveStateDir)
  log(`  Updated roster for all ${Object.keys(config.agents).length} agents`)

  // 8. Print invite URL and next steps
  const inviteUrl = discord.inviteUrl(botInfo.appId)

  if (opts.json) {
    console.log(JSON.stringify({
      agent: name,
      bot: botInfo.name,
      bot_id: botInfo.id,
      invite_url: inviteUrl,
      status: "added",
    }))
    return
  }

  console.log(`\n── Agent "${name}" added ──────────────────────────────────`)
  console.log(`Bot     : ${botInfo.name} (${botInfo.id})`)
  console.log(`Role    : ${role}`)
  console.log(`Server  : ${server}`)
  console.log(`Token env: ${tokenEnv}`)
  console.log("")
  console.log(`Invite URL: ${inviteUrl}`)
  console.log("")
  console.log("Next steps:")
  console.log(`  1. Open the invite URL above and add ${botInfo.name} to your server`)
  console.log(`  2. Run: fleet-next start ${name}`)
  console.log("  3. @mention the bot in Discord to verify it responds")
}
