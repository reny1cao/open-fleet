import { writeBootIdentity, writeRoster } from "../../core/identity"
import { getToken } from "../../core/config"
import { DiscordApi } from "../../channel/discord/api"
import { writeAccessConfig } from "../../channel/discord/access"
import { sshRun, scp } from "../../runtime/remote"
import type { AgentAdapter } from "../types"
import type { StartAgentContext } from "../types"
import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  if (p === "~") return homedir()
  return p
}

export class ClaudeAgentAdapter implements AgentAdapter {
  readonly kind = "claude" as const

  async start(ctx: StartAgentContext): Promise<void> {
    const { agentName, configDir, config, runtime, token, session, stateDir, opts } = ctx
    const agentDef = config.agents[agentName]

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
          throw new Error(
            `Cannot start ${agentName}: own token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`
          )
        }
        if (!opts.json) {
          console.warn(`  Warning: ${name} token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`)
        }
        botIds[name] = "UNKNOWN"
      }
    }

    const unknownAgents = Object.entries(botIds).filter(([, id]) => id === "UNKNOWN").map(([name]) => name)
    if (unknownAgents.length > 0 && !opts.json) {
      console.warn(`  Warning: ${unknownAgents.length} agent(s) have unknown bot IDs: ${unknownAgents.join(", ")}`)
    }

    writeBootIdentity(agentName, config, botIds, stateDir)
    writeRoster(agentName, config, botIds, stateDir)

    const partnerBotIds = Object.entries(botIds)
      .filter(([name]) => name !== agentName)
      .map(([, id]) => id)
      .filter((id) => id !== "UNKNOWN")

    // Scope agent to specific channels if configured, otherwise all channels
    const agentChannelScopes = config.agents[agentName]?.channels
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

    const settingsPath = join(stateDir, ".claude", "settings.json")
    const settings = { skipDangerousModePermissionPrompt: true }
    mkdirSync(join(stateDir, ".claude"), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8")

    if (agentDef.server !== "local") {
      const serverConfig = config.servers![agentDef.server]
      if (!opts.json) console.log(`  Copying files to ${agentDef.server}...`)

      const { stdout: remoteHome } = await sshRun(serverConfig, "echo $HOME")
      const remoteStateDirRaw = agentDef.stateDir ?? `~/.fleet/state/discord-${agentName}`
      const remoteStateDirAbs = remoteStateDirRaw.replace(/^~/, remoteHome)

      await sshRun(serverConfig, `mkdir -p '${remoteStateDirAbs}/.claude'`)
      await scp(serverConfig, join(stateDir, "identity.md"), `${remoteStateDirAbs}/identity.md`)
      await scp(serverConfig, join(stateDir, "access.json"), `${remoteStateDirAbs}/access.json`)
      await scp(serverConfig, settingsPath, `${remoteStateDirAbs}/.claude/settings.json`)

      const rosterPath = join(stateDir, ".claude", "CLAUDE.md")
      if (existsSync(rosterPath)) {
        await scp(serverConfig, rosterPath, `${remoteStateDirAbs}/.claude/CLAUDE.md`)
      }
    }

    const isRemote = agentDef.server !== "local"
    const rawStateDir = agentDef.stateDir ?? `~/.fleet/state/discord-${agentName}`
    const rawWorkspace = agentDef.workspace ?? config.defaults.workspace ?? "~/workspace"
    const cmdStateDir = isRemote ? rawStateDir.replace(/^~/, "$HOME") : stateDir
    const cmdWorkspace = isRemote ? rawWorkspace.replace(/^~/, "$HOME") : expandHome(rawWorkspace)

    const quote = isRemote ? '"' : "'"
    const claudeCmd = [
      "claude",
      "--dangerously-skip-permissions",
      `--append-system-prompt-file ${quote}${cmdStateDir}/identity.md${quote}`,
      `--add-dir ${quote}${cmdWorkspace}${quote}`,
      `--channels ${discord.pluginId()}`,
    ].join(" ")

    const wrapperLines = [
      "#!/bin/bash",
      ...(isRemote ? ['export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"'] : []),
      "MAX_RETRIES=5",
      "RETRY_COUNT=0",
      "MIN_UPTIME=30",
      "",
      "while true; do",
      "  START_TIME=$(date +%s)",
      `  ${claudeCmd}`,
      "  UPTIME=$(($(date +%s) - START_TIME))",
      "  if [ $UPTIME -gt $MIN_UPTIME ]; then",
      "    RETRY_COUNT=0",
      "  else",
      "    RETRY_COUNT=$((RETRY_COUNT + 1))",
      "  fi",
      "  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then",
      `    echo "[fleet] ${agentName}: too many rapid restarts. Giving up."`,
      "    break",
      "  fi",
      `  echo "[fleet] ${agentName}: restarting in 3s..."`,
      "  sleep 3",
      "done",
    ]

    const wrapperScript = isRemote
      ? `/tmp/fleet-wrapper-${session}.sh`
      : join(stateDir, "wrapper.sh")
    writeFileSync(
      isRemote ? `/tmp/fleet-wrapper-${session}-local.sh` : wrapperScript,
      wrapperLines.join("\n") + "\n",
      "utf8"
    )

    if (isRemote) {
      const serverConfig = config.servers![agentDef.server]
      const remoteWrapper = `/tmp/fleet-wrapper-${session}.sh`
      await scp(serverConfig, `/tmp/fleet-wrapper-${session}-local.sh`, remoteWrapper)
      await sshRun(serverConfig, `chmod +x '${remoteWrapper}'`)
      try { (await import("fs")).unlinkSync(`/tmp/fleet-wrapper-${session}-local.sh`) } catch {}
    }

    const command = isRemote
      ? `bash /tmp/fleet-wrapper-${session}.sh`
      : `bash '${wrapperScript}'`

    const proxyEnv: Record<string, string> = {}
    for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) {
      if (process.env[key]) proxyEnv[key] = process.env[key]!
    }
    if (!proxyEnv.HTTP_PROXY && !proxyEnv.HTTPS_PROXY && !proxyEnv.http_proxy && !proxyEnv.https_proxy) {
      try {
        const globalConfigPath = join(homedir(), ".fleet", "config.json")
        if (existsSync(globalConfigPath)) {
          const globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf8"))
          if (globalConfig.proxy) {
            proxyEnv.HTTP_PROXY = globalConfig.proxy
            proxyEnv.HTTPS_PROXY = globalConfig.proxy
          }
        }
      } catch {}
    }

    await runtime.start({
      session,
      env: {
        DISCORD_BOT_TOKEN: token,
        DISCORD_STATE_DIR: cmdStateDir,
        DISCORD_ACCESS_MODE: "static",
        FLEET_SELF: agentName,
        ...proxyEnv,
      },
      workDir: cmdStateDir,
      command,
    })

    const sleepMs = agentDef.server === "local" ? 3000 : 5000
    for (let attempt = 0; attempt < 3; attempt++) {
      const output = await runtime.captureOutput(session)
      if (/Listening for channel messages/.test(output)) break
      if (/trust this folder|safety check/i.test(output)) {
        await runtime.sendKeys(session, "")
        await Bun.sleep(sleepMs)
        continue
      }
      if (/bypass|dangerous|permission|y\/n/i.test(output)) {
        await runtime.sendKeys(session, "y")
        await Bun.sleep(sleepMs)
        continue
      }
      await Bun.sleep(2000)
    }

    if (opts.wait) {
      await runtime.waitFor(session, /Listening for channel messages/, 60_000)
    }

    if (opts.json) {
      console.log(JSON.stringify({ agent: agentName, session, status: "started" }))
    } else {
      console.log(`Done: ${session}`)
    }
  }
}
