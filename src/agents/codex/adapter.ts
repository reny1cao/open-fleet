import { join } from "path"
import { writeBootIdentity, writeRoster } from "../../core/identity"
import { getToken } from "../../core/config"
import { DiscordApi } from "../../channel/discord/api"
import type { AgentAdapter, StartAgentContext } from "../types"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export class CodexAgentAdapter implements AgentAdapter {
  readonly kind = "codex" as const

  async start(ctx: StartAgentContext): Promise<void> {
    const { agentName, configDir, config, runtime, token, session, stateDir, opts } = ctx
    const agentDef = config.agents[agentName]
    if (agentDef.server !== "local") {
      throw new Error("Codex agents currently support local startup only")
    }

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

    const entrypoint = join(import.meta.dir, "..", "..", "index.ts")
    const command = [
      "bun",
      "run",
      shellQuote(entrypoint),
      "run-agent",
      shellQuote(agentName),
    ].join(" ")

    await runtime.start({
      session,
      env: {
        DISCORD_BOT_TOKEN: token,
        FLEET_CONFIG: join(configDir, "fleet.yaml"),
        FLEET_SELF: agentName,
      },
      workDir: configDir,
      command,
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
