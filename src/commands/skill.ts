import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"

// ── Skill frontmatter types ─────────────────────────────────────────────

interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  tags?: string[]
  platforms?: string[]
  created_by?: string
  created_from?: string
}

interface SkillEntry {
  name: string
  description: string
  version: string
  tags: string[]
  path: string
  tier: "global" | "project"
}

// ── Frontmatter parsing ─────────────────────────────────────────────────

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return null

  const raw = match[1]
  const body = match[2]

  // Simple YAML-subset parser: handles key: value, key: [a, b], key: >
  const frontmatter: Record<string, unknown> = {}
  const lines = raw.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trimEnd()

    // Skip blank lines
    if (!line.trim()) { i++; continue }

    const kvMatch = line.match(/^(\w[\w_-]*)\s*:\s*(.*)$/)
    if (!kvMatch) { i++; continue }

    const key = kvMatch[1]
    let value = kvMatch[2].trim()

    // Multi-line scalar (>)
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

    // Inline array: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""))
      i++
      continue
    }

    // Quoted string
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    frontmatter[key] = value
    i++
  }

  return { frontmatter, body }
}

function validateFrontmatter(fm: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!fm.name || typeof fm.name !== "string") {
    errors.push("Missing or invalid 'name' field")
  } else {
    const name = fm.name as string
    if (name.length > 64) errors.push(`Name too long (${name.length}/64 chars)`)
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 1) {
      errors.push(`Name must be lowercase alphanumeric with hyphens: "${name}"`)
    }
    if (name.length === 1 && !/^[a-z0-9]$/.test(name)) {
      errors.push(`Name must be lowercase alphanumeric: "${name}"`)
    }
  }

  if (!fm.description || typeof fm.description !== "string") {
    errors.push("Missing or invalid 'description' field")
  } else if ((fm.description as string).length > 1024) {
    errors.push(`Description too long (${(fm.description as string).length}/1024 chars)`)
  }

  if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
    errors.push("'tags' must be an array")
  }

  if (fm.platforms !== undefined && !Array.isArray(fm.platforms)) {
    errors.push("'platforms' must be an array")
  }

  return { valid: errors.length === 0, errors }
}

// ── Secret detection ────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i,
  /(?:secret|password|passwd|token)\s*[:=]\s*\S+/i,
  /sk-[a-zA-Z0-9]{20,}/,           // OpenAI-style keys
  /ghp_[a-zA-Z0-9]{36,}/,          // GitHub PATs
  /glpat-[a-zA-Z0-9_-]{20,}/,      // GitLab PATs
  /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/, // Slack bot tokens
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,              // AWS access keys
]

function detectSecrets(content: string): string[] {
  const findings: string[] = []
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      findings.push(`Possible secret detected: ${pattern.source}`)
    }
  }
  return findings
}

// ── Skill discovery ─────────────────────────────────────────────────────

function globalSkillsDir(): string {
  return join(homedir(), ".fleet", "skills")
}

function projectSkillsDir(workspace?: string): string | null {
  if (!workspace) return null
  const dir = join(workspace, ".fleet", "skills")
  return existsSync(dir) ? dir : null
}

function scanSkillsDir(dir: string, tier: "global" | "project"): SkillEntry[] {
  if (!existsSync(dir)) return []

  const entries: SkillEntry[] = []

  for (const item of readdirSync(dir)) {
    const skillDir = join(dir, item)
    const skillFile = join(skillDir, "SKILL.md")

    if (!statSync(skillDir).isDirectory()) continue
    if (!existsSync(skillFile)) continue

    try {
      const content = readFileSync(skillFile, "utf-8")
      const parsed = parseFrontmatter(content)
      if (!parsed) continue

      const fm = parsed.frontmatter
      entries.push({
        name: (fm.name as string) ?? item,
        description: (fm.description as string) ?? "(no description)",
        version: (fm.version as string) ?? "0.0.0",
        tags: Array.isArray(fm.tags) ? fm.tags as string[] : [],
        path: skillDir,
        tier,
      })
    } catch {
      // Skip unreadable skills
    }
  }

  return entries
}

function discoverSkills(workspace?: string): SkillEntry[] {
  const global = scanSkillsDir(globalSkillsDir(), "global")

  const projectDir = projectSkillsDir(workspace)
  const project = projectDir ? scanSkillsDir(projectDir, "project") : []

  // Project-local skills take precedence on name collision
  const seen = new Set<string>()
  const merged: SkillEntry[] = []

  for (const s of project) {
    seen.add(s.name)
    merged.push(s)
  }
  for (const s of global) {
    if (!seen.has(s.name)) {
      merged.push(s)
    }
  }

  return merged
}

// ── CLI commands ────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 3) + "..."
}

export async function skill(args: string[], opts: { json?: boolean; workspace?: string }): Promise<void> {
  const subcommand = args[0]

  switch (subcommand) {
    case "list":
      return skillList(opts)
    case "show":
      return skillShow(args.slice(1), opts)
    case "validate":
      return skillValidate(args.slice(1), opts)
    default:
      throw new Error(
        "Usage: fleet skill <list|show|validate>\n" +
        "  fleet skill list                     List all skills\n" +
        "  fleet skill show <name>              Show full SKILL.md content\n" +
        "  fleet skill validate [name]          Validate one or all skills"
      )
  }
}

async function skillList(opts: { json?: boolean; workspace?: string }): Promise<void> {
  const skills = discoverSkills(opts.workspace)

  if (opts.json) {
    console.log(JSON.stringify(skills))
    return
  }

  if (skills.length === 0) {
    console.log("No skills found.")
    console.log(`  Global:  ${globalSkillsDir()}`)
    if (opts.workspace) {
      console.log(`  Project: ${join(opts.workspace, ".fleet", "skills")}`)
    }
    return
  }

  for (const s of skills) {
    const tier = s.tier === "project" ? " [project]" : ""
    const tags = s.tags.length > 0 ? `  (${s.tags.join(", ")})` : ""
    console.log(`  ${s.name}${tier}  ${truncate(s.description, 70)}${tags}`)
  }
  console.log(`\n${skills.length} skill(s)`)
}

async function skillShow(args: string[], opts: { json?: boolean; workspace?: string }): Promise<void> {
  const name = args[0]
  if (!name || name.startsWith("--")) throw new Error("Usage: fleet skill show <name>")

  const skills = discoverSkills(opts.workspace)
  const found = skills.find(s => s.name === name)

  if (!found) {
    throw new Error(`Skill not found: "${name}"\nRun 'fleet skill list' to see available skills.`)
  }

  const skillFile = join(found.path, "SKILL.md")
  const content = readFileSync(skillFile, "utf-8")

  if (opts.json) {
    const parsed = parseFrontmatter(content)
    console.log(JSON.stringify({
      name: found.name,
      description: found.description,
      version: found.version,
      tags: found.tags,
      tier: found.tier,
      path: found.path,
      content,
      body: parsed?.body ?? content,
    }))
    return
  }

  console.log(`── ${found.name} (${found.tier}) ──`)
  console.log(content)
}

async function skillValidate(args: string[], opts: { json?: boolean; workspace?: string }): Promise<void> {
  const targetName = args[0] && !args[0].startsWith("--") ? args[0] : undefined
  const skills = discoverSkills(opts.workspace)

  if (targetName) {
    const found = skills.find(s => s.name === targetName)
    if (!found) throw new Error(`Skill not found: "${targetName}"`)
    const results = validateOneSkill(found)
    printValidation([results], opts.json)
    return
  }

  // Validate all — also check for skills dirs with no SKILL.md
  const results: ValidationResult[] = []

  for (const s of skills) {
    results.push(validateOneSkill(s))
  }

  // Check for orphaned directories (no SKILL.md)
  for (const dir of [globalSkillsDir(), projectSkillsDir(opts.workspace)].filter(Boolean) as string[]) {
    if (!existsSync(dir)) continue
    for (const item of readdirSync(dir)) {
      const skillDir = join(dir, item)
      if (!statSync(skillDir).isDirectory()) continue
      if (!existsSync(join(skillDir, "SKILL.md"))) {
        results.push({
          name: item,
          path: skillDir,
          valid: false,
          errors: ["Missing SKILL.md file"],
          warnings: [],
        })
      }
    }
  }

  printValidation(results, opts.json)
}

// ── Validation ──────────────────────────────────────────────────────────

interface ValidationResult {
  name: string
  path: string
  valid: boolean
  errors: string[]
  warnings: string[]
}

function validateOneSkill(entry: SkillEntry): ValidationResult {
  const skillFile = join(entry.path, "SKILL.md")
  const errors: string[] = []
  const warnings: string[] = []

  let content: string
  try {
    content = readFileSync(skillFile, "utf-8")
  } catch {
    return { name: entry.name, path: entry.path, valid: false, errors: ["Cannot read SKILL.md"], warnings: [] }
  }

  // Parse frontmatter
  const parsed = parseFrontmatter(content)
  if (!parsed) {
    errors.push("Missing or malformed YAML frontmatter (expected --- delimiters)")
    return { name: entry.name, path: entry.path, valid: false, errors, warnings }
  }

  // Validate frontmatter fields
  const fmValidation = validateFrontmatter(parsed.frontmatter)
  errors.push(...fmValidation.errors)

  // Check body is non-empty
  if (!parsed.body.trim()) {
    errors.push("Empty body — skill has no instructions")
  }

  // Check for secrets
  const secrets = detectSecrets(content)
  for (const s of secrets) {
    errors.push(s)
  }

  // Check directory name matches frontmatter name
  const dirName = basename(entry.path)
  if (parsed.frontmatter.name && parsed.frontmatter.name !== dirName) {
    warnings.push(`Directory name "${dirName}" doesn't match frontmatter name "${parsed.frontmatter.name}"`)
  }

  return {
    name: entry.name,
    path: entry.path,
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

function printValidation(results: ValidationResult[], json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(results))
    return
  }

  if (results.length === 0) {
    console.log("No skills to validate.")
    return
  }

  let passed = 0
  let failed = 0

  for (const r of results) {
    if (r.valid && r.warnings.length === 0) {
      passed++
      continue
    }

    if (r.valid) {
      console.log(`  ${r.name}: OK (with warnings)`)
    } else {
      console.log(`  ${r.name}: FAIL`)
      failed++
    }

    for (const e of r.errors) {
      console.log(`    ERROR: ${e}`)
    }
    for (const w of r.warnings) {
      console.log(`    WARN:  ${w}`)
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${results.length} skill(s)`)

  if (failed > 0) {
    process.exitCode = 1
  }
}
