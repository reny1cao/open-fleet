import { writeBootIdentity, writeRoster } from "../../core/identity"
import { getToken } from "../../core/config"
import { DiscordApi } from "../../channel/discord/api"
import { writeAccessConfig } from "../../channel/discord/access"
import { heartbeatShellSnippet } from "../../core/heartbeat"
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
    const botDisplayNames: Record<string, string> = {}

    const entries = Object.entries(config.agents)
    const results = await Promise.allSettled(
      entries.map(async ([name]) => {
        const agentToken = getToken(name, config, configDir)
        const info = await discord.validateToken(agentToken)
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
        if (name === agentName) {
          throw new Error(
            `Cannot start ${agentName}: own token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`
          )
        }
        if (!opts.json) {
          console.warn(`  Warning: ${name} token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`)
        }
        botIds[name] = "UNKNOWN"
        botDisplayNames[name] = name
      }
    }

    const unknownAgents = Object.entries(botIds).filter(([, id]) => id === "UNKNOWN").map(([name]) => name)
    if (unknownAgents.length > 0 && !opts.json) {
      console.warn(`  Warning: ${unknownAgents.length} agent(s) have unknown bot IDs: ${unknownAgents.join(", ")}`)
    }

    writeBootIdentity(agentName, config, botIds, stateDir, botDisplayNames)
    writeRoster(agentName, config, botIds, stateDir, botDisplayNames)

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

      // Copy tasks-context.md for remote agents (boot-check doesn't run remotely)
      const tasksContextPath = join(stateDir, "tasks-context.md")
      if (existsSync(tasksContextPath)) {
        await scp(serverConfig, tasksContextPath, `${remoteStateDirAbs}/tasks-context.md`)
      }
    }

    const isRemote = agentDef.server !== "local"
    const rawStateDir = agentDef.stateDir ?? `~/.fleet/state/discord-${agentName}`
    const rawWorkspace = agentDef.workspace ?? config.defaults.workspace ?? "~/workspace"
    const cmdStateDir = isRemote ? rawStateDir.replace(/^~/, "$HOME") : stateDir
    const cmdWorkspace = isRemote ? rawWorkspace.replace(/^~/, "$HOME") : expandHome(rawWorkspace)

    const quote = isRemote ? '"' : "'"
    // Ensure tasks-context.md exists (empty is fine — boot-check overwrites with real content)
    const tasksContextLocal = join(stateDir, "tasks-context.md")
    if (!existsSync(tasksContextLocal)) {
      writeFileSync(tasksContextLocal, "", "utf8")
    }

    const claudeCmd = [
      "claude",
      "--dangerously-skip-permissions",
      `--append-system-prompt-file ${quote}${cmdStateDir}/identity.md${quote}`,
      `--append-system-prompt-file ${quote}${cmdStateDir}/tasks-context.md${quote}`,
      `--add-dir ${quote}${cmdWorkspace}${quote}`,
      `--channels ${discord.pluginId()}`,
    ].join(" ")

    // Heartbeat path: use the remote stateDir for remote agents
    const hbStateDir = isRemote ? cmdStateDir : stateDir

    // Resolve fleet CLI path for boot-check (local only — remote agents
    // get their config files SCP'd before the wrapper is launched)
    const fleetCliDir = configDir
    const bootCheckCmd = isRemote
      ? null // remote agents don't run boot-check in the wrapper
      : `cd '${fleetCliDir}' && bun run src/cli.ts boot-check ${agentName} 2>&1 | tail -20`

    // For remote agents, inject FLEET_API_URL so task commands route via HTTP
    const apiHost = config.fleet.apiHost ?? process.env.FLEET_API_HOST
    const apiPort = config.fleet.apiPort ?? parseInt(process.env.FLEET_API_PORT ?? "4680")
    const apiToken = process.env.FLEET_API_TOKEN ?? ""
    const apiEnvLines: string[] = isRemote && apiHost
      ? [
          `export FLEET_API_URL="http://${apiHost}:${apiPort}"`,
          ...(apiToken ? [`export FLEET_API_TOKEN="${apiToken}"`] : []),
          `export FLEET_SELF="${agentName}"`,
        ]
      : [`export FLEET_SELF="${agentName}"`]

    const wrapperLines = [
      "#!/bin/bash",
      ...(isRemote ? ['export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"'] : []),
      ...apiEnvLines,
      ...heartbeatShellSnippet(hbStateDir),
      "MAX_RETRIES=5",
      "RETRY_COUNT=0",
      "MIN_UPTIME=30",
      "",
      "while true; do",
      // Boot-check: regenerate config, verify plugin, verify identity, log boot
      ...(bootCheckCmd
        ? [
            `  echo "[fleet] ${agentName}: running boot-check..."`,
            `  ${bootCheckCmd}`,
            `  BOOT_EXIT=$?`,
            `  if [ $BOOT_EXIT -ne 0 ]; then`,
            `    echo "[fleet] ${agentName}: boot-check failed (exit $BOOT_EXIT) — launching anyway"`,
            `  fi`,
          ]
        : [`  echo "[fleet] ${agentName}: skipping boot-check (remote agent)"`]),
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
    const localWrapperPath = isRemote ? `/tmp/fleet-wrapper-${session}-local.sh` : wrapperScript
    writeFileSync(localWrapperPath, wrapperLines.join("\n") + "\n", { encoding: "utf8", mode: 0o700 })

    if (isRemote) {
      const serverConfig = config.servers![agentDef.server]
      const remoteWrapper = `/tmp/fleet-wrapper-${session}.sh`
      await scp(serverConfig, `/tmp/fleet-wrapper-${session}-local.sh`, remoteWrapper)
      await sshRun(serverConfig, `chmod 700 '${remoteWrapper}'`)
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

    // Auto-patch after start: plugin may have been reinstalled fresh
    try {
      const { patch: runPatch } = await import("../../commands/patch")
      // Suppress stdout when caller expects JSON to avoid corrupting output
      const origLog = console.log
      if (opts.json) console.log = () => {}
      try {
        await runPatch({ json: true })
      } finally {
        if (opts.json) console.log = origLog
      }
    } catch (e) {
      if (!opts.json) {
        console.warn(`  Warning: auto-patch failed — ${e instanceof Error ? e.message : e}`)
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ agent: agentName, session, status: "started" }))
    } else {
      console.log(`Done: ${session}`)
    }
  }
}
