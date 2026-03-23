import { existsSync, readFileSync } from "fs"
import { join } from "path"

function rewriteDiscordRule(identityText: string): string {
  return identityText.replace(
    "- **Always reply via Discord reply tool** — terminal output does not reach Discord",
    "- Write your final answer as plain text. Open Fleet will post it back to Discord for you.",
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
    "- Only messages with an explicit @mention are delivered to you.",
    "- Keep final responses concise and ready to send as Discord messages.",
    "- Do not say you posted to Discord yourself; Open Fleet sends your final message.",
  ].join("\n"))

  return sections.filter((section) => section.length > 0).join("\n\n")
}
