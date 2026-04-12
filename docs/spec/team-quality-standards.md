# Team Quality Standards

## Why This Exists

April 8 SysBuilder session: the boss found 4 bugs in one sitting that the entire team missed. Features compiled, tests passed, code review approved — but story creation silently dropped data, drag-and-drop flickered, IDs mismatched between frontend and backend, and the confirmation UX required double-clicking. Every bug was visible within 30 seconds of actually *using* the feature.

The root cause wasn't carelessness — it was a missing definition of "done." The team's implicit standard was "code compiles and the tool returns 200." The user's standard was "I can do the thing and it works." This document closes that gap.

## Core Principle: Done Means a User Can Do the Thing

A task is done when a real person can complete the intended action and see the expected result. Not when the code compiles. Not when the API returns 200. Not when the diff looks clean. When the *user journey works end-to-end.*

Every standard below serves this principle.

---

## 1. Acceptance Criteria — Before Coding Starts

Every task must have acceptance criteria written as user actions + visible results before implementation begins. No coding without AC.

### Format

```
AC:
- [ ] User can [action] and sees [result]
- [ ] When [edge case], user sees [expected behavior]
- [ ] [State] persists after [action] (e.g., page refresh, navigation, restart)
```

### Rules

- **Write as user actions, not technical assertions.** "User drags a story to Sprint 2 and it stays there after refresh" — not "moveStory API returns 200 and updates sortedIndex."
- **Include at least one persistence check.** If data should survive a refresh, say so explicitly. This is where the SysBuilder bugs lived — things worked in-session but didn't persist.
- **Include at least one edge case.** Empty input, long text, rapid clicks, concurrent edits. Pick the most likely real-world edge case.
- **Include at least one negative case.** What should happen on bad input, missing data, or unauthorized access? Define the error experience.
- **Keep it to 3-7 criteria.** Fewer than 3 means you haven't thought it through. More than 7 means the task should be split.

### Examples

**Good:**
```
AC:
- [ ] User types a story description and presses Enter — story appears on the board in the correct sprint
- [ ] Story has a unique ID visible on the card
- [ ] After page refresh, the story is still in the correct position
- [ ] Empty description shows a validation message, does not create a blank story
- [ ] User can create 20 stories rapidly without duplicates or missing entries
```

**Bad:**
```
AC:
- [ ] createStory endpoint works
- [ ] Frontend renders story card
- [ ] Tests pass
```

The bad example describes code behavior, not user outcomes. It would pass even if the story appeared in the wrong sprint, had no ID, or disappeared on refresh.

### Who Writes AC

- **Lead** writes AC for tasks they assign. If delegating AC writing to the assignee, review before coding starts.
- **Worker** writes AC for tasks they self-assign. Lead reviews before coding starts.
- **Reviewer** validates AC completeness before approving the review — if AC is weak, send it back.

---

## 2. Definition of Done — Per Phase

### Phase: Spec / Design

- [ ] AC written and reviewed by lead
- [ ] Approach documented (which files change, what the data flow looks like)
- [ ] Dependencies identified (blocked by other tasks? needs API from another agent?)
- [ ] If UI: rough description of what the user sees (doesn't need to be a mockup — words are fine)

### Phase: Implementation

- [ ] All AC items addressed in code
- [ ] Code compiles cleanly (no warnings, no type errors)
- [ ] Existing tests pass — zero regressions
- [ ] New tests for new behavior (if testable without a browser)
- [ ] Self-tested as a user: opened the UI / ran the CLI / hit the API and verified each AC item manually
- [ ] State persistence verified: refreshed the page / restarted the process / re-queried the data
- [ ] Edge case from AC tested

### Phase: Review

- [ ] All gates from [Reviewer Quality Bar](reviewer-quality-bar.md) pass
- [ ] Reviewer exercised the feature in a real environment (not just read the diff)
- [ ] Visual verification for UI changes (screenshot in context)
- [ ] Functional verification for API/CLI changes (run it, show the output)
- [ ] At least one edge case tested by reviewer (different from the one the implementer tested)

### Phase: Verification / Ship

- [ ] Dogfooding: someone (not the implementer) completes a real user task using the feature
- [ ] No open questions or TODOs in the code related to this task
- [ ] Task result updated with summary of what was done
- [ ] If the feature changes data format: migration from old format verified

---

## 3. UX Quality Bar

### The 30-Second Rule

If a user can find a bug within 30 seconds of using a feature, the feature wasn't tested. Before marking a task done, spend 30 seconds using the feature as a real user would. Don't click the button you just implemented — complete the *workflow* the button is part of.

### Visual Standards

- **Alignment:** Elements that should be aligned are aligned. Eyeball it in the browser, not in the code.
- **Spacing:** Consistent with surrounding elements. A 59px collapsed card next to a 46px expanded card is wrong — even if both values are "correct" in isolation.
- **Empty states:** Every list, table, and data view has a defined empty state. Not a blank screen. Not a broken layout.
- **Overflow:** Long text truncates or wraps gracefully. Test with a 200-character story title.
- **Loading:** Operations that take >200ms show a loading indicator. No frozen UI.
- **Error feedback:** Errors produce a visible message the user can act on. No silent failures.

### Interaction Standards

- **Single action, single result.** Clicking a button once does the thing once. No double-submit, no "click twice to confirm" unless explicitly designed as a confirmation step.
- **Undo or confirm for destructive actions.** Delete, move, and status changes that can't be undone should either confirm first or provide undo.
- **Keyboard accessible.** If it has a click handler, it should be focusable and triggerable via Enter/Space.
- **Responsive.** Test at 1280px (laptop) and 768px (tablet). Mobile is nice-to-have, not required.

### Data Integrity Standards

- **What you create, you can see.** If the user creates a story, it appears on the board. If they edit a field, the edit persists. If they delete something, it's gone.
- **IDs are consistent.** The ID shown in the UI matches the ID in the database. The ID in the API response matches the ID in the frontend state.
- **Round-trip integrity.** Create → read back → the data matches. Edit → read back → the edit is there. Delete → read back → it's gone. This sounds obvious. It failed 4 times in one session.

---

## 4. First-Shot Culture

### The Standard

Get it right before pushing. Don't rely on review cycles to catch gaps. The reviewer is a safety net, not a QA team.

### What This Means in Practice

- **Self-review before requesting review.** Read your own diff. Run your own feature. Would you approve this if someone else submitted it?
- **Test the AC yourself.** Every acceptance criterion should be verified by the implementer before the reviewer sees it. If you can't verify it (e.g., no access to the environment), say so explicitly.
- **Don't push known issues.** If you know the empty state is broken, fix it before pushing — don't note it as a "known issue" for the reviewer to track.
- **Ask before guessing.** If you're unsure whether an edge case matters, ask in Discord. A 30-second question prevents a round-trip review cycle.

### What This Does NOT Mean

- **Perfection before pushing.** Ship when the AC is met and you've self-verified. Don't polish indefinitely.
- **No review needed.** Reviews catch things self-review misses. First-shot culture reduces the *number* of review round-trips, not the need for review.
- **Never push WIP.** Feature branches exist for WIP. The standard applies to what goes to review, not what goes to a branch.

---

## 5. Dogfooding Requirement

Before a task moves to `done`, someone other than the implementer must complete a real user task using the feature. This is the final gate.

### What Counts as Dogfooding

- A teammate uses the feature to accomplish something real — not a synthetic test case.
- The dogfooder didn't read the implementation. They follow the user path, not the code path.
- They report what they experienced: what worked, what was confusing, what broke.

### What Doesn't Count

- The implementer testing their own code (that's self-verification, not dogfooding).
- Running automated tests (that's CI, not dogfooding).
- Reading the diff and saying "looks good" (that's code review, not dogfooding).

### When to Skip

- Pure backend/infrastructure changes with no user-facing surface (e.g., task store migration, config refactor).
- Specs and documentation (this document, for instance).
- Emergency hotfixes where dogfooding would delay a critical fix.

When skipping, note why in the task result: `"Dogfooding skipped: infrastructure-only change, no user surface."`

---

## Applying These Standards

### For Workers

1. Read the AC before coding. If AC is missing, write it and get lead approval.
2. Self-verify every AC item before requesting review.
3. Update task status: `in_progress` → `review` (not `done`).
4. In the review request, state what you tested and how.

### For Reviewers

1. Follow the [Reviewer Quality Bar](reviewer-quality-bar.md) checklist.
2. Run the feature — don't just read the diff.
3. Test at least one edge case the implementer didn't.
4. If AC is incomplete, send it back before reviewing code.

### For Lead

1. Write or approve AC before assigning tasks.
2. Assign dogfooding to someone other than the implementer.
3. Don't mark `done` until dogfooding passes.
4. When the boss finds a bug: trace it back to which gate failed, then strengthen that gate.

---

## Anti-Patterns (From Real Incidents)

| What Happened | Which Gate Failed | Fix |
|---------------|-------------------|-----|
| Story created but disappeared on refresh | No persistence check in AC | AC must include "persists after refresh" |
| Drag-and-drop flickered and dropped to wrong position | No self-verification of interaction | Implementer must test the interaction, not just the API |
| Frontend showed ID "story-12" but backend stored "story-013" | No round-trip integrity check | AC must specify: "ID shown matches ID stored" |
| Confirmation required double-click, no user would guess this | No UX review step | 30-second rule: use the feature as a user before pushing |
| API returned 200 but stored empty string for required field | Happy-path-only testing | AC must include negative case: "empty input shows error" |
| Feature worked in dev but broke after restart | No persistence/restart test | Done checklist: "verified after process restart" |
| `mvn compile` not run after Java edits, server had stale code | Self-verification against wrong environment | Done checklist: "verified against running server, not just code" |
