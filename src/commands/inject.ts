import { findConfigDir, loadConfig, sessionName } from "../core/config"
import { readRoleOverlay } from "../core/identity"
import { resolveRuntime } from "../runtime/resolve"
import { readdirSync, existsSync } from "fs"
import { join } from "path"

export async function inject(agentName: string, roleName: string, opts?: { json?: boolean }): Promise<void> {
  // 1. Load config, verify agent exists
  const configDir = findConfigDir()
  const config = loadConfig(configDir)

  const agentDef = config.agents[agentName]
  if (!agentDef) {
    throw new Error(`Unknown agent: "${agentName}"`)
  }

  // 2. Check session is running (local or remote)
  const runtime = resolveRuntime(agentName, config)
  const session = sessionName(config.fleet.name, agentName)

  if (!(await runtime.isRunning(session))) {
    throw new Error(`Agent "${agentName}" is not running (session: ${session})`)
  }

  // 3. Read role file
  const roleContent = readRoleOverlay(roleName, configDir)

  // 4. If role not found, throw with available roles list
  if (roleContent === null) {
    const rolesDir = join(configDir, "identities", "roles")
    let available: string[] = []
    if (existsSync(rolesDir)) {
      available = readdirSync(rolesDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
    }
    const hint =
      available.length > 0
        ? `Available roles: ${available.join(", ")}`
        : "No roles found in identities/roles/"
    throw new Error(`Role "${roleName}" not found. ${hint}`)
  }

  // 5. Build prompt
  const prompt = `You are now assigned an additional role. Read and integrate:\n\n${roleContent}`

  // 6. Send via runtime.sendKeys
  await runtime.sendKeys(session, prompt)

  // 7. Print confirmation
  if (opts?.json) {
    console.log(JSON.stringify({ agent: agentName, role: roleName, status: "injected" }))
  } else {
    console.log(`Injected role '${roleName}' into ${agentName}`)
  }
}
