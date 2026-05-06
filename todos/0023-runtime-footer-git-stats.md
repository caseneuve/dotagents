---
title: runtime footer git stats
status: closed
priority: medium
type: feature
labels: []
created: 2026-05-06
parent: null
blocked-by: []
blocks: []
---

## Context

The Pi runtime footer shows the current git branch but not how dirty the worktree is. Add compact diff statistics beside the branch so agents can see line churn and file counts without running `git status`.

## Acceptance Criteria

- [ ] Runtime footer shows added/removed line counts next to the git branch when the repo has changes.
- [ ] Added and removed line counts use success/error colors respectively.
- [ ] Footer includes compact file counts for changed, newly added, and untracked files.
- [ ] Clean worktrees keep the existing branch-only footer behavior.

## Affected Files

- `pi/extensions/runtime-footer.ts` — read and render git stats in the footer.
- `pi/README.md` — document the footer's git stats.

## E2E Spec

GIVEN a Pi session in a git repo with tracked changes and untracked files
WHEN the runtime footer renders
THEN the branch segment includes colored `+N/-M` line counts and a compact file-count summary.

## Notes

Use short-lived caching so footer renders do not shell out to git on every paint.
