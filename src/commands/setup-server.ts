import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const SSH_TIMEOUT = 10
const REMOTE_PATH_PREFIX = "export PATH=$HOME/.bun/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

/** Resolve proxy from env vars or ~/.fleet/config.json */
function resolveProxy(): string | undefined {
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
  if (envProxy) return envProxy
  try {
    const { readFileSync, existsSync } = require("fs") as typeof import("fs")
    const { join } = require("path") as typeof import("path")
    const { homedir } = require("os") as typeof import("os")
    const p = join(homedir(), ".fleet", "config.json")
    if (existsSync(p)) {
      const c = JSON.parse(readFileSync(p, "utf8"))
      if (c.proxy) return c.proxy
    }
  } catch {}
  return undefined
}

/** Build proxy export prefix for remote shell commands */
function remoteProxyPrefix(): string {
  const proxy = resolveProxy()
  if (!proxy) return ""
  return `export HTTP_PROXY='${proxy}' && export HTTPS_PROXY='${proxy}' && `
}

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

async function scpToHost(
  host: string,
  localPath: string,
  remotePath: string,
): Promise<boolean> {
  const proc = Bun.spawn(
    ["scp", "-o", `ConnectTimeout=${SSH_TIMEOUT}`, "-o", "BatchMode=yes", localPath, `${host}:${remotePath}`],
    { stdout: "pipe", stderr: "pipe" }
  )
  await new Response(proc.stdout).text()
  await new Response(proc.stderr).text()
  const code = await proc.exited
  return code === 0
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
  const { ok: installOk, stdout } = await sshExec(host, `${remoteProxyPrefix()}${installCmd}`)
  if (installOk) {
    log(`  [ok]  ${tool} — installed`)
    return { step: tool, status: "installed", message: "installed" }
  } else {
    log(`  [!!] ${tool} — install failed`)
    return { step: tool, status: "failed", message: stdout.slice(0, 200) }
  }
}

async function syncCodexAuth(
  host: string,
  log: (...args: unknown[]) => void,
): Promise<StepResult> {
  const localAuthPath = join(homedir(), ".codex", "auth.json")
  if (!existsSync(localAuthPath)) {
    log("  [..] codex auth — skipped (local ~/.codex/auth.json not found)")
    return { step: "codex-auth", status: "skipped", message: "local auth.json not found" }
  }

  log("  [..] codex auth — copying local auth…")
  const { ok: mkdirOk } = await sshExec(host, "mkdir -p ~/.codex")
  if (!mkdirOk) {
    log("  [!!] codex auth — could not create ~/.codex on remote")
    return { step: "codex-auth", status: "failed", message: "could not create ~/.codex on remote" }
  }

  const copied = await scpToHost(host, localAuthPath, "~/.codex/auth.json")
  if (!copied) {
    log("  [!!] codex auth — copy failed")
    return { step: "codex-auth", status: "failed", message: "copy failed" }
  }

  const { ok: loginOk, stdout } = await sshExec(
    host,
    "codex login status"
  )
  if (loginOk) {
    log("  [ok]  codex auth — reused local login")
    return { step: "codex-auth", status: "installed", message: stdout || "reused local login" }
  }

  log("  [!!] codex auth — copied auth but login status failed")
  return { step: "codex-auth", status: "failed", message: stdout || "copied auth but login status failed" }
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

  // 5. npm (needed for Codex CLI install)
  const npmResult = await checkAndInstall(
    host, "npm",
    "which npm",
    "sudo apt-get install -y npm 2>/dev/null || sudo yum install -y npm 2>/dev/null",
    log,
  )
  results.push(npmResult)

  // 6. Codex CLI via npm
  const codexResult = await checkAndInstall(
    host, "codex",
    "which codex",
    "mkdir -p ~/.npm-global && NPM_CONFIG_PREFIX=$HOME/.npm-global npm install -g @openai/codex",
    log,
  )
  results.push(codexResult)

  // 7. Reuse local Codex auth when available
  const codexAuthResult = await syncCodexAuth(host, log)
  results.push(codexAuthResult)

  // 8. Verify
  log("")
  log("Verifying…")
  const { stdout: versions } = await sshExec(
    host,
    "echo \"bun: $(bun --version 2>/dev/null || echo missing)\" && echo \"claude: $(claude --version 2>/dev/null || echo missing)\" && echo \"codex: $(codex --version 2>/dev/null || echo missing)\" && echo \"tmux: $(tmux -V 2>/dev/null || echo missing)\"",
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
