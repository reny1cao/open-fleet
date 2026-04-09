import { existsSync, readFileSync } from "fs"
import { join } from "path"

function rewriteDiscordRule(identityText: string): string {
  return identityText.replace(
    "- **Always reply via Discord reply tool** — terminal output does not reach Discord",
    "- Write your final answer as plain text. Open Fleet will post it back to Discord for you.",
  )
}

function rewriteSkillInstructions(identityText: string): string {
  // Codex doesn't have a Read MCP tool — it reads files via its own file tools
  // Adapt skill instructions for Codex's tool surface
  return identityText
    .replace(
      /Use the Read tool to load a skill's SKILL\.md/g,
      "Read a skill's SKILL.md file",
    )
    .replace(
      /read its SKILL\.md and follow the instructions/g,
      "read its SKILL.md file and follow the instructions",
    )
}

export function buildCodexDeveloperInstructions(stateDir: string): string {
  const sections: string[] = []

  // 1. Identity (static — role, rules, skills behavioral instructions)
  const identityPath = join(stateDir, "identity.md")
  if (existsSync(identityPath)) {
    let identity = readFileSync(identityPath, "utf8").trim()
    identity = rewriteDiscordRule(identity)
    identity = rewriteSkillInstructions(identity)
    sections.push(identity)
  }

  // 2. Roster + skills index (dynamic — re-generated each boot)
  const rosterPath = join(stateDir, ".claude", "CLAUDE.md")
  if (existsSync(rosterPath)) {
    let roster = readFileSync(rosterPath, "utf8").trim()
    roster = rewriteSkillInstructions(roster)
    sections.push(roster)
  }

  // 3. Task context (active tasks, recent activity)
  const tasksContextPath = join(stateDir, "tasks-context.md")
  if (existsSync(tasksContextPath)) {
    const tasksContext = readFileSync(tasksContextPath, "utf8").trim()
    if (tasksContext.length > 0) {
      sections.push(tasksContext)
    }
  }

  // 4. Project wiki (project-specific docs)
  const projectWikiPath = join(stateDir, "project-wiki.md")
  if (existsSync(projectWikiPath)) {
    const projectWiki = readFileSync(projectWikiPath, "utf8").trim()
    if (projectWiki.length > 0) {
      sections.push(projectWiki)
    }
  }

  // 5. Bridge instructions (Codex-specific behavior)
  sections.push([
    "## Open Fleet Bridge",
    "- Only messages with an explicit @mention are delivered to you.",
    "- Only output your final answer. Do not include thinking steps, progress updates, or commentary in your response.",
    "- Keep final responses concise and ready to send as Discord messages.",
    "- Do not say you posted to Discord yourself; Open Fleet sends your final message.",
    "- You can read and write files, run commands, and use `fleet task` CLI commands.",
    "- To update task status: `fleet task update <id> --status done --result '{\"summary\":\"what you did\"}'`",
  ].join("\n"))

  return sections.filter((section) => section.length > 0).join("\n\n")
}
