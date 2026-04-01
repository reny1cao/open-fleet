import { findConfigDir, loadConfig } from "../core/config"
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const PID_FILE = join(homedir(), ".fleet", "server.pid")
const DEFAULT_PORT = 4680

function getServerPid(): number | null {
  if (!existsSync(PID_FILE)) return null
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim())
    if (isNaN(pid)) return null
    // Check if process is alive
    try {
      process.kill(pid, 0)
      return pid
    } catch {
      // Process not running, clean up stale PID file
      try { unlinkSync(PID_FILE) } catch {}
      return null
    }
  } catch {
    return null
  }
}

export async function server(
  subcommand: string,
  opts: { port?: number; json?: boolean }
): Promise<void> {
  switch (subcommand) {
    case "start":
      return serverStart(opts)
    case "stop":
      return serverStop(opts)
    case "status":
      return serverStatus(opts)
    default:
      throw new Error(
        "Usage: fleet server <start|stop|status>\n" +
        "  fleet server start [--port 4680]\n" +
        "  fleet server stop\n" +
        "  fleet server status"
      )
  }
}

async function serverStart(opts: { port?: number; json?: boolean }): Promise<void> {
  const existingPid = getServerPid()
  if (existingPid) {
    if (opts.json) {
      console.log(JSON.stringify({ status: "already_running", pid: existingPid }))
    } else {
      console.log(`Fleet server already running (PID ${existingPid})`)
    }
    return
  }

  const port = opts.port ?? DEFAULT_PORT
  const configDir = findConfigDir()

  // Spawn the server as a detached background process
  const serverModule = join(import.meta.dir, "..", "server", "index.ts")
  const proc = Bun.spawn(["bun", "run", serverModule], {
    env: {
      ...process.env,
      FLEET_API_PORT: String(port),
      FLEET_CONFIG_DIR: configDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })

  // Wait briefly to see if it starts successfully
  await Bun.sleep(1000)

  // Check if process is still alive
  try {
    process.kill(proc.pid, 0)
  } catch {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Fleet server failed to start: ${stderr}`)
  }

  // Write PID file
  writeFileSync(PID_FILE, String(proc.pid), "utf8")

  // Unref so parent can exit
  proc.unref()

  if (opts.json) {
    console.log(JSON.stringify({ status: "started", pid: proc.pid, port, url: `http://localhost:${port}` }))
  } else {
    console.log(`Fleet server started on port ${port} (PID ${proc.pid})`)
    console.log(`API URL: http://localhost:${port}`)
  }
}

async function serverStop(opts: { json?: boolean }): Promise<void> {
  const pid = getServerPid()
  if (!pid) {
    if (opts.json) {
      console.log(JSON.stringify({ status: "not_running" }))
    } else {
      console.log("Fleet server is not running.")
    }
    return
  }

  try {
    process.kill(pid, "SIGTERM")
    // Wait for graceful shutdown
    for (let i = 0; i < 10; i++) {
      await Bun.sleep(200)
      try {
        process.kill(pid, 0)
      } catch {
        // Process gone — success
        break
      }
    }
    try { unlinkSync(PID_FILE) } catch {}
  } catch {
    try { unlinkSync(PID_FILE) } catch {}
  }

  if (opts.json) {
    console.log(JSON.stringify({ status: "stopped", pid }))
  } else {
    console.log(`Fleet server stopped (PID ${pid})`)
  }
}

async function serverStatus(opts: { json?: boolean }): Promise<void> {
  const pid = getServerPid()

  if (opts.json) {
    console.log(JSON.stringify({ running: !!pid, pid }))
  } else {
    if (pid) {
      console.log(`Fleet server running (PID ${pid})`)
    } else {
      console.log("Fleet server is not running.")
    }
  }
}
