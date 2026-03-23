import { start } from "./commands/start"
import { stop } from "./commands/stop"
import { status } from "./commands/status"
import { init, interactiveInit } from "./commands/init"
import { doctor } from "./commands/doctor"
import { patch } from "./commands/patch"
import { inject } from "./commands/inject"
import { apply } from "./commands/apply"
import { addAgent } from "./commands/add-agent"
import { move } from "./commands/move"
import { use } from "./commands/use"
import { setupServer } from "./commands/setup-server"
import { restart } from "./commands/restart"
import { runAgent } from "./commands/run-agent"
import type { AgentAdapterKind } from "./core/types"

function usage(): void {
  console.log(`fleet-next — Agent fleet CLI (TypeScript)

Usage:
  fleet-next init --token T1 [--token T2 …] --name NAME [--agent name:server:role[:adapter] …] [--channel label:id[:workspace] …] [--guild ID] [--create-channel NAME] [--force]
  fleet-next start <agent> [--wait] [--role <r>]
  fleet-next restart <agent>
  fleet-next stop <agent> [--force]
  fleet-next status [--json]
  fleet-next doctor [--json]
  fleet-next patch [--json]
  fleet-next inject <agent> <role>
  fleet-next apply [--json]
  fleet-next add-agent --token T --name N --role R [--server S] [--adapter claude|codex]
  fleet-next move <agent> <server>
  fleet-next use <fleet-name|path>
  fleet-next setup-server <ssh-host>
  fleet-next run-agent <agent>
  fleet-next help

Flags:
  --json    Machine-readable output
  --wait    Block until agent is ready
  --force   Override safety checks`)
}

function parseFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function parseFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
}

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2)
  const command = args[0]

  try {
    switch (command) {
      case "init": {
        const tokens: string[] = []
        const agents: string[] = []
        const channelArgs: string[] = []
        const serverArgs: string[] = []
        for (let i = 1; i < args.length; i++) {
          if (args[i] === "--token" && args[i + 1]) { tokens.push(args[++i]); continue }
          if (args[i] === "--name" && args[i + 1]) { /* handled by parseFlagValue */ continue }
          if (args[i] === "--agent" && args[i + 1]) { agents.push(args[++i]); continue }
          if (args[i] === "--channel" && args[i + 1]) { channelArgs.push(args[++i]); continue }
          if (args[i] === "--server" && args[i + 1]) { serverArgs.push(args[++i]); continue }
          if (args[i] === "--guild" && args[i + 1]) { /* handled by parseFlagValue */ i++; continue }
          if (args[i] === "--create-channel" && args[i + 1]) { /* handled by parseFlagValue */ i++; continue }
        }
        const name = parseFlagValue(args, "--name") ?? "my-fleet"
        const template = parseFlagValue(args, "--template")
        const guild = parseFlagValue(args, "--guild")
        const createChannel = parseFlagValue(args, "--create-channel")
        if (tokens.length === 0) {
          await interactiveInit(process.cwd())
        } else {
          await init({ tokens, name, agents: agents.length > 0 ? agents : undefined, channel: channelArgs.length > 0 ? channelArgs : undefined, server: serverArgs.length > 0 ? serverArgs : undefined, guild, createChannel, force: parseFlag(args, "--force"), json: parseFlag(args, "--json"), template })
        }
        break
      }
      case "start": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet-next start <agent>")
        await start(agent, {
          wait: parseFlag(args, "--wait"),
          role: parseFlagValue(args, "--role"),
          json: parseFlag(args, "--json"),
        })
        break
      }
      case "restart": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet-next restart <agent>")
        await restart(agent, { json: parseFlag(args, "--json") })
        break
      }
      case "stop": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet-next stop <agent>")
        await stop(agent, { force: parseFlag(args, "--force"), json: parseFlag(args, "--json") })
        break
      }
      case "status":
        await status({ json: parseFlag(args, "--json") })
        break
      case "doctor":
        await doctor({ json: parseFlag(args, "--json") })
        break
      case "patch":
        await patch({ json: parseFlag(args, "--json") })
        break
      case "inject": {
        const agent = args[1]
        const role = args[2]
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet-next inject <agent> <role>")
        if (!role || role.startsWith("--")) throw new Error("Usage: fleet-next inject <agent> <role>")
        await inject(agent, role, { json: parseFlag(args, "--json") })
        break
      }
      case "apply":
        await apply({ json: parseFlag(args, "--json") })
        break
      case "add-agent": {
        const token = parseFlagValue(args, "--token")
        const name = parseFlagValue(args, "--name")
        const role = parseFlagValue(args, "--role")
        const server = parseFlagValue(args, "--server")
        const adapterValue = parseFlagValue(args, "--adapter")
        if (!token || !name || !role) {
          throw new Error("Usage: fleet-next add-agent --token T --name N --role R [--server S] [--adapter claude|codex]")
        }
        if (adapterValue && adapterValue !== "claude" && adapterValue !== "codex") {
          throw new Error(`Invalid --adapter "${adapterValue}". Expected "claude" or "codex"`)
        }
        const adapter = adapterValue as AgentAdapterKind | undefined
        await addAgent({ token, name, role, server, adapter, json: parseFlag(args, "--json") })
        break
      }
      case "move": {
        const agent = args[1]
        const server = args[2]
        if (!agent || agent.startsWith("--") || !server || server.startsWith("--")) {
          throw new Error("Usage: fleet-next move <agent> <server>")
        }
        await move(agent, server, { json: parseFlag(args, "--json") })
        break
      }
      case "use": {
        const target = args[1]
        if (!target || target.startsWith("--")) {
          throw new Error("Usage: fleet-next use <fleet-name-or-path>")
        }
        await use(target, { json: parseFlag(args, "--json") })
        break
      }
      case "setup-server": {
        const host = args[1]
        if (!host || host.startsWith("--")) {
          throw new Error("Usage: fleet-next setup-server <ssh-host>")
        }
        await setupServer(host, { json: parseFlag(args, "--json") })
        break
      }
      case "run-agent": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) {
          throw new Error("Usage: fleet-next run-agent <agent>")
        }
        await runAgent(agent)
        break
      }
      case "help":
      case "--help":
      case undefined:
        usage()
        break
      default:
        console.error(`Unknown command: ${command}`)
        usage()
        process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
