const SSH_TIMEOUT = 10
const REMOTE_PATH_PREFIX = "export PATH=$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

interface SetupOpts {
  json?: boolean
}

interface StepResult {
  step: string
  status: "ok" | "installed" | "skipped" | "failed"
  message: string
}

/** Run SSH command using host alias directly (supports ~/.ssh/config aliases) */
async function sshExec(
  host: string,
  cmd: string,
): Promise<{ stdout: string; ok: boolean }> {
  const fullCmd = `${REMOTE_PATH_PREFIX} && ${cmd}`
  const proc = Bun.spawn(
    ["ssh", "-o", `ConnectTimeout=${SSH_TIMEOUT}`, "-o", "BatchMode=yes", "-o", "RequestTTY=no", "-o", "RemoteCommand=none", host, fullCmd],
    { stdout: "pipe", stderr: "pipe" }
  )
  const stdout = await new Response(proc.stdout).text()
  await new Response(proc.stderr).text()
  const code = await proc.exited
  return { stdout: stdout.trim(), ok: code === 0 }
}

async function checkAndInstall(
  host: string,
  tool: string,
  whichCmd: string,
  installCmd: string,
  log: (...args: unknown[]) => void,
): Promise<StepResult> {
  const { ok } = await sshExec(host, whichCmd)
  if (ok) {
    log(`  [ok]  ${tool} — already installed`)
    return { step: tool, status: "ok", message: "already installed" }
  }

  log(`  [..] ${tool} — installing…`)
  const { ok: installOk, stdout } = await sshExec(host, installCmd)
  if (installOk) {
    log(`  [ok]  ${tool} — installed`)
    return { step: tool, status: "installed", message: "installed" }
  } else {
    log(`  [!!] ${tool} — install failed`)
    return { step: tool, status: "failed", message: stdout.slice(0, 200) }
  }
}

export async function setupServer(
  host: string,
  opts?: SetupOpts,
): Promise<void> {
  const log = opts?.json ? () => {} : console.log.bind(console)

  // 1. Test connectivity (host can be SSH alias like "demo" or "user@ip")
  log(`Connecting to ${host}…`)
  const { ok, stdout: whoami } = await sshExec(host, "whoami && uname -s -m")
  if (!ok) {
    throw new Error(`Cannot connect to ${host} — check SSH config`)
  }
  const [user, platform] = whoami.split("\n")
  log(`  Connected as ${user.trim()} (${platform.trim()})`)

  const results: StepResult[] = []

  // 2. tmux
  const tmuxResult = await checkAndInstall(
    host, "tmux",
    "which tmux",
    "sudo apt-get install -y tmux 2>/dev/null || sudo yum install -y tmux 2>/dev/null",
    log,
  )
  results.push(tmuxResult)

  // 3. bun
  const bunResult = await checkAndInstall(
    host, "bun",
    "which bun",
    "curl -fsSL https://bun.sh/install | bash",
    log,
  )
  results.push(bunResult)

  // 4. Claude Code via curl installer (auto-updates)
  const claudeResult = await checkAndInstall(
    host, "claude",
    "which claude",
    "curl -fsSL https://claude.ai/install.sh | sh",
    log,
  )
  results.push(claudeResult)

  // 5. Verify
  log("")
  log("Verifying…")
  const { stdout: versions } = await sshExec(
    host,
    "echo \"bun: $(bun --version 2>/dev/null || echo missing)\" && echo \"claude: $(claude --version 2>/dev/null || echo missing)\" && echo \"tmux: $(tmux -V 2>/dev/null || echo missing)\"",
  )
  for (const line of versions.split("\n")) {
    if (line.trim()) log(`  ${line.trim()}`)
  }

  if (opts?.json) {
    console.log(JSON.stringify({ host, results }, null, 2))
  } else {
    const failed = results.filter(r => r.status === "failed")
    if (failed.length > 0) {
      console.log(`\nSetup incomplete — ${failed.length} step(s) failed`)
    } else {
      console.log(`\nServer ${host} is ready.`)
    }
  }
}
