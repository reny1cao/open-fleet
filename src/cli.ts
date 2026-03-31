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
import { setAdapter } from "./commands/set-adapter"
import { use } from "./commands/use"
import { setupServer } from "./commands/setup-server"
import { restart } from "./commands/restart"
import { runAgent } from "./commands/run-agent"
import { logs } from "./commands/logs"
import { watch } from "./commands/watch"
import { sync } from "./commands/sync"
import { bootCheck } from "./commands/boot-check"
import { validate } from "./commands/validate"
import { clear } from "./commands/clear"
import { watchdog } from "./commands/watchdog"
import type { AgentAdapterKind } from "./core/types"

async function getVersion(): Promise<string> {
  const pkg = "0.1.0"
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    })
    const sha = new TextDecoder().decode(result.stdout).trim()
    if (sha) return `fleet ${pkg} (${sha})`
  } catch {}
  return `fleet ${pkg}`
}

function usage(): void {
  console.log(`fleet — Agent fleet CLI

Usage:
  fleet init --token T1 [--token T2 …] --name NAME [--agent name:server:role[:adapter] …] [--channel label:id[:workspace] …] [--guild ID] [--create-channel NAME] [--force]
  fleet start <agent> [--wait] [--role <r>]
  fleet clear <agent> | fleet clear --all
  fleet restart <agent>
  fleet stop <agent> [--force]
  fleet logs <agent> [--lines N] [--follow] [--json]
  fleet logs --all [--lines N] [--json]
  fleet watch [--interval N]
  fleet watchdog [--interval N] [--dry-run] [--verbose] [--no-alert]
  fleet status [--json]
  fleet doctor [--json]
  fleet patch [--json]
  fleet inject <agent> <role>
  fleet apply [--json]
  fleet add-agent --token T --name N --role R [--server S] [--adapter claude|codex]
  fleet move <agent> <server>
  fleet set-adapter <agent> <claude|codex>
  fleet use <fleet-name|path>
  fleet setup-server <ssh-host> [--reuse-codex-auth|--no-reuse-codex-auth]
  fleet sync [agent] [--json]
  fleet boot-check <agent>
  fleet validate [--json]
  fleet run-agent <agent>
  fleet help
  fleet --version

Flags:
  --json      Machine-readable output
  --wait      Block until agent is ready
  --force     Override safety checks
  --version   Print version and git SHA`)
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
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet start <agent>")
        await start(agent, {
          wait: parseFlag(args, "--wait"),
          role: parseFlagValue(args, "--role"),
          json: parseFlag(args, "--json"),
        })
        break
      }
      case "restart": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet restart <agent>")
        await restart(agent, { json: parseFlag(args, "--json") })
        break
      }
      case "clear": {
        const agent = parseFlag(args, "--all") ? undefined : args[1]
        if (!agent && !parseFlag(args, "--all")) {
          throw new Error("Usage: fleet clear <agent> or fleet clear --all")
        }
        await clear(agent, { all: parseFlag(args, "--all"), json: parseFlag(args, "--json") })
        break
      }
      case "stop": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet stop <agent>")
        await stop(agent, { force: parseFlag(args, "--force"), json: parseFlag(args, "--json") })
        break
      }
      case "logs": {
        const agent = parseFlag(args, "--all") ? undefined : args[1]
        if (!agent && !parseFlag(args, "--all")) {
          throw new Error("Usage: fleet logs <agent> [--lines N] [--follow] [--json]\n       fleet logs --all [--lines N] [--json]")
        }
        await logs(agent, {
          lines: parseInt(parseFlagValue(args, "--lines") ?? "50"),
          all: parseFlag(args, "--all"),
          follow: parseFlag(args, "--follow") || parseFlag(args, "-f"),
          json: parseFlag(args, "--json"),
        })
        break
      }
      case "watch":
        await watch({
          interval: parseInt(parseFlagValue(args, "--interval") ?? "5"),
        })
        break
      case "watchdog":
        await watchdog({
          interval: parseInt(parseFlagValue(args, "--interval") ?? "15"),
          dryRun: parseFlag(args, "--dry-run"),
          verbose: parseFlag(args, "--verbose"),
          noAlert: parseFlag(args, "--no-alert"),
        })
        break
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
        if (!agent || agent.startsWith("--")) throw new Error("Usage: fleet inject <agent> <role>")
        if (!role || role.startsWith("--")) throw new Error("Usage: fleet inject <agent> <role>")
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
          throw new Error("Usage: fleet add-agent --token T --name N --role R [--server S] [--adapter claude|codex]")
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
          throw new Error("Usage: fleet move <agent> <server>")
        }
        await move(agent, server, { json: parseFlag(args, "--json") })
        break
      }
      case "set-adapter": {
        const agent = args[1]
        const adapter = args[2]
        if (!agent || agent.startsWith("--") || !adapter || adapter.startsWith("--")) {
          throw new Error("Usage: fleet set-adapter <agent> <claude|codex>")
        }
        if (adapter !== "claude" && adapter !== "codex") {
          throw new Error(`Invalid adapter "${adapter}". Expected "claude" or "codex"`)
        }
        await setAdapter(agent, adapter as AgentAdapterKind, { json: parseFlag(args, "--json") })
        break
      }
      case "use": {
        const target = args[1]
        if (!target || target.startsWith("--")) {
          throw new Error("Usage: fleet use <fleet-name-or-path>")
        }
        await use(target, { json: parseFlag(args, "--json") })
        break
      }
      case "setup-server": {
        const host = args[1]
        if (!host || host.startsWith("--")) {
          throw new Error("Usage: fleet setup-server <ssh-host> [--reuse-codex-auth|--no-reuse-codex-auth]")
        }
        const reuseCodexAuth = parseFlag(args, "--reuse-codex-auth")
          ? true
          : parseFlag(args, "--no-reuse-codex-auth")
            ? false
            : undefined
        await setupServer(host, { json: parseFlag(args, "--json"), reuseCodexAuth })
        break
      }
      case "sync": {
        const agent = args[1] && !args[1].startsWith("--") ? args[1] : undefined
        await sync(agent, { json: parseFlag(args, "--json") })
        break
      }
      case "boot-check": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) {
          throw new Error("Usage: fleet boot-check <agent>")
        }
        await bootCheck(agent, { json: parseFlag(args, "--json") })
        break
      }
      case "validate":
        await validate({ json: parseFlag(args, "--json") })
        break
      case "run-agent": {
        const agent = args[1]
        if (!agent || agent.startsWith("--")) {
          throw new Error("Usage: fleet run-agent <agent>")
        }
        await runAgent(agent)
        break
      }
      case "version":
      case "--version":
      case "-v":
        console.log(await getVersion())
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
