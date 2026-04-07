/**
 * Project wiki builder — assembles scoped context for agents at boot.
 *
 * Wiki files live in <fleet-dir>/wiki/:
 *   wiki/shared.md              — always included
 *   wiki/roles/<role>.md        — included for matching role
 *   wiki/projects/<key>.md      — included for matching workspace
 *
 * Project key is derived from workspace path: ~/workspace/open-fleet → open-fleet
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join, basename, resolve } from "path"

const MAX_WIKI_CHARS = 4000

export interface WikiSection {
  source: string  // e.g., "shared", "role:worker", "project:open-fleet"
  content: string
}

/** Derive project key from workspace path: ~/workspace/open-fleet → open-fleet */
export function workspaceToProjectKey(workspace: string): string {
  return basename(workspace.replace(/\/+$/, ""))
}

/** Load all relevant wiki sections for an agent. */
export function loadWikiSections(
  fleetDir: string,
  role: string,
  workspace?: string,
): WikiSection[] {
  const wikiDir = join(fleetDir, "wiki")
  if (!existsSync(wikiDir)) return []

  const sections: WikiSection[] = []

  // 1. shared.md — always included
  const sharedPath = join(wikiDir, "shared.md")
  if (existsSync(sharedPath)) {
    sections.push({
      source: "shared",
      content: readFileSync(sharedPath, "utf8").trim(),
    })
  }

  // 2. roles/<role>.md — matched by agent role
  const rolePath = join(wikiDir, "roles", `${role}.md`)
  if (existsSync(rolePath)) {
    sections.push({
      source: `role:${role}`,
      content: readFileSync(rolePath, "utf8").trim(),
    })
  }

  // 3. projects/<key>.md — matched by workspace
  if (workspace) {
    const projectKey = workspaceToProjectKey(workspace)
    const projectPath = join(wikiDir, "projects", `${projectKey}.md`)
    if (existsSync(projectPath)) {
      sections.push({
        source: `project:${projectKey}`,
        content: readFileSync(projectPath, "utf8").trim(),
      })
    }
  }

  return sections
}

/** Build the assembled project-wiki.md content from sections, respecting size cap. */
export function buildProjectWiki(sections: WikiSection[]): string {
  if (sections.length === 0) return ""

  const parts: string[] = []
  let charCount = 0

  for (const section of sections) {
    const sectionSize = section.content.length + 2 // +2 for newlines
    if (charCount + sectionSize > MAX_WIKI_CHARS) {
      // Truncate this section to fit
      const remaining = MAX_WIKI_CHARS - charCount - 20 // leave room for truncation note
      if (remaining > 100) {
        parts.push(section.content.slice(0, remaining) + "\n...(truncated)")
      }
      break
    }
    parts.push(section.content)
    charCount += sectionSize
  }

  return parts.join("\n\n")
}

/** List all available wiki entries for display. */
export function listWikiEntries(fleetDir: string): Array<{ type: string; name: string; path: string; size: number }> {
  const wikiDir = join(fleetDir, "wiki")
  if (!existsSync(wikiDir)) return []

  const entries: Array<{ type: string; name: string; path: string; size: number }> = []

  // shared.md
  const sharedPath = join(wikiDir, "shared.md")
  if (existsSync(sharedPath)) {
    const stat = statSync(sharedPath)
    entries.push({ type: "shared", name: "shared", path: sharedPath, size: stat.size })
  }

  // roles/
  const rolesDir = join(wikiDir, "roles")
  if (existsSync(rolesDir)) {
    for (const file of readdirSync(rolesDir)) {
      if (!file.endsWith(".md")) continue
      const fullPath = join(rolesDir, file)
      const stat = statSync(fullPath)
      entries.push({ type: "role", name: file.replace(".md", ""), path: fullPath, size: stat.size })
    }
  }

  // projects/
  const projectsDir = join(wikiDir, "projects")
  if (existsSync(projectsDir)) {
    for (const file of readdirSync(projectsDir)) {
      if (!file.endsWith(".md")) continue
      const fullPath = join(projectsDir, file)
      const stat = statSync(fullPath)
      entries.push({ type: "project", name: file.replace(".md", ""), path: fullPath, size: stat.size })
    }
  }

  return entries
}
