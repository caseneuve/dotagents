---
title: session-notes width overflow crash and resume persistence check
status: closed
priority: high
type: bug
labels: [pi, session-notes]
created: 2026-05-16
parent: null
blocked-by: []
blocks: []
---


## Closed: transferred, NOT fixed (2026-11-15)

Canonical unfinished product work is tracked in
`pi-conversation-tools/todos/0001-session-notes-width-overflow-and-persistence-check.md` at
`6d357a27a25a1fc06357ba1ab576266b492df01b`.
The exact existing destination was read and remains OPEN. This dotagents copy is
closed as transferred/superseded, not done: migration smoke/compatibility checks
do not establish that this bug/redesign's complete criteria passed.

Evidence: destination todo's explicit source pointer; destination extraction
todo0005; `~/.cache/pi-migration/evidence/conversation-tools/{handoff,review}.md`.
Original acceptance criteria remain unchecked below. Do not duplicate implementation
in the dormant dotagents copy or close the destination without its own evidence.

## Historical transferred product criteria (still unfinished at destination)

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
