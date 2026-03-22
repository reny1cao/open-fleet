import { start } from "./commands/start"
import { stop } from "./commands/stop"
import { status } from "./commands/status"

function usage(): void {
  console.log(`fleet-next — Agent fleet CLI (TypeScript)

Usage:
  fleet-next start <agent> [--wait] [--role <r>]
  fleet-next stop <agent> [--force]
  fleet-next status [--json]
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
