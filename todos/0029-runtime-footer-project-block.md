---
title: runtime footer project block
status: done
priority: medium
type: feature
labels: [pi, ux]
created: 2026-05-16
parent: null
blocked-by: []
blocks: []
---

## Context

Runtime footer is now configurable by block id, but it lacks a compact `project`
block that shows repository/project identity without the full cwd path.

## Acceptance Criteria

- [x] Add new block id `project` to runtime-footer block registry.
- [x] `project` resolves to git root directory name when inside a git repo.
- [x] `project` falls back to current directory name when no git root is found.
- [x] README documents the new block id behavior.

## Affected Files

- `pi/extensions/runtime-footer.ts` — add `project` block + resolution/cache logic.
- `pi/README.md` — document `project` block in available block ids.

## E2E Spec

GIVEN cwd is `~/git/dotagents` inside a git repo
WHEN runtime-footer config includes `project`
THEN the footer renders `dotagents` for that block.

GIVEN cwd is not in a git repo
WHEN runtime-footer config includes `project`
THEN the footer renders the basename of the current directory.

## Notes

Implemented with short-lived cache (similar TTL pattern as git stats) to avoid
shelling out to git on every footer render.
