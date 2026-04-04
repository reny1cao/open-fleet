import { describe, it, expect } from "bun:test"
import { homedir } from "os"
import { join } from "path"
import {
  expandHome,
  compareVersionSegments,
  colorLabel,
  COLORS,
} from "../src/core/utils"

// ── expandHome ──────────────────────────────────────────────────────────────

describe("expandHome", () => {
  it("expands ~/foo to homedir/foo", () => {
    expect(expandHome("~/foo")).toBe(join(homedir(), "foo"))
  })

  it("expands ~/deeply/nested/path", () => {
    expect(expandHome("~/a/b/c")).toBe(join(homedir(), "a/b/c"))
  })

  it("expands bare ~ to homedir", () => {
    expect(expandHome("~")).toBe(homedir())
  })

  it("leaves absolute paths unchanged", () => {
    expect(expandHome("/usr/local/bin")).toBe("/usr/local/bin")
  })

  it("leaves relative paths unchanged", () => {
    expect(expandHome("relative/path")).toBe("relative/path")
  })

  it("leaves empty string unchanged", () => {
    expect(expandHome("")).toBe("")
  })

  it("does not expand ~user syntax (only ~/)", () => {
    expect(expandHome("~otheruser/foo")).toBe("~otheruser/foo")
  })
})

// ── compareVersionSegments ──────────────────────────────────────────────────

describe("compareVersionSegments", () => {
  it("returns negative when a < b (0.0.4 vs 0.0.10)", () => {
    expect(compareVersionSegments("0.0.4", "0.0.10")).toBeLessThan(0)
  })

  it("returns positive when a > b (1.0.0 vs 0.9.9)", () => {
    expect(compareVersionSegments("1.0.0", "0.9.9")).toBeGreaterThan(0)
  })

  it("returns 0 for equal versions", () => {
    expect(compareVersionSegments("1.2.3", "1.2.3")).toBe(0)
  })

  it("treats missing segments as 0 (1.0 vs 1.0.0)", () => {
    expect(compareVersionSegments("1.0", "1.0.0")).toBe(0)
  })

  it("handles single-segment versions", () => {
    expect(compareVersionSegments("2", "1")).toBeGreaterThan(0)
  })

  it("handles many segments", () => {
    expect(compareVersionSegments("1.2.3.4.5", "1.2.3.4.6")).toBeLessThan(0)
  })
})

// ── colorLabel ──────────────────────────────────────────────────────────────

describe("colorLabel", () => {
  it("wraps 'pass' in green ANSI codes", () => {
    expect(colorLabel("pass")).toBe(`${COLORS.pass}[pass]${COLORS.reset}`)
  })

  it("wraps 'fail' in red ANSI codes", () => {
    expect(colorLabel("fail")).toBe(`${COLORS.fail}[fail]${COLORS.reset}`)
  })

  it("wraps 'warn' in yellow ANSI codes", () => {
    expect(colorLabel("warn")).toBe(`${COLORS.warn}[warn]${COLORS.reset}`)
  })

  it("wraps 'info' in cyan ANSI codes", () => {
    expect(colorLabel("info")).toBe(`${COLORS.info}[info]${COLORS.reset}`)
  })

  it("wraps unknown status with no color prefix but still has brackets and reset", () => {
    const result = colorLabel("unknown")
    expect(result).toBe(`[unknown]${COLORS.reset}`)
  })

  it("handles empty string status", () => {
    const result = colorLabel("")
    expect(result).toContain("[]")
  })
})
