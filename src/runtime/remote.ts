import type { RuntimeAdapter, StartOpts } from "./types"
import type { ServerConfig } from "../core/types"

const SSH_TIMEOUT = 10
// PATH prefix for non-interactive SSH shells (bun/claude not in default PATH)
const REMOTE_PATH_PREFIX = "export PATH=$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

export async function sshRun(
  server: ServerConfig,
  cmd: string,
  opts?: { throwOnError?: boolean }
): Promise<{ stdout: string; ok: boolean }> {
  const fullCmd = `${REMOTE_PATH_PREFIX} && ${cmd}`
  const proc = Bun.spawn(
    ["ssh", "-o", `ConnectTimeout=${SSH_TIMEOUT}`, "-o", "BatchMode=yes", "-o", "RequestTTY=no", "-o", "RemoteCommand=none", `${server.user}@${server.sshHost}`, fullCmd],
    { stdout: "pipe", stderr: "pipe" }
  )
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  const ok = code === 0
  if (!ok && (opts?.throwOnError ?? true)) {
    throw new Error(`SSH command failed on ${server.sshHost}: ${cmd}\n${stderr.trim()}`)
  }
  return { stdout: stdout.trim(), ok }
}

export async function scp(
  server: ServerConfig,
  localPath: string,
  remotePath: string
): Promise<void> {
  const proc = Bun.spawn(
    ["scp", "-o", `ConnectTimeout=${SSH_TIMEOUT}`, "-o", "BatchMode=yes", localPath, `${server.user}@${server.sshHost}:${remotePath}`],
    { stdout: "pipe", stderr: "pipe" }
  )
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`SCP failed: ${localPath} → ${server.sshHost}:${remotePath}\n${stderr.trim()}`)
  }
}

export class TmuxRemote implements RuntimeAdapter {
  constructor(private server: ServerConfig) {}

  async start(opts: StartOpts): Promise<void> {
    // Create remote workDir
    await sshRun(this.server, `mkdir -p "${opts.workDir}"`)

    // Write a startup script to remote to avoid quoting hell
    // (SSH → tmux → shell = 3 layers of escaping)
    const scriptLines = [
      "#!/bin/bash",
      REMOTE_PATH_PREFIX,
      ...Object.entries(opts.env).map(([k, v]) => `export ${k}="${v}"`),
      `cd "${opts.workDir}"`,
      `exec ${opts.command.replace(/'/g, '"')}`,
    ]
    const remoteScript = `/tmp/fleet-start-${opts.session}.sh`
    const { writeFileSync, unlinkSync } = await import("fs")
    const localScript = `/tmp/fleet-start-${opts.session}-local.sh`
    writeFileSync(localScript, scriptLines.join("\n") + "\n")
    await scp(this.server, localScript, remoteScript)
    await sshRun(this.server, `chmod +x '${remoteScript}'`)
    try { unlinkSync(localScript) } catch { /* ignore: temp file cleanup is best-effort */ }

    // Start tmux with the script
    await sshRun(this.server,
      `tmux new-session -d -s '${opts.session}' '${remoteScript}'`)
  }

  async stop(session: string): Promise<void> {
    // Kill the entire process tree inside the session, not just the shell.
    // tmux kill-session sends SIGHUP but child processes (e.g., MCP plugin
    // servers) can survive. Find the pane PID and kill its process group.
    try {
      const { stdout } = await sshRun(
        this.server,
        `tmux display-message -t '${session}' -p '#{pane_pid}'`,
        { throwOnError: false }
      )
      const panePid = stdout.trim()
      if (panePid && /^\d+$/.test(panePid)) {
        await sshRun(
          this.server,
          `kill -- -${panePid} 2>/dev/null; pkill -TERM -P ${panePid} 2>/dev/null; sleep 0.5; pkill -KILL -P ${panePid} 2>/dev/null`,
          { throwOnError: false }
        )
      }
    } catch {
      // Best-effort — fall through to kill-session
    }
    await sshRun(this.server, `tmux kill-session -t '${session}'`, { throwOnError: false })
  }

  async isRunning(session: string): Promise<boolean> {
    const { ok } = await sshRun(this.server, `tmux has-session -t '${session}'`, { throwOnError: false })
    return ok
  }

  async sendKeys(session: string, text: string): Promise<void> {
    if (text.includes("\n")) {
      const tmpRemote = `/tmp/fleet-inject-${Date.now()}.txt`
      const tmpLocal = `/tmp/fleet-inject-local-${Date.now()}.txt`
      const { writeFileSync, unlinkSync } = await import("fs")
      writeFileSync(tmpLocal, text)
      await scp(this.server, tmpLocal, tmpRemote)
      await sshRun(this.server, `tmux load-buffer -b fleet-inject '${tmpRemote}'`)
      await sshRun(this.server, `tmux paste-buffer -b fleet-inject -t '${session}'`)
      await sshRun(this.server, `tmux send-keys -t '${session}' '' Enter`)
      await sshRun(this.server, `rm -f '${tmpRemote}'`, { throwOnError: false })
      try { unlinkSync(tmpLocal) } catch { /* ignore: temp file cleanup is best-effort */ }
    } else {
      await sshRun(this.server, `tmux send-keys -t '${session}' '${text.replace(/'/g, "'\\''")}' Enter`)
    }
  }

  async captureOutput(session: string, lines = 50): Promise<string> {
    const { stdout } = await sshRun(this.server,
      `tmux capture-pane -t '${session}' -p -S -${lines}`,
      { throwOnError: false }
    )
    return stdout
  }

  async waitFor(session: string, pattern: RegExp, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const output = await this.captureOutput(session)
      if (pattern.test(output)) return true
      await Bun.sleep(2000) // slower poll for remote (SSH overhead)
    }
    return false
  }
}
