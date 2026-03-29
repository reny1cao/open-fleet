import { describe, it, expect } from "bun:test"
import { parseActivity, extractRecentActivity, type ActivityEvent } from "../src/core/activity"

describe("parseActivity", () => {
  it("parses incoming Discord message", () => {
    const events = parseActivity("agent1", [
      "← discord · Steve Jobs: Build the feature now"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("discord_in")
    expect(events[0].summary).toContain("Steve Jobs")
    expect(events[0].summary).toContain("Build the feature")
  })

  it("parses outgoing Discord reply", () => {
    const events = parseActivity("agent1", [
      '● plugin:discord:discord - reply (MCP)(chat_id: "123", text: "On it")'
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("discord_out")
  })

  it("parses Discord react", () => {
    const events = parseActivity("agent1", [
      '● plugin:discord:discord - react (MCP)(chat_id: "123", emoji: "👍")'
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("discord_out")
  })

  it("parses sent confirmation", () => {
    const events = parseActivity("agent1", [
      "⎿  sent (id: 1487734512581480540)"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("discord_out")
  })

  it("parses bash command", () => {
    const events = parseActivity("agent1", [
      "● Bash(cd ~/open-fleet && ls -la 2>&1)"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("bash")
    expect(events[0].summary).toContain("$")
  })

  it("parses git commit", () => {
    const events = parseActivity("agent1", [
      '● Bash(cd ~/open-fleet && git commit -m "Fix bug")'
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("git")
    expect(events[0].summary).toBe("Git commit")
  })

  it("parses git push", () => {
    const events = parseActivity("agent1", [
      "● Bash(git push origin master 2>&1)"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("git")
  })

  it("parses test run", () => {
    const events = parseActivity("agent1", [
      "● Bash(cd ~/open-fleet && bun test 2>&1)"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("test")
    expect(events[0].summary).toBe("Running tests")
  })

  it("parses test results", () => {
    const events = parseActivity("agent1", [
      " 134 pass"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("test")
    expect(events[0].summary).toBe("134 tests passed")
  })

  it("parses file operations", () => {
    const events = parseActivity("agent1", [
      "● Read(/home/dev/open-fleet/src/cli.ts)"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("file_op")
  })

  it("parses thinking indicators", () => {
    const events = parseActivity("agent1", [
      "✢ Doing… (30s · ↑ 175 tokens)"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("thinking")
  })

  it("parses completion", () => {
    const events = parseActivity("agent1", [
      "✻ Cooked for 49s"
    ])
    expect(events.length).toBe(1)
    expect(events[0].type).toBe("complete")
  })

  it("filters noise lines", () => {
    const events = parseActivity("agent1", [
      "",
      "──────────────────────",
      "❯",
      "⏵⏵ bypass permissions on",
      "… +12 lines (ctrl+o to expand)",
      "  Shell cwd was reset to /home/dev/.fleet/state/discord-coder",
    ])
    expect(events.length).toBe(0)
  })

  it("strips ANSI codes", () => {
    const events = parseActivity("agent1", [
      "\x1b[32m← discord · Steve: Hello\x1b[0m"
    ])
    expect(events.length).toBe(1)
    expect(events[0].summary).not.toContain("\x1b")
  })

  it("preserves agent name", () => {
    const events = parseActivity("John-Carmack", [
      "● Bash(echo hello)"
    ])
    expect(events[0].agent).toBe("John-Carmack")
  })
})

describe("extractRecentActivity", () => {
  it("returns last N events", () => {
    const lines = [
      "● Bash(cmd1)",
      "● Bash(cmd2)",
      "● Bash(cmd3)",
      "● Bash(cmd4)",
      "● Bash(cmd5)",
    ]
    const events = extractRecentActivity("agent1", lines, 3)
    expect(events.length).toBe(3)
    expect(events[0].summary).toContain("cmd3")
    expect(events[2].summary).toContain("cmd5")
  })

  it("returns all events if fewer than max", () => {
    const events = extractRecentActivity("agent1", ["● Bash(cmd1)"], 10)
    expect(events.length).toBe(1)
  })

  it("returns empty for all-noise input", () => {
    const events = extractRecentActivity("agent1", ["", "─────", "❯"], 10)
    expect(events.length).toBe(0)
  })
})
