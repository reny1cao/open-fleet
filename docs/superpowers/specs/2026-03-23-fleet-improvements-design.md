# Fleet Improvements — 7 Fixes

## A. stateDir Collision (critical)

**Problem:** Two fleets' first agents share `~/.claude/channels/discord`. They overwrite each other's identity.md and access.json.

**Fix:** Remove "first agent" special case in `resolveStateDir()`. All agents use `~/.fleet/state/<fleetName>-<agentName>`.

**Files:** `src/core/config.ts`, `test/config.test.ts`

## B. Guild Detection

**Problem:** `init` takes `listServers()[0]` — wrong when bot is in multiple guilds.

**Fix:** Add `--guild` flag to `init`. If bot is in multiple guilds and no `--guild` provided, error with list of guilds to choose from.

**Files:** `src/commands/init.ts`, `src/cli.ts`

## C. `fleet move` Command

**Problem:** Changing agent server requires manual YAML editing.

**Fix:** New command: `fleet move <agent> <server>`. Reads config, updates `agent.server`, saves config. Validates server exists in `servers` section (or is "local").

**Files:** New `src/commands/move.ts`, `src/cli.ts`

## D. Bot Invitation Check

**Problem:** `init` doesn't verify bots are in the target guild. Results in @unknown-user.

**Fix:** After init completes, for each bot token call `listServers()` and check target guild is present. If missing, print invite URL + warning.

**Files:** `src/commands/init.ts`

## E. `fleet use` Command

**Problem:** `config.json` stores one `defaultFleet`. No way to switch between fleets.

**Fix:** New command: `fleet use <path>`. Updates `~/.fleet/config.json` `defaultFleet` to the given directory. If the argument is a fleet name (not a path), scan known fleet directories.

To support name-based lookup, `config.json` gains a `fleets` registry:
```json
{
  "defaultFleet": "/path/to/fleet-dev",
  "fleets": {
    "dev": "/path/to/fleet-dev",
    "content": "/path/to/fleet-content"
  }
}
```

`fleet init` and `fleet use` both register into `fleets`. `fleet use dev` → lookup in registry → set defaultFleet.

**Files:** New `src/commands/use.ts`, `src/core/config.ts` (writeGlobalConfig), `src/cli.ts`, `src/commands/init.ts` (register fleet)

## F. SKILL.md Update

**Problem:** Still references `channel_id` format; missing `fleet move` and `fleet use` docs.

**Fix:** Update SKILL.md with current `channels` format, add new commands.

**Files:** `skill/SKILL.md`

## G. Init Auto-Create Channel

**Problem:** Must manually create Discord channel before init.

**Fix:** Add `--create-channel name` flag to init. Calls Discord API to create text channel in the detected/specified guild, uses returned ID.

**Files:** `src/commands/init.ts`, `src/cli.ts`

## Dependencies

A, B, C, D, E, G are independent. F depends on all others completing first.

## Testing

- A: update existing resolveStateDir tests
- C: new test for move command
- E: new test for use command + config registry
- B, D, G: manual testing (Discord API calls)
