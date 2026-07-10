---
title: add a cross-platform screenshot picker for Pi workbench
status: open
priority: low
type: feature
labels: [pi, workbench, follow-up]
created: 2026-07-10
parent: null
blocked-by: [0027.3]
blocks: []
---

## Context

The extracted attach-screenshot extension preserves its current `sxiv`-based workflow and platform
limitations. Add a deliberate Linux/macOS abstraction later rather than changing behavior during
packaging.

No existing todo covers a macOS screenshot picker or a cross-platform selection adapter.

## Acceptance Criteria

- [ ] Specify current Linux behavior and desired common selection/queue contract.
- [ ] Select and document supported Linux and macOS picker backends plus dependency detection/fallback behavior.
- [ ] Preserve marker queueing, cancellation, multi-selection, and next-message attachment semantics.
- [ ] Add platform-focused tests where automation is practical and manual verification steps otherwise.

## E2E Spec

GIVEN supported picker dependencies on Linux or macOS
WHEN the user selects, cancels, or removes one or more queued screenshots
THEN the next-message attachment behavior is consistent across supported backends.

## Notes

Do not block `0027.3` on macOS expansion.
