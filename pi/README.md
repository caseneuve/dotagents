# pi

Pi-specific themes and extensions for this dotagents repo.

## Contents

- `extensions/` — small focused extensions following a composable, Unix-style philosophy
- `themes/` — custom themes

These resources are intended to be linked into Pi's default discovery locations under:

- `~/.pi/agent/extensions/`
- `~/.pi/agent/themes/`

## Extensions

### `extensions/branch-status.ts`
Shows the current branch context in the status area.

What it does:
- infers the current branch path from the active session leaf
- shows a compact branch name in the footer/status area
- prefers the nearest label/bookmark on the active path when available
- falls back to the split point id when no label exists
- shows extra branch context such as prompt distance and number of sibling paths

Why it exists:
- make tree navigation and branching more legible during long sessions
- surface the current conversational branch without opening `/tree`

### `extensions/bookmark.ts`
Adds a `/bookmark` command for quickly labeling a prompt on the current branch.

What it does:
- shows a simple picker of user prompts from the active branch only
- lets the user choose which prompt should receive a label
- prompts for a label name, unless one is provided as an argument
- applies the label using pi bookmarks so it appears in `/tree`
- emits an update event so `branch-status` refreshes immediately after adding a bookmark

Usage:
- `/bookmark`
- `/bookmark my-label`

Notes:
- prompt selection is restricted to the current branch path
- labels can later be edited or removed in the standard `/tree` UI

## Design Notes

These extensions are intentionally small and composable.

The guiding idea is to prefer:
- one focused extension per concern
- reuse of stock pi features where possible
- quick feedback loops
- minimal custom state

over large do-everything workflow extensions.
