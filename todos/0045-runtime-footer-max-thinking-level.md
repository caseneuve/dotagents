---
title: runtime footer max thinking level
status: done
priority: medium
type: bug
labels: []
created: 2026-07-10
parent: null
blocked-by: []
blocks: []
---

## Context

Pi added the `max` thinking level, but the runtime-footer block mapping did
not include it. The prior `xhigh` and `max` presentation was also identical.

## Acceptance Criteria

- [x] Default block mappings include `max` and use a unique glyph for every supported level.
- [x] `xhigh` and `max` render with distinct tones.
- [x] Regression tests cover mappings and tones.

## Affected Files

- `pi/extensions/runtime-footer.ts` — default mappings and thinking-level tones.
- `pi/README.md` — documented mapping example.
- `test/pi/runtime-footer.test.ts` — mapping and tone regression tests.

## E2E Spec

GIVEN the footer uses `thinking.mode: "blocks"`
WHEN Pi reports each supported thinking level, including `max`
THEN every level uses a distinct glyph, and `max` uses a stronger tone than `xhigh`.

## Notes

Existing user config files override defaults and must be updated separately.
