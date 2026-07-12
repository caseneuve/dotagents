---
title: Make session notes session-wide
status: open
priority: medium
type: bug
labels: []
created: 2026-07-12
parent: null
blocked-by: []
blocks: []
---

## Context

`session-notes` currently reconstructs its state from the active conversation branch. Navigating with `/tree` can therefore replace the visible notes and footer count with a branch-local snapshot. Notes are intended to belong to the session as a whole, independently of the selected point in its conversation tree.

New sessions, including sessions created by `/fork` or `/clone`, must start without notes rather than inheriting snapshots copied from the source session.

## Acceptance Criteria

- [ ] `/session-notes` resolves the latest notes state for the whole current session rather than the active branch.
- [ ] Navigating between branches with `/tree` does not change the notes or their footer status.
- [ ] Note create, edit, status, and delete operations remain visible from every branch in the same session.
- [ ] `/new`, `/fork`, and `/clone` start with no notes; resuming the same session restores its notes.
- [ ] Legacy note snapshots have an explicit, tested compatibility policy.
- [ ] Pi documentation describes session-wide behavior and the new-session/fork boundary accurately.
- [ ] Extension type-checks and focused tests pass.

## Affected Files

- `pi/extensions/session-notes.ts` — resolve and persist session-wide note state and enforce new-session boundaries.
- `test/pi/session-notes.test.ts` — cover branch-independent resolution, legacy snapshots, and fork/reset semantics.
- `pi/README.md` — replace branch-aware documentation with session-wide semantics.

## E2E Spec

GIVEN a session with notes and multiple conversation branches
WHEN the user navigates between branches with `/tree`
THEN every branch shows the same latest notes and footer count

GIVEN a session containing notes
WHEN the user creates a new session with `/new`, `/fork`, or `/clone`
THEN the new session starts with no notes
AND resuming the original session restores its notes

## Notes

Pi custom entries always occupy a tree position because `pi.appendEntry()` attaches them to the current leaf. Session-wide behavior can still be implemented by resolving snapshots independently of ancestry.

Fork and clone paths may physically copy custom entries from the selected source path, so merely switching reads from `getBranch()` to `getEntries()` is insufficient. The implementation must establish an explicit session identity/reset boundary without breaking resume behavior or legacy sessions.
