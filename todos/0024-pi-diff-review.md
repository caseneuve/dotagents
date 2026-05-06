---
title: pi diff review
status: in_progress
priority: medium
type: feature
labels: []
created: 2026-05-06
parent: null
blocked-by: []
blocks: []
---

## Context

Humans need a lightweight way to inspect an agent's git diff, leave targeted comments near changed code, and feed only those comments back to the agent instead of context-mongering the full diff.

## Acceptance Criteria

- [ ] Pi exposes a slash command for reviewing the current worktree diff in `$VISUAL`/`$EDITOR`.
- [ ] The review artifact opens as a diff and supports natural inline comments without marker syntax.
- [ ] Only structured review comments are sent back to the agent as a follow-up message.
- [ ] Review artifacts are written under `/tmp/pi-diff-reviews/`.

## Affected Files

- `pi/extensions/diff-review.ts` — new editor-backed diff review command.
- `pi/README.md` — document the MVP workflow.

## E2E Spec

GIVEN a Pi session in a dirty git repo
WHEN the human runs `/diff-review`, edits the generated review file, and adds inline `REVIEW` comments
THEN the agent receives a concise follow-up containing only the review comments and file/hunk anchors.

## Notes

MVP intentionally reuses the user's editor rather than implementing a full diff browser inside Pi TUI.
