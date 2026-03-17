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
Shows the current conversational branch context in the status area.

What it does:
- infers the current branch path from the active session leaf
- shows a compact branch name in the footer/status area
- prefers the nearest label/bookmark on the active path when available
- falls back to the split point id when no label exists
- shows extra branch context such as prompt distance and number of sibling paths

Why it exists:
- make tree navigation and branching more legible during long sessions
- surface the current conversational branch without opening `/tree`

### `extensions/runtime-footer.ts`
Replaces the default footer with a denser single-line runtime status.

What it does:
- keeps cwd and git branch on the left side
- keeps model, rounded cost, and context percentage on the right side
- removes the noisier token counters from the default footer
- keeps the layout on a single line with lightweight color emphasis

Why it exists:
- fit the most useful runtime context into one readable line
- reduce footer noise while keeping model, cost, and context pressure visible

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

### `extensions/last-assistant-block.ts`
Adds a `/last-assistant-block` command and `ctrl-x` shortcut for reusing the latest assistant text block.

What it does:
- scans the current branch history for the most recent completed assistant message
- extracts the last text block from that message
- loads that text into the main input editor
- makes it easy to follow up, refine, or press `ctrl-g` to open it in the external editor

Usage:
- `/last-assistant-block`
- `ctrl-x`

Notes:
- works on the current branch only
- extracts the last text block, not tool payloads or non-text content
- leaves the built-in `ctrl-g` external editor flow unchanged

### `extensions/attach-screenshot.ts`
Adds an `/attach-screenshot` command for picking an image in `sxiv` and attaching it to the conversation.

What it does:
- scans the current directory, or a provided relative path, for common image files
- opens matching files in `sxiv` using thumbnail/output mode
- lets you mark one or more candidates with `m` inside `sxiv`
- attaches the selected screenshot back into the current Pi conversation as an image message

Usage:
- `/attach-screenshot`
- `/attach-screenshot path/to/screenshots`

Notes:
- requires `sxiv` to be installed and available on `PATH`
- only works while the agent is idle
- if multiple images are marked, Pi asks which basename to attach

### `extensions/repo-todos.ts`
Adds a `/repo-todos` command for browsing repository todos stored in `./todos/`.

What it does:
- scans the current repo `./todos` directory for todo markdown files
- groups parent items and sub-tasks into a navigable tree
- treats `done`, `closed`, and `completed` as completed state for filtering
- shows a side-by-side list and preview in a centered framed overlay
- supports summary and markdown preview modes
- stays read-only in this first iteration

Usage:
- `/repo-todos`

Keybindings:
- `↑/↓` or `j/k` — move selection / scroll preview
- `←/→` or `h/l` — collapse/expand in the todo tree
- `ctrl-u` / `ctrl-d` — page preview up/down
- `gg` / `G` — jump to top/bottom
- `tab` — switch focus between list and preview
- `s` — toggle sort mode
- `d` — hide/show completed items
- `m` — toggle summary/markdown preview
- `r` — rescan todos
- `q` / `esc` — close

Notes:
- operates on the current working directory only
- intended for todo files following the add-todo-style frontmatter schema
- epics and parents with children can be folded and unfolded

### `extensions/agent-journal.ts`
Adds an `/agent-journal` command for browsing `~/org/agent-journal/` entries in a two-pane overlay.

What it does:
- recursively scans the full journal tree for `.org` entries and sorts them by recency
- parses `#+TITLE`, `#+DATE`, `#+FILETAGS`, and `:LLM_PROJECT:` metadata
- defaults to the current git-root project when that project can be inferred from cwd
- shows a list on the left and an Org-ish formatted preview on the right
- opens the selected entry in `$EDITOR` / `$VISUAL` with `e`

Usage:
- `/agent-journal`

Keybindings:
- `↑/↓` or `j/k` — move selection / scroll preview
- `enter` or `tab` — focus the preview pane and collapse the left list
- `/` or `ctrl-f` — focus the filter input
- `p` — toggle current-project filtering on/off
- `ctrl-u` / `ctrl-d` — page preview up/down
- `gg` / `G` — jump to top/bottom
- `e` — open selected entry in the editor
- `r` — rescan the journal tree
- `q` / `esc` — close

Notes:
- the initial query filter matches title, project, and filetags
- the preview strips Org metadata and drawers, then renders headings and basic inline markup in a cleaner reading view

## Design Notes

These extensions are intentionally small and composable.

The guiding idea is to prefer:
- one focused extension per concern
- reuse of stock pi features where possible
- quick feedback loops
- minimal custom state

over large do-everything workflow extensions.
