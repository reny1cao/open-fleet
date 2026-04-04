import { existsSync, writeFileSync, mkdirSync, readFileSync, symlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { createInterface } from "readline"
import { parse as parseYaml } from "yaml"
import { saveConfig, resolveStateDir, writeGlobalConfig } from "../core/config"
import type { FleetConfig, AgentDef, ChannelDef, AgentAdapterKind } from "../core/types"
import { writeBootIdentity } from "../core/identity"
import { DiscordApi } from "../channel/discord/api"
import { writeAccessConfig } from "../channel/discord/access"
import { patch } from "./patch"
import { expandHome } from "../core/utils"

function tokenEnvName(agentName: string): string {
  return `DISCORD_BOT_TOKEN_${agentName.toUpperCase().replace(/-/g, "_")}`
}

interface AgentSpec {
  name: string
  server: string
  role: string
  adapter?: AgentAdapterKind
}

function parseAgentSpec(spec: string): AgentSpec {
  const parts = spec.split(":")
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error(
      `Invalid --agent format "${spec}": expected "name:server:role[:adapter]"`
    )
  }
  const [name, server, role, adapter] = parts
  if (!name || !server || !role) {
    throw new Error(
      `Invalid --agent format "${spec}": name, server, and role must be non-empty`
    )
  }
  if (adapter && adapter !== "claude" && adapter !== "codex") {
    throw new Error(
      `Invalid --agent format "${spec}": adapter must be "claude" or "codex"`
    )
  }
  const normalizedAdapter = adapter as AgentAdapterKind | undefined
  return { name, server, role, ...(normalizedAdapter ? { adapter: normalizedAdapter } : {}) }
}

function loadTemplate(name: string): { agents: Array<{ name: string; role: string; server: string; adapter?: AgentAdapterKind }> } | null {
  // Check ~/.fleet/templates/ first (user overrides), then repo templates/
  const paths = [
    join(process.env.HOME ?? "", ".fleet", "templates", `${name}.yaml`),
    join(__dirname, "..", "..", "templates", `${name}.yaml`),
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      return parseYaml(readFileSync(p, "utf8"))
    }
  }
  return null
}

export async function init(opts: {
  tokens: string[]
  name: string
  agents?: string[]
  channel?: string[]
  guild?: string
  createChannel?: string
  server?: string[]
  force?: boolean
  json?: boolean
  template?: string
}): Promise<void> {
  const { tokens, name, force } = opts
  const log = opts.json ? () => {} : console.log
  const write = opts.json ? () => {} : (s: string) => process.stdout.write(s)

  // ── 1. Check existing config ──────────────────────────────────────────────
  const configDir = process.cwd()
  const configPath = join(configDir, "fleet.yaml")
  if (existsSync(configPath) && !force) {
    throw new Error(
      `fleet.yaml already exists in ${configDir}. Use --force to overwrite.`
    )
  }

  // ── 1b. Apply template if requested ──────────────────────────────────────
  if (opts.template) {
    const tmpl = loadTemplate(opts.template)
    if (!tmpl) throw new Error(`Template not found: ${opts.template}. Available: dev-team, research, ops`)
    if (!opts.agents || opts.agents.length === 0) {
      opts.agents = tmpl.agents.map((a) => [a.name, a.server, a.role, a.adapter].filter(Boolean).join(":"))
    }
  }

  // ── 2. Validate tokens ────────────────────────────────────────────────────
  const discord = new DiscordApi()
  log(`Validating ${tokens.length} token(s)…`)

  const botInfos: Array<{ id: string; name: string; appId: string }> = []
  for (let i = 0; i < tokens.length; i++) {
    write(`  [${i + 1}/${tokens.length}] validating… `)
    const info = await discord.validateToken(tokens[i])
    log(`OK  (${info.name} / ${info.id})`)
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

  // ── 4. Detect or use specified guild ──────────────────────────────────────
  log("Detecting guild…")
  const servers = await discord.listServers(tokens[0])
  if (servers.length === 0) {
    throw new Error("No Discord servers found for the first token. Invite the bot to a server first.")
  }

  let guild: { id: string; name: string; ownerId?: string }
  if (opts.guild) {
    const match = servers.find(s => s.id === opts.guild)
    if (!match) {
      throw new Error(`Bot is not in guild ${opts.guild}. Available guilds:\n${servers.map(s => `  ${s.id} — ${s.name}`).join("\n")}`)
    }
    guild = match
  } else if (servers.length > 1) {
    throw new Error(
      `Bot is in ${servers.length} servers — specify which one with --guild:\n${servers.map(s => `  ${s.id} — ${s.name}`).join("\n")}`
    )
  } else {
    guild = servers[0]
  }
  const guildId = guild.id
  // Fetch the full guild to get owner_id (/users/@me/guilds doesn't include it)
  const ownerId = await discord.getGuildOwnerId(tokens[0], guildId)
  if (!ownerId) {
    log(`  warn: could not fetch guild owner — userId will be unset`)
  }
  log(`  Using guild: ${guild.name} (${guildId})`)

  // ── 4b. Auto-create channel if requested ──────────────────────────────────
  if (opts.createChannel && (!opts.channel || opts.channel.length === 0)) {
    log(`Creating channel #${opts.createChannel}…`)
    const created = await discord.createChannel(tokens[0], guildId, opts.createChannel)
    log(`  Created #${created.name} (${created.id})`)
    opts.channel = [`${created.name}:${created.id}`]
  }

  // ── 5. Parse channels ─────────────────────────────────────────────────────
  let channels: Record<string, ChannelDef>
  if (opts.channel && opts.channel.length > 0) {
    channels = {}
    for (const ch of opts.channel) {
      const parts = ch.split(":")
      if (parts.length === 2) {
        channels[parts[0]] = { id: parts[1] }
      } else if (parts.length === 3) {
        channels[parts[0]] = { id: parts[1], workspace: parts[2] }
      } else {
        throw new Error(`Invalid --channel format "${ch}": expected "label:id" or "label:id:workspace"`)
      }
    }
  } else {
    log("Detecting channel…")
    const allChannels = await discord.listChannels(tokens[0], guildId)
    const textChannel = allChannels.find((ch) => ch.type === "text")
    if (!textChannel) {
      throw new Error("No text channels found. Create one in Discord, or pass --channel label:id")
    }
    channels = { default: { id: textChannel.id } }
    log(`  Using channel: #${textChannel.name} (${textChannel.id})`)
  }

  // ── 6. Build FleetConfig and generate fleet.yaml ──────────────────────────
  const agents: Record<string, AgentDef> = {}
  for (let i = 0; i < agentSpecs.length; i++) {
    const spec = agentSpecs[i]
    const envVar = tokenEnvName(spec.name)
    const agentEntry: AgentDef = {
      ...(spec.adapter ? { agentAdapter: spec.adapter } : {}),
      role: spec.role,
      tokenEnv: envVar,
      server: spec.server,
      identity: `identities/${spec.name.replace(/\s+/g, "-")}.md`,
    }
    // Non-first agents get an explicit state_dir
    if (i > 0) {
      agentEntry.stateDir = `~/.fleet/state/discord-${spec.name.replace(/\s+/g, "-")}`
    }
    agents[spec.name] = agentEntry
  }

  // ── 6b. Auto-detect structure (star topology if a lead role exists) ───
  const leadAgent = agentSpecs.find(s => s.role === "lead")
  const structure = leadAgent
    ? { topology: "star" as const, lead: leadAgent.name }
    : undefined

  // ── 6c. Build servers config from --server flags and agent references ─
  const serverFlags: Record<string, { sshHost: string; user: string }> = {}
  if (opts.server) {
    for (const s of opts.server) {
      const parts = s.split(":")
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        throw new Error(`Invalid --server format "${s}": expected "name:ssh_host:user"`)
      }
      serverFlags[parts[0]] = { sshHost: parts[1], user: parts[2] }
    }
  }

  const remoteServers = [...new Set(agentSpecs.map(s => s.server).filter(s => s !== "local"))]
  let serversConfig: Record<string, { sshHost: string; user: string }> | undefined
  if (remoteServers.length > 0) {
    serversConfig = {}
    for (const srv of remoteServers) {
      if (serverFlags[srv]) {
        serversConfig[srv] = serverFlags[srv]
      } else {
        throw new Error(
          `Agent(s) reference server "${srv}" but no --server ${srv}:SSH_HOST:USER provided.`
        )
      }
    }
  }

  const config: FleetConfig = {
    fleet: { name },
    structure,
    discord: {
      channels,
      serverId: guildId,
      ...(ownerId !== undefined ? { userId: ownerId } : {}),
    },
    servers: serversConfig,
    defaults: {
      workspace: "~/workspace",
    },
    agents,
  }

  saveConfig(config, configDir)
  log("  Wrote fleet.yaml")
  writeGlobalConfig(configDir, name)
  if (!opts.json) console.log("  Wrote global config → ~/.fleet/config.json")

  // ── 6e. Install fleet skill globally ────────────────────────────────
  const skillSource = join(homedir(), ".fleet", "skill", "SKILL.md")
  const skillDir = join(homedir(), ".claude", "skills", "fleet")
  const skillTarget = join(skillDir, "SKILL.md")
  if (existsSync(skillSource) && !existsSync(skillTarget)) {
    mkdirSync(skillDir, { recursive: true })
    symlinkSync(skillSource, skillTarget)
    log("  Installed fleet skill → ~/.claude/skills/fleet/")
  }

  // ── 7. Generate .env ──────────────────────────────────────────────────────
  const envLines: string[] = []
  for (let i = 0; i < agentSpecs.length; i++) {
    const envVar = tokenEnvName(agentSpecs[i].name)
    envLines.push(`${envVar}=${tokens[i]}`)
  }
  writeFileSync(join(configDir, ".env"), envLines.join("\n") + "\n", "utf8")
  log("  Wrote .env")

  // ── 8 & 9. Identity files and access.json ─────────────────────────────────
  // Build botIds map for identity prompts
  const botIds: Record<string, string> = {}
  for (let i = 0; i < agentSpecs.length; i++) {
    botIds[agentSpecs[i].name] = botInfos[i].id
  }

  // Write bot-ids.json for cross-fleet discovery (used by fleet patch)
  writeFileSync(
    join(configDir, "bot-ids.json"),
    JSON.stringify(botIds, null, 2) + "\n",
    "utf8"
  )
  log("  Wrote bot-ids.json")

  const writtenFiles: string[] = ["fleet.yaml", ".env", "bot-ids.json"]
  log("Writing identity and access files…")
  for (let i = 0; i < agentSpecs.length; i++) {
    const agentName = agentSpecs[i].name
    const stateDir = resolveStateDir(agentName, config)

    // Also ensure the identities/ directory exists for the identity.md symlink path
    const identitiesDir = join(configDir, "identities")
    mkdirSync(identitiesDir, { recursive: true })

    // 8. Write identity.md into stateDir (writeBootIdentity creates stateDir)
    writeBootIdentity(agentName, config, botIds, stateDir)
    log(`  ${agentName}: identity.md → ${stateDir}`)
    writtenFiles.push(`identities/${agentName}.md`)

    // 9. Write access.json — partnerBotIds = all other bot IDs
    const partnerBotIds = agentSpecs
      .filter((_, j) => j !== i)
      .map((spec) => botIds[spec.name])

    const agentDef = config.agents[agentName]
    const agentChannels = agentDef?.channels
      ? Object.fromEntries(
          Object.entries(channels)
            .filter(([label]) => agentDef.channels!.includes(label))
        )
      : channels

    writeAccessConfig(stateDir, {
      channels: agentChannels,
      partnerBotIds,
      requireMention: true,
      userId: config.discord.userId,
    })
    log(`  ${agentName}: access.json → ${stateDir}`)
  }

  // ── Check bot guild membership ────────────────────────────────────────────
  const missingBots: Array<{ name: string; appId: string }> = []
  try {
    for (let i = 0; i < tokens.length; i++) {
      const botServers = await discord.listServers(tokens[i])
      if (!botServers.some(s => s.id === guildId)) {
        missingBots.push({ name: agentSpecs[i].name, appId: botInfos[i].appId })
      }
    }
  } catch {
    if (!opts.json) log("  (Skipped bot invitation check — Discord rate limit)")
  }

  if (missingBots.length > 0 && !opts.json) {
    console.log("")
    console.log("Warning: these bots are NOT in the server yet — invite them:")
    for (const bot of missingBots) {
      console.log(`  ${bot.name}: ${discord.inviteUrl(bot.appId)}`)
    }
  }

  // ── 10. Patch Discord plugin (PARTNER_BOT_IDS) on local + remote ─────────
  const needsClaudePatch = agentSpecs.some((spec) => (spec.adapter ?? "claude") === "claude")
  if (needsClaudePatch) {
    log("Patching Discord plugin…")
    try {
      await patch({ json: opts.json })
    } catch (err) {
      if (!opts.json) console.warn(`  warn: patch failed — ${err instanceof Error ? err.message : err}`)
    }
  } else {
    log("Skipping Claude Discord plugin patch (no Claude agents configured)")
  }

  // ── 11. Print summary ─────────────────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify({
      fleet: name,
      agents: agentSpecs.map((s) => s.name),
      channels: Object.fromEntries(
        Object.entries(channels).map(([label, ch]) => [label, ch.id])
      ),
      files: writtenFiles,
    }))
    return
  }

  console.log("\n── Fleet initialized ──────────────────────────────────────")
  console.log(`Fleet name : ${name}`)
  console.log(`Guild      : ${guild.name} (${guildId})`)
  console.log(`Channels :`)
  for (const [label, ch] of Object.entries(channels)) {
    const ws = ch.workspace ? ` → ${ch.workspace}` : ""
    console.log(`  #${label} (${ch.id})${ws}`)
  }
  console.log("")
  console.log("Invite URLs (add bots to your server):")
  for (let i = 0; i < agentSpecs.length; i++) {
    const url = discord.inviteUrl(botInfos[i].appId)
    console.log(`  ${agentSpecs[i].name} (${botInfos[i].name}): ${url}`)
  }
  console.log("")
  console.log("Next steps:")
  console.log("  1. Open the invite URLs above and add each bot to your server")
  console.log("  2. Run: fleet start <agent>")
  console.log("  3. DM or @mention the bot in Discord to verify it responds")
}

export async function interactiveInit(configDir: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r))

  try {
    console.log("")
    console.log("fleet init — First-time setup")
    console.log("──────────────────────────────────")

    // Step 1: Fleet name
    const name = await ask("Fleet name [my-fleet]: ") || "my-fleet"

    // Step 2: Collect tokens
    console.log("")
    console.log("  Bot tokens (paste each, press Enter. Empty line when done):")
    console.log("  Get tokens at: https://discord.com/developers/applications")
    console.log("")

    const tokens: string[] = []
    const discord = new DiscordApi()
    while (true) {
      const token = await ask(`  Token ${tokens.length + 1}: `)
      if (!token.trim()) break
      try {
        const info = await discord.validateToken(token.trim())
        console.log(`  ✔ ${info.name} (${info.appId})`)
        tokens.push(token.trim())
      } catch {
        console.log("  ✘ Invalid token, try again")
      }
    }

    if (tokens.length === 0) {
      console.log("No tokens provided. Exiting.")
      rl.close()
      return
    }

    // Step 3: Agent names
    // Validate all tokens to get bot info
    const botInfos = await Promise.all(tokens.map(t => discord.validateToken(t)))

    console.log("")
    console.log("  Agents:")
    const agents: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      const defaultName = i === 0 ? "lead" : `worker-${i}`
      const defaultRole = i === 0 ? "lead" : "worker"
      const agentName = await ask(`  Name for ${botInfos[i].name} [${defaultName}]: `) || defaultName
      const role = await ask(`  Role for ${agentName} [${defaultRole}]: `) || defaultRole
      agents.push(`${agentName}:local:${role}`)
    }

    // Step 4: Channels
    console.log("")
    console.log("  Channels (label:id or label:id:workspace, empty line when done):")
    const channelArgs: string[] = []
    while (true) {
      const ch = await ask(`  Channel ${channelArgs.length + 1}: `)
      if (!ch.trim()) break
      channelArgs.push(ch.trim())
    }

    rl.close()

    // Call the existing non-interactive init
    await init({ tokens, name, agents, channel: channelArgs.length > 0 ? channelArgs : undefined, force: false })

  } catch (err) {
    rl.close()
    throw err
  }
}
