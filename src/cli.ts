import { start } from "./commands/start"
import { stop } from "./commands/stop"
import { status } from "./commands/status"
import { init } from "./commands/init"
import { doctor } from "./commands/doctor"
import { patch } from "./commands/patch"
import { inject } from "./commands/inject"
import { apply } from "./commands/apply"
import { addAgent } from "./commands/add-agent"

function usage(): void {
  console.log(`fleet-next — Agent fleet CLI (TypeScript)

Usage:
  fleet-next init --token T1 [--token T2 …] --name NAME [--agent name:server:role …] [--channel ID] [--force]
  fleet-next start <agent> [--wait] [--role <r>]
  fleet-next stop <agent> [--force]
  fleet-next status [--json]
  fleet-next doctor [--json]
  fleet-next patch [--json]
  fleet-next inject <agent> <role>
  fleet-next apply [--json]
  fleet-next add-agent --token T --name N --role R [--server S]
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
        for (let i = 1; i < args.length; i++) {
          if (args[i] === "--token" && args[i + 1]) { tokens.push(args[++i]); continue }
          if (args[i] === "--name" && args[i + 1]) { /* handled by parseFlagValue */ continue }
          if (args[i] === "--agent" && args[i + 1]) { agents.push(args[++i]); continue }
        }
        const name = parseFlagValue(args, "--name") ?? "my-fleet"
        const channel = parseFlagValue(args, "--channel")
        if (tokens.length === 0) throw new Error("Usage: fleet-next init --token T1 [--token T2] --name NAME")
        await init({ tokens, name, agents: agents.length > 0 ? agents : undefined, channel, force: parseFlag(args, "--force") })
        break
      }
      case "start": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet-next start <agent>")
        await start(agent, {
          wait: parseFlag(args, "--wait"),
          role: parseFlagValue(args, "--role"),
        })
        break
      }
      case "stop": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet-next stop <agent>")
        await stop(agent, { force: parseFlag(args, "--force") })
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
        await inject(agent, role)
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
        if (!token || !name || !role) {
          throw new Error("Usage: fleet-next add-agent --token T --name N --role R [--server S]")
        }
        await addAgent({ token, name, role, server })
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
