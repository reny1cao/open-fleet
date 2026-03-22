import type { RuntimeAdapter, StartOpts } from "./types.ts"

interface RunResult {
  stdout: string
  ok: boolean
}

async function run(cmd: string[]): Promise<RunResult> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  return { stdout: stdout.trim(), ok: exitCode === 0 }
}

export class TmuxLocal implements RuntimeAdapter {
  async start(opts: StartOpts): Promise<void> {
    const envPrefix = Object.entries(opts.env)
      .map(([k, v]) => `${k}=${v}`)
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
    await run(["tmux", "kill-session", "-t", session])
  }

  async isRunning(session: string): Promise<boolean> {
    const result = await run(["tmux", "has-session", "-t", session])
    return result.ok
  }

  async sendKeys(session: string, text: string): Promise<void> {
    await run(["tmux", "send-keys", "-t", session, text, "Enter"])
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
