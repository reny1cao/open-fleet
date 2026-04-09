import { homedir } from "os"
import { isAbsolute, join } from "path"
import { getToken, loadConfig, findConfigDir, resolveStateDir } from "../core/config"
import { getAgentAdapterKind } from "../agents/resolve"
import { buildCodexDeveloperInstructions } from "../agents/codex/instructions"
import { getCodexThreadId, setCodexThreadId } from "../agents/codex/state"
import { PersistentCodexSession } from "../agents/codex/app-server"
import { DiscordApi } from "../channel/discord/api"
import { DiscordBot } from "../channel/discord/bot"

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  if (p === "~") return homedir()
  return p
}

function resolveWorkspacePath(configDir: string, workspace: string): string {
  const expanded = expandHome(workspace)
  return isAbsolute(expanded) ? expanded : join(configDir, expanded)
}

export async function runAgent(agentName: string): Promise<void> {
  const configDir = findConfigDir()
  const config = loadConfig(configDir)
  const agentDef = config.agents[agentName]
  if (!agentDef) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  if (getAgentAdapterKind(agentName, config) !== "codex") {
    throw new Error(`run-agent currently only supports Codex agents. "${agentName}" is configured as ${getAgentAdapterKind(agentName, config)}.`)
  }

  const token = getToken(agentName, config, configDir)
  const stateDir = resolveStateDir(agentName, config)
  const api = new DiscordApi()
  const me = await api.validateToken(token)
  const defaultWorkspace = resolveWorkspacePath(
    configDir,
    agentDef.workspace ?? config.defaults.workspace ?? "~/workspace",
  )

  // Long-lived Codex session — reuses the same app-server process across turns
  const codexSession = new PersistentCodexSession(defaultWorkspace)

  const bot = new DiscordBot({
    token,
    botUserId: me.id,
    channels: config.discord.channels,
    defaultWorkspace,
    api,
    onMention: async (context) => {
      const developerInstructions = buildCodexDeveloperInstructions(stateDir)
      const workspacePath = resolveWorkspacePath(configDir, context.workspace)
      const prompt = context.prompt.replace(`Workspace: ${context.workspace}`, `Workspace: ${workspacePath}`)
      const result = await codexSession.runTurn({
        cwd: workspacePath,
        developerInstructions,
        prompt,
        existingThreadId: getCodexThreadId(stateDir, context.scopeKey),
      })
      setCodexThreadId(stateDir, context.scopeKey, result.threadId)
      return result.reply.length > 0 ? result.reply : "I completed the turn but did not generate a reply. Please ask a more specific question."
    },
  })

  const shutdown = async (): Promise<void> => {
    await codexSession.close()
    await bot.close()
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())

  await bot.start()
  console.log(`Codex Discord worker ready (${agentName})`)
  await bot.waitForClose()
}
