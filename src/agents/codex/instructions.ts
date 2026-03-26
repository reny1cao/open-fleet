import { existsSync, readFileSync } from "fs"
import { join } from "path"

function rewriteDiscordRule(identityText: string): string {
  return identityText.replace(
    "- **Always reply via Discord reply tool** — terminal output does not reach Discord",
    "- Return structured Open Fleet channel actions as JSON. Open Fleet executes them on Discord for you.",
  )
}

export function buildCodexDeveloperInstructions(stateDir: string): string {
  const sections: string[] = []

  const identityPath = join(stateDir, "identity.md")
  if (existsSync(identityPath)) {
    sections.push(rewriteDiscordRule(readFileSync(identityPath, "utf8").trim()))
  }

  const rosterPath = join(stateDir, ".claude", "CLAUDE.md")
  if (existsSync(rosterPath)) {
    sections.push(readFileSync(rosterPath, "utf8").trim())
  }

  sections.push([
    "## Open Fleet Bridge",
    "- Channel events are delivered to you by Open Fleet, not directly by Discord.",
    "- Return only valid JSON channel actions with no markdown fences or extra commentary.",
    '- Supported action schema: {"actions":[{"type":"reply","text":"message text","replyToMessageId":"optional"}]}',
    "- Keep Discord messages concise and directly sendable.",
    "- Do not say you posted to Discord yourself; Open Fleet executes the actions.",
  ].join("\n"))

  return sections.filter((section) => section.length > 0).join("\n\n")
}
