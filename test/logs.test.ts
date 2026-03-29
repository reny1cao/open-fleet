import { describe, it, expect } from "bun:test"
import { diffLines } from "../src/commands/logs"

describe("diffLines", () => {
  it("returns all lines when prev is empty", () => {
    const result = diffLines([], ["line1", "line2", "line3"])
    expect(result).toEqual(["line1", "line2", "line3"])
  })

  it("returns empty when current is empty", () => {
    const result = diffLines(["line1"], [])
    expect(result).toEqual([])
  })

  it("returns empty when nothing changed", () => {
    const lines = ["line1", "line2", "line3"]
    const result = diffLines(lines, [...lines])
    expect(result).toEqual([])
  })

  it("returns new lines after overlap", () => {
    const prev = ["line1", "line2", "line3"]
    const current = ["line2", "line3", "line4", "line5"]
    const result = diffLines(prev, current)
    expect(result).toEqual(["line4", "line5"])
  })

  it("returns all lines when no overlap found", () => {
    const prev = ["old1", "old2"]
    const current = ["new1", "new2", "new3"]
    const result = diffLines(prev, current)
    expect(result).toEqual(["new1", "new2", "new3"])
  })

  it("handles single new line", () => {
    const prev = ["line1", "line2"]
    const current = ["line1", "line2", "line3"]
    const result = diffLines(prev, current)
    expect(result).toEqual(["line3"])
  })

  it("ignores empty lines in comparison", () => {
    const prev = ["line1", "line2", ""]
    const current = ["line1", "line2", "", "line3"]
    const result = diffLines(prev, current)
    expect(result).toEqual(["line3"])
  })

  it("handles scrolled buffer (prev start is gone)", () => {
    const prev = ["line1", "line2", "line3", "line4"]
    const current = ["line3", "line4", "line5", "line6"]
    const result = diffLines(prev, current)
    expect(result).toEqual(["line5", "line6"])
  })

  it("handles identical single line", () => {
    const result = diffLines(["only"], ["only"])
    expect(result).toEqual([])
  })

  it("handles prev and current both empty", () => {
    const result = diffLines([], [])
    expect(result).toEqual([])
  })
})
