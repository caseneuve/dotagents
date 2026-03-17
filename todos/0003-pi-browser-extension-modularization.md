---
title: Modularize Pi browser extensions and extract shared overlay code
status: open
priority: medium
type: refactor
created: 2026-03-17
parent: null
blocked-by: []
blocks: [0003.1, 0003.2]
---

## Context

The `agent-journal` and `repo-todos` Pi extensions have both grown past 1k LOC
and now duplicate a lot of overlay, layout, focus, filtering, and rendering
plumbing. We want to preserve the current working single-file extensions as a
reference point while building modularized `*-next` replacements that can later
be swapped in and the monoliths removed.

## Acceptance Criteria

- [ ] A modularized replacement path exists for both browser extensions without
      breaking the current working commands during the transition.
- [ ] Shared overlay/browser utilities extracted from actual duplication in
      both browsers live in one obvious reusable place instead of being copied
      between the two next-generation implementations.
- [ ] Extracted pure helpers are covered by unit tests where practical, and any
      behavior that is not automated has an explicit manual parity checklist in
      the relevant child task.
- [ ] The migration plan ends with one canonical implementation per extension,
      not permanent duplication between old and new paths.
- [ ] Cutover removes legacy browser implementations in the same migration
      phase or immediately after, leaving one canonical command path per
      browser.

## Affected Files

- `pi/extensions/agent-journal.ts` — current reference implementation to keep
  stable during the transition
- `pi/extensions/repo-todos.ts` — current reference implementation to keep
  stable during the transition
- `pi/extensions/shared/` — extracted shared browser helpers
- `pi/extensions/*-next/` — modularized replacement implementations
- `pi/README.md` — document the canonical path once the cutover is complete

## Notes

Build the next-generation versions in parallel first, compare them against the
working originals, then cut over and delete the legacy monoliths promptly.
Avoid creating a permanent two-track setup.
