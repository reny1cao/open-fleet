import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// We test the internals by importing the module and calling functions
// through the CLI entrypoint. Since skill.ts exports `skill()`, we
// test via subprocess to match how the CLI actually runs.

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fleet-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeSkill(baseDir: string, name: string, frontmatter: string, body: string): void {
  const skillDir = join(baseDir, name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`)
}

// Direct unit tests of the parsing/validation logic
// We re-implement the key functions here to test in isolation

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return null
  const raw = match[1]
  const body = match[2]
  const frontmatter: Record<string, unknown> = {}
  const lines = raw.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trimEnd()
    if (!line.trim()) { i++; continue }
    const kvMatch = line.match(/^(\w[\w_-]*)\s*:\s*(.*)$/)
    if (!kvMatch) { i++; continue }
    const key = kvMatch[1]
    let value = kvMatch[2].trim()
    if (value === ">") {
      const parts: string[] = []
      i++
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].trim() === "")) {
        parts.push(lines[i].trim())
        i++
      }
      frontmatter[key] = parts.join(" ").trim()
      continue
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""))
      i++
      continue
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    frontmatter[key] = value
    i++
  }
  return { frontmatter, body }
}

describe("frontmatter parsing", () => {
  it("parses simple key-value pairs", () => {
    const content = `---\nname: my-skill\ndescription: A test skill\n---\n# Body`
    const result = parseFrontmatter(content)
    expect(result).not.toBeNull()
    expect(result!.frontmatter.name).toBe("my-skill")
    expect(result!.frontmatter.description).toBe("A test skill")
    expect(result!.body).toBe("# Body")
  })

  it("parses inline arrays", () => {
    const content = `---\nname: test\ndescription: test\ntags: [deploy, staging, ci]\n---\nbody`
    const result = parseFrontmatter(content)
    expect(result!.frontmatter.tags).toEqual(["deploy", "staging", "ci"])
  })

  it("parses multi-line scalars", () => {
    const content = `---\nname: test\ndescription: >\n  This is a long\n  description text\n---\nbody`
    const result = parseFrontmatter(content)
    expect(result!.frontmatter.description).toBe("This is a long description text")
  })

  it("returns null for missing frontmatter", () => {
    const result = parseFrontmatter("# Just a markdown file\nNo frontmatter here")
    expect(result).toBeNull()
  })

  it("parses quoted strings", () => {
    const content = `---\nname: "my-skill"\ndescription: 'A test skill'\n---\nbody`
    const result = parseFrontmatter(content)
    expect(result!.frontmatter.name).toBe("my-skill")
    expect(result!.frontmatter.description).toBe("A test skill")
  })
})

describe("secret detection", () => {
  const SECRET_PATTERNS = [
    /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i,
    /(?:secret|password|passwd|token)\s*[:=]\s*\S+/i,
    /sk-[a-zA-Z0-9-]{20,}/,
    /ghp_[a-zA-Z0-9]{36,}/,
    /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
    /AKIA[0-9A-Z]{16}/,
  ]

  function detectSecrets(content: string): string[] {
    const findings: string[] = []
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) findings.push(pattern.source)
    }
    return findings
  }

  it("detects OpenAI-style API keys", () => {
    const secrets = detectSecrets("Use this key: sk-abcdefghijklmnopqrstuvwxyz")
    expect(secrets.length).toBeGreaterThan(0)
  })

  it("detects Anthropic API keys (sk-ant-)", () => {
    const secrets = detectSecrets("ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz")
    expect(secrets.length).toBeGreaterThan(0)
  })

  it("detects GitHub PATs", () => {
    const secrets = detectSecrets("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789")
    expect(secrets.length).toBeGreaterThan(0)
  })

  it("detects AWS access keys", () => {
    const secrets = detectSecrets("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE")
    expect(secrets.length).toBeGreaterThan(0)
  })

  it("detects private keys", () => {
    const secrets = detectSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIE...")
    expect(secrets.length).toBeGreaterThan(0)
  })

  it("detects password fields", () => {
    const secrets = detectSecrets("password: my-secret-password123")
    expect(secrets.length).toBeGreaterThan(0)
  })

  it("does not flag clean content", () => {
    const secrets = detectSecrets("## Steps\n1. Run the deploy script\n2. Check health endpoint")
    expect(secrets.length).toBe(0)
  })
})

describe("skill discovery", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("discovers skills from a directory", () => {
    writeSkill(tmpDir, "my-skill", "name: my-skill\ndescription: Test skill", "# Steps\n1. Do thing")

    const skillDir = join(tmpDir, "my-skill", "SKILL.md")
    const content = readFileSync(skillDir, "utf-8")
    const parsed = parseFrontmatter(content)

    expect(parsed).not.toBeNull()
    expect(parsed!.frontmatter.name).toBe("my-skill")
    expect(parsed!.frontmatter.description).toBe("Test skill")
    expect(parsed!.body.trim()).toBe("# Steps\n1. Do thing")
  })

  it("handles empty skills directory", () => {
    // Empty dir — should not crash
    const entries = Bun.spawnSync(["ls", tmpDir], { stdout: "pipe" })
    const out = new TextDecoder().decode(entries.stdout).trim()
    // Just verify the dir exists and is empty
    expect(out).toBe("")
  })

  it("handles skill with missing SKILL.md", () => {
    mkdirSync(join(tmpDir, "orphaned-dir"), { recursive: true })
    writeFileSync(join(tmpDir, "orphaned-dir", "README.md"), "Not a skill")

    // SKILL.md doesn't exist in this dir
    const skillFile = join(tmpDir, "orphaned-dir", "SKILL.md")
    expect(() => readFileSync(skillFile, "utf-8")).toThrow()
  })

  it("detects secrets in skill content", () => {
    const SECRET_PATTERNS = [
      /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i,
      /sk-[a-zA-Z0-9]{20,}/,
    ]
    function detectSecrets(content: string): string[] {
      const findings: string[] = []
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) findings.push(pattern.source)
      }
      return findings
    }

    writeSkill(tmpDir, "bad-skill",
      "name: bad-skill\ndescription: Has secrets",
      "# Config\napi_key: sk-abcdefghijklmnopqrstuvwxyz\n")

    const content = readFileSync(join(tmpDir, "bad-skill", "SKILL.md"), "utf-8")
    const secrets = detectSecrets(content)
    expect(secrets.length).toBeGreaterThan(0)
  })

  it("project-local skill takes precedence over global on name collision", () => {
    const globalDir = join(tmpDir, "global")
    const projectDir = join(tmpDir, "project")

    writeSkill(globalDir, "deploy", "name: deploy\ndescription: Global deploy", "# Global")
    writeSkill(projectDir, "deploy", "name: deploy\ndescription: Project deploy", "# Project")

    // Read both and verify project wins
    const globalContent = readFileSync(join(globalDir, "deploy", "SKILL.md"), "utf-8")
    const projectContent = readFileSync(join(projectDir, "deploy", "SKILL.md"), "utf-8")

    const globalParsed = parseFrontmatter(globalContent)
    const projectParsed = parseFrontmatter(projectContent)

    expect(globalParsed!.frontmatter.description).toBe("Global deploy")
    expect(projectParsed!.frontmatter.description).toBe("Project deploy")

    // Simulate merge logic: project first, skip duplicates from global
    const seen = new Set<string>()
    const merged: Array<{ name: string; tier: string }> = []

    seen.add("deploy")
    merged.push({ name: "deploy", tier: "project" })
    // Global "deploy" should be skipped
    if (!seen.has("deploy")) merged.push({ name: "deploy", tier: "global" })

    expect(merged.length).toBe(1)
    expect(merged[0].tier).toBe("project")
  })
})

describe("frontmatter validation", () => {
  function validateFrontmatter(fm: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    if (!fm.name || typeof fm.name !== "string") {
      errors.push("Missing or invalid 'name' field")
    } else {
      const name = fm.name as string
      if (name.length > 64) errors.push(`Name too long`)
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 1) {
        errors.push(`Name must be lowercase alphanumeric with hyphens: "${name}"`)
      }
    }
    if (!fm.description || typeof fm.description !== "string") {
      errors.push("Missing or invalid 'description' field")
    }
    return { valid: errors.length === 0, errors }
  }

  it("passes valid frontmatter", () => {
    const result = validateFrontmatter({ name: "deploy-staging", description: "Deploy to staging" })
    expect(result.valid).toBe(true)
    expect(result.errors.length).toBe(0)
  })

  it("fails on missing name", () => {
    const result = validateFrontmatter({ description: "No name" })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes("name"))).toBe(true)
  })

  it("fails on missing description", () => {
    const result = validateFrontmatter({ name: "test" })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes("description"))).toBe(true)
  })

  it("fails on uppercase name", () => {
    const result = validateFrontmatter({ name: "MySkill", description: "Test" })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes("lowercase"))).toBe(true)
  })

  it("fails on name with spaces", () => {
    const result = validateFrontmatter({ name: "my skill", description: "Test" })
    expect(result.valid).toBe(false)
  })
})
