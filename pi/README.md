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
- shows a compact branch name in the footer/status area only when there is branch context to show
- prefers the nearest label/bookmark on the active path when available
- falls back to the split point id when no label exists

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

Adds an `/attach-screenshot` command for picking screenshots in `sxiv` and queueing them into the editor for the next message.

What it does:

- scans the current directory, or a provided relative path, for common image files
- sorts candidates by recency so the newest screenshots appear first in `sxiv`
- opens matching files in `sxiv` using thumbnail/output mode
- lets you mark one or more candidates with `m` inside `sxiv`
- pastes screenshot markers into the editor instead of sending immediately
- converts those markers into real image attachments when you send your next message

Usage:

- `/attach-screenshot`
- `/attach-screenshot path/to/screenshots`
- `/attach-screenshot . -- Please compare these screenshots`

Notes:

- requires `sxiv` to be installed and available on `PATH`
- only works while the agent is idle
- queued screenshots are attached only if their pasted markers remain in the editor when you send
- deleting those markers, or clearing the editor entirely, discards the queued screenshots instead of attaching them

### `extensions/repo-todos.ts`

Adds a `/repo-todos` command for browsing repository todos stored in `./todos/`.

What it does:

- scans the current repo `./todos` directory for todo markdown files
- groups parent items and sub-tasks into a navigable tree
- treats `done`, `closed`, and `completed` as completed state for filtering
- shows a responsive list/preview overlay that switches to a stacked vertical split in narrow terminals
- supports summary and markdown preview modes
- stays read-only in this first iteration

Usage:

- `/repo-todos`

Keybindings:

- `↑/↓` or `j/k` — move selection / scroll preview
- `←/→` or `h/l` — collapse/expand in the todo tree
- `ctrl-u` / `ctrl-d` — page preview up/down
- `gg` / `G` — jump to top/bottom
- `/` or `ctrl-f` — focus the filter input (matches todo id and title)
- `tab` — fold/unfold the selected item
- `enter` — focus/unfocus preview and collapse/restore the list
- `v` — show/hide the preview pane while staying in list view
- `t` — toggle horizontal/vertical split
- `s` — toggle sort mode
- `d` — hide/show completed items
- `m` — mark/unmark the selected todo (from list or preview focus)
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
- shows a responsive list/preview overlay that stacks vertically in narrow terminals
- lets you mark one or more entries with `m` from either list or preview focus
- on close, pastes plain paths for marked entries into the editor
- opens the selected entry in `$EDITOR` / `$VISUAL` with `e`

Usage:

- `/agent-journal`

Keybindings:

- `↑/↓` or `j/k` — move selection / scroll preview
- `enter` or `tab` — focus the preview pane and collapse the left list
- `/` or `ctrl-f` — focus the filter input
- `p` — toggle current-project filtering on/off
- `v` — show/hide the preview pane while staying in list view
- `t` — toggle horizontal/vertical split in list mode
- `ctrl-u` / `ctrl-d` — page preview up/down
- `gg` / `G` — jump to top/bottom
- `m` — mark/unmark the selected entry (from list or preview focus)
- `e` — open selected entry in the editor
- `r` — rescan the journal tree
- `q` / `esc` — close, and load plain paths for marked entries into the editor if any were selected

Notes:

- the initial query filter matches title, project, and filetags
- the preview strips Org metadata and drawers, then renders headings and basic inline markup in a cleaner reading view

### `extensions/usage.ts`

Adds a `/usage` command for fetching and viewing subscription usage in an overlay.

What it does:

- fetches usage only on demand when `/usage` is opened
- reads the ChatGPT subscription token from `~/.codex/auth.json`
- calls the ChatGPT usage endpoint currently used by the local Codex script
- renders usage as compact cards inspired by the web balance view
- highlights the backend that matches the currently active Pi model
- is structured around pluggable backends so additional usage endpoints can be added later

Usage:

- `/usage`

Keybindings:

- `r` — refresh usage
- `q` / `esc` — close

Notes:

- the first backend implementation covers the ChatGPT subscription / `wham/usage` endpoint only
- model-to-backend matching is heuristic for now and can be refined as more backends are added

### `extensions/assistant-outline/`

Adds an `/assistant-outline` command for browsing the latest assistant response as a heading tree and as an extracted shell-commands view.

What it does:

- scans the current branch for the most recent completed assistant message with text content
- parses markdown ATX headings into a navigable outline, with a synthetic root for the whole response
- shows a two-pane outline/preview overlay and collapses into preview-only mode when you press `enter`
- previews the selected heading subtree, so parent headings include their children while leaf headings stay narrow
- lets you open `$EDITOR` / `$VISUAL` on the focused section to capture a stored comment for that section
- persists those comments in Pi session custom entries keyed to the assistant message id
- loads marked sections into the main Pi editor when you close the overlay
- exports section paths by default, and adds comments only for sections that have them, to keep follow-up prompts compact
- adds a commands mode that extracts shell-like fenced code blocks from the whole response, associates them with outline paths, and previews them in a dedicated list/preview view with command checkboxes
- lets you open either the selected extracted command snippet or the full extracted command export in `$EDITOR` / `$VISUAL`
- inserts marked command snippets into the Pi editor without a shebang so they can be used for further discussion with the agent
- copies only bare command text to the clipboard in commands mode, so pasted snippets work directly in a shell

Usage:

- `/assistant-outline`

Keybindings:

- `↑/↓` or `j/k` — move through the outline
- `←/→` or `h/l` — collapse/expand outline nodes
- `tab` — fold/unfold the selected heading
- `enter` — toggle preview-only focus
- `ctrl-u` / `ctrl-d` — page the preview
- `gg` / `G` — jump to top/bottom
- `m` — in outline mode, mark/unmark the selected section for export back into the Pi editor; in commands mode, mark/unmark the selected command snippet for insertion into the Pi editor when the overlay closes
- `y` — in commands mode, copy the selected command snippet's bare code to the system clipboard
- `e` — in outline mode, open the focused section in the external editor with an editable comment block; in commands mode, open the selected command snippet in `$EDITOR`
- `E` — in commands mode, open the full extracted commands export in `$EDITOR`
- `c` — toggle between outline mode and commands mode
- `r` — reload from the latest assistant response on the current branch
- `t` — toggle horizontal/vertical split when not in preview-only mode
- `q` / `esc` — close, loading marked sections into the editor and including comments where present

Notes:

- the outline view parses ATX headings (`#` through `######`) and ignores headings inside fenced code blocks
- the commands view extracts shell-like fenced code blocks (`bash`, `sh`, `shell`, `zsh`, plus untyped shell-looking blocks) and splits them by blank-line-separated command chunks
- external-editor command exports normalize to a single top-level bash shebang, while Pi-editor insertion stays shebang-free
- comments are stored separately from the assistant response; the overlay treats the section text as reference content and the comment block as the editable part

### `extensions/playwright/`

Adds native Playwright browser-debug tools for frontend verification loops.

What it does:

- exposes browser actions as first-class tools (`playwright_open`, `playwright_query`, `playwright_hover`, etc.)
- returns structured outputs for DOM queries, computed styles, waits, screenshots, and console errors
- keeps one browser session alive across tool calls for fast iterate-fix-verify cycles
- enforces URL policy for navigation and network interception with allow/deny rules (allowlist-only)
- ships with a safe default policy that allows only `http://localhost:3000`
- includes `/playwright-settings` for interactive policy editing

Notes:

- policy is stored project-locally at `.pi/playwright-policy.json`
- install extension-local dependencies with Bun in `pi/extensions/playwright/`

## Design Notes

These extensions are intentionally small and composable.

The guiding idea is to prefer:

- one focused extension per concern
- reuse of stock pi features where possible
- quick feedback loops
- minimal custom state

over large do-everything workflow extensions.
