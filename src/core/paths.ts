import { homedir } from "os"

/**
 * Expand ~ to the user's home directory.
 * Shared utility — replaces 4+ inline copies across the codebase.
 */
export function expandHome(p: string): string {
  if (p.startsWith("~/")) return homedir() + p.slice(1)
  if (p === "~") return homedir()
  return p
}

/**
 * Expand ~ using a custom home directory (for remote agents).
 */
export function expandHomeTo(p: string, home: string): string {
  if (p.startsWith("~/")) return home + p.slice(1)
  if (p === "~") return home
  return p
}
