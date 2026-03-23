import { sshRun } from "../runtime/remote"
import type { ServerConfig } from "../core/types"

interface SetupOpts {
  json?: boolean
}

interface StepResult {
  step: string
  status: "ok" | "installed" | "skipped" | "failed"
  message: string
}

async function checkAndInstall(
  server: ServerConfig,
  tool: string,
  whichCmd: string,
  installCmd: string,
  log: (...args: unknown[]) => void,
): Promise<StepResult> {
  // Check if already installed
  const { ok } = await sshRun(server, whichCmd, { throwOnError: false })
  if (ok) {
    log(`  [ok]  ${tool} — already installed`)
    return { step: tool, status: "ok", message: "already installed" }
  }

  // Install
  log(`  [..] ${tool} — installing…`)
  const { ok: installOk, stdout } = await sshRun(server, installCmd, { throwOnError: false })
  if (installOk) {
    log(`  [ok]  ${tool} — installed`)
    return { step: tool, status: "installed", message: "installed" }
  } else {
    log(`  [!!] ${tool} — install failed`)
    return { step: tool, status: "failed", message: stdout.slice(0, 200) }
  }
}

export async function setupServer(
  sshHost: string,
  opts?: SetupOpts,
): Promise<void> {
  const log = opts?.json ? () => {} : console.log.bind(console)

  // Parse sshHost — could be "user@host" or just a host alias from ssh config
  // We'll treat it as an SSH host alias and extract user/host from the connection
  const server: ServerConfig = sshHost.includes("@")
    ? { user: sshHost.split("@")[0], sshHost: sshHost.split("@")[1] }
    : { user: "", sshHost }

  // 1. Test connectivity
  log(`Connecting to ${sshHost}…`)
  const { ok, stdout: whoami } = await sshRun(server, "whoami && uname -s -m", { throwOnError: false })
  if (!ok) {
    throw new Error(`Cannot connect to ${sshHost} — check SSH config`)
  }
  const [user, platform] = whoami.split("\n")
  log(`  Connected as ${user.trim()} (${platform.trim()})`)

  // Fill in user if we didn't have it
  if (!server.user) server.user = user.trim()

  const results: StepResult[] = []

  // 2. tmux — should be pre-installed on most servers, apt install if missing
  const tmuxResult = await checkAndInstall(
    server, "tmux",
    "which tmux",
    "sudo apt-get install -y tmux 2>/dev/null || sudo yum install -y tmux 2>/dev/null",
    log,
  )
  results.push(tmuxResult)

  // 3. bun
  const bunResult = await checkAndInstall(
    server, "bun",
    "export PATH=$HOME/.bun/bin:$PATH && which bun",
    "curl -fsSL https://bun.sh/install | bash",
    log,
  )
  results.push(bunResult)

  // 4. Claude Code via curl installer (auto-updates)
  const claudeResult = await checkAndInstall(
    server, "claude",
    "export PATH=$HOME/.local/bin:$HOME/.bun/bin:$PATH && which claude",
    "curl -fsSL https://claude.ai/install.sh | sh",
    log,
  )
  results.push(claudeResult)

  // 5. Verify all installed
  log("")
  log("Verifying…")
  const { stdout: versions } = await sshRun(
    server,
    "export PATH=$HOME/.bun/bin:$HOME/.local/bin:$PATH && echo \"bun: $(bun --version 2>/dev/null || echo missing)\" && echo \"claude: $(claude --version 2>/dev/null || echo missing)\" && echo \"tmux: $(tmux -V 2>/dev/null || echo missing)\"",
    { throwOnError: false },
  )
  for (const line of versions.split("\n")) {
    if (line.trim()) log(`  ${line.trim()}`)
  }

  if (opts?.json) {
    console.log(JSON.stringify({ host: sshHost, results }, null, 2))
  } else {
    const failed = results.filter(r => r.status === "failed")
    if (failed.length > 0) {
      console.log(`\nSetup incomplete — ${failed.length} step(s) failed`)
    } else {
      console.log(`\nServer ${sshHost} is ready.`)
    }
  }
}
