import type { RuntimeAdapter, StartOpts } from "./types"

interface RunResult {
  stdout: string
  ok: boolean
}

async function run(cmd: string[], opts?: { throwOnError?: boolean }): Promise<RunResult> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  const ok = code === 0
  if (!ok && (opts?.throwOnError ?? true)) {
    throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr.trim()}`)
  }
  return { stdout: stdout.trim(), ok }
}

export class TmuxLocal implements RuntimeAdapter {
  async start(opts: StartOpts): Promise<void> {
    const envPrefix = Object.entries(opts.env)
      .map(([k, v]) => `${k}='${v}'`)
      .join(" ")

    const fullCommand = envPrefix
      ? `${envPrefix} ${opts.command}`
      : opts.command

    const result = await run([
      "tmux", "new-session",
      "-d",
      "-s", opts.session,
      "-c", opts.workDir,
      fullCommand,
    ])

    if (!result.ok) {
      throw new Error(`Failed to start tmux session "${opts.session}"`)
    }
  }

  async stop(session: string): Promise<void> {
    // Kill the entire process tree inside the session, not just the shell.
    // tmux kill-session sends SIGHUP but child processes (e.g., MCP plugin
    // servers) can survive if they ignore SIGHUP. We find the session's
    // pane PID and kill its entire process group.
    try {
      const { stdout } = await run(
        ["tmux", "display-message", "-t", session, "-p", "#{pane_pid}"],
        { throwOnError: false }
      )
      const panePid = stdout.trim()
      if (panePid && /^\d+$/.test(panePid)) {
        // Kill the process group (negative PID = process group)
        await run(["kill", "--", `-${panePid}`], { throwOnError: false })
        // Also kill any remaining children by walking /proc
        await run(
          ["bash", "-c", `pkill -TERM -P ${panePid} 2>/dev/null; sleep 0.5; pkill -KILL -P ${panePid} 2>/dev/null`],
          { throwOnError: false }
        )
      }
    } catch {
      // Best-effort — fall through to kill-session
    }
    await run(["tmux", "kill-session", "-t", session], { throwOnError: false })
  }

  async isRunning(session: string): Promise<boolean> {
    const result = await run(["tmux", "has-session", "-t", session], { throwOnError: false })
    return result.ok
  }

  async sendKeys(session: string, text: string): Promise<void> {
    if (text.includes("\n")) {
      // Multi-line: use load-buffer + paste-buffer to avoid newline interpretation
      const tmpFile = `/tmp/fleet-inject-${Date.now()}.txt`
      const { writeFileSync, unlinkSync } = await import("fs")
      writeFileSync(tmpFile, text)
      await run(["tmux", "load-buffer", "-b", "fleet-inject", tmpFile])
      await run(["tmux", "paste-buffer", "-b", "fleet-inject", "-t", session])
      await run(["tmux", "send-keys", "-t", session, "", "Enter"])
      try { unlinkSync(tmpFile) } catch { /* ignore: temp file cleanup is best-effort */ }
    } else {
      // Single line: simple send-keys
      await run(["tmux", "send-keys", "-t", session, text, "Enter"])
    }
  }

  async captureOutput(session: string, lines = 50): Promise<string> {
    const result = await run([
      "tmux", "capture-pane",
      "-t", session,
      "-p",
      "-S", `-${lines}`,
    ])
    return result.stdout
  }

  async waitFor(
    session: string,
    pattern: RegExp,
    timeoutMs = 30000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const output = await this.captureOutput(session)
      if (pattern.test(output)) {
        return true
      }
      await Bun.sleep(1000)
    }

    return false
  }
}
