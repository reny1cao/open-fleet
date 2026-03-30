import { findConfigDir, loadConfig, getToken, resolveStateDir } from "../core/config"
import { writeBootIdentity, writeRoster } from "../core/identity"
import { writeAccessConfig } from "../channel/discord/access"
import { DiscordApi } from "../channel/discord/api"
import { scp, sshRun } from "../runtime/remote"
import { existsSync } from "fs"
import { join } from "path"

/**
 * Propagate config from fleet.yaml to all agents (or a single agent) without restart.
 * Regenerates access.json and roster for each agent, SCPs to remote agents.
 * Running agents pick up changes via the plugin's 30s static reload.
 */
export async function sync(
  agentName?: string,
  opts?: { json?: boolean }
): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  // Determine which agents to sync
  const agentNames = agentName
    ? [agentName]
    : Object.keys(config.agents)

  if (agentName && !config.agents[agentName]) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  // Validate all tokens and collect bot IDs (needed for partner IDs and roster)
  const discord = new DiscordApi()
  const botIds: Record<string, string> = {}
  const botDisplayNames: Record<string, string> = {}

  if (!opts?.json) console.log("Validating bot tokens...")

  const entries = Object.entries(config.agents)
  const results = await Promise.allSettled(
    entries.map(async ([name]) => {
      const token = getToken(name, config, configDir)
      const info = await discord.validateToken(token)
      return { name, id: info.id, displayName: info.name }
    })
  )

  for (let i = 0; i < entries.length; i++) {
    const [name] = entries[i]
    const result = results[i]
    if (result.status === "fulfilled") {
      botIds[name] = result.value.id
      botDisplayNames[name] = result.value.displayName
    } else {
      if (!opts?.json) {
        console.warn(`  Warning: ${name} token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`)
      }
      botIds[name] = "UNKNOWN"
      botDisplayNames[name] = name
    }
  }

  const syncResults: Array<{ agent: string; status: string; error?: string }> = []

  for (const name of agentNames) {
    try {
      if (!opts?.json) console.log(`Syncing ${name}...`)

      const agentDef = config.agents[name]
      const stateDir = resolveStateDir(name, config)

      // 1. Regenerate access.json
      const partnerBotIds = Object.entries(botIds)
        .filter(([n]) => n !== name)
        .map(([, id]) => id)
        .filter((id) => id !== "UNKNOWN")

      const agentChannelScopes = agentDef.channels
      const scopedChannels = agentChannelScopes
        ? Object.fromEntries(
            Object.entries(config.discord.channels)
              .filter(([label]) => agentChannelScopes.includes(label))
          )
        : config.discord.channels

      writeAccessConfig(stateDir, {
        channels: scopedChannels,
        partnerBotIds,
        requireMention: true,
        userId: config.discord.userId,
      })

      // 2. Update roster (CLAUDE.md — picked up live by Claude Code)
      writeRoster(name, config, botIds, stateDir, botDisplayNames)

      // 3. Update identity.md
      writeBootIdentity(name, config, botIds, stateDir, botDisplayNames)

      // 4. SCP to remote agents
      if (agentDef.server !== "local") {
        const serverConfig = config.servers![agentDef.server]
        if (!opts?.json) console.log(`  Copying to ${agentDef.server}...`)

        const { stdout: remoteHome } = await sshRun(serverConfig, "echo $HOME")
        const remoteStateDirRaw = agentDef.stateDir ?? `~/.fleet/state/discord-${name}`
        const remoteStateDirAbs = remoteStateDirRaw.replace(/^~/, remoteHome)

        await sshRun(serverConfig, `mkdir -p '${remoteStateDirAbs}/.claude'`)
        await scp(serverConfig, join(stateDir, "access.json"), `${remoteStateDirAbs}/access.json`)
        await scp(serverConfig, join(stateDir, "identity.md"), `${remoteStateDirAbs}/identity.md`)

        const rosterPath = join(stateDir, ".claude", "CLAUDE.md")
        if (existsSync(rosterPath)) {
          await scp(serverConfig, rosterPath, `${remoteStateDirAbs}/.claude/CLAUDE.md`)
        }
      }

      syncResults.push({ agent: name, status: "synced" })
      if (!opts?.json) console.log(`  ✓ ${name}`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      syncResults.push({ agent: name, status: "failed", error: errMsg })
      if (!opts?.json) console.error(`  ✗ ${name}: ${errMsg}`)
    }
  }

  // Summary
  const synced = syncResults.filter((r) => r.status === "synced").length
  const failed = syncResults.filter((r) => r.status === "failed").length

  if (opts?.json) {
    console.log(JSON.stringify({ results: syncResults, synced, failed }))
  } else {
    console.log(`\nSync complete: ${synced} synced, ${failed} failed`)
    if (failed === 0) {
      console.log("Agents will pick up changes within 30s (static access reload).")
    }
  }
}
