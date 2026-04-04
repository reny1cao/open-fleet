import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { findConfigDir, loadConfig, loadEnv, resolveStateDir, sessionName } from "../core/config"
import { DiscordApi } from "../channel/discord/api"
import { resolveRuntime } from "../runtime/resolve"
import { resolvePluginServerPaths, colorLabel, COLORS } from "../core/utils"
import type { FleetConfig } from "../core/types"

export interface CheckResult {
  check: string
  status: "pass" | "warn" | "fail" | "info"
  message: string
}

interface AdapterRequirements {
  claude: boolean
  codex: boolean
}

async function runWithTimeout(
  cmd: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })

  const timer = setTimeout(() => {
    proc.kill()
  }, timeoutMs)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } finally {
    clearTimeout(timer)
  }
}

function getAdapterRequirements(config?: FleetConfig): AdapterRequirements {
  if (!config) {
    return { claude: true, codex: true }
  }

  return {
    claude: Object.values(config.agents).some((agent) => (agent.agentAdapter ?? "claude") === "claude"),
    codex: Object.values(config.agents).some((agent) => (agent.agentAdapter ?? "claude") === "codex"),
  }
}

// ── checks ────────────────────────────────────────────────────────────────────

/** Check 1: Prerequisites — bun, claude, tmux */
async function checkPrerequisites(requirements: AdapterRequirements): Promise<CheckResult[]> {
  const tools = ["bun", "tmux"]
  if (requirements.claude) tools.push("claude")
  if (requirements.codex) tools.push("codex")
  const results: CheckResult[] = []

  for (const tool of tools) {
    try {
      const { exitCode } = await runWithTimeout(["which", tool], 5000)
      if (exitCode === 0) {
        results.push({ check: `prereq:${tool}`, status: "pass", message: `${tool} found` })
      } else {
        results.push({ check: `prereq:${tool}`, status: "fail", message: `${tool} not found in PATH` })
      }
    } catch {
      results.push({ check: `prereq:${tool}`, status: "fail", message: `${tool} not found in PATH` })
    }
  }

  return results
}

/** Check 2: Claude Code version >= 2.1.80 */
async function checkClaudeVersion(required: boolean): Promise<CheckResult> {
  if (!required) {
    return { check: "claude:version", status: "info", message: "Claude version skipped (no Claude agents configured)" }
  }
  try {
    const { stdout, exitCode } = await runWithTimeout(["claude", "--version"], 5000)
    if (exitCode !== 0) {
      return { check: "claude:version", status: "warn", message: "could not get claude version" }
    }

    // Parse version string like "2.1.81" or "Claude Code 2.1.81"
    const match = stdout.match(/(\d+)\.(\d+)\.(\d+)/)
    if (!match) {
      return { check: "claude:version", status: "warn", message: `could not parse version from: ${stdout}` }
    }

    const [, major, minor, patch] = match.map(Number)
    const version = `${major}.${minor}.${patch}`

    // Compare against 2.1.80
    const isOk =
      major > 2 ||
      (major === 2 && minor > 1) ||
      (major === 2 && minor === 1 && patch >= 80)

    if (isOk) {
      return { check: "claude:version", status: "pass", message: `claude v${version}` }
    } else {
      return {
        check: "claude:version",
        status: "warn",
        message: `claude v${version} is below minimum 2.1.80`,
      }
    }
  } catch {
    return { check: "claude:version", status: "warn", message: "could not run claude --version" }
  }
}

/** Check 3: Claude Code auth */
async function checkClaudeAuth(required: boolean): Promise<CheckResult> {
  if (!required) {
    return { check: "claude:auth", status: "info", message: "Claude auth skipped (no Claude agents configured)" }
  }
  try {
    const { exitCode } = await runWithTimeout(["claude", "auth", "status"], 5000)
    if (exitCode === 0) {
      return { check: "claude:auth", status: "pass", message: "claude auth: logged in" }
    } else {
      return { check: "claude:auth", status: "warn", message: "claude auth: not logged in" }
    }
  } catch {
    return { check: "claude:auth", status: "warn", message: "claude auth: not checked" }
  }
}

/** Check 3b: Codex auth */
async function checkCodexAuth(required: boolean): Promise<CheckResult> {
  if (!required) {
    return { check: "codex:auth", status: "info", message: "Codex auth skipped (no Codex agents configured)" }
  }

  try {
    const { stdout, exitCode } = await runWithTimeout(["codex", "login", "status"], 5000)
    if (exitCode === 0) {
      return { check: "codex:auth", status: "pass", message: `codex auth: ${stdout || "logged in"}` }
    }
    return { check: "codex:auth", status: "warn", message: stdout || "codex auth: not logged in" }
  } catch {
    return { check: "codex:auth", status: "warn", message: "codex auth: not checked" }
  }
}

/** Check 4: Config validation */
async function checkConfig(): Promise<{ result: CheckResult; configDir?: string }> {
  try {
    const configDir = findConfigDir()
    loadConfig(configDir)
    return {
      result: { check: "config", status: "pass", message: "fleet.yaml valid" },
      configDir,
    }
  } catch (err) {
    return {
      result: {
        check: "config",
        status: "fail",
        message: `fleet.yaml: ${err instanceof Error ? err.message : err}`,
      },
    }
  }
}

/** Check 5: Token validation — per agent */
async function checkTokens(configDir: string): Promise<CheckResult[]> {
  const config = loadConfig(configDir)
  const envVars = loadEnv(configDir)
  const discord = new DiscordApi()
  const results: CheckResult[] = []

  for (const [name, def] of Object.entries(config.agents)) {
    const tokenEnv = def.tokenEnv
    const token = process.env[tokenEnv] ?? envVars[tokenEnv]

    if (!token) {
      results.push({
        check: `token:${name}`,
        status: "fail",
        message: `Token: ${name} — ${tokenEnv} not set`,
      })
      continue
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000)
      )
      const botInfo = await Promise.race([discord.validateToken(token), timeoutPromise])
      results.push({
        check: `token:${name}`,
        status: "pass",
        message: `Token: ${name} (${botInfo.name})`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        check: `token:${name}`,
        status: "fail",
        message: `Token: ${name} — ${msg}`,
      })
    }
  }

  return results
}

/** Check 6: Discord plugin installed */
async function checkPluginInstalled(required: boolean): Promise<CheckResult> {
  if (!required) {
    return { check: "plugin:installed", status: "info", message: "Discord Claude plugin skipped (no Claude agents configured)" }
  }
  const pluginPath = resolvePluginServerPaths()[0]
  if (pluginPath) {
    return { check: "plugin:installed", status: "pass", message: "Discord plugin installed" }
  }
  return { check: "plugin:installed", status: "fail", message: "Discord plugin not found" }
}

/** Check 7: Patches applied */
async function checkPatches(required: boolean): Promise<CheckResult[]> {
  if (!required) {
    return [
      {
        check: "patch:STATE_DIR",
        status: "info",
        message: "Claude Discord patch skipped (no Claude agents configured)",
      },
      {
        check: "patch:PARTNER_BOT_IDS",
        status: "info",
        message: "Claude Discord patch skipped (no Claude agents configured)",
      },
    ]
  }
  const pluginPath = resolvePluginServerPaths()[0]

  if (!pluginPath) {
    return [
      {
        check: "patch:STATE_DIR",
        status: "fail",
        message: "Cannot check patches — plugin not installed",
      },
      {
        check: "patch:PARTNER_BOT_IDS",
        status: "fail",
        message: "Cannot check patches — plugin not installed",
      },
    ]
  }

  let content: string
  try {
    content = readFileSync(pluginPath, "utf8")
  } catch {
    return [
      { check: "patch:STATE_DIR", status: "fail", message: "Cannot read plugin server.ts" },
      { check: "patch:PARTNER_BOT_IDS", status: "fail", message: "Cannot read plugin server.ts" },
    ]
  }

  const hasStateDir = content.includes("DISCORD_STATE_DIR")
  const hasPartnerBotIds = content.includes("PARTNER_BOT_IDS")

  return [
    {
      check: "patch:STATE_DIR",
      status: hasStateDir ? "pass" : "fail",
      message: hasStateDir ? "STATE_DIR patch applied" : "DISCORD_STATE_DIR patch missing",
    },
    {
      check: "patch:PARTNER_BOT_IDS",
      status: hasPartnerBotIds ? "pass" : "fail",
      message: hasPartnerBotIds ? "PARTNER_BOT_IDS patch applied" : "PARTNER_BOT_IDS patch missing",
    },
  ]
}

/** Check 8: access.json schema — per agent */
async function checkAccessJson(configDir: string): Promise<CheckResult[]> {
  const config = loadConfig(configDir)
  const results: CheckResult[] = []

  for (const [name, agent] of Object.entries(config.agents)) {
    if ((agent.agentAdapter ?? "claude") !== "claude") {
      results.push({
        check: `access:${name}`,
        status: "info",
        message: `access.json: ${name} skipped (Codex agent does not use Claude Discord plugin)`,
      })
      continue
    }

    const stateDir = resolveStateDir(name, config)
    const accessPath = join(stateDir, "access.json")

    if (!existsSync(accessPath)) {
      results.push({
        check: `access:${name}`,
        status: "warn",
        message: `access.json: ${name} — file missing (${accessPath})`,
      })
      continue
    }

    try {
      const raw = JSON.parse(readFileSync(accessPath, "utf8")) as Record<string, unknown>
      const hasRequired =
        "dmPolicy" in raw && "allowFrom" in raw && "groups" in raw && "pending" in raw

      if (hasRequired) {
        results.push({
          check: `access:${name}`,
          status: "pass",
          message: `access.json: ${name} (valid)`,
        })
      } else {
        const missing = ["dmPolicy", "allowFrom", "groups", "pending"].filter((k) => !(k in raw))
        results.push({
          check: `access:${name}`,
          status: "fail",
          message: `access.json: ${name} — missing fields: ${missing.join(", ")}`,
        })
      }
    } catch (err) {
      results.push({
        check: `access:${name}`,
        status: "fail",
        message: `access.json: ${name} — parse error: ${err instanceof Error ? err.message : err}`,
      })
    }
  }

  return results
}

/** Check 8b: Adapter constraints */
async function checkAdapterConstraints(configDir: string): Promise<CheckResult[]> {
  const config = loadConfig(configDir)
  const results: CheckResult[] = []

  for (const [name, agent] of Object.entries(config.agents)) {
    results.push({
      check: `adapter:${name}`,
      status: "pass",
      message: `${name}: ${agent.agentAdapter ?? "claude"} on ${agent.server}`,
    })
  }

  return results
}

/** Check 9: Running sessions — per agent (informational) */
async function checkSessions(configDir: string): Promise<CheckResult[]> {
  const config = loadConfig(configDir)
  const results: CheckResult[] = []

  for (const [name] of Object.entries(config.agents)) {
    const session = sessionName(config.fleet.name, name)
    const runtime = resolveRuntime(name, config)
    const running = await runtime.isRunning(session)
    results.push({
      check: `session:${name}`,
      status: "info",
      message: `${name}: ${running ? "running" : "stopped"}`,
    })
  }

  return results
}

/** Check 10: Remote server connectivity and prerequisites */
async function checkRemoteServers(configDir: string): Promise<CheckResult[]> {
  const config = loadConfig(configDir)
  const results: CheckResult[] = []

  if (!config.servers || Object.keys(config.servers).length === 0) {
    return results
  }

  for (const [name, server] of Object.entries(config.servers)) {
    const target = `${server.user}@${server.sshHost}`
    const serverAgents = Object.values(config.agents).filter((agent) => agent.server === name)
    const serverRequirements = {
      claude: serverAgents.some((agent) => (agent.agentAdapter ?? "claude") === "claude"),
      codex: serverAgents.some((agent) => (agent.agentAdapter ?? "claude") === "codex"),
    }

    // 1. SSH connectivity
    let sshPassed = false
    try {
      const { exitCode } = await runWithTimeout(
        ["ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes", "-o", "RequestTTY=no", "-o", "RemoteCommand=none", target, "echo ok"],
        5000
      )
      sshPassed = exitCode === 0
      results.push({
        check: `remote:${name}:ssh`,
        status: sshPassed ? "pass" : "fail",
        message: sshPassed ? `${name} SSH: reachable` : `${name} SSH: unreachable`,
      })
    } catch {
      results.push({
        check: `remote:${name}:ssh`,
        status: "fail",
        message: `${name} SSH: unreachable`,
      })
    }

    // 2. Remote prerequisites (only if SSH passed)
    if (sshPassed) {
      const prereqs = ["tmux", "bun"]
      if (serverRequirements.claude) prereqs.push("claude")
      if (serverRequirements.codex) prereqs.push("codex")

      for (const tool of prereqs) {
        try {
          const { exitCode } = await runWithTimeout(
            ["ssh", "-o", "RequestTTY=no", "-o", "RemoteCommand=none", target, `export PATH=$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH && which ${tool}`],
            5000
          )
          results.push({
            check: `remote:${name}:${tool}`,
            status: exitCode === 0 ? "pass" : "warn",
            message: exitCode === 0 ? `${name} ${tool}: found` : `${name} ${tool}: not found`,
          })
        } catch {
          results.push({
            check: `remote:${name}:${tool}`,
            status: "warn",
            message: `${name} ${tool}: not found`,
          })
        }
      }

      if (serverRequirements.codex) {
        try {
          const { stdout, exitCode } = await runWithTimeout(
            ["ssh", "-o", "RequestTTY=no", "-o", "RemoteCommand=none", target, "export PATH=$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH && codex login status"],
            5000
          )
          results.push({
            check: `remote:${name}:codex-auth`,
            status: exitCode === 0 ? "pass" : "warn",
            message: exitCode === 0
              ? `${name} codex auth: ${stdout || "logged in"}`
              : `${name} codex auth: ${stdout || "not logged in"}`,
          })
        } catch {
          results.push({
            check: `remote:${name}:codex-auth`,
            status: "warn",
            message: `${name} codex auth: not checked`,
          })
        }
      }
    }
  }

  return results
}

// ── main export ────────────────────────────────────────────────────────────────

export async function doctor(opts: { json?: boolean }): Promise<void> {
  const allResults: CheckResult[] = []

  // 1. Config validation
  const { result: configResult, configDir } = await checkConfig()
  allResults.push(configResult)

  const config = configDir ? loadConfig(configDir) : undefined
  const requirements = getAdapterRequirements(config)

  // 2. Prerequisites
  const prereqResults = await checkPrerequisites(requirements)
  allResults.push(...prereqResults)

  // 3. Claude version
  const versionResult = await checkClaudeVersion(requirements.claude)
  allResults.push(versionResult)

  // 4. Claude auth
  const authResult = await checkClaudeAuth(requirements.claude)
  allResults.push(authResult)

  // 5. Codex auth
  const codexAuthResult = await checkCodexAuth(requirements.codex)
  allResults.push(codexAuthResult)

  if (configDir) {
    // 6. Token validation
    const tokenResults = await checkTokens(configDir)
    allResults.push(...tokenResults)
  }

  // 7. Plugin installed
  const pluginResult = await checkPluginInstalled(requirements.claude)
  allResults.push(pluginResult)

  // 8. Patches applied
  const patchResults = await checkPatches(requirements.claude)
  allResults.push(...patchResults)

  if (configDir) {
    // 9. access.json schema
    const accessResults = await checkAccessJson(configDir)
    allResults.push(...accessResults)

    // 10. Adapter constraints
    const adapterResults = await checkAdapterConstraints(configDir)
    allResults.push(...adapterResults)

    // 11. Running sessions
    const sessionResults = await checkSessions(configDir)
    allResults.push(...sessionResults)

    // 12. Remote server connectivity and prerequisites
    const remoteResults = await checkRemoteServers(configDir)
    allResults.push(...remoteResults)
  }

  if (opts.json) {
    console.log(JSON.stringify(allResults, null, 2))
    return
  }

  // Plain output
  console.log("=== Fleet Doctor ===")
  for (const r of allResults) {
    console.log(`  ${colorLabel(r.status)} ${r.message}`)
  }
}
