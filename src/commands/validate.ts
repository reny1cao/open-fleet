import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { findConfigDir, loadConfig, resolveStateDir } from "../core/config"
import { colorLabel } from "../core/utils"
import type { FleetConfig } from "../core/types"

export interface ValidationResult {
  check: string
  status: "pass" | "warn" | "fail"
  message: string
}

// ── checks ─────────────────────────────────────────────────────────────────────

const SNOWFLAKE = /^\d{17,20}$/

/** Validate that Discord IDs are numeric snowflakes */
function checkDiscordIds(config: FleetConfig): ValidationResult[] {
  const results: ValidationResult[] = []

  // discord.channels — each channel ID
  const channelEntries = Object.entries(config.discord.channels)
  if (channelEntries.length === 0) {
    results.push({
      check: "channel:none",
      status: "fail",
      message: "No channels defined in discord.channels",
    })
  }

  for (const [label, def] of channelEntries) {
    if (SNOWFLAKE.test(def.id)) {
      results.push({
        check: `channel:${label}`,
        status: "pass",
        message: `Channel "${label}" ID is valid (${def.id})`,
      })
    } else {
      results.push({
        check: `channel:${label}`,
        status: "fail",
        message: `Channel "${label}" ID "${def.id}" is not a valid Discord snowflake (expected 17-20 digit number)`,
      })
    }
  }

  // discord.serverId (optional)
  if (config.discord.serverId) {
    if (SNOWFLAKE.test(config.discord.serverId)) {
      results.push({
        check: "discord:server_id",
        status: "pass",
        message: `discord.server_id is valid (${config.discord.serverId})`,
      })
    } else {
      results.push({
        check: "discord:server_id",
        status: "fail",
        message: `discord.server_id "${config.discord.serverId}" is not a valid Discord snowflake`,
      })
    }
  }

  // discord.userId (optional)
  if (config.discord.userId) {
    if (SNOWFLAKE.test(config.discord.userId)) {
      results.push({
        check: "discord:user_id",
        status: "pass",
        message: `discord.user_id is valid (${config.discord.userId})`,
      })
    } else {
      results.push({
        check: "discord:user_id",
        status: "fail",
        message: `discord.user_id "${config.discord.userId}" is not a valid Discord snowflake`,
      })
    }
  }

  return results
}

/** Validate agent definitions are complete and consistent */
function checkAgents(config: FleetConfig): ValidationResult[] {
  const results: ValidationResult[] = []
  const agentNames = Object.keys(config.agents)
  const channelLabels = new Set(Object.keys(config.discord.channels))

  // Check for duplicate token_env values
  const tokenEnvs = new Map<string, string[]>()
  for (const [name, def] of Object.entries(config.agents)) {
    const existing = tokenEnvs.get(def.tokenEnv) ?? []
    existing.push(name)
    tokenEnvs.set(def.tokenEnv, existing)
  }

  for (const [tokenEnv, names] of tokenEnvs) {
    if (names.length > 1) {
      results.push({
        check: "agent:duplicate_token",
        status: "fail",
        message: `Agents share token_env "${tokenEnv}": ${names.join(", ")} — each agent needs its own bot token`,
      })
    }
  }

  // Check each agent
  for (const [name, def] of Object.entries(config.agents)) {
    if (!def.role) {
      results.push({
        check: `agent:${name}:role`,
        status: "fail",
        message: `Agent "${name}" is missing required field: role`,
      })
    }

    if (!def.server) {
      results.push({
        check: `agent:${name}:server`,
        status: "fail",
        message: `Agent "${name}" is missing required field: server`,
      })
    }

    if (!def.identity) {
      results.push({
        check: `agent:${name}:identity`,
        status: "warn",
        message: `Agent "${name}" has no identity file configured`,
      })
    }

    // Validate channel scoping references
    if (def.channels) {
      for (const ch of def.channels) {
        if (!channelLabels.has(ch)) {
          results.push({
            check: `agent:${name}:channel_ref`,
            status: "fail",
            message: `Agent "${name}" references channel "${ch}" which is not defined in discord.channels`,
          })
        }
      }
    }
  }

  if (agentNames.length > 0 && results.filter((r) => r.status === "fail").length === 0) {
    results.push({
      check: "agent:all",
      status: "pass",
      message: `${agentNames.length} agent(s) defined: ${agentNames.join(", ")}`,
    })
  }

  return results
}

/** Validate structure section if present */
function checkStructure(config: FleetConfig): ValidationResult[] {
  const results: ValidationResult[] = []

  if (!config.structure) return results

  const validTopologies = ["star", "hierarchy", "mesh", "squad"]
  if (!validTopologies.includes(config.structure.topology)) {
    results.push({
      check: "structure:topology",
      status: "fail",
      message: `Invalid topology "${config.structure.topology}" — must be one of: ${validTopologies.join(", ")}`,
    })
  } else {
    results.push({
      check: "structure:topology",
      status: "pass",
      message: `Topology: ${config.structure.topology}`,
    })
  }

  if (config.structure.lead) {
    if (config.agents[config.structure.lead]) {
      results.push({
        check: "structure:lead",
        status: "pass",
        message: `Lead agent: ${config.structure.lead}`,
      })
    } else {
      results.push({
        check: "structure:lead",
        status: "fail",
        message: `Lead "${config.structure.lead}" is not a defined agent — must match an agent name`,
      })
    }
  }

  return results
}

/** Validate server definitions */
function checkServers(config: FleetConfig): ValidationResult[] {
  const results: ValidationResult[] = []

  if (!config.servers) return results

  for (const [name, srv] of Object.entries(config.servers)) {
    if (!srv.sshHost) {
      results.push({
        check: `server:${name}:ssh_host`,
        status: "fail",
        message: `Server "${name}" is missing ssh_host`,
      })
    }
    if (!srv.user) {
      results.push({
        check: `server:${name}:user`,
        status: "fail",
        message: `Server "${name}" is missing user`,
      })
    }
  }

  // Check for unreferenced servers
  const referencedServers = new Set(
    Object.values(config.agents)
      .map((a) => a.server)
      .filter((s) => s !== "local")
  )
  for (const name of Object.keys(config.servers)) {
    if (!referencedServers.has(name)) {
      results.push({
        check: `server:${name}:unused`,
        status: "warn",
        message: `Server "${name}" is defined but not referenced by any agent`,
      })
    }
  }

  return results
}

/** Validate access.json group keys are valid snowflakes */
function checkAccessJson(config: FleetConfig): ValidationResult[] {
  const results: ValidationResult[] = []

  for (const [name] of Object.entries(config.agents)) {
    let stateDir: string
    try {
      stateDir = resolveStateDir(name, config)
    } catch {
      continue
    }

    const accessPath = join(stateDir, "access.json")
    if (!existsSync(accessPath)) continue

    try {
      const raw = JSON.parse(readFileSync(accessPath, "utf8"))
      if (raw.groups && typeof raw.groups === "object") {
        for (const groupId of Object.keys(raw.groups)) {
          if (!SNOWFLAKE.test(groupId)) {
            results.push({
              check: `access:${name}:group`,
              status: "fail",
              message: `access.json (${name}): group key "${groupId}" is not a valid Discord snowflake`,
            })
          }
        }
      }
    } catch { /* ignore: malformed access.json — skip validation */ }
  }

  return results
}

/** Check required top-level fields */
function checkRequiredFields(config: FleetConfig): ValidationResult[] {
  const results: ValidationResult[] = []

  results.push({
    check: "required:fleet_name",
    status: "pass",
    message: `Fleet name: ${config.fleet.name}`,
  })

  if (!config.defaults.workspace) {
    results.push({
      check: "required:workspace",
      status: "warn",
      message: "defaults.workspace is not set — agents will need per-agent workspace overrides",
    })
  } else {
    results.push({
      check: "required:workspace",
      status: "pass",
      message: `Default workspace: ${config.defaults.workspace}`,
    })
  }

  return results
}

// ── main export ────────────────────────────────────────────────────────────────

export async function validate(opts: { json?: boolean }): Promise<void> {
  const allResults: ValidationResult[] = []

  let config: FleetConfig
  try {
    const configDir = findConfigDir()
    config = loadConfig(configDir)
    allResults.push({
      check: "parse",
      status: "pass",
      message: "fleet.yaml parsed successfully",
    })
  } catch (err) {
    allResults.push({
      check: "parse",
      status: "fail",
      message: `fleet.yaml: ${err instanceof Error ? err.message : err}`,
    })

    if (opts.json) {
      console.log(JSON.stringify({ valid: false, results: allResults }, null, 2))
    } else {
      console.log("=== Fleet Validate ===")
      for (const r of allResults) {
        console.log(`  ${colorLabel(r.status)} ${r.message}`)
      }
    }
    process.exit(1)
    return
  }

  allResults.push(...checkRequiredFields(config))
  allResults.push(...checkDiscordIds(config))
  allResults.push(...checkAgents(config))
  allResults.push(...checkStructure(config))
  allResults.push(...checkServers(config))
  allResults.push(...checkAccessJson(config))

  const fails = allResults.filter((r) => r.status === "fail")
  const warns = allResults.filter((r) => r.status === "warn")

  if (opts.json) {
    console.log(
      JSON.stringify({ valid: fails.length === 0, results: allResults }, null, 2)
    )
  } else {
    console.log("=== Fleet Validate ===")
    for (const r of allResults) {
      console.log(`  ${colorLabel(r.status)} ${r.message}`)
    }
    console.log()
    if (fails.length > 0) {
      console.log(`  ${fails.length} error(s), ${warns.length} warning(s)`)
    } else if (warns.length > 0) {
      console.log(`  Valid with ${warns.length} warning(s)`)
    } else {
      console.log("  All checks passed")
    }
  }

  if (fails.length > 0) {
    process.exit(1)
  }
}
