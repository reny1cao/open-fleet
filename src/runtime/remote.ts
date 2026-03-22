import type { RuntimeAdapter, StartOpts } from "./types"
import type { ServerConfig } from "../core/types"

const SSH_TIMEOUT = 5

export async function sshRun(
  server: ServerConfig,
  cmd: string,
  opts?: { throwOnError?: boolean }
): Promise<{ stdout: string; ok: boolean }> {
  const proc = Bun.spawn(
    ["ssh", "-o", `ConnectTimeout=${SSH_TIMEOUT}`, "-o", "BatchMode=yes", `${server.user}@${server.sshHost}`, cmd],
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
    await sshRun(this.server, `mkdir -p '${opts.workDir}'`)

    // Build env prefix
    const envPrefix = Object.entries(opts.env)
      .map(([k, v]) => `${k}='${v}'`)
      .join(" ")
    const fullCmd = envPrefix ? `${envPrefix} ${opts.command}` : opts.command

    await sshRun(this.server,
      `tmux new-session -d -s '${opts.session}' -c '${opts.workDir}' "${fullCmd.replace(/"/g, '\\\\"')}"`)
  }

  async stop(session: string): Promise<void> {
    await sshRun(this.server, `tmux kill-session -t '${session}'`)
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
      try { unlinkSync(tmpLocal) } catch {}
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
