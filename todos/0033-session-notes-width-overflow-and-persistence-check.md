---
title: session-notes width overflow crash and resume persistence check
status: open
priority: high
type: bug
labels: [pi, session-notes]
created: 2026-05-16
parent: null
blocked-by: []
blocks: []
---

## Context

Two regressions are suspected in `session-notes`:

1. Rendering crash when entering custom notes in narrow terminals:
   `Rendered line ... exceeds terminal width` from pi-tui.
2. Possible note persistence issue after restoring a session with `pi -r`.

## Acceptance Criteria

- [ ] Reproduce and fix width overflow crash in `session-notes` overlay.
- [ ] Ensure all rendered lines are width-safe under narrow terminal widths.
- [ ] Investigate persistence behavior after `pi -r` restore.
- [ ] If persistence bug exists, fix it; otherwise document why behavior is correct and what to watch for.
- [ ] Update docs if user-visible behavior changes.

## Affected Files

- `pi/extensions/session-notes.ts`
- `pi/README.md` (if behavior docs need updates)

## E2E Spec

GIVEN a narrow terminal and a session with session-notes enabled
WHEN I open `/session-notes` and add/edit notes
THEN the overlay renders without width overflow exceptions.

GIVEN notes were added in a previous session
WHEN I resume with `pi -r`
THEN notes remain present for the resumed branch/session as expected.

## Notes

Track both issues in one bug item first; split if they prove independent.
