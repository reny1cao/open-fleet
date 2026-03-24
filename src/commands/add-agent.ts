import { findConfigDir, loadConfig, saveConfig, loadEnv, resolveStateDir } from "../core/config"
import { writeBootIdentity, writeRoster, updateAllRosters } from "../core/identity"
import { DiscordApi } from "../channel/discord/api"
import { writeAccessConfig } from "../channel/discord/access"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import type { AgentDef, AgentAdapterKind } from "../core/types"
import { patch } from "./patch"

function tokenEnvName(agentName: string): string {
  return `DISCORD_BOT_TOKEN_${agentName.toUpperCase().replace(/-/g, "_")}`
}

export async function addAgent(opts: {
  token: string
  name: string
  role: string
  server?: string
  adapter?: AgentAdapterKind
  json?: boolean
}): Promise<void> {
  const { token, name, role, server = "local", adapter = "claude" } = opts
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
    ...(adapter !== "claude" ? { agentAdapter: adapter } : {}),
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!opts.json) console.warn(`  Warning: ${agentName} token validation failed — ${msg}`)
        botIds[agentName] = "UNKNOWN"
      }
    } else {
      botIds[agentName] = "UNKNOWN"
    }
  }

  const stateDir = resolveStateDir(name, config)
  writeBootIdentity(name, config, botIds, stateDir)
  log(`  Wrote identity.md → ${stateDir}`)

  // 7. Generate access.json via writeAccessConfig
  const partnerBotIds = Object.entries(botIds)
    .filter(([n]) => n !== name)
    .map(([, id]) => id)
    .filter((id) => id !== "UNKNOWN")

  writeAccessConfig(stateDir, {
    channels: config.discord.channels,
    partnerBotIds,
    requireMention: true,
    userId: config.discord.userId,
  })
  log(`  Wrote access.json → ${stateDir}`)

  // 7b. Update ALL agents' roster CLAUDE.md (running agents pick this up on next turn)
  updateAllRosters(config, botIds, resolveStateDir)
  log(`  Updated roster for all ${Object.keys(config.agents).length} agents`)

  // 7c. Update bot-ids.json and patch PARTNER_BOT_IDS on all machines
  const botIdsPath = join(configDir, "bot-ids.json")
  let existingBotIds: Record<string, string> = {}
  if (existsSync(botIdsPath)) {
    try { existingBotIds = JSON.parse(readFileSync(botIdsPath, "utf8")) } catch {}
  }
  for (const [n, id] of Object.entries(botIds)) {
    if (id !== "UNKNOWN") existingBotIds[n] = id
  }
  writeFileSync(botIdsPath, JSON.stringify(existingBotIds, null, 2) + "\n", "utf8")
  log("  Updated bot-ids.json")

  const needsClaudePatch = Object.values(config.agents).some((agent) => (agent.agentAdapter ?? "claude") === "claude")
  if (needsClaudePatch) {
    try {
      await patch({ json: opts.json })
    } catch (err) {
      if (!opts.json) console.warn(`  warn: patch failed — ${err instanceof Error ? err.message : err}`)
    }
  } else if (!opts.json) {
    console.log("  Skipped Claude Discord plugin patch (no Claude agents in fleet)")
  }

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
  console.log(`Adapter : ${adapter}`)
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
