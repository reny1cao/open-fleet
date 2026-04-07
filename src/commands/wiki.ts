import { findConfigDir } from "../core/config"
import { listWikiEntries, loadWikiSections, buildProjectWiki, workspaceToProjectKey } from "../core/wiki"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname, resolve } from "path"

/** Resolve a wiki target path, rejecting traversal outside wiki dir. */
function resolveWikiPath(wikiDir: string, target: string): string {
  if (target.includes("..")) throw new Error(`Invalid wiki path: "${target}" — '..' segments not allowed`)
  const filePath = target === "shared"
    ? join(wikiDir, "shared.md")
    : join(wikiDir, `${target}.md`)
  const resolved = resolve(filePath)
  if (!resolved.startsWith(resolve(wikiDir))) {
    throw new Error(`Invalid wiki path: "${target}" — resolves outside wiki directory`)
  }
  return resolved
}

export async function wiki(args: string[], opts: { json?: boolean }): Promise<void> {
  const subcommand = args[0]

  switch (subcommand) {
    case "list":
      return wikiList(opts)
    case "show":
      return wikiShow(args.slice(1), opts)
    case "set":
      return wikiSet(args.slice(1), opts)
    default:
      throw new Error(
        "Usage: fleet wiki <list|show|set>\n" +
        "  fleet wiki list                           List all wiki entries\n" +
        "  fleet wiki show <type>/<name>             Show a wiki entry (e.g., projects/open-fleet)\n" +
        "  fleet wiki set <type>/<name> <content>    Create or update a wiki entry"
      )
  }
}

async function wikiList(opts: { json?: boolean }): Promise<void> {
  const configDir = findConfigDir()
  const entries = listWikiEntries(configDir)

  if (opts.json) {
    console.log(JSON.stringify(entries))
    return
  }

  if (entries.length === 0) {
    console.log("No wiki entries found. Create one with: fleet wiki set <type>/<name> <content>")
    console.log("\nTypes: shared, roles/<role>, projects/<project>")
    return
  }

  console.log("Wiki entries:\n")
  for (const entry of entries) {
    const path = entry.type === "shared" ? "shared" : `${entry.type}s/${entry.name}`
    console.log(`  ${path}  (${entry.size} bytes)`)
  }
  console.log(`\n${entries.length} entry(s). Show with: fleet wiki show <path>`)
}

async function wikiShow(args: string[], opts: { json?: boolean }): Promise<void> {
  const target = args[0]
  if (!target) throw new Error("Usage: fleet wiki show <type>/<name>  (e.g., projects/open-fleet, roles/worker, shared)")

  const configDir = findConfigDir()
  const wikiDir = join(configDir, "wiki")
  const filePath = resolveWikiPath(wikiDir, target)

  if (!existsSync(filePath)) {
    throw new Error(`Wiki entry not found: ${target}\nRun \`fleet wiki list\` to see available entries.`)
  }

  const content = readFileSync(filePath, "utf8")

  if (opts.json) {
    console.log(JSON.stringify({ path: target, content }))
  } else {
    console.log(content)
  }
}

async function wikiSet(args: string[], opts: { json?: boolean }): Promise<void> {
  const target = args[0]
  if (!target) throw new Error("Usage: fleet wiki set <type>/<name> <content>")

  const content = args.slice(1).join(" ")
  if (!content) throw new Error("Usage: fleet wiki set <type>/<name> <content>\nContent is required.")

  const configDir = findConfigDir()
  const wikiDir = join(configDir, "wiki")
  const filePath = resolveWikiPath(wikiDir, target)

  // Ensure parent directory exists
  mkdirSync(dirname(filePath), { recursive: true })

  writeFileSync(filePath, content + "\n", "utf8")

  if (opts.json) {
    console.log(JSON.stringify({ path: target, size: content.length + 1, status: "updated" }))
  } else {
    console.log(`Updated wiki entry: ${target} (${content.length + 1} bytes)`)
  }
}
