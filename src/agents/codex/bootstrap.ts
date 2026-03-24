import { join } from "path"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function expandHomePath(pathValue: string, home: string): string {
  if (pathValue === "~") return home
  if (pathValue.startsWith("~/")) return join(home, pathValue.slice(2))
  return pathValue
}

export function resolveCodexStateDir(
  agentName: string,
  rawStateDir: string | undefined,
  home: string,
): string {
  return expandHomePath(rawStateDir ?? `~/.fleet/state/discord-${agentName}`, home)
}

export function resolveCodexRemoteBundleDir(stateDir: string): string {
  return join(stateDir, "fleet-runtime")
}

export function resolveLocalCodexWorkerCommand(
  entrypoint: string,
  agentName: string,
): string {
  return [
    "bun",
    "run",
    shellQuote(entrypoint),
    "run-agent",
    shellQuote(agentName),
  ].join(" ")
}

export function resolveRemoteCodexWorkerCommand(
  binaryPath: string,
  agentName: string,
): string {
  return [
    shellQuote(binaryPath),
    "run-agent",
    shellQuote(agentName),
  ].join(" ")
}

export function resolveBundledCodexWorkerCommand(
  bundlePath: string,
  agentName: string,
): string {
  return [
    "bun",
    shellQuote(bundlePath),
    "run-agent",
    shellQuote(agentName),
  ].join(" ")
}
