import { existsSync, realpathSync, writeFileSync } from "fs"
import { basename, dirname, join } from "path"
import { writeBootIdentity, writeRoster } from "../../core/identity"
import { getToken, resolveStateDir } from "../../core/config"
import { heartbeatShellSnippet } from "../../core/heartbeat"
import { DiscordApi } from "../../channel/discord/api"
import { scp, sshRun } from "../../runtime/remote"
import type { AgentAdapter, StartAgentContext } from "../types"
import {
  resolveBundledCodexWorkerCommand,
  resolveCodexRemoteBundleDir,
  resolveCodexStateDir,
  resolveLocalCodexWorkerCommand,
  resolveRemoteCodexWorkerCommand,
} from "./bootstrap"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function resolveFleetBinaryPath(): string {
  const currentExecutable = resolveCurrentExecutablePath()
  const executableName = basename(currentExecutable)
  if (executableName === "fleet" || executableName === "fleet-next") {
    return currentExecutable
  }

  // Try source runner (fleet) in repo root
  const repoRunner = join(import.meta.dir, "..", "..", "..", "fleet")
  if (existsSync(repoRunner)) {
    return repoRunner
  }

  // Legacy: compiled binary
  const repoBinary = join(import.meta.dir, "..", "..", "..", "fleet-next")
  if (existsSync(repoBinary)) {
    return repoBinary
  }

  throw new Error("fleet runner not found in repo root. Ensure open-fleet/fleet exists.")
}

function resolveCurrentExecutablePath(): string {
  try {
    return realpathSync(process.execPath)
  } catch {
    return process.execPath
  }
}

function resolveFleetRemoteBundlePath(): string {
  const currentExecutable = resolveCurrentExecutablePath()
  const executableName = basename(currentExecutable)
  if (executableName === "fleet" || executableName === "fleet-next") {
    const siblingBundle = join(dirname(currentExecutable), "fleet-remote.mjs")
    if (existsSync(siblingBundle)) {
      return siblingBundle
    }
  }

  const repoBundle = join(import.meta.dir, "..", "..", "..", "fleet-remote.mjs")
  if (existsSync(repoBundle)) {
    return repoBundle
  }

  throw new Error("fleet-remote.mjs not found. Run `bun run build:remote` to generate it.")
}

export class CodexAgentAdapter implements AgentAdapter {
  readonly kind = "codex" as const

  async start(ctx: StartAgentContext): Promise<void> {
    const { agentName, configDir, config, runtime, token, session, stateDir, opts } = ctx
    const agentDef = config.agents[agentName]
    const isRemote = agentDef.server !== "local"

    const discord = new DiscordApi()
    const botIds: Record<string, string> = {}
    const entries = Object.entries(config.agents)
    const results = await Promise.allSettled(
      entries.map(async ([name]) => {
        const agentToken = getToken(name, config, configDir)
        const info = await discord.validateToken(agentToken)
        return { name, id: info.id }
      }),
    )

    for (let i = 0; i < entries.length; i++) {
      const [name] = entries[i]
      const result = results[i]
      if (result.status === "fulfilled") {
        botIds[name] = result.value.id
        continue
      }

      if (name === agentName) {
        throw new Error(
          `Cannot start ${agentName}: own token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`,
        )
      }

      if (!opts.json) {
        console.warn(`  Warning: ${name} token validation failed — ${result.reason instanceof Error ? result.reason.message : result.reason}`)
      }
      botIds[name] = "UNKNOWN"
    }

    writeBootIdentity(agentName, config, botIds, stateDir)
    writeRoster(agentName, config, botIds, stateDir)

    let command: string
    let workDir = configDir
    let fleetConfigPath = join(configDir, "fleet.yaml")

    if (isRemote) {
      const serverConfig = config.servers?.[agentDef.server]
      if (!serverConfig) {
        throw new Error(`Server "${agentDef.server}" not defined in fleet.yaml servers`)
      }

      const { stdout: remoteHome } = await sshRun(serverConfig, "echo $HOME")
      const remoteStateDir = resolveCodexStateDir(agentName, agentDef.stateDir, remoteHome)
      const remoteBundleDir = resolveCodexRemoteBundleDir(remoteStateDir)

      await sshRun(serverConfig, `mkdir -p "${remoteStateDir}/.claude" "${remoteBundleDir}"`)
      await scp(serverConfig, join(stateDir, "identity.md"), `${remoteStateDir}/identity.md`)

      const rosterPath = join(stateDir, ".claude", "CLAUDE.md")
      if (existsSync(rosterPath)) {
        await scp(serverConfig, rosterPath, `${remoteStateDir}/.claude/CLAUDE.md`)
      }

      // Copy task context and project wiki for remote agents
      const tasksContextPath = join(stateDir, "tasks-context.md")
      if (existsSync(tasksContextPath)) {
        await scp(serverConfig, tasksContextPath, `${remoteStateDir}/tasks-context.md`)
      }
      const projectWikiPath = join(stateDir, "project-wiki.md")
      if (existsSync(projectWikiPath)) {
        await scp(serverConfig, projectWikiPath, `${remoteStateDir}/project-wiki.md`)
      }

      const localBundle = resolveFleetRemoteBundlePath()
      const remoteBundle = `${remoteBundleDir}/fleet-remote.mjs`
      const remoteFleetConfig = `${remoteBundleDir}/fleet.yaml`
      await scp(serverConfig, localBundle, remoteBundle)
      await scp(serverConfig, fleetConfigPath, remoteFleetConfig)

      command = resolveBundledCodexWorkerCommand(remoteBundle, agentName)
      workDir = remoteBundleDir
      fleetConfigPath = remoteFleetConfig
    } else {
      const currentExecutable = process.execPath
      const executableName = basename(currentExecutable)
      if (executableName === "fleet" || executableName === "fleet-next") {
        command = resolveRemoteCodexWorkerCommand(currentExecutable, agentName)
      } else {
        const entrypoint = join(import.meta.dir, "..", "..", "index.ts")
        command = resolveLocalCodexWorkerCommand(entrypoint, agentName)
      }
    }

    // Resolve API URL so agents can use fleet task commands via HTTP
    const apiHost = config.fleet.apiHost ?? process.env.FLEET_API_HOST
    const apiPort = config.fleet.apiPort ?? parseInt(process.env.FLEET_API_PORT ?? "4680")
    const apiUrl = apiHost
      ? `http://${apiHost}:${apiPort}`
      : `http://127.0.0.1:${apiPort}`

    // Generate wrapper script with heartbeat, boot-check, and auto-restart
    const hbStateDir = stateDir
    const bootCheckCmd = isRemote
      ? null
      : `cd '${configDir}' && bun run src/cli.ts boot-check ${agentName} 2>&1 | tail -20`

    const wrapperLines = [
      "#!/bin/bash",
      ...(isRemote ? ['export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.npm-global/bin:$PATH"'] : ['export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"']),
      `export DISCORD_BOT_TOKEN="${token}"`,
      `export ${agentDef.tokenEnv}="${token}"`,
      `export FLEET_CONFIG="${fleetConfigPath}"`,
      `export FLEET_SELF="${agentName}"`,
      `export FLEET_API_URL="${apiUrl}"`,
      ...(process.env.FLEET_API_TOKEN ? [`export FLEET_API_TOKEN="${process.env.FLEET_API_TOKEN}"`] : []),
      "",
      ...heartbeatShellSnippet(hbStateDir),
      "MAX_RETRIES=5",
      "RETRY_COUNT=0",
      "MIN_UPTIME=30",
      "",
      "while true; do",
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
      `  ${command}`,
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
      await scp(serverConfig, localWrapperPath, wrapperScript)
    }

    await runtime.start({
      session,
      env: {},
      workDir,
      command: `bash ${wrapperScript}`,
    })

    if (opts.wait) {
      const ready = await runtime.waitFor(session, /Codex Discord worker ready/, 60_000)
      if (!ready) {
        throw new Error(`Timed out waiting for Codex worker "${agentName}" to become ready`)
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ agent: agentName, session, status: "started" }))
    } else {
      console.log(`Done: ${session}`)
    }
  }
}
