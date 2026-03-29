import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  readHeartbeat,
  writeHeartbeat,
  heartbeatShellSnippet,
  formatAge,
} from "../src/core/heartbeat"

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fleet-hb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("heartbeat", () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe("readHeartbeat", () => {
    it("returns unknown when no heartbeat file exists", () => {
      const hb = readHeartbeat(dir)
      expect(hb.state).toBe("unknown")
      expect(hb.lastSeen).toBeNull()
      expect(hb.ageSec).toBeNull()
    })

    it("returns alive for recent heartbeat", () => {
      const now = new Date().toISOString()
      writeFileSync(
        join(dir, "heartbeat.json"),
        JSON.stringify({ timestamp: now })
      )
      const hb = readHeartbeat(dir)
      expect(hb.state).toBe("alive")
      expect(hb.lastSeen).toBe(now)
      expect(hb.ageSec).toBeLessThanOrEqual(2)
    })

    it("returns stale for heartbeat older than 60s", () => {
      const old = new Date(Date.now() - 120_000).toISOString() // 2 min ago
      writeFileSync(
        join(dir, "heartbeat.json"),
        JSON.stringify({ timestamp: old })
      )
      const hb = readHeartbeat(dir)
      expect(hb.state).toBe("stale")
      expect(hb.ageSec).toBeGreaterThanOrEqual(119)
    })

    it("returns dead for heartbeat older than 5min", () => {
      const old = new Date(Date.now() - 400_000).toISOString() // ~6.7 min ago
      writeFileSync(
        join(dir, "heartbeat.json"),
        JSON.stringify({ timestamp: old })
      )
      const hb = readHeartbeat(dir)
      expect(hb.state).toBe("dead")
    })

    it("returns unknown for corrupted heartbeat file", () => {
      writeFileSync(join(dir, "heartbeat.json"), "not json")
      const hb = readHeartbeat(dir)
      expect(hb.state).toBe("unknown")
    })

    it("returns unknown for invalid timestamp", () => {
      writeFileSync(
        join(dir, "heartbeat.json"),
        JSON.stringify({ timestamp: "not-a-date" })
      )
      const hb = readHeartbeat(dir)
      // NaN date → returns unknown deterministically
      expect(hb.state).toBe("unknown")
      expect(hb.lastSeen).toBe("not-a-date")
      expect(hb.ageSec).toBeNull()
    })
  })

  describe("writeHeartbeat", () => {
    it("writes a valid heartbeat file", () => {
      writeHeartbeat(dir)
      const data = JSON.parse(readFileSync(join(dir, "heartbeat.json"), "utf8"))
      expect(data.timestamp).toBeDefined()
      expect(data.pid).toBe(process.pid)
      // Timestamp should be recent
      const age = Date.now() - new Date(data.timestamp).getTime()
      expect(age).toBeLessThan(5000)
    })

    it("creates state directory if missing", () => {
      const nested = join(dir, "nested", "state")
      writeHeartbeat(nested)
      const data = JSON.parse(
        readFileSync(join(nested, "heartbeat.json"), "utf8")
      )
      expect(data.timestamp).toBeDefined()
    })

    it("overwrites existing heartbeat", () => {
      writeHeartbeat(dir)
      const first = JSON.parse(
        readFileSync(join(dir, "heartbeat.json"), "utf8")
      )
      // Small delay
      const before = Date.now()
      writeHeartbeat(dir)
      const second = JSON.parse(
        readFileSync(join(dir, "heartbeat.json"), "utf8")
      )
      expect(new Date(second.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(first.timestamp).getTime()
      )
    })
  })

  describe("heartbeatShellSnippet", () => {
    it("generates valid bash lines", () => {
      const lines = heartbeatShellSnippet("/tmp/test-state")
      expect(lines.length).toBeGreaterThan(5)
      expect(lines.some((l) => l.includes("HEARTBEAT_FILE"))).toBe(true)
      expect(lines.some((l) => l.includes("sleep 30"))).toBe(true)
      expect(lines.some((l) => l.includes("/tmp/test-state"))).toBe(true)
      expect(lines.some((l) => l.includes("trap"))).toBe(true)
    })

    it("includes the correct file path", () => {
      const lines = heartbeatShellSnippet("/home/user/.fleet/state/my-agent")
      const fileLine = lines.find((l) => l.includes("HEARTBEAT_FILE="))
      expect(fileLine).toContain("/home/user/.fleet/state/my-agent/heartbeat.json")
    })
  })

  describe("formatAge", () => {
    it("returns never for null", () => {
      expect(formatAge(null)).toBe("never")
    })

    it("formats seconds", () => {
      expect(formatAge(5)).toBe("5s ago")
      expect(formatAge(59)).toBe("59s ago")
    })

    it("formats minutes", () => {
      expect(formatAge(60)).toBe("1m ago")
      expect(formatAge(300)).toBe("5m ago")
      expect(formatAge(3599)).toBe("59m ago")
    })

    it("formats hours", () => {
      expect(formatAge(3600)).toBe("1h ago")
      expect(formatAge(7200)).toBe("2h ago")
    })
  })
})
