---
title: suspend tui for external editors
status: done
priority: high
type: bug
labels: []
created: 2026-08-09
parent: null
blocked-by: []
blocks: []
---

## Context

External editors launched by Pi extensions inherit the fullscreen TUI's raw terminal mode. Emacsclient then receives Pi's key handling state, so control keys and exit sequences behave incorrectly. Every command that launches an editor directly must suspend the TUI before spawning it and restore the TUI afterward.

## Acceptance Criteria

- [x] Diff review, cwd editor, and runtime-footer editor commands suspend the TUI while an external editor runs.
- [x] Emacsclient receives normal terminal input (including Ctrl+D and Evil-mode sequences), and Pi redraws cleanly after the editor exits.
- [x] Existing editor error reporting and non-interactive behavior remain unchanged.

## Affected Files

- `pi/extensions/diff-review.ts` — suspend TUI around diff editor.
- `pi/extensions/cwd-editor.ts` — suspend TUI around cwd editor.
- `pi/extensions/runtime-footer.ts` — suspend TUI around config editor.
- `pi/extensions/shared/external-editor.ts` — shared suspended-editor helper (if useful).
- `test/pi/...` — cover helper behavior where practical.

## E2E Spec

GIVEN Pi is running in fullscreen TUI mode with `$EDITOR=emacsclient`
WHEN a command opens an external editor
THEN the TUI is stopped before spawning, the editor has direct terminal input, and the TUI restarts and redraws after exit.

## Notes

Extensions that already run inside `ctx.ui.custom` overlays (repo-todos, session-notes, agent-journal, assistant-outline) already call `tui.stop()`/`tui.start()` and should retain that behavior.
