---
title: pi repo-todos falls back to git root todos
status: done
priority: low
type: feature
labels: []
created: 2026-05-13
parent: null
blocked-by: []
blocks: []
---

## Context

`/repo-todos` only discovers todos in `./todos` relative to pi's cwd. When
pi is launched from a subdirectory of a repo, the overlay shows nothing
even though the repo has a populated `todos/` at its root. Users expect
the overlay to track the repo's todos regardless of which subdir pi was
started in.

## Acceptance Criteria

- [x] If `./todos` exists, use it (unchanged behavior).
- [x] If `./todos` does not exist, locate the git root via
      `git rev-parse --show-toplevel` and use `<git-root>/todos` when it
      exists.
- [x] If neither exists, surface a single clear "No todos directory found"
      issue listing the paths that were searched.
- [x] Subtitle indicates when the resolved directory is a fallback.
- [x] Drop the previously unused `todo` / `tasks` directory aliases — only
      `todos` is supported.

## Affected Files

- `pi/extensions/repo-todos.ts` — replace multi-shape directory scan with
  cwd-then-git-root resolution; surface fallback in the header.

## E2E Spec

GIVEN a repo with `todos/0001-foo.md` at its root
AND pi started from a subdirectory of that repo with no local `todos/`
WHEN the user opens `/repo-todos`
THEN the overlay lists `0001-foo` and the subtitle shows the git-root
     todos path tagged `(fallback)`.

## Notes

- Local `./todos` always wins — git root is only consulted when the cwd
  has no `todos/` directory.
- Outside a git checkout the behavior degrades to the previous
  empty-state with a clearer message.
