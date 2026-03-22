import { existsSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { saveConfig, resolveStateDir } from "../core/config"
import type { FleetConfig, AgentDef } from "../core/types"
import { writeBootIdentity } from "../core/identity"
import { DiscordApi } from "../channel/discord/api"
import { writeAccessConfig } from "../channel/discord/access"

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  if (p === "~") return homedir()
  return p
}

function tokenEnvName(agentName: string): string {
  return `DISCORD_BOT_TOKEN_${agentName.toUpperCase().replace(/-/g, "_")}`
}

interface AgentSpec {
  name: string
  server: string
  role: string
}

function parseAgentSpec(spec: string): AgentSpec {
  const parts = spec.split(":")
  if (parts.length !== 3) {
    throw new Error(
      `Invalid --agent format "${spec}": expected "name:server:role"`
    )
  }
  const [name, server, role] = parts
  if (!name || !server || !role) {
    throw new Error(
      `Invalid --agent format "${spec}": name, server, and role must be non-empty`
    )
  }
  return { name, server, role }
}

export async function init(opts: {
  tokens: string[]
  name: string
  agents?: string[]
  channel?: string
  force?: boolean
}): Promise<void> {
  const { tokens, name, force } = opts

  // ── 1. Check existing config ──────────────────────────────────────────────
  const configDir = process.cwd()
  const configPath = join(configDir, "fleet.yaml")
  if (existsSync(configPath) && !force) {
    throw new Error(
      `fleet.yaml already exists in ${configDir}. Use --force to overwrite.`
    )
  }

  // ── 2. Validate tokens ────────────────────────────────────────────────────
  const discord = new DiscordApi()
  console.log(`Validating ${tokens.length} token(s)…`)

  const botInfos: Array<{ id: string; name: string; appId: string }> = []
  for (let i = 0; i < tokens.length; i++) {
    process.stdout.write(`  [${i + 1}/${tokens.length}] validating… `)
    const info = await discord.validateToken(tokens[i])
    console.log(`OK  (${info.name} / ${info.id})`)
    botInfos.push(info)
  }

  // ── 3. Parse agent definitions ────────────────────────────────────────────
  let agentSpecs: AgentSpec[]
  if (opts.agents && opts.agents.length > 0) {
    if (opts.agents.length !== tokens.length) {
      throw new Error(
        `Mismatch: ${tokens.length} token(s) but ${opts.agents.length} --agent spec(s). ` +
          `Provide one --agent per --token.`
      )
    }
    agentSpecs = opts.agents.map(parseAgentSpec)
  } else {
    // Default: first token → "hub" with role "hub", rest → "worker-N" with role "worker"
    agentSpecs = tokens.map((_, i) => {
      if (i === 0) return { name: "hub", server: "local", role: "hub" }
      return { name: `worker-${i}`, server: "local", role: "worker" }
    })
  }

  // ── 4. Detect guild ───────────────────────────────────────────────────────
  console.log("Detecting guild…")
  const servers = await discord.listServers(tokens[0])
  if (servers.length === 0) {
    throw new Error(
      "No Discord servers found for the first token. " +
        "Invite the bot to a server first."
    )
  }
  const guild = servers[0]
  const guildId = guild.id
  const ownerId = guild.ownerId
  console.log(`  Using guild: ${guild.name} (${guildId})`)

  // ── 5. Detect channel ─────────────────────────────────────────────────────
  let channelId: string
  if (opts.channel) {
    channelId = opts.channel
    console.log(`  Using channel (override): ${channelId}`)
  } else {
    console.log("Detecting channel…")
    const channels = await discord.listChannels(tokens[0], guildId)
    const textChannel = channels.find((ch) => ch.type === "text")
    if (!textChannel) {
      throw new Error(
        "No text channels found in the server. " +
          "Create a text channel in Discord, or pass --channel <id> to specify one manually."
      )
    }
    channelId = textChannel.id
    console.log(`  Using channel: #${textChannel.name} (${channelId})`)
  }

  // ── 6. Build FleetConfig and generate fleet.yaml ──────────────────────────
  const agents: Record<string, AgentDef> = {}
  for (let i = 0; i < agentSpecs.length; i++) {
    const spec = agentSpecs[i]
    const envVar = tokenEnvName(spec.name)
    const agentEntry: AgentDef = {
      role: spec.role,
      tokenEnv: envVar,
      server: spec.server,
      identity: `identities/${spec.name}.md`,
    }
    // Non-first agents get an explicit state_dir
    if (i > 0) {
      agentEntry.stateDir = `~/.fleet/state/discord-${spec.name}`
    }
    agents[spec.name] = agentEntry
  }

  const config: FleetConfig = {
    fleet: { name },
    discord: {
      channelId,
      ...(ownerId !== undefined ? { userId: ownerId } : {}),
    },
    defaults: {
      workspace: "~/workspace",
    },
    agents,
  }

  saveConfig(config, configDir)
  console.log("  Wrote fleet.yaml")

  // ── 7. Generate .env ──────────────────────────────────────────────────────
  const envLines: string[] = []
  for (let i = 0; i < agentSpecs.length; i++) {
    const envVar = tokenEnvName(agentSpecs[i].name)
    envLines.push(`${envVar}=${tokens[i]}`)
  }
  writeFileSync(join(configDir, ".env"), envLines.join("\n") + "\n", "utf8")
  console.log("  Wrote .env")

  // ── 8 & 9. Identity files and access.json ─────────────────────────────────
  // Build botIds map for identity prompts
  const botIds: Record<string, string> = {}
  for (let i = 0; i < agentSpecs.length; i++) {
    botIds[agentSpecs[i].name] = botInfos[i].id
  }

  console.log("Writing identity and access files…")
  for (let i = 0; i < agentSpecs.length; i++) {
    const agentName = agentSpecs[i].name
    const stateDir = resolveStateDir(agentName, config)

    // Also ensure the identities/ directory exists for the identity.md symlink path
    const identitiesDir = join(configDir, "identities")
    mkdirSync(identitiesDir, { recursive: true })

    // 8. Write identity.md into stateDir (writeBootIdentity creates stateDir)
    writeBootIdentity(agentName, config, botIds, stateDir)
    console.log(`  ${agentName}: identity.md → ${stateDir}`)

    // 9. Write access.json — partnerBotIds = all other bot IDs
    const partnerBotIds = agentSpecs
      .filter((_, j) => j !== i)
      .map((spec) => botIds[spec.name])

    writeAccessConfig(stateDir, {
      channelId,
      partnerBotIds,
      requireMention: true,
    })
    console.log(`  ${agentName}: access.json → ${stateDir}`)
  }

  // ── 10. Print summary ─────────────────────────────────────────────────────
  console.log("\n── Fleet initialized ──────────────────────────────────────")
  console.log(`Fleet name : ${name}`)
  console.log(`Guild      : ${guild.name} (${guildId})`)
  console.log(`Channel ID : ${channelId}`)
  console.log("")
  console.log("Invite URLs (add bots to your server):")
  for (let i = 0; i < agentSpecs.length; i++) {
    const url = discord.inviteUrl(botInfos[i].appId)
    console.log(`  ${agentSpecs[i].name} (${botInfos[i].name}): ${url}`)
  }
  console.log("")
  console.log("Next steps:")
  console.log("  1. Open the invite URLs above and add each bot to your server")
  console.log("  2. Run: fleet-next start <agent>")
  console.log("  3. DM or @mention the bot in Discord to verify it responds")
}
