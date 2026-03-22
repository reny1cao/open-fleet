import { findConfigDir, loadConfig, getToken, resolveStateDir, sessionName } from "../core/config"
import { writeBootIdentity } from "../core/identity"
import { DiscordApi } from "../channel/discord/api"
import { writeAccessConfig } from "../channel/discord/access"
import { TmuxLocal } from "../runtime/tmux"
import { homedir } from "os"
import { join } from "path"

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  if (p === "~") return homedir()
  return p
}

export async function start(
  agentName: string,
  opts: { wait?: boolean; role?: string }
): Promise<void> {
  // 1. Find config dir and load config; throw if agent unknown
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agentDef = config.agents[agentName]
  if (!agentDef) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  // 2. Get token for this agent
  const token = getToken(agentName, config, configDir)

  // 3. Resolve state dir (expand ~ to HOME)
  const expandedStateDir = resolveStateDir(agentName, config)

  // 4. Get session name
  const session = sessionName(config.fleet.name, agentName)

  // 5. Check if already running
  const runtime = new TmuxLocal()
  if (await runtime.isRunning(session)) {
    console.log(`Agent "${agentName}" is already running (session: ${session})`)
    return
  }

  // 6. Validate all bot tokens to build botIds map
  const discord = new DiscordApi()
  const botIds: Record<string, string> = {}

  for (const [name, def] of Object.entries(config.agents)) {
    try {
      const agentToken = getToken(name, config, configDir)
      const info = await discord.validateToken(agentToken)
      botIds[name] = info.id
    } catch {
      botIds[name] = "UNKNOWN"
    }
  }

  // 7. Write identity.md
  writeBootIdentity(agentName, config, botIds, expandedStateDir)

  // 8. Write access.json — partnerBotIds = all other bot IDs
  const partnerBotIds = Object.entries(botIds)
    .filter(([name]) => name !== agentName)
    .map(([, id]) => id)
    .filter((id) => id !== "UNKNOWN")

  writeAccessConfig(expandedStateDir, {
    channelId: config.discord.channelId,
    partnerBotIds,
    requireMention: true,
  })

  // 9. Build command
  const command = [
    "claude",
    "--dangerously-skip-permissions",
    `--append-system-prompt-file ${expandedStateDir}/identity.md`,
    `--channels ${discord.pluginId()}`,
  ].join(" ")

  // 10. Determine workspace
  const workspace = agentDef.workspace ?? config.defaults.workspace ?? process.cwd()
  const expandedWorkspace = expandHome(workspace)

  // 11. Start the session
  await runtime.start({
    session,
    env: {
      DISCORD_BOT_TOKEN: token,
      DISCORD_STATE_DIR: expandedStateDir,
      DISCORD_ACCESS_MODE: "static",
      FLEET_SELF: agentName,
    },
    workDir: expandedWorkspace,
    command,
  })

  // 11. Handle first-run permissions prompt
  const permMatched = await runtime.waitFor(
    session,
    /bypass|dangerous|permission|y\/n/i,
    10_000
  )
  if (permMatched) {
    await runtime.sendKeys(session, "y")
  }

  // 12. Optionally wait for "Listening for channel messages"
  if (opts.wait) {
    await runtime.waitFor(session, /Listening for channel messages/, 60_000)
  }

  // 13. Done
  console.log(`Done: ${session}`)
}
