---
title: pi extension alt shortcuts
status: done
priority: medium
type: feature
labels: []
created: 2026-05-13
parent: null
blocked-by: []
blocks: []
---

## Context

Pi overlays that are used frequently should be reachable without typing slash commands. Agent comms already uses an Alt-based shortcut; add matching shortcuts for assistant outline, session notes, and repo todos.

## Acceptance Criteria

- [ ] `Alt+O` opens the assistant outline overlay with the same default behavior as `/assistant-outline`.
- [ ] `Alt+N` opens the session notes overlay with the same behavior as `/session-notes` with no inline note text.
- [ ] `Alt+T` opens the repo todos overlay with the same behavior as `/repo-todos`.
- [ ] `pi/README.md` documents the new shortcuts.

## Affected Files

- `pi/extensions/assistant-outline/index.ts` — register `Alt+O` and share command logic.
- `pi/extensions/session-notes.ts` — register `Alt+N` and share command logic.
- `pi/extensions/repo-todos.ts` — register `Alt+T` and share command logic.
- `pi/README.md` — document shortcuts.

## E2E Spec

GIVEN Pi is running interactively with these extensions loaded
WHEN the user presses `Alt+O`, `Alt+N`, or `Alt+T`
THEN the matching overlay opens as if the corresponding slash command had been run without arguments.

## Notes

Use lowercase shortcut registrations (`alt+o`, `alt+n`, `alt+t`) to match the existing `alt+m` comms shortcut style.
