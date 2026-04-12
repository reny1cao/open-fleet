# Reviewer Quality Bar

What "done" means before approving a change. Every review must pass all applicable gates.

## Gate 1 — Compilation & Tests

- [ ] Code compiles cleanly (`bun build` / `tsc` / framework equivalent)
- [ ] Existing tests pass — no regressions
- [ ] New tests added for new behavior (if applicable)
- [ ] Linter/formatter passes with no new warnings

## Gate 2 — Code Correctness

- [ ] Logic matches the stated intent (PR description, task, spec)
- [ ] Edge cases handled: empty input, max length, zero/null, concurrent access
- [ ] Error paths are reachable and produce useful messages
- [ ] No silent swallowing of errors (`catch {}` with no handling)
- [ ] State transitions are valid — check that every status/mode change follows documented rules
- [ ] No dead code introduced (unreachable branches, unused imports, orphan functions)

## Gate 3 — Security

- [ ] No secrets, tokens, or credentials in committed code
- [ ] User input validated at system boundaries (CLI args, HTTP params, env vars)
- [ ] No command injection, path traversal, or template injection vectors
- [ ] Auth checks present on protected endpoints — verify, don't assume

## Gate 4 — HTML & Component Correctness (UI changes)

- [ ] No nested interactive elements: `<button>` inside `<button>`, `<a>` inside `<a>`
  - Common trap: shadcn/radix triggers (`PopoverTrigger`, `DialogTrigger`) render a `<button>` — if the child is also a `<button>`, it's invalid HTML. Fix with `asChild` or change the inner element.
- [ ] Semantic HTML: correct heading levels, landmark elements, form labels
- [ ] No broken element nesting (`<p>` inside `<p>`, block elements inside inline)
- [ ] Responsive behavior: does it break at narrow widths or with long content?

## Gate 5 — Visual Verification (UI changes)

**Never approve UI changes from diff alone.** Run the app and look at it.

- [ ] Start the dev server and exercise the changed feature in a browser
- [ ] Screenshot the change **in context** — include surrounding elements, not just the changed component in isolation
- [ ] Compare relative sizing, alignment, and visual weight against adjacent elements
- [ ] Check empty state (no data), overflow state (long text, many items), and loading state
- [ ] If the change touches a list/grid, verify items look correct next to each other — not just one item alone

## Gate 6 — Functional Verification

**Never approve based on reading the diff alone.** Test the actual behavior.

- [ ] Exercise the golden path — does the feature work as described?
- [ ] Test at least one error/edge path — what happens on bad input, missing data, timeout?
- [ ] If it's a CLI command: run it with valid args, invalid args, missing args, and `--help`
- [ ] If it's an API endpoint: hit it with curl/fetch — verify status codes, response shape, error responses
- [ ] If it touches state (task store, config, database): verify reads and writes round-trip correctly
- [ ] Check for regressions in adjacent features — did fixing X break Y?

## Gate 7 — Integration

- [ ] Change works with both local and HTTP API paths (if applicable to fleet)
- [ ] Notifications/side-effects fire correctly (Discord messages, file writes, state updates)
- [ ] No assumptions about execution order or timing that could break under load
- [ ] If schema changed: migration from old format works, old clients degrade gracefully

## How to Report

When posting review results:

1. **State the verdict first:** PASS, FAIL, or PASS with nits
2. **List what you tested** — not just what you read
3. **For failures:** exact reproduction steps, expected vs. actual behavior
4. **For nits:** clearly mark as non-blocking, explain why it matters

## Anti-Patterns (things that have burned us)

- **Diff-only review:** Reading code and saying "looks good" without running it. Misses runtime bugs, hydration errors, visual regressions.
- **Property-in-isolation review:** Checking that a CSS value is correct without viewing it next to its neighbors. A 59px collapsed card next to a 46px expanded card is obviously wrong in context.
- **Type-system trust:** `tsc` passing doesn't mean the HTML is valid or the UI works. Nested interactive elements, invalid nesting, and runtime-only failures all pass type checking.
- **Happy-path-only testing:** Verifying the feature works with good input and calling it done. The bugs live in the edge cases.
