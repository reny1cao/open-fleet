import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { getCodexThreadId, loadCodexThreadMap, setCodexThreadId } from "../src/agents/codex/state"

describe("codex thread state", () => {
  it("returns an empty map when no state file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-codex-state-"))
    try {
      expect(loadCodexThreadMap(dir)).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("persists and reloads scope-to-thread mappings", () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-codex-state-"))
    try {
      setCodexThreadId(dir, "channel:123", "thread-alpha")
      setCodexThreadId(dir, "thread:456", "thread-beta")

      expect(getCodexThreadId(dir, "channel:123")).toBe("thread-alpha")
      expect(loadCodexThreadMap(dir)).toEqual({
        "channel:123": "thread-alpha",
        "thread:456": "thread-beta",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
