---
title: runtime footer context format modes
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

`runtime-footer` currently renders context as a percentage only. We want selectable
context formats so users can choose between literal `%`, a progress bar, or block
glyph mode.

## Acceptance Criteria

- [x] Add `context.mode` config with values: `percent` (default), `bar`, `blocks`.
- [x] Add `context.barWidth` config for bar mode.
- [x] Keep `percent` mode behavior consistent with current thresholds.
- [x] In `bar` and `blocks` modes, color by context pressure with green only in low usage range (<=20%).
- [x] Update runtime-footer docs and config example.

## Affected Files

- `pi/extensions/runtime-footer.ts` — parse config + render context block modes.
- `pi/README.md` — document `context.mode` and `context.barWidth`.

## E2E Spec

GIVEN runtime-footer config is set to each context mode
WHEN footer renders with varying context usage
THEN context block renders as `%` / bar-only / blocks accordingly
AND color transitions follow configured thresholds.

## Notes

This is step 5 of iterative runtime-footer improvements.
