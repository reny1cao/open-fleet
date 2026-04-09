import { describe, it, expect } from "bun:test"
import { expandHome, expandHomeTo } from "../src/core/paths"
import { homedir } from "os"

describe("expandHome", () => {
  it("expands ~/path to home directory", () => {
    const result = expandHome("~/workspace/sysbuilder")
    expect(result).toBe(`${homedir()}/workspace/sysbuilder`)
  })

  it("expands bare ~ to home directory", () => {
    expect(expandHome("~")).toBe(homedir())
  })

  it("leaves absolute paths unchanged", () => {
    expect(expandHome("/usr/local/bin")).toBe("/usr/local/bin")
  })

  it("leaves relative paths unchanged", () => {
    expect(expandHome("./src/index.ts")).toBe("./src/index.ts")
  })

  it("does not expand ~ in the middle of a path", () => {
    expect(expandHome("/home/user/~backup")).toBe("/home/user/~backup")
  })
})

describe("expandHomeTo", () => {
  it("expands ~/path with custom home", () => {
    expect(expandHomeTo("~/workspace", "/remote/home")).toBe("/remote/home/workspace")
  })

  it("expands bare ~ with custom home", () => {
    expect(expandHomeTo("~", "/remote/home")).toBe("/remote/home")
  })

  it("leaves absolute paths unchanged", () => {
    expect(expandHomeTo("/usr/bin", "/remote/home")).toBe("/usr/bin")
  })
})
