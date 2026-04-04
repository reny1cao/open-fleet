import { describe, it, expect } from "bun:test"
import { parseFlag, parseFlagValue } from "../src/cli"

// ── parseFlag ───────────────────────────────────────────────────────────────

describe("parseFlag", () => {
  it("returns true when flag is present", () => {
    expect(parseFlag(["start", "--json"], "--json")).toBe(true)
  })

  it("returns false when flag is absent", () => {
    expect(parseFlag(["start", "agent1"], "--json")).toBe(false)
  })

  it("finds flag at the start of args", () => {
    expect(parseFlag(["--force", "init"], "--force")).toBe(true)
  })

  it("finds flag in the middle of args", () => {
    expect(parseFlag(["start", "--wait", "agent1"], "--wait")).toBe(true)
  })

  it("returns false for empty args", () => {
    expect(parseFlag([], "--json")).toBe(false)
  })

  it("does not match partial flag names", () => {
    expect(parseFlag(["--json-output"], "--json")).toBe(false)
  })
})

// ── parseFlagValue ──────────────────────────────────────────────────────────

describe("parseFlagValue", () => {
  it("returns value after flag", () => {
    expect(parseFlagValue(["--name", "my-fleet"], "--name")).toBe("my-fleet")
  })

  it("returns undefined when flag is absent", () => {
    expect(parseFlagValue(["start", "agent1"], "--name")).toBeUndefined()
  })

  it("returns undefined when flag is last element (no value after)", () => {
    expect(parseFlagValue(["start", "--name"], "--name")).toBeUndefined()
  })

  it("returns value when flag is in the middle", () => {
    expect(parseFlagValue(["--token", "T1", "--name", "fleet1", "--json"], "--name")).toBe("fleet1")
  })

  it("returns first occurrence when flag appears multiple times", () => {
    // parseFlagValue uses indexOf, so it returns the first match
    expect(parseFlagValue(["--name", "first", "--name", "second"], "--name")).toBe("first")
  })

  it("returns undefined for empty args", () => {
    expect(parseFlagValue([], "--name")).toBeUndefined()
  })
})
