import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

export type CodexThreadMap = Record<string, string>

function statePath(stateDir: string): string {
  return join(stateDir, "codex-threads.json")
}

export function loadCodexThreadMap(stateDir: string): CodexThreadMap {
  const path = statePath(stateDir)
  if (!existsSync(path)) {
    return {}
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  const result: CodexThreadMap = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.length > 0) {
      result[key] = value
    }
  }
  return result
}

export function getCodexThreadId(stateDir: string, scopeKey: string): string | undefined {
  return loadCodexThreadMap(stateDir)[scopeKey]
}

export function setCodexThreadId(stateDir: string, scopeKey: string, threadId: string): void {
  mkdirSync(stateDir, { recursive: true })
  const next = loadCodexThreadMap(stateDir)
  next[scopeKey] = threadId
  writeFileSync(statePath(stateDir), JSON.stringify(next, null, 2) + "\n", "utf8")
}
