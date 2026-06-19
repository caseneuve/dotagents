---
title: Replace /diff-review with /diff + focused alias commands
status: done
priority: medium
type: chore
labels: []
created: 2026-06-18
parent: null
blocked-by: []
blocks: []
---

## Context

Replace the redundant `/diff-review` + `/diff` alias pair with `/diff` as the single primary command, plus four focused no-argument alias commands (`/diff-dirty`, `/diff-staged`, `/diff-latest`, `/diff-vs-master`) for the most common review modes.

## Acceptance Criteria

- [x] `/diff` is the primary command with full argument completions.
- [x] `/diff-dirty`, `/diff-staged`, `/diff-latest`, `/diff-vs-master` registered as focused aliases.
- [x] `getArgumentCompletions` derives entries from `FIXED_ARG_ALIASES` (single source of truth).
- [x] `ctx` typed as `ExtensionCommandContext` (no more `Parameters<...>` gymnastics).
- [x] `pi/README.md` updated to reflect new command surface.

## Affected Files

- `src/...` — what changes here
- `test/...` — what to test

## Notes

[Constraints, gotchas, related issues.]
