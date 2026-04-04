import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { writeGlobalConfig, loadConfig } from "../core/config"

export async function use(
  nameOrPath: string,
  opts: { json?: boolean }
): Promise<void> {
  const globalDir = join(process.env.HOME ?? homedir(), ".fleet")
  const configPath = join(globalDir, "config.json")

  // Try as direct path first
  if (existsSync(join(nameOrPath, "fleet.yaml"))) {
    const config = loadConfig(nameOrPath)
    writeGlobalConfig(nameOrPath, config.fleet.name)
    if (opts.json) {
      console.log(JSON.stringify({ fleet: config.fleet.name, path: nameOrPath, status: "switched" }))
    } else {
      console.log(`Switched to fleet "${config.fleet.name}" (${nameOrPath})`)
    }
    return
  }

  // Try as fleet name from registry
  if (existsSync(configPath)) {
    try {
      const { fleets } = JSON.parse(readFileSync(configPath, "utf8"))
      if (fleets && fleets[nameOrPath]) {
        const fleetDir = fleets[nameOrPath]
        if (existsSync(join(fleetDir, "fleet.yaml"))) {
          writeGlobalConfig(fleetDir, nameOrPath)
          if (opts.json) {
            console.log(JSON.stringify({ fleet: nameOrPath, path: fleetDir, status: "switched" }))
          } else {
            console.log(`Switched to fleet "${nameOrPath}" (${fleetDir})`)
          }
          return
        }
      }
    } catch { /* ignore: malformed config.json — fall through to error */ }
  }

  throw new Error(
    `Fleet "${nameOrPath}" not found. Use a path to a directory with fleet.yaml, or a registered fleet name.`
  )
}
