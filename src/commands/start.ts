import { findConfigDir, loadConfig, getToken, resolveStateDir, sessionName } from "../core/config"
import { writeBootIdentity, writeRoster } from "../core/identity"
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
  opts: { wait?: boolean; role?: string; json?: boolean }
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
    if (opts.json) {
      console.log(JSON.stringify({ agent: agentName, session, status: "already_running" }))
    } else {
      console.log(`Agent "${agentName}" is already running (session: ${session})`)
    }
    return
  }

  // 6. Validate all bot tokens to build botIds map (parallel)
  const discord = new DiscordApi()
  const botIds: Record<string, string> = {}

  const entries = Object.entries(config.agents)
  const results = await Promise.allSettled(
    entries.map(async ([name]) => {
      const agentToken = getToken(name, config, configDir)
      const info = await discord.validateToken(agentToken)
      return { name, id: info.id }
    })
  )

  for (let i = 0; i < entries.length; i++) {
    const [name] = entries[i]
    const result = results[i]
    if (result.status === "fulfilled") {
      botIds[name] = result.value.id
    } else {
      if (name === agentName) {
        throw new Error(`Cannot start ${agentName}: own token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`)
      }
      if (!opts.json) console.warn(`  Warning: ${name} token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`)
      botIds[name] = "UNKNOWN"
    }
  }

  const unknownAgents = Object.entries(botIds).filter(([, id]) => id === "UNKNOWN").map(([n]) => n)
  if (unknownAgents.length > 0 && !opts.json) {
    console.warn(`  Warning: ${unknownAgents.length} agent(s) have unknown bot IDs: ${unknownAgents.join(", ")}`)
  }

  // 7. Write identity.md (fixed, loaded once via --append-system-prompt-file)
  writeBootIdentity(agentName, config, botIds, expandedStateDir)

  // 7b. Write roster CLAUDE.md (dynamic, re-read every turn)
  writeRoster(agentName, config, botIds, expandedStateDir)

  // 8. Write access.json — partnerBotIds = all other bot IDs
  const partnerBotIds = Object.entries(botIds)
    .filter(([name]) => name !== agentName)
    .map(([, id]) => id)
    .filter((id) => id !== "UNKNOWN")

  writeAccessConfig(expandedStateDir, {
    channelId: config.discord.channelId,
    partnerBotIds,
    requireMention: true,
    userId: config.discord.userId,
  })

  // 9. Determine workspace (for --add-dir)
  const workspace = agentDef.workspace ?? config.defaults.workspace ?? process.cwd()
  const expandedWorkspace = expandHome(workspace)

  // 10. Build command
  //   CWD = stateDir (so Claude Code reads .claude/CLAUDE.md for dynamic roster)
  //   --add-dir = workspace (so agent can access the actual codebase)
  //   --append-system-prompt-file = fixed identity (role, rules, formatting)
  const command = [
    "claude",
    "--dangerously-skip-permissions",
    `--append-system-prompt-file '${expandedStateDir}/identity.md'`,
    `--add-dir '${expandedWorkspace}'`,
    `--channels ${discord.pluginId()}`,
  ].join(" ")

  // 11. Start the session (CWD = stateDir for CLAUDE.md discovery)
  await runtime.start({
    session,
    env: {
      DISCORD_BOT_TOKEN: token,
      DISCORD_STATE_DIR: expandedStateDir,
      DISCORD_ACCESS_MODE: "static",
      FLEET_SELF: agentName,
    },
    workDir: expandedStateDir,
    command,
  })

  // 11. Handle trust prompt (new workspace directory) and permissions prompt
  //     Both require pressing Enter or "y" + Enter. Poll for either.
  for (let attempt = 0; attempt < 3; attempt++) {
    const output = await runtime.captureOutput(session)
    if (/Listening for channel messages/.test(output)) break
    if (/trust this folder|safety check/i.test(output)) {
      await runtime.sendKeys(session, "")  // press Enter to accept
      await Bun.sleep(3000)
      continue
    }
    if (/bypass|dangerous|permission|y\/n/i.test(output)) {
      await runtime.sendKeys(session, "y")
      await Bun.sleep(3000)
      continue
    }
    await Bun.sleep(2000)
  }

  // 12. Optionally wait for "Listening for channel messages"
  if (opts.wait) {
    await runtime.waitFor(session, /Listening for channel messages/, 60_000)
  }

  // 13. Done
  if (opts.json) {
    console.log(JSON.stringify({ agent: agentName, session, status: "started" }))
  } else {
    console.log(`Done: ${session}`)
  }
}
